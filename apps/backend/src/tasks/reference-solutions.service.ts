import { InjectQueue } from '@nestjs/bullmq';
import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Queue } from 'bullmq';
import { randomUUID } from 'crypto';
import { execFile } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { request as undiciRequest } from 'undici';
import { promisify } from 'util';
import { Repository } from 'typeorm';
import { RepositoryAnalysisEntity } from '../analysis/entities/repository-analysis.entity';
import { RepositoryEntity } from '../repositories/entities/repository.entity';
import { RepositorySnapshotEntity } from '../repositories/entities/repository-snapshot.entity';
import { ReferenceSolutionEntity } from './entities/reference-solution.entity';
import { TaskEntity } from './entities/task.entity';
import { TaskGenerationEntity } from './entities/task-generation.entity';
import { TaskVersionEntity } from './entities/task-version.entity';

type Provider = 'openrouter' | 'ollama';
type BuildOrTestStatus = 'not_run' | 'passed' | 'failed';
const execFileAsync = promisify(execFile);
const MAX_PATCH_REPAIR_CHARS = 30_000;
const MAX_PATCH_REPAIR_ERROR_CHARS = 2_000;

interface GenerateReferenceInput {
  reviewerFeedback?: unknown;
}

interface ReferenceGenerationResponse {
  operation_id: string;
  status: string;
  provider: string;
  model: string;
  prompt_version: string;
  implementation_plan?: Record<string, unknown>[];
  patches?: GeneratedRepositoryPatch[];
  tests?: Record<string, unknown>[];
  context_manifest?: Record<string, unknown>;
  validation?: Record<string, unknown>;
}

interface GeneratedRepositoryPatch {
  repository_id: string;
  patch_diff: string;
}

interface PatchRepairRequest {
  repositoryId: string;
  patchDiff: string;
  error: string;
}

class GeneratedPatchPreflightError extends Error {
  constructor(
    readonly repositoryId: string,
    readonly patchDiff: string,
    cause: unknown,
  ) {
    super(cause instanceof Error ? cause.message : 'The generated patch failed pinned-snapshot preflight.');
    this.name = GeneratedPatchPreflightError.name;
  }
}

interface ReviewInput {
  action?: unknown;
  note?: unknown;
}

interface ValidationInput {
  buildStatus?: unknown;
  testStatus?: unknown;
  notes?: unknown;
}

@Injectable()
export class ReferenceSolutionsService {
  private readonly logger = new Logger(ReferenceSolutionsService.name);
  private readonly storagePath = process.env.ARTIFACT_STORAGE_PATH
    ? path.resolve(__dirname, '../../../../', process.env.ARTIFACT_STORAGE_PATH)
    : path.resolve(__dirname, '../../../../storage');

  constructor(
    @InjectQueue('reference-generation')
    private readonly referenceQueue: Queue,
    private readonly config: ConfigService,
    @InjectRepository(TaskEntity)
    private readonly tasks: Repository<TaskEntity>,
    @InjectRepository(TaskGenerationEntity)
    private readonly generations: Repository<TaskGenerationEntity>,
    @InjectRepository(TaskVersionEntity)
    private readonly taskVersions: Repository<TaskVersionEntity>,
    @InjectRepository(ReferenceSolutionEntity)
    private readonly references: Repository<ReferenceSolutionEntity>,
    @InjectRepository(RepositoryAnalysisEntity)
    private readonly analyses: Repository<RepositoryAnalysisEntity>,
    @InjectRepository(RepositorySnapshotEntity)
    private readonly snapshots: Repository<RepositorySnapshotEntity>,
    @InjectRepository(RepositoryEntity)
    private readonly repositories: Repository<RepositoryEntity>,
  ) {}

