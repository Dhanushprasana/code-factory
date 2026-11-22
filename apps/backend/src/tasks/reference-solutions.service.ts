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
import * as fs from 'fs';
import * as path from 'path';
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

interface GenerateReferenceInput {
  reviewerFeedback?: unknown;
}

interface ReferenceGenerationResponse {
  operation_id: string;
  status: string;
  provider: string;
  model: string;
  prompt_version: string;
  implementation_plan: Record<string, unknown>[];
  patches: Array<{ repository_id: string; patch_diff: string }>;
  tests: Record<string, unknown>[];
  context_manifest: Record<string, unknown>;
  validation: Record<string, unknown>;
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
        test_files_present: 'not_run',
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

  async recordValidation(referenceId: string, input: ValidationInput) {
    const reference = await this.findReference(referenceId);
    if (reference.status !== 'pending_review') {
      throw new BadRequestException('Only a generated reference awaiting review can be validated.');
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
      if (!reference.patches?.length || !reference.tests?.length ||
        reference.validation.execution_mode !== 'manual_confirmation'
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
      const serviceUrl = this.config.get<string>('AI_SERVICE_URL', 'http://localhost:8000')
        .replace(/\/+$/, '');
      const response = await fetch(`${serviceUrl}/api/v1/references/generate`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          operation_id: reference.id,
          project_id: request.projectId,
          provider: reference.provider,
          reviewer_feedback: request.reviewerFeedback,
          task: this.toReferenceTaskInput(task, reference.taskVersion),
          repositories,
        }),
        signal: AbortSignal.timeout(610_000),
      });
      if (!response.ok) {
        const detail = await this.readProviderError(response);
        throw new Error(detail);
      }
      const result = await response.json() as ReferenceGenerationResponse;
      if (
        result.status !== 'pending_review'
        || result.provider !== reference.provider
        || !result.model
        || !result.implementation_plan?.length
        || !result.patches?.length
        || !result.tests?.length
        || !result.context_manifest
      ) {
        throw new Error('AI service returned an incomplete reference solution.');
      }
      reference.status = 'pending_review';
      reference.model = result.model;
      reference.promptVersion = result.prompt_version;
      reference.implementationPlan = result.implementation_plan;
      reference.patches = result.patches;
      reference.tests = result.tests;
      reference.contextManifest = result.context_manifest;
      reference.validation = result.validation;
      await this.references.save(reference);
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

  private async readProviderError(response: Response) {
    const raw = await response.text();
    try {
      const body = JSON.parse(raw) as { detail?: unknown };
      return typeof body.detail === 'string'
        ? body.detail
        : `AI service returned HTTP ${response.status}.`;
    } catch {
      return `AI service returned HTTP ${response.status}.`;
    }
  }
}
