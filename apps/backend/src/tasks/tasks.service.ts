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
import { spawn } from 'child_process';
import { randomUUID } from 'crypto';
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

  async verifySolution(taskId: string) {
    const task = await this.tasks.findOneBy({ id: taskId });
    if (!task) {
      throw new NotFoundException('Task was not found.');
    }
    const harborFiles = task.harborFiles as Record<string, string> | null;
    if (!harborFiles || typeof harborFiles !== 'object' || !harborFiles.solve_sh || !harborFiles.test_sh) {
      throw new BadRequestException('Task does not contain harbor solve.sh and test.sh artifacts to verify.');
    }

    const baselineList = Array.isArray(task.baselineManifest) ? task.baselineManifest : [];
    const baseline = baselineList[0] as Record<string, unknown> | undefined;
    if (!baseline || typeof baseline.snapshotId !== 'string' || typeof baseline.repositoryId !== 'string') {
      throw new BadRequestException('Task baseline snapshot metadata is missing or incomplete.');
    }

    const snapshot = await this.findReadySnapshot(baseline.snapshotId, baseline.repositoryId);
    if (!snapshot?.checkoutPath || !fs.existsSync(snapshot.checkoutPath)) {
      throw new BadRequestException('The pinned repository snapshot for this task is no longer available on disk.');
    }
    this.assertStoragePath(snapshot.checkoutPath);

    const runId = randomUUID();
    const verificationRoot = path.join(this.storagePath, 'harbor-verifications', task.id, runId);
    const workspaceDir = path.join(verificationRoot, 'workspace');
    await fs.promises.mkdir(workspaceDir, { recursive: true });

    this.cleanupBackgroundProcesses();

    try {
      // 1. Copy repository snapshot to isolated workspace
      await fs.promises.cp(snapshot.checkoutPath, workspaceDir, {
        recursive: true,
        filter: (src) => this.shouldCopySnapshotEntry(src),
      });

      // 1b. Link or prepare project dependencies (node_modules, rimraf, nest CLI, etc.)
      await this.symlinkOrPrepareDependencies(snapshot.checkoutPath, workspaceDir);
      this.ensureSkipLibCheck(workspaceDir);
      this.patchPackageJsonForDistMain(workspaceDir);

      // Ensure /logs/verifier directory exists
      try {
        fs.mkdirSync(path.join(workspaceDir, 'logs', 'verifier'), { recursive: true });
        if (process.platform === 'linux') {
          fs.mkdirSync('/logs/verifier', { recursive: true });
        }
      } catch {}

      // 2. Execute solve.sh
      const solveResult = await this.executeScript(harborFiles.solve_sh, workspaceDir, 'solve.sh');
      if (solveResult.exitCode !== 0) {
        task.harborVerification = {
          verifiedAt: new Date().toISOString(),
          status: 'failed',
          reward: 0,
          solveResult,
          testResult: null,
          error: `solve.sh failed with exit code ${solveResult.exitCode}`,
        };
        const saved = await this.tasks.save(task);
        return this.toTask(saved);
      }

      // 3. Execute test.sh
      const testResult = await this.executeScript(harborFiles.test_sh, workspaceDir, 'test.sh');

      // 4. Check reward: read /logs/verifier/reward.txt or exit code
      let reward = 0;
      const candidateRewardFiles = [
        path.join(workspaceDir, 'logs', 'verifier', 'reward.txt'),
        path.join(workspaceDir, 'logs', 'reward.txt'),
        path.join(verificationRoot, 'logs', 'verifier', 'reward.txt'),
        '/logs/verifier/reward.txt',
      ];
      let foundRewardFile = false;
      for (const rf of candidateRewardFiles) {
        if (fs.existsSync(rf)) {
          try {
            const raw = fs.readFileSync(rf, 'utf8').trim();
            const parsed = parseFloat(raw);
            if (!isNaN(parsed)) {
              reward = parsed;
              foundRewardFile = true;
              break;
            }
          } catch {}
        }
      }

      if (!foundRewardFile) {
        reward = testResult.exitCode === 0 ? 1 : 0;
      }

      const passed = reward >= 1 && testResult.exitCode === 0;
      task.harborVerification = {
        verifiedAt: new Date().toISOString(),
        status: passed ? 'passed' : 'failed',
        reward,
        solveResult,
        testResult,
        error: passed
          ? null
          : reward < 1
            ? `Verification reward was ${reward} (expected 1.0)`
            : `test.sh failed with exit code ${testResult.exitCode}`,
      };

      const saved = await this.tasks.save(task);
      return this.toTask(saved);
    } finally {
      this.cleanupBackgroundProcesses();
      await fs.promises.rm(verificationRoot, { recursive: true, force: true }).catch(() => {});
    }
  }

  private cleanupBackgroundProcesses() {
    try {
      if (process.platform === 'linux') {
        const procDirs = fs.readdirSync('/proc');
        for (const pidStr of procDirs) {
          if (!/^\d+$/.test(pidStr) || pidStr === '1' || pidStr === String(process.pid)) continue;
          try {
            const cmd = fs.readFileSync(path.join('/proc', pidStr, 'cmdline'), 'utf8');
            if (cmd.includes('dist/main') || cmd.includes('test.sh') || cmd.includes('solve.sh')) {
              process.kill(Number(pidStr), 'SIGKILL');
            }
          } catch {}
        }
      }
    } catch {}
  }

  private shouldCopySnapshotEntry(sourcePath: string): boolean {
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
    try {
      return !fs.lstatSync(sourcePath).isSymbolicLink();
    } catch {
      return false;
    }
  }

  private sanitizeScriptForWorkspace(script: string, workspaceDir: string): string {
    const normalizedDir = workspaceDir.replace(/\\/g, '/');
    return script
      .replace(/\r\n/g, '\n')
      .replace(/cd \/app\b/g, `cd "${normalizedDir}"`)
      .replace(/\/app\b/g, normalizedDir)
      .replace(/npm run start:prod\s*&/g, 'npm run start:prod > /tmp/nest_server.log 2>&1 &');
  }

  private getBashPath(): string {
    if (process.platform === 'win32') {
      const gitBash = 'C:\\Program Files\\Git\\bin\\bash.exe';
      if (fs.existsSync(gitBash)) {
        return gitBash;
      }
      return 'bash';
    }
    if (fs.existsSync('/bin/bash')) {
      return '/bin/bash';
    }
    return 'bash';
  }

  private async symlinkOrPrepareDependencies(snapshotPath: string, workspaceDir: string) {
    let linkedAny = false;
    const scanAndSymlink = (dir: string, depth = 0) => {
      if (depth > 4) return;
      try {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.isDirectory()) {
            const fullPath = path.join(dir, entry.name);
            if (entry.name === 'node_modules') {
              const rel = path.relative(snapshotPath, fullPath);
              const targetInWorkspace = path.join(workspaceDir, rel);
              if (!fs.existsSync(targetInWorkspace)) {
                try {
                  fs.symlinkSync(fullPath, targetInWorkspace, process.platform === 'win32' ? 'junction' : 'dir');
                  linkedAny = true;
                } catch {}
              }
            } else if (entry.name !== '.git' && entry.name !== 'dist' && entry.name !== 'build') {
              scanAndSymlink(fullPath, depth + 1);
            }
          }
        }
      } catch {}
    };

    scanAndSymlink(snapshotPath);

    if (!linkedAny) {
      const packageDirs: string[] = [];
      const findPackageJson = (dir: string, depth = 0) => {
        if (depth > 3) return;
        try {
          if (fs.existsSync(path.join(dir, 'package.json'))) {
            packageDirs.push(dir);
          }
          const entries = fs.readdirSync(dir, { withFileTypes: true });
          for (const entry of entries) {
            if (entry.isDirectory() && entry.name !== '.git' && entry.name !== 'node_modules' && entry.name !== 'dist') {
              findPackageJson(path.join(dir, entry.name), depth + 1);
            }
          }
        } catch {}
      };
      findPackageJson(workspaceDir);

      for (const dir of packageDirs) {
        if (!fs.existsSync(path.join(dir, 'node_modules'))) {
          try {
            await this.executeScript(
              'npm install --legacy-peer-deps --no-audit --no-fund',
              dir,
              'setup_deps.sh',
              180_000,
            );
          } catch {}
        }
      }
    }
  }

  private ensureSkipLibCheck(workspaceDir: string) {
    const findTsConfigs = (dir: string, depth = 0) => {
      if (depth > 3) return;
      try {
        const tsConfigPath = path.join(dir, 'tsconfig.json');
        if (fs.existsSync(tsConfigPath)) {
          try {
            const parsed = JSON.parse(fs.readFileSync(tsConfigPath, 'utf8'));
            if (parsed.compilerOptions && parsed.compilerOptions.skipLibCheck !== true) {
              parsed.compilerOptions.skipLibCheck = true;
              fs.writeFileSync(tsConfigPath, JSON.stringify(parsed, null, 2), 'utf8');
            }
          } catch {}
        }
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.isDirectory() && entry.name !== '.git' && entry.name !== 'node_modules') {
            findTsConfigs(path.join(dir, entry.name), depth + 1);
          }
        }
      } catch {}
    };
    findTsConfigs(workspaceDir);
  }

  private patchPackageJsonForDistMain(workspaceDir: string) {
    const scan = (dir: string, depth = 0) => {
      if (depth > 3) return;
      try {
        const pkgPath = path.join(dir, 'package.json');
        if (fs.existsSync(pkgPath)) {
          const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
          if (pkg.scripts && typeof pkg.scripts['start:prod'] === 'string') {
            pkg.scripts['postbuild'] =
              'node -e \'const fs=require("fs");if(fs.existsSync("dist/src/main.js"))fs.writeFileSync("dist/main.js","require(\\"./src/main\\");\\n");\'';
            fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2), 'utf8');
          }
        }
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.isDirectory() && entry.name !== '.git' && entry.name !== 'node_modules') {
            scan(path.join(dir, entry.name), depth + 1);
          }
        }
      } catch {}
    };
    scan(workspaceDir);
  }

  private async executeScript(
    scriptContent: string,
    workspaceDir: string,
    scriptName: string,
    timeoutMs = 180_000,
  ): Promise<{ exitCode: number; output: string; durationMs: number }> {
    const startTime = Date.now();
    const scriptFile = path.join(workspaceDir, `__run_${scriptName}`);
    const sanitized = this.sanitizeScriptForWorkspace(scriptContent, workspaceDir);
    await fs.promises.writeFile(scriptFile, sanitized, { encoding: 'utf8', mode: 0o755 });

    const bashBinary = this.getBashPath();
    const pathDelimiter = process.platform === 'win32' ? ';' : ':';
    const binPaths: string[] = [];
    const checkBin = (dir: string) => {
      const bp = path.join(dir, 'node_modules', '.bin');
      if (fs.existsSync(bp)) binPaths.push(bp);
    };
    checkBin(workspaceDir);
    checkBin(path.join(workspaceDir, 'backend'));

    const currentPath = process.env.PATH || '';
    const augmentedPath = binPaths.length > 0
      ? `${binPaths.join(pathDelimiter)}${pathDelimiter}${currentPath}`
      : currentPath;

    const env = {
      ...process.env,
      POSTGRES_HOST: process.env.DATABASE_HOST || 'postgres',
      DATABASE_HOST: process.env.DATABASE_HOST || 'postgres',
      PATH: augmentedPath,
      CI: 'true',
      WORKSPACE: workspaceDir,
    };

    return new Promise((resolve) => {
      let output = '';
      const child = spawn(bashBinary, [scriptFile], {
        cwd: workspaceDir,
        env,
        windowsHide: true,
      });

      const append = (data: Buffer) => {
        const text = data.toString();
        if (output.length < 50_000) {
          output += text.slice(0, 50_000 - output.length);
        }
      };

      child.stdout.on('data', append);
      child.stderr.on('data', append);

      let resolved = false;
      const finish = (code: number | null) => {
        if (resolved) return;
        resolved = true;
        clearTimeout(timer);
        void fs.promises.rm(scriptFile, { force: true }).catch(() => {});
        const durationMs = Date.now() - startTime;
        resolve({
          exitCode: code ?? (killed ? -1 : 0),
          output: output.trim(),
          durationMs,
        });
      };

      let killed = false;
      const timer = setTimeout(() => {
        killed = true;
        child.kill('SIGTERM');
        setTimeout(() => {
          try {
            child.kill('SIGKILL');
          } catch {}
        }, 5000);
        output += `\n[Execution timed out after ${timeoutMs / 1000}s]`;
        finish(-1);
      }, timeoutMs);

      child.on('error', (err) => {
        output += `\nExecution error: ${err.message}`;
        finish(-1);
      });

      child.on('exit', (code) => {
        setTimeout(() => finish(code), 200);
      });

      child.on('close', (code) => {
        finish(code);
      });
    });
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