  async generate(taskId: string, input: GenerateReferenceInput = {}) {
    const task = await this.findTask(taskId);
    if (!task.generationId) {
      throw new BadRequestException('This task has no task-generation record to select its AI provider.');
    }
    const generation = await this.generations.findOneBy({ id: task.generationId });
    if (!generation || (generation.provider !== 'openrouter' && generation.provider !== 'ollama')) {
      throw new BadRequestException('The task generation has no supported OpenRouter or Ollama provider.');
    }
    const reviewerFeedback = input.reviewerFeedback;
    if (reviewerFeedback !== undefined &&
      (typeof reviewerFeedback !== 'string' || reviewerFeedback.length > 2000)) {
      throw new BadRequestException('Reviewer feedback must be a string of at most 2,000 characters.');
    }
    const taskVersion = await this.taskVersions.findOneBy({
      taskId,
      version: task.currentVersion,
    });
    if (!taskVersion) {
      throw new BadRequestException('The current task version is unavailable.');
    }
    const previous = await this.references.findOne({
      where: { taskId },
      order: { version: 'DESC' },
    });
    const feedback = typeof reviewerFeedback === 'string' && reviewerFeedback.trim()
      ? reviewerFeedback.trim()
      : previous?.status === 'changes_requested'
        ? previous.reviewNote ?? ''
        : '';
    const reference = await this.references.save(this.references.create({
      taskId,
      taskVersion: task.currentVersion,
      version: (previous?.version ?? 0) + 1,
      status: 'queued',
      provider: generation.provider,
      input: {
        taskId,
        projectId: task.projectId,
        taskVersion: task.currentVersion,
        provider: generation.provider,
        task: taskVersion.content,
        baselineManifest: task.baselineManifest,
        reviewerFeedback: feedback,
      },
      validation: {
        patch_format: 'not_run',
        patch_preflight: 'not_run',
        test_files_present: 'not_run',
        apply_status: 'not_applied',
        build: 'not_run',
        tests: 'not_run',
        execution_mode: 'not_run',
      },
    }));
    try {
      await this.referenceQueue.add(
        'generate',
        { referenceId: reference.id },
        { jobId: reference.id, attempts: 1, removeOnComplete: 100, removeOnFail: 100 },
      );
    } catch (error) {
      reference.status = 'failed';
      reference.errorMessage = 'Reference generation could not be queued. Check the Redis connection and try again.';
      await this.references.save(reference);
      this.logger.error(
        `Could not enqueue reference generation ${reference.id}.`,
        error instanceof Error ? error.stack : undefined,
      );
      throw new ServiceUnavailableException(reference.errorMessage);
    }
    return reference;
  }

  async listForTask(taskId: string) {
    await this.findTask(taskId);
    return this.references.find({
      where: { taskId },
      order: { version: 'DESC' },
      take: 50,
    });
  }

  async get(referenceId: string) {
    return this.findReference(referenceId);
  }

