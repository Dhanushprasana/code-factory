import {
  BadGatewayException,
  BadRequestException,
  GatewayTimeoutException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import * as fs from 'fs';
import * as path from 'path';
import { In, Repository } from 'typeorm';
import { ProjectEntity } from '../projects/entities/project.entity';
import { ProjectRepositoryEntity } from '../repositories/entities/project-repository.entity';
import { RepositoryAnalysisEntity } from '../analysis/entities/repository-analysis.entity';
import { RepositorySnapshotEntity } from '../repositories/entities/repository-snapshot.entity';
import { TaskEntity } from './entities/task.entity';
import { TaskGenerationEntity } from './entities/task-generation.entity';
import { TaskVersionEntity } from './entities/task-version.entity';

const TASK_CATEGORIES = [
  'feature',
  'bug_fix',
  'api_enhancement',
  'refactoring',
  'database_change',
  'performance',
  'test_improvement',
] as const;
const TASK_DIFFICULTIES = ['easy', 'medium', 'hard'] as const;

interface SuggestTasksInput {
  provider?: unknown;
  analysisIds?: unknown;
  userIdea?: unknown;
  category?: unknown;
  difficulty?: unknown;
  constraints?: unknown;
  count?: unknown;
}

interface SaveTaskInput {
  generationId?: unknown;
  candidateIndex?: unknown;
  title?: unknown;
  description?: unknown;
  category?: unknown;
  difficulty?: unknown;
  requirements?: unknown;
  acceptanceCriteria?: unknown;
  constraints?: unknown;
  affectedModules?: unknown;
}

interface TaskSuggestionResponse {
  operation_id: string;
  status: string;
  provider: string;
  model: string;
  prompt_version: string;
  tasks: Record<string, unknown>[];
  context_manifest: Record<string, unknown>;
}

type TaskProvider = 'openrouter' | 'ollama';

@Injectable()
export class TasksService {
  private readonly logger = new Logger(TasksService.name);
  private readonly storagePath = process.env.ARTIFACT_STORAGE_PATH
    ? path.resolve(__dirname, '../../../../', process.env.ARTIFACT_STORAGE_PATH)
    : path.resolve(__dirname, '../../../../storage');

  constructor(
    private readonly config: ConfigService,
    @InjectRepository(ProjectEntity)
    private readonly projects: Repository<ProjectEntity>,
    @InjectRepository(ProjectRepositoryEntity)
    private readonly projectRepositories: Repository<ProjectRepositoryEntity>,
    @InjectRepository(RepositoryAnalysisEntity)
    private readonly analyses: Repository<RepositoryAnalysisEntity>,
    @InjectRepository(RepositorySnapshotEntity)
    private readonly snapshots: Repository<RepositorySnapshotEntity>,
    @InjectRepository(TaskEntity)
    private readonly tasks: Repository<TaskEntity>,
    @InjectRepository(TaskGenerationEntity)
    private readonly generations: Repository<TaskGenerationEntity>,
    @InjectRepository(TaskVersionEntity)
    private readonly versions: Repository<TaskVersionEntity>,
  ) {}

  async getProjectContext(projectId: string) {
    await this.requireProject(projectId);
    const associations = await this.projectRepositories.find({
      where: { projectId },
      relations: { repository: true },
      order: { createdAt: 'ASC' },
    });
    const components = await Promise.all(associations.map(async (association) => {
      const selectedCommitSha = association.selectedCommitSha;
      const analysis = selectedCommitSha
        ? await this.analyses.findOne({
          where: {
            repositoryId: association.repositoryId,
            commitSha: selectedCommitSha,
            status: 'completed',
          },
          order: { createdAt: 'DESC' },
        })
        : null;
      const snapshot = analysis
        ? await this.findReadySnapshot(analysis.snapshotId, association.repositoryId)
        : null;
      const modules = Array.isArray(analysis?.summary?.modules)
        ? analysis.summary.modules
          .filter((module): module is Record<string, unknown> => typeof module === 'object' && module !== null)
          .map((module) => String(module.path ?? module.name ?? ''))
          .filter(Boolean)
        : [];
      return {
        repositoryId: association.repositoryId,
        repositoryName: association.repository.fullName,
        role: association.repoRole,
        branch: association.selectedBranch,
        commitSha: selectedCommitSha,
        analysisId: analysis && snapshot?.checkoutPath ? analysis.id : null,
        snapshotId: analysis && snapshot?.checkoutPath ? analysis.snapshotId : null,
        analyzedAt: analysis?.createdAt ?? null,
        modules,
        ready: Boolean(analysis && snapshot?.checkoutPath && fs.existsSync(snapshot.checkoutPath)),
      };
    }));
    return { projectId, components };
  }

  async listProjectTasks(projectId: string) {
    await this.requireProject(projectId);
    const items = await this.tasks.find({
      where: { projectId },
      order: { updatedAt: 'DESC' },
    });
    return items.map((task) => this.toTask(task));
  }

  async listTasks(projectId?: string) {
    if (projectId) {
      return this.listProjectTasks(projectId);
    }
    const items = await this.tasks.find({ order: { updatedAt: 'DESC' }, take: 200 });
    return items.map((task) => this.toTask(task));
  }

  async listGenerations(projectId: string) {
    await this.requireProject(projectId);
    return this.generations.find({
      where: { projectId },
      order: { createdAt: 'DESC' },
      take: 50,
    });
  }

  async suggestTasks(projectId: string, input: SuggestTasksInput) {
    await this.requireProject(projectId);
    const validated = this.validateSuggestionInput(input);
    const repositories = await this.resolveRepositories(projectId, validated.analysisIds);
    const generation = await this.generations.save(this.generations.create({
      projectId,
      status: 'running',
      input: {
        provider: validated.provider,
        analysisIds: validated.analysisIds,
        userIdea: validated.userIdea,
        category: validated.category,
        difficulty: validated.difficulty,
        constraints: validated.constraints,
        count: validated.count,
      },
    }));

    try {
      const serviceUrl = this.config.get<string>('AI_SERVICE_URL', 'http://localhost:8000')
        .replace(/\/+$/, '');
      const response = await fetch(`${serviceUrl}/api/v1/tasks/suggest`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          operation_id: generation.id,
          project_id: projectId,
          provider: validated.provider,
          user_idea: validated.userIdea,
          category: validated.category,
          difficulty: validated.difficulty,
          constraints: validated.constraints,
          count: validated.count,
          repositories,
        }),
        signal: AbortSignal.timeout(310_000),
      });
      if (!response.ok) {
        const detail = await this.readProviderError(response);
        generation.status = 'failed';
        generation.errorMessage = detail;
        await this.generations.save(generation);
        if (response.status === 503) {
          throw new ServiceUnavailableException(detail);
        }
        if (response.status === 504) {
          throw new GatewayTimeoutException(detail);
        }
        throw new BadGatewayException(detail);
      }
      const result = await response.json() as TaskSuggestionResponse;
      if (
        result.status !== 'completed'
        || !Array.isArray(result.tasks)
        || !result.tasks.length
        || typeof result.provider !== 'string'
        || typeof result.model !== 'string'
        || !result.context_manifest
      ) {
        throw new BadGatewayException('AI service returned an invalid task-generation response.');
      }
      generation.status = 'completed';
      generation.provider = result.provider;
      generation.model = result.model;
      generation.promptVersion = result.prompt_version;
      generation.contextManifest = result.context_manifest;
      generation.candidates = result.tasks;
      await this.generations.save(generation);

      // Store draft Harbor package files in Docker volume
      try {
        const draftsDir = path.join(this.storagePath, 'harbor-packages', 'drafts', generation.id);
        result.tasks.forEach((candidate, idx) => {
          const harbor = (candidate as any).harbor_files as Record<string, string> | undefined;
          if (harbor) {
            this.writeHarborPackageFiles(path.join(draftsDir, `candidate-${idx}`), harbor, {
              id: `draft-${generation.id}-${idx}`,
              title: String((candidate as any).title ?? `Draft ${idx + 1}`),
              description: String((candidate as any).description ?? ''),
            });
          }
        });
      } catch (volumeError) {
        this.logger.warn(`Could not write draft Harbor files to volume: ${volumeError instanceof Error ? volumeError.message : volumeError}`);
      }

      return { ...generation, candidates: result.tasks };
    } catch (error) {
      if (generation.status === 'running') {
        generation.status = 'failed';
        generation.errorMessage = error instanceof Error ? error.message : 'Task generation failed.';
        await this.generations.save(generation);
      }
      if (error instanceof BadGatewayException || error instanceof ServiceUnavailableException ||
        error instanceof GatewayTimeoutException) {
        throw error;
      }
      this.logger.error(
        `Task generation ${generation.id} failed.`,
        error instanceof Error ? error.stack : undefined,
      );
      throw new ServiceUnavailableException(
        'Could not reach the AI service for task generation. Check AI_SERVICE_URL and the AI service health.',
      );
    }
  }

  async createTask(projectId: string, input: SaveTaskInput) {
    await this.requireProject(projectId);
    const generationId = this.requireString(input.generationId, 'Generation ID is required.');
    const candidateIndex = input.candidateIndex;
    if (!Number.isInteger(candidateIndex) || Number(candidateIndex) < 0) {
      throw new BadRequestException('Candidate index must be a non-negative integer.');
    }
    const generation = await this.generations.findOneBy({ id: generationId, projectId });
    if (!generation || generation.status !== 'completed' || !generation.candidates || !generation.contextManifest) {
      throw new BadRequestException('Select a completed task-generation suggestion for this project.');
    }
    const original = generation.candidates[Number(candidateIndex)] as Record<string, unknown> | undefined;
    if (!original) {
      throw new BadRequestException('The selected task suggestion was not found.');
    }
    const candidate = {
      ...original,
      title: input.title ?? original.title,
      description: input.description ?? original.description,
      category: input.category ?? original.category,
      difficulty: input.difficulty ?? original.difficulty,
      requirements: input.requirements ?? original.requirements,
      acceptance_criteria: input.acceptanceCriteria ?? original.acceptance_criteria,
      constraints: input.constraints ?? original.constraints,
      affected_modules: input.affectedModules ?? original.affected_modules,
    };
    const content = this.normalizeTask(candidate);
    const baselineManifest = this.getBaselineManifest(generation.contextManifest);
    const task = await this.tasks.save(this.tasks.create({
      projectId,
      generationId,
      currentVersion: 1,
      ...content,
      status: 'draft',
      baselineManifest,
      contextManifest: generation.contextManifest,
    }));

    // Write Harbor Task Package files to Docker volume storage/harbor-packages/${task.id}
    const harborFiles = ((original as any)?.harbor_files ?? (input as any)?.harborFiles) as Record<string, string> | undefined;
    const packageDir = path.join(this.storagePath, 'harbor-packages', task.id);
    const harborPath = this.writeHarborPackageFiles(packageDir, harborFiles, {
      id: task.id,
      title: task.title,
      description: task.description,
      requirements: task.requirements,
      acceptanceCriteria: task.acceptanceCriteria,
    });

    task.harborFiles = harborFiles ?? null;
    task.harborPackagePath = harborPath;
    await this.tasks.save(task);

    await this.versions.save(this.versions.create({
      taskId: task.id,
      version: 1,
      content: this.versionContent(task),
    }));
    return this.toTask(task);
  }

  async getTask(taskId: string) {
    const task = await this.tasks.findOneBy({ id: taskId });
    if (!task) {
      throw new NotFoundException('Task was not found.');
    }
    return this.toTask(task);
  }

  async updateTask(taskId: string, input: SaveTaskInput) {
    const task = await this.tasks.findOneBy({ id: taskId });
    if (!task) {
      throw new NotFoundException('Task was not found.');
    }
    const current = this.versionContent(task) as Record<string, unknown>;
    const changes: Record<string, unknown> = {
      title: input.title ?? current.title,
      description: input.description ?? current.description,
      category: input.category ?? current.category,
      difficulty: input.difficulty ?? current.difficulty,
      requirements: input.requirements ?? current.requirements,
      acceptance_criteria: input.acceptanceCriteria ?? current.acceptanceCriteria,
      constraints: input.constraints ?? current.constraints,
      affected_modules: input.affectedModules ?? current.affectedModules,
    };
    const content = this.normalizeTask(changes);
    Object.assign(task, content);
    task.currentVersion += 1;
    const saved = await this.tasks.save(task);
    await this.versions.save(this.versions.create({
      taskId: saved.id,
      version: saved.currentVersion,
      content: this.versionContent(saved),
    }));
    return this.toTask(saved);
  }

  async listVersions(taskId: string) {
    await this.getTask(taskId);
    return this.versions.find({ where: { taskId }, order: { version: 'DESC' } });
  }

  private async resolveRepositories(projectId: string, analysisIds: string[]) {
    const associations = await this.projectRepositories.find({
      where: { projectId },
      relations: { repository: true },
    });
    const associationByRepository = new Map(associations.map((association) => [
      association.repositoryId,
      association,
    ]));
    const analyses = await this.analyses.find({
      where: { id: In(analysisIds), status: 'completed' },
    });
    if (analyses.length !== analysisIds.length) {
      throw new BadRequestException('Every selected repository analysis must be completed.');
    }
    const resolved: Array<Record<string, unknown>> = [];
    for (const analysis of analyses) {
      const association = associationByRepository.get(analysis.repositoryId);
      if (!association || association.selectedCommitSha?.toLowerCase() !== analysis.commitSha.toLowerCase()) {
        throw new BadRequestException(
          'Each analysis must belong to a repository in this project and match its selected commit baseline.',
        );
      }
      const snapshot = await this.findReadySnapshot(analysis.snapshotId, analysis.repositoryId);
      if (!snapshot?.checkoutPath || !fs.existsSync(snapshot.checkoutPath)) {
        throw new BadRequestException('A selected repository snapshot is no longer available.');
      }
      this.assertStoragePath(snapshot.checkoutPath);
      if (!analysis.summary || !analysis.report) {
        throw new BadRequestException('A selected analysis does not contain a complete report.');
      }
      const contextMdPath = path.join(snapshot.checkoutPath, 'CONTEXT.md');
      const diskContextMd = fs.existsSync(contextMdPath) ? fs.readFileSync(contextMdPath, 'utf8') : null;
      const contextMarkdown = (analysis.contextMarkdown && analysis.contextMarkdown.trim())
        ? analysis.contextMarkdown
        : diskContextMd;

      resolved.push({
        repository_id: analysis.repositoryId,
        repository_name: association.repository.fullName,
        snapshot_id: snapshot.id,
        analysis_id: analysis.id,
        commit_sha: analysis.commitSha,
        repository_path: snapshot.checkoutPath,
        summary: analysis.summary,
        report: analysis.report,
        context_markdown: contextMarkdown,
      });
    }
    return resolved;
  }

  private async findReadySnapshot(snapshotId: string, repositoryId: string) {
    return this.snapshots
      .createQueryBuilder('snapshot')
      .addSelect('snapshot.checkoutPath')
      .where('snapshot.id = :snapshotId', { snapshotId })
      .andWhere('snapshot.repositoryId = :repositoryId', { repositoryId })
      .andWhere('snapshot.status = :status', { status: 'ready' })
      .getOne();
  }

  private validateSuggestionInput(input: SuggestTasksInput) {
    const provider = input.provider;
    if (provider !== 'openrouter' && provider !== 'ollama') {
      throw new BadRequestException('Choose OpenRouter or Ollama as the task-generation provider.');
    }
    if (!Array.isArray(input.analysisIds) || input.analysisIds.length < 1 || input.analysisIds.length > 10) {
      throw new BadRequestException('Select between 1 and 10 completed repository analyses.');
    }
    const analysisIds = input.analysisIds.map((id) => this.requireString(id, 'Analysis IDs must be strings.'));
    if (new Set(analysisIds).size !== analysisIds.length) {
      throw new BadRequestException('Selected repository analyses must be unique.');
    }
    const category = input.category ?? 'feature';
    const difficulty = input.difficulty ?? 'medium';
    const count = input.count ?? 3;
    if (typeof category !== 'string' || !TASK_CATEGORIES.includes(category as typeof TASK_CATEGORIES[number])) {
      throw new BadRequestException('Choose a supported task category.');
    }
    if (typeof difficulty !== 'string' || !TASK_DIFFICULTIES.includes(difficulty as typeof TASK_DIFFICULTIES[number])) {
      throw new BadRequestException('Choose a supported task difficulty.');
    }
    if (!Number.isInteger(count) || Number(count) < 1 || Number(count) > 5) {
      throw new BadRequestException('Task suggestion count must be between 1 and 5.');
    }
    if (input.userIdea !== undefined && (typeof input.userIdea !== 'string' || input.userIdea.length > 1000)) {
      throw new BadRequestException('Task idea must be a string of at most 1000 characters.');
    }
    if (input.constraints !== undefined &&
      (!Array.isArray(input.constraints) || input.constraints.length > 10 ||
        input.constraints.some((item) => typeof item !== 'string' || item.length > 500))) {
      throw new BadRequestException('Constraints must be up to 10 strings, each at most 500 characters.');
    }
    return {
      provider,
      analysisIds,
      userIdea: typeof input.userIdea === 'string' ? input.userIdea.trim() : '',
      category,
      difficulty,
      constraints: (input.constraints as string[] | undefined)?.map((item) => item.trim()).filter(Boolean) ?? [],
      count: Number(count),
    };
  }

  private normalizeTask(candidate: Record<string, unknown>) {
    const title = this.requireString(candidate.title, 'Task title is required.').trim();
    const description = this.requireString(candidate.description, 'Task description is required.').trim();
    const category = this.requireString(candidate.category, 'Task category is required.');
    const difficulty = this.requireString(candidate.difficulty, 'Task difficulty is required.');
    if (title.length < 8 || title.length > 160 || description.length < 30 || description.length > 3000) {
      throw new BadRequestException('Task title or description is outside the allowed length.');
    }
    if (!TASK_CATEGORIES.includes(category as typeof TASK_CATEGORIES[number]) ||
      !TASK_DIFFICULTIES.includes(difficulty as typeof TASK_DIFFICULTIES[number])) {
      throw new BadRequestException('Task category or difficulty is invalid.');
    }
    const requirements = this.requireStringList(candidate.requirements, 'At least two requirements are required.', 2, 10);
    const acceptanceCriteria = this.requireStringList(
      candidate.acceptance_criteria ?? candidate.acceptanceCriteria,
      'At least two acceptance criteria are required.',
      2,
      10,
    );
    const constraints = this.requireStringList(candidate.constraints ?? [], 'Invalid constraints.', 0, 10);
    const affectedModules = this.requireStringList(
      candidate.affected_modules ?? candidate.affectedModules,
      'At least one affected module is required.',
      1,
      10,
    );
    const evidence = Array.isArray(candidate.evidence) ? candidate.evidence : [];
    if (!evidence.length) {
      throw new BadRequestException('Task evidence is required.');
    }
    return {
      title,
      description,
      category,
      difficulty,
      requirements,
      acceptanceCriteria,
      constraints,
      affectedModules,
      evidence: evidence as Record<string, unknown>[],
    };
  }

  private requireStringList(value: unknown, message: string, min: number, max: number): string[] {
    if (!Array.isArray(value) || value.length < min || value.length > max ||
      value.some((item) => typeof item !== 'string' || !item.trim())) {
      throw new BadRequestException(message);
    }
    return value.map((item: string) => item.trim());
  }

  private requireString(value: unknown, message: string) {
    if (typeof value !== 'string' || !value.trim()) {
      throw new BadRequestException(message);
    }
    return value;
  }

  private getBaselineManifest(contextManifest: Record<string, unknown>) {
    const repositories = contextManifest.repositories;
    if (!Array.isArray(repositories)) {
      throw new BadRequestException('The generated task has no repository baseline manifest.');
    }
    return repositories.map((item) => {
      const repository = item as Record<string, unknown>;
      return {
        repositoryId: repository.repository_id,
        snapshotId: repository.snapshot_id,
        analysisId: repository.analysis_id,
        commitSha: repository.commit_sha,
      };
    });
  }

  private versionContent(task: TaskEntity) {
    return {
      title: task.title,
      description: task.description,
      category: task.category,
      difficulty: task.difficulty,
      status: task.status,
      requirements: task.requirements,
      acceptanceCriteria: task.acceptanceCriteria,
      constraints: task.constraints,
      affectedModules: task.affectedModules,
      baselineManifest: task.baselineManifest,
      contextManifest: task.contextManifest,
      evidence: task.evidence,
      harborFiles: task.harborFiles,
      harborPackagePath: task.harborPackagePath,
    };
  }

  private writeHarborPackageFiles(
    targetDir: string,
    harborFiles: Record<string, string> | undefined,
    taskInfo: {
      id?: string;
      title?: string;
      description?: string;
      requirements?: string[];
      acceptanceCriteria?: string[];
      commitSha?: string;
    },
  ): string | null {
    if (!harborFiles || typeof harborFiles !== 'object') {
      return null;
    }
    fs.mkdirSync(targetDir, { recursive: true });
    fs.mkdirSync(path.join(targetDir, 'environment'), { recursive: true });
    fs.mkdirSync(path.join(targetDir, 'solution'), { recursive: true });
    fs.mkdirSync(path.join(targetDir, 'tests'), { recursive: true });

    if (typeof harborFiles.instruction_md === 'string') {
      fs.writeFileSync(path.join(targetDir, 'instruction.md'), harborFiles.instruction_md, 'utf8');
    }
    if (typeof harborFiles.task_toml === 'string') {
      fs.writeFileSync(path.join(targetDir, 'task.toml'), harborFiles.task_toml, 'utf8');
    }
    if (typeof harborFiles.dockerfile === 'string') {
      fs.writeFileSync(path.join(targetDir, 'environment', 'Dockerfile'), harborFiles.dockerfile, 'utf8');
    }
    if (typeof harborFiles.solve_sh === 'string') {
      fs.writeFileSync(path.join(targetDir, 'solution', 'solve.sh'), harborFiles.solve_sh, 'utf8');
    }
    if (typeof harborFiles.test_sh === 'string') {
      fs.writeFileSync(path.join(targetDir, 'tests', 'test.sh'), harborFiles.test_sh, 'utf8');
    }

    const packageId = taskInfo.id || path.basename(targetDir);
    const bundleFile = path.join(this.storagePath, `${packageId}.harbor.json`);
    const relativeDir = path.relative(this.storagePath, targetDir).replace(/\\/g, '/');
    const exportBundle = {
      schema: 'https://harborframework.com/spec/v1.json',
      package: {
        id: packageId,
        title: taskInfo.title,
        harborSchema: 'v1',
        harborPath: relativeDir,
        createdAt: new Date().toISOString(),
        files: {
          instruction: 'instruction.md',
          configuration: 'task.toml',
          environment: 'environment/Dockerfile',
          solution: 'solution/solve.sh',
          verifier: 'tests/test.sh',
        },
      },
      artifacts: harborFiles,
    };
    fs.writeFileSync(bundleFile, JSON.stringify(exportBundle, null, 2), 'utf8');
    return relativeDir;
  }

  private toTask(task: TaskEntity) {
    return { ...task, version: task.currentVersion };
  }

  private async readProviderError(response: Response) {
    const raw = await response.text();
    try {
      const body = JSON.parse(raw) as { detail?: unknown };
      return typeof body.detail === 'string' ? body.detail : `AI service returned HTTP ${response.status}.`;
    } catch {
      return `AI service returned HTTP ${response.status}.`;
    }
  }

  private async requireProject(projectId: string) {
    const project = await this.projects.findOneBy({ id: projectId });
    if (!project) {
      throw new NotFoundException('Project was not found.');
    }
    return project;
  }

  private assertStoragePath(checkoutPath: string) {
    const resolved = path.resolve(checkoutPath);
    const relative = path.relative(this.storagePath, resolved);
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
      throw new BadRequestException('Selected snapshot is outside the configured artifact storage root.');
    }
  }
}