  async applyPatches(referenceId: string) {
    const reference = await this.findReference(referenceId);
    if (reference.status !== 'pending_review') {
      throw new BadRequestException('Only a generated reference awaiting review can be applied.');
    }
    if (!reference.patches?.length) {
      throw new BadRequestException('This reference has no code patches to apply.');
    }
    if (reference.validation.apply_status === 'applying') {
      throw new BadRequestException('Patch application is already in progress.');
    }
    const existingWorkspace = reference.validation.workspace as { status?: string } | undefined;
    const workspaceRoot = this.workspacePath(reference.id);
    if (existingWorkspace?.status === 'applied' && fs.existsSync(workspaceRoot)) {
      return reference;
    }
    if (fs.existsSync(workspaceRoot)) {
      throw new BadRequestException(
        'A partial review workspace already exists. Remove it before applying this reference again.',
      );
    }

    const baselines = await this.resolveBaseline(reference.input.baselineManifest);
    const baselineById = new Map(
      baselines.map((baseline) => [baseline.repository_id as string, baseline]),
    );
    const patchByRepository = new Map<string, string>();
    for (const patch of reference.patches) {
      if (patchByRepository.has(patch.repository_id)) {
        throw new BadRequestException('A reference may contain only one patch bundle per repository.');
      }
      patchByRepository.set(patch.repository_id, patch.patch_diff);
    }
    const testsByRepository = new Map<string, Array<Record<string, unknown>>>();
    for (const test of reference.tests ?? []) {
      if (typeof test.repository_id !== 'string' || typeof test.file_path !== 'string'
        || typeof test.content !== 'string' || !this.isSafeRelativePath(test.file_path)) {
        throw new BadRequestException('A generated test file contains invalid repository or path data.');
      }
      const current = testsByRepository.get(test.repository_id) ?? [];
      current.push(test);
      testsByRepository.set(test.repository_id, current);
    }

    const repositoryIds = new Set([...patchByRepository.keys(), ...testsByRepository.keys()]);
    for (const repositoryId of repositoryIds) {
      if (!baselineById.has(repositoryId) || !/^[a-zA-Z0-9_-]{1,128}$/.test(repositoryId)) {
        throw new BadRequestException('A patch or test refers to a repository outside the pinned baseline.');
      }
    }

    const workspaceParent = path.dirname(workspaceRoot);
    this.assertStoragePath(workspaceRoot);
    await fs.promises.mkdir(workspaceParent, { recursive: true });
    const stagingRoot = path.join(workspaceParent, `${reference.id}.tmp-${randomUUID()}`);
    reference.validation = {
      ...reference.validation,
      apply_status: 'applying',
      apply_error: null,
      workspace: null,
    };
    await this.references.save(reference);

    let workspaceCreated = false;
    try {
      const workspaceRepositories: Array<Record<string, unknown>> = [];
      for (const repositoryId of repositoryIds) {
        const baseline = baselineById.get(repositoryId)!;
        const sourcePath = baseline.repository_path;
        if (typeof sourcePath !== 'string') {
          throw new BadRequestException('A pinned repository checkout path is invalid.');
        }
        const repositoryPath = path.join(stagingRoot, 'repositories', repositoryId);
        await fs.promises.mkdir(path.dirname(repositoryPath), { recursive: true });
        await fs.promises.cp(sourcePath, repositoryPath, {
          recursive: true,
          filter: (source) => this.shouldCopySnapshotEntry(source),
        });

        const patch = patchByRepository.get(repositoryId);
        if (patch) {
          const patchesPath = path.join(stagingRoot, '.patches');
          await fs.promises.mkdir(patchesPath, { recursive: true });
          const patchPath = path.join(patchesPath, `${repositoryId}.patch`);
          await fs.promises.writeFile(patchPath, patch, { flag: 'wx' });
          await this.applyGitPatch(repositoryPath, patchPath, true);
          await this.applyGitPatch(repositoryPath, patchPath, false);
        }

        for (const test of testsByRepository.get(repositoryId) ?? []) {
          const relativePath = test.file_path as string;
          const destination = path.resolve(repositoryPath, relativePath);
          const relativeDestination = path.relative(repositoryPath, destination);
          if (!relativeDestination || relativeDestination.startsWith('..')
            || path.isAbsolute(relativeDestination)) {
            throw new BadRequestException('A generated test file is outside its review workspace.');
          }
          const content = test.content as string;
          if (fs.existsSync(destination)) {
            const existing = await fs.promises.readFile(destination, 'utf8');
            if (existing !== content) {
              throw new BadRequestException(
                `Generated test ${relativePath} would overwrite an existing file in the review workspace.`,
              );
            }
          } else {
            await fs.promises.mkdir(path.dirname(destination), { recursive: true });
            await fs.promises.writeFile(destination, content, { flag: 'wx' });
          }
        }

        const commands = this.suggestBuildAndTestCommands(repositoryPath);
        workspaceRepositories.push({
          repository_id: repositoryId,
          repository_name: baseline.repository_name,
          directory: path.posix.join('repositories', repositoryId),
          build_commands: commands.build,
          test_commands: commands.tests,
        });
      }

      await fs.promises.rm(path.join(stagingRoot, '.patches'), { recursive: true, force: true });
      await fs.promises.rename(stagingRoot, workspaceRoot);
      workspaceCreated = true;
      reference.validation = {
        ...reference.validation,
        apply_status: 'applied',
        apply_error: null,
        workspace: {
          status: 'applied',
          applied_at: new Date().toISOString(),
          repositories: workspaceRepositories,
        },
        build: 'not_run',
        tests: 'not_run',
        execution_mode: 'not_run',
      };
      return this.references.save(reference);
    } catch (error) {
      await fs.promises.rm(stagingRoot, { recursive: true, force: true });
      if (workspaceCreated) {
        await fs.promises.rm(workspaceRoot, { recursive: true, force: true });
      }
      reference.validation = {
        ...reference.validation,
        apply_status: 'failed',
        apply_error: error instanceof Error ? error.message : 'Patch application failed.',
        workspace: null,
      };
      await this.references.save(reference);
      if (error instanceof BadRequestException) {
        throw error;
      }
      this.logger.error(
        `Could not apply reference ${reference.id} to its review workspace.`,
        error instanceof Error ? error.stack : undefined,
      );
      throw new BadRequestException('The generated patch could not be applied to the pinned snapshot.');
    }
  }

  async createWorkspaceArchive(referenceId: string) {
    const reference = await this.findReference(referenceId);
    if (reference.validation.apply_status !== 'applied') {
      throw new BadRequestException('Apply the patches to a review workspace before downloading it.');
    }
    const workspaceRoot = this.workspacePath(reference.id);
    if (!fs.existsSync(workspaceRoot)) {
      throw new BadRequestException('The applied review workspace is no longer available.');
    }
    const archivePath = `${workspaceRoot}-${randomUUID()}.tar.gz`;
    this.assertStoragePath(archivePath);
    await execFileAsync('tar', [
      '-czf',
      archivePath,
      '-C',
      workspaceRoot,
      '.',
    ], { timeout: 120_000, maxBuffer: 1024 * 1024 });
    return {
      path: archivePath,
      filename: `reference-${reference.id}-workspace.tar.gz`,
    };
  }

  async recordValidation(referenceId: string, input: ValidationInput) {
    const reference = await this.findReference(referenceId);
    if (reference.status !== 'pending_review') {
      throw new BadRequestException('Only a generated reference awaiting review can be validated.');
    }
    if (reference.validation.apply_status !== 'applied') {
      throw new BadRequestException('Apply the patches to a review workspace before recording build or test results.');
    }
    const buildStatus = this.validateCheckStatus(input.buildStatus, 'Build');
    const testStatus = this.validateCheckStatus(input.testStatus, 'Test');
    if (input.notes !== undefined &&
      (typeof input.notes !== 'string' || input.notes.length > 2000)) {
      throw new BadRequestException('Validation notes must be a string of at most 2,000 characters.');
    }
    const notes = typeof input.notes === 'string' ? input.notes.trim() : '';
    if ((buildStatus === 'passed' || testStatus === 'passed') && !notes) {
      throw new BadRequestException('Add notes describing how the passing build or tests were verified.');
    }
    reference.validation = {
      ...reference.validation,
      build: buildStatus,
      tests: testStatus,
      execution_mode: 'manual_confirmation',
      notes,
      recorded_at: new Date().toISOString(),
    };
    return this.references.save(reference);
  }

  async review(referenceId: string, input: ReviewInput) {
    const reference = await this.findReference(referenceId);
    if (reference.status !== 'pending_review') {
      throw new BadRequestException('Only a generated reference awaiting review can be reviewed.');
    }
    if (input.note !== undefined && (typeof input.note !== 'string' || input.note.length > 2000)) {
      throw new BadRequestException('Review note must be a string of at most 2,000 characters.');
    }
    const note = typeof input.note === 'string' ? input.note.trim() : '';
    if (input.action === 'request_changes') {
      if (!note) {
        throw new BadRequestException('Add a review note describing the requested changes.');
      }
      reference.status = 'changes_requested';
      reference.reviewNote = note;
    } else if (input.action === 'reject') {
      reference.status = 'rejected';
      reference.reviewNote = note || null;
    } else if (input.action === 'approve') {
      if (!reference.patches?.length || !reference.tests?.length
        || reference.validation.apply_status !== 'applied'
        || reference.validation.execution_mode !== 'manual_confirmation'
        || reference.validation.build !== 'passed'
        || reference.validation.tests !== 'passed') {
        throw new BadRequestException(
          'Approval requires a patch, generated tests, and recorded passing build and test validation.',
        );
      }
      reference.status = 'approved';
      reference.reviewNote = note || null;
    } else {
      throw new BadRequestException('Choose approve, request_changes, or reject.');
    }
    return this.references.save(reference);
  }

  async processGeneration(referenceId: string) {
    const reference = await this.references.findOneBy({ id: referenceId });
    if (!reference || reference.status !== 'queued') {
      return;
    }
    reference.status = 'running';
    await this.references.save(reference);

    try {
      const request = reference.input;
      const task = request.task as Record<string, unknown>;
      const repositories = await this.resolveBaseline(request.baselineManifest);
      const repositoryPaths = new Map<string, string>();
      for (const repository of repositories) {
        if (typeof repository.repository_id === 'string'
          && typeof repository.repository_path === 'string') {
          repositoryPaths.set(repository.repository_id, repository.repository_path);
        }
      }
      const serviceUrl = this.config.get<string>('AI_SERVICE_URL', 'http://localhost:8000')
        .replace(/\/+$/, '');
      let patchRepair: PatchRepairRequest | undefined;
      let previousPatches: GeneratedRepositoryPatch[] | undefined;
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const response = await undiciRequest(`${serviceUrl}/api/v1/references/generate`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            operation_id: patchRepair ? `${reference.id}-repair` : reference.id,
            project_id: request.projectId,
            provider: reference.provider,
            reviewer_feedback: request.reviewerFeedback,
            patch_repair: patchRepair ? {
              repository_id: patchRepair.repositoryId,
              patch_diff: patchRepair.patchDiff,
              preflight_error: patchRepair.error,
            } : undefined,
            task: this.toReferenceTaskInput(task, reference.taskVersion),
            repositories,
          }),
          headersTimeout: 1_220_000,
          bodyTimeout: 1_220_000,
          signal: AbortSignal.timeout(1_210_000),
        });
        if (response.statusCode < 200 || response.statusCode >= 300) {
          const detail = this.readProviderError(response.statusCode, await response.body.text());
          throw new Error(detail);
        }
        const result = await response.body.json() as ReferenceGenerationResponse;
        if (
          result.status !== 'pending_review'
          || result.provider !== reference.provider
          || !result.model
          || !result.patches?.length
          || !result.context_manifest
          || (!patchRepair && (!result.implementation_plan?.length || !result.tests?.length))
        ) {
          throw new Error('AI service returned an incomplete reference solution.');
        }
        const generatedPatches = result.patches.map((patch) => ({
          ...patch,
          patch_diff: this.normalizeGeneratedPatch(
            patch.patch_diff,
            repositoryPaths.get(patch.repository_id),
          ),
        }));
        let patches = generatedPatches;
        if (patchRepair) {
          if (
            !previousPatches
            || generatedPatches.length !== 1
            || generatedPatches[0].repository_id !== patchRepair.repositoryId
          ) {
            throw new Error('The AI service did not return only the repository patch requested for repair.');
          }
          patches = previousPatches.map((patch) => (
            patch.repository_id === patchRepair?.repositoryId ? generatedPatches[0] : patch
          ));
        }

        reference.model = result.model;
        reference.promptVersion = result.prompt_version;
        reference.patches = patches;
        if (!patchRepair) {
          if (!result.implementation_plan || !result.tests || !result.context_manifest) {
            throw new Error('AI service returned an incomplete reference solution.');
          }
          reference.implementationPlan = result.implementation_plan;
          reference.tests = result.tests;
          reference.contextManifest = result.context_manifest;
        }
        try {
          await this.checkGeneratedPatchesApply(repositories, patches);
        } catch (error) {
          reference.validation = {
            ...reference.validation,
            patch_preflight: 'failed',
          };
          if (
            attempt === 0
            && error instanceof GeneratedPatchPreflightError
            && error.patchDiff.length <= MAX_PATCH_REPAIR_CHARS
          ) {
            previousPatches = patches;
            patchRepair = {
              repositoryId: error.repositoryId,
              patchDiff: error.patchDiff,
              error: error.message.slice(0, MAX_PATCH_REPAIR_ERROR_CHARS),
            };
            reference.validation = {
              ...reference.validation,
              patch_repair_attempts: 1,
            };
            await this.references.save(reference);
            this.logger.warn(
              `Reference generation ${reference.id} failed pinned-snapshot preflight; requesting one patch repair.`,
            );
            continue;
          }
          throw error;
        }

        reference.status = 'pending_review';
        reference.validation = {
          ...(result.validation ?? {}),
          patch_preflight: 'passed',
          patch_repair_attempts: attempt,
          apply_status: 'not_applied',
        };
        await this.references.save(reference);
        return;
      }
    } catch (error) {
      reference.status = 'failed';
      reference.errorMessage = error instanceof Error ? error.message : 'Reference generation failed.';
      await this.references.save(reference);
      this.logger.error(
        `Reference generation ${reference.id} failed.`,
        error instanceof Error ? error.stack : undefined,
      );
    }
  }

  private async resolveBaseline(value: unknown): Promise<Array<Record<string, unknown>>> {
    if (!Array.isArray(value) || !value.length || value.length > 10) {
      throw new BadRequestException('The task does not have a valid pinned repository baseline.');
    }
    const resolved: Array<Record<string, unknown>> = [];
    for (const baseline of value) {
      if (!baseline || typeof baseline !== 'object') {
        throw new BadRequestException('The task baseline manifest is invalid.');
      }
      const item = baseline as Record<string, unknown>;
      const repositoryId = item.repositoryId;
      const snapshotId = item.snapshotId;
      const analysisId = item.analysisId;
      const commitSha = item.commitSha;
      if (
        typeof repositoryId !== 'string' || typeof snapshotId !== 'string'
        || typeof analysisId !== 'string' || typeof commitSha !== 'string'
      ) {
        throw new BadRequestException('The task baseline manifest is incomplete.');
      }
      const analysis = await this.analyses.findOneBy({ id: analysisId, status: 'completed' });
      if (
        !analysis || analysis.repositoryId !== repositoryId
        || analysis.snapshotId !== snapshotId
        || analysis.commitSha.toLowerCase() !== commitSha.toLowerCase()
        || !analysis.summary || !analysis.report
      ) {
        throw new BadRequestException('The task baseline analysis is unavailable or does not match its saved commit.');
      }
      const snapshot = await this.snapshots
        .createQueryBuilder('snapshot')
        .addSelect('snapshot.checkoutPath')
        .where('snapshot.id = :snapshotId', { snapshotId })
        .andWhere('snapshot.repositoryId = :repositoryId', { repositoryId })
        .andWhere('snapshot.status = :status', { status: 'ready' })
        .getOne();
      if (!snapshot?.checkoutPath || !fs.existsSync(snapshot.checkoutPath)) {
        throw new BadRequestException('A repository snapshot in the task baseline is no longer available.');
      }
      this.assertStoragePath(snapshot.checkoutPath);
      const repository = await this.repositories.findOneBy({ id: repositoryId });
      if (!repository) {
        throw new BadRequestException('A repository in the task baseline is unavailable.');
      }
      resolved.push({
        repository_id: repositoryId,
        repository_name: repository.fullName,
        snapshot_id: snapshotId,
        analysis_id: analysisId,
        commit_sha: commitSha,
        repository_path: snapshot.checkoutPath,
        summary: analysis.summary,
        report: analysis.report,
      });
    }
    return resolved;
  }

  private workspacePath(referenceId: string) {
    return path.join(this.storagePath, 'reference-workspaces', referenceId);
  }

  private shouldCopySnapshotEntry(sourcePath: string) {
    const name = path.basename(sourcePath);
    const excludedNames = new Set([
      '.git',
      'node_modules',
      '.venv',
      'venv',
      '__pycache__',
      'dist',
      'build',
      '.next',
      '.turbo',
    ]);
    if (excludedNames.has(name)) {
      return false;
    }
    if (name.startsWith('.env') && !['.env.example', '.env.sample', '.env.template'].includes(name)) {
      return false;
    }
    return !fs.lstatSync(sourcePath).isSymbolicLink();
  }

  private isSafeRelativePath(value: string) {
    return value.length > 0
      && !value.startsWith('/')
      && !value.includes('\\')
      && !value.includes('\0')
      && !value.includes(':')
      && value.split('/').every((part) => part.length > 0 && part !== '.' && part !== '..');
  }

  private async applyGitPatch(repositoryPath: string, patchPath: string, checkOnly: boolean) {
    const args = ['apply', '--recount', '--whitespace=nowarn'];
    if (checkOnly) {
      args.push('--check');
    }
    args.push('--', patchPath);
    try {
      await execFileAsync('git', args, {
        cwd: repositoryPath,
        timeout: 30_000,
        maxBuffer: 1024 * 1024,
        windowsHide: true,
      });
    } catch (error) {
      const stderr = error && typeof error === 'object' && 'stderr' in error
        && typeof error.stderr === 'string'
        ? error.stderr.trim()
        : '';
      const detail = stderr || (error instanceof Error ? error.message : 'git apply failed.');
      throw new BadRequestException(
        `The generated patch does not apply cleanly to the pinned snapshot: ${detail.slice(0, 1000)}`,
      );
    }
  }

  private normalizeGeneratedPatch(patch: string, repositoryPath?: string) {
    const normalizedInput = patch.replace(/\r\n/g, '\n').replace(/\n+$/, '\n');
    const hasTrailingNewline = normalizedInput.endsWith('\n');
    const lines = normalizedInput.split('\n');
    if (hasTrailingNewline) {
      lines.pop();
    }
    for (let lineIndex = 0; lineIndex < lines.length - 2; lineIndex += 1) {
      const indentedFileHeader = /^ diff --git a\/(.+) b\/(.+)$/.exec(lines[lineIndex]);
      if (
        indentedFileHeader
        && lines[lineIndex + 1] === `--- a/${indentedFileHeader[1]}`
        && lines[lineIndex + 2] === `+++ b/${indentedFileHeader[2]}`
      ) {
        lines[lineIndex] = lines[lineIndex].slice(1);
      }
    }
    const normalized: string[] = [];
    let sectionStart = 0;
    while (sectionStart < lines.length) {
      if (!lines[sectionStart].startsWith('diff --git ')) {
        normalized.push(lines[sectionStart]);
        sectionStart += 1;
        continue;
      }

      let sectionEnd = sectionStart + 1;
      while (sectionEnd < lines.length && !lines[sectionEnd].startsWith('diff --git ')) {
        sectionEnd += 1;
      }
      const section = lines.slice(sectionStart, sectionEnd);
      const fileHeader = /^diff --git a\/(.+) b\/(.+)$/.exec(section[0]);
      const pinnedLines = fileHeader && repositoryPath
        ? this.pinnedFileLines(repositoryPath, fileHeader[1])
        : undefined;
      const firstHunkIndex = section.findIndex((line) => line.startsWith('@@ '));
      const hasFileHeaders = section.some((line) => line.startsWith('--- ') || line.startsWith('+++ '));
      const hasSpecialFileMode = section.some((line) =>
        /^(new file mode|deleted file mode|rename from|rename to)\b/.test(line));
      if (fileHeader && firstHunkIndex >= 0 && !hasFileHeaders && !hasSpecialFileMode) {
        section.splice(
          firstHunkIndex,
          0,
          `--- a/${fileHeader[1]}`,
          `+++ b/${fileHeader[2]}`,
        );
      }

      let previousOldEnd: number | undefined;
      let previousNewEnd: number | undefined;
      for (let hunkIndex = 0; hunkIndex < section.length; hunkIndex += 1) {
        const hunkHeader = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)$/.exec(section[hunkIndex]);
        if (!hunkHeader) {
          continue;
        }
        let oldCount = 0;
        let newCount = 0;
        let validHunk = true;
        for (let lineIndex = hunkIndex + 1; lineIndex < section.length; lineIndex += 1) {
          const line = section[lineIndex];
          if (line.startsWith('@@ ') || line.startsWith('diff --git ')) {
            break;
          }
          if (line === '') {
            section[lineIndex] = ' ';
            oldCount += 1;
            newCount += 1;
            continue;
          }
          if (line.startsWith('\\')) {
            continue;
          }
          if (line.startsWith(' ')) {
            oldCount += 1;
            newCount += 1;
          } else if (line.startsWith('-')) {
            oldCount += 1;
          } else if (line.startsWith('+')) {
            const previousLine = section[lineIndex - 1];
            const nextLine = section[lineIndex + 1];
            if (
              pinnedLines
              && previousLine?.startsWith(' ')
              && nextLine?.startsWith(' ')
              && this.hasUniqueAdjacentLines(
                pinnedLines,
                previousLine.slice(1),
                line.slice(1),
                nextLine.slice(1),
              )
            ) {
              section[lineIndex] = ` ${line.slice(1)}`;
              oldCount += 1;
              newCount += 1;
            } else {
              newCount += 1;
            }
          } else {
            validHunk = false;
            break;
          }
        }
        if (validHunk && oldCount + newCount > 0) {
          const oldStart = previousOldEnd === undefined
            ? Number(hunkHeader[1])
            : Math.max(Number(hunkHeader[1]), previousOldEnd + 1);
          const newStart = previousNewEnd === undefined
            ? Number(hunkHeader[2])
            : Math.max(Number(hunkHeader[2]), previousNewEnd + 1);
          section[hunkIndex] = `@@ -${oldStart},${oldCount} +${newStart},${newCount} @@${hunkHeader[3]}`;
          previousOldEnd = oldStart + oldCount - 1;
          previousNewEnd = newStart + newCount - 1;
        }
      }

      normalized.push(...section);
      sectionStart = sectionEnd;
    }
    return normalized.join('\n') + '\n';
  }

  private pinnedFileLines(repositoryPath: string, relativePath: string) {
    if (!this.isSafeRelativePath(relativePath)) {
      return undefined;
    }
    let filePath = path.resolve(repositoryPath);
    for (const part of relativePath.split('/')) {
      filePath = path.join(filePath, part);
      if (!fs.existsSync(filePath) || fs.lstatSync(filePath).isSymbolicLink()) {
        return undefined;
      }
    }
    const stat = fs.statSync(filePath);
    if (!stat.isFile() || stat.size > 100_000) {
      return undefined;
    }
    return fs.readFileSync(filePath, 'utf8').replace(/\r\n/g, '\n').split('\n');
  }

  private hasUniqueAdjacentLines(lines: string[], previous: string, current: string, next: string) {
    let matches = 0;
    for (let index = 1; index < lines.length - 1; index += 1) {
      if (
        lines[index - 1] === previous
        && lines[index] === current
        && lines[index + 1] === next
      ) {
        matches += 1;
        if (matches > 1) {
          return false;
        }
      }
    }
    return matches === 1;
  }

  private async checkGeneratedPatchesApply(
    repositories: Array<Record<string, unknown>>,
    patches: GeneratedRepositoryPatch[],
  ) {
    const repositoryPaths = new Map<string, string>();
    for (const repository of repositories) {
      if (typeof repository.repository_id === 'string'
        && typeof repository.repository_path === 'string') {
        repositoryPaths.set(repository.repository_id, repository.repository_path);
      }
    }
    for (const patch of patches) {
      if (!repositoryPaths.has(patch.repository_id)) {
        throw new BadRequestException('The AI service returned a patch outside the pinned repository baseline.');
      }
    }

    const preflightRoot = path.join(this.storagePath, `.reference-preflight-${randomUUID()}`);
    this.assertStoragePath(preflightRoot);
    await fs.promises.mkdir(preflightRoot);
    try {
      for (const [index, patch] of patches.entries()) {
        const repositoryPath = repositoryPaths.get(patch.repository_id);
        if (!repositoryPath) {
          throw new BadRequestException('The AI service returned a patch outside the pinned repository baseline.');
        }
        const patchPath = path.join(preflightRoot, `${index}.patch`);
        await fs.promises.writeFile(patchPath, patch.patch_diff, { flag: 'wx' });
        try {
          await this.applyGitPatch(repositoryPath, patchPath, true);
        } catch (error) {
          throw new GeneratedPatchPreflightError(patch.repository_id, patch.patch_diff, error);
        }
      }
    } finally {
      await fs.promises.rm(preflightRoot, { recursive: true, force: true });
    }
  }

  private suggestBuildAndTestCommands(repositoryPath: string) {
    const build: string[] = [];
    const tests: string[] = [];
    const packageJsonPath = path.join(repositoryPath, 'package.json');
    if (fs.existsSync(packageJsonPath)) {
      const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8')) as {
        packageManager?: string;
        scripts?: Record<string, unknown>;
      };
      const scripts = packageJson.scripts ?? {};
      const packageManager = typeof packageJson.packageManager === 'string'
        ? packageJson.packageManager.split('@')[0]
        : fs.existsSync(path.join(repositoryPath, 'pnpm-lock.yaml'))
          ? 'pnpm'
          : fs.existsSync(path.join(repositoryPath, 'yarn.lock'))
            ? 'yarn'
            : 'npm';
      if (typeof scripts.build === 'string') {
        build.push(`${packageManager} run build`);
      }
      if (typeof scripts.test === 'string') {
        tests.push(packageManager === 'npm' ? 'npm test' : `${packageManager} test`);
      }
    }

    if (fs.existsSync(path.join(repositoryPath, 'pyproject.toml'))
      || fs.existsSync(path.join(repositoryPath, 'requirements.txt'))) {
      build.push('python -m compileall -q .');
      if (fs.existsSync(path.join(repositoryPath, 'tests'))
        || fs.existsSync(path.join(repositoryPath, 'test'))) {
        tests.push('python -m pytest');
      }
    }
    return { build, tests };
  }

  private toReferenceTaskInput(task: Record<string, unknown>, taskVersion: number) {
    return {
      title: task.title,
      description: task.description,
      category: task.category,
      difficulty: task.difficulty,
      requirements: task.requirements,
      acceptance_criteria: task.acceptanceCriteria ?? task.acceptance_criteria,
      constraints: task.constraints,
      affected_modules: task.affectedModules ?? task.affected_modules,
      task_version: taskVersion,
    };
  }

  private async findTask(taskId: string) {
    const task = await this.tasks.findOneBy({ id: taskId });
    if (!task) {
      throw new NotFoundException('Task was not found.');
    }
    return task;
  }

  private async findReference(referenceId: string) {
    const reference = await this.references.findOneBy({ id: referenceId });
    if (!reference) {
      throw new NotFoundException('Reference solution was not found.');
    }
    return reference;
  }

  private validateCheckStatus(value: unknown, label: string): BuildOrTestStatus {
    if (value !== 'not_run' && value !== 'passed' && value !== 'failed') {
      throw new BadRequestException(`${label} status must be not_run, passed, or failed.`);
    }
    return value;
  }

  private assertStoragePath(checkoutPath: string) {
    const resolved = path.resolve(checkoutPath);
    const relative = path.relative(this.storagePath, resolved);
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
      throw new BadRequestException('A task baseline snapshot is outside the configured artifact storage root.');
    }
  }

  private readProviderError(statusCode: number, raw: string) {
    try {
      const body = JSON.parse(raw) as { detail?: unknown };
      return typeof body.detail === 'string'
        ? body.detail
        : `AI service returned HTTP ${statusCode}.`;
    } catch {
      return `AI service returned HTTP ${statusCode}.`;
    }
  }
}
