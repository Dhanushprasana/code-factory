import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import * as fs from 'fs';
import * as path from 'path';
import { Repository } from 'typeorm';
import { RepositorySnapshotEntity } from '../repositories/entities/repository-snapshot.entity';
import { ReferenceSolutionEntity } from './entities/reference-solution.entity';
import { TaskEntity } from './entities/task.entity';

export interface HarborPackageFile {
  path: string;
  size: number;
  content: string;
}

export interface HarborPackageSummary {
  packageId: string;
  taskId: string;
  taskVersion: number;
  title: string;
  category: string;
  difficulty: string;
  status: string;
  fileCount: number;
  createdAt: string;
}

@Injectable()
export class HarborPackageService {
  private readonly storagePath = process.env.ARTIFACT_STORAGE_PATH
    ? path.resolve(__dirname, '../../../../', process.env.ARTIFACT_STORAGE_PATH)
    : path.resolve(__dirname, '../../../../storage');

  constructor(
    @InjectRepository(TaskEntity)
    private readonly tasks: Repository<TaskEntity>,
    @InjectRepository(ReferenceSolutionEntity)
    private readonly references: Repository<ReferenceSolutionEntity>,
    @InjectRepository(RepositorySnapshotEntity)
    private readonly snapshots: Repository<RepositorySnapshotEntity>,
  ) {}

  private packagesRoot(): string {
    return path.join(this.storagePath, 'harbor-packages');
  }

  private assertSafePackageId(packageId: string): void {
    if (!/^[a-zA-Z0-9_-]+$/.test(packageId)) {
      throw new BadRequestException('Invalid Harbor package identifier.');
    }
  }

  private isSafeRelativePath(value: string): boolean {
    return (
      value.length > 0
      && !value.startsWith('/')
      && !value.includes('\\')
      && !value.includes('\0')
      && !value.includes(':')
      && value.split('/').every((part) => part.length > 0 && part !== '.' && part !== '..')
    );
  }

  private shouldCopyRepoEntry(sourcePath: string): boolean {
    const name = path.basename(sourcePath);
    const excluded = new Set([
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
    if (excluded.has(name)) {
      return false;
    }
    if (name.startsWith('.env') && !['.env.example', '.env.sample', '.env.template'].includes(name)) {
      return false;
    }
    return !fs.lstatSync(sourcePath).isSymbolicLink();
  }

  async finalizeTask(taskId: string, referenceId?: string) {
    const task = await this.tasks.findOneBy({ id: taskId });
    if (!task) {
      throw new NotFoundException('Task was not found.');
    }

    const reference = referenceId
      ? await this.references.findOneBy({ id: referenceId, taskId })
      : await this.references.findOne({
        where: { taskId, status: 'approved' },
        order: { version: 'DESC' },
      });

    if (!reference || reference.status !== 'approved') {
      throw new BadRequestException(
        'An approved reference solution is required before finalizing the task into a Harbor package.',
      );
    }

    const packageId = `${task.id}-v${task.currentVersion}`;
    this.assertSafePackageId(packageId);
    const packageDir = path.join(this.packagesRoot(), packageId);
    const stagingDir = path.join(this.packagesRoot(), `.tmp-${packageId}-${Date.now()}`);
    await fs.promises.mkdir(stagingDir, { recursive: true });

    try {
      const envDir = path.join(stagingDir, 'environment');
      const solutionDir = path.join(stagingDir, 'solution');
      const testsDir = path.join(stagingDir, 'tests');
      await Promise.all([
        fs.promises.mkdir(envDir, { recursive: true }),
        fs.promises.mkdir(solutionDir, { recursive: true }),
        fs.promises.mkdir(testsDir, { recursive: true }),
      ]);

      // Resolve primary repository checkout to copy into environment/repo and detect Dockerfile
      const firstBaseline = Array.isArray(task.baselineManifest) ? task.baselineManifest[0] : undefined;
      let repoCheckoutPath: string | null = null;
      if (firstBaseline && typeof firstBaseline.snapshotId === 'string') {
        const snapshot = await this.snapshots
          .createQueryBuilder('snapshot')
          .addSelect('snapshot.checkoutPath')
          .where('snapshot.id = :snapshotId', { snapshotId: firstBaseline.snapshotId })
          .getOne();
        if (snapshot?.checkoutPath && fs.existsSync(snapshot.checkoutPath)) {
          repoCheckoutPath = snapshot.checkoutPath;
        }
      }

      if (repoCheckoutPath) {
        const envRepoDir = path.join(envDir, 'repo');
        await fs.promises.cp(repoCheckoutPath, envRepoDir, {
          recursive: true,
          filter: (src) => this.shouldCopyRepoEntry(src),
        });
      }

      const instructionMd = this.renderInstructionMarkdown(task);
      const taskToml = this.renderTaskToml(task, reference);
      const dockerfile = this.renderDockerfile(repoCheckoutPath);
      const solveSh = (reference.solveScript || this.fallbackSolveScript(reference)).replace(/\r\n/g, '\n');

      const workspaceRepos = (
        reference.validation?.workspace as { repositories?: Array<{ test_commands?: string[] }> } | undefined
      )?.repositories ?? [];
      const detectedTestCommands = workspaceRepos.flatMap((repo) => repo.test_commands ?? []);

      const writtenTestFiles: string[] = [];
      const patchText = (reference.patches ?? []).map((p) => p.patch_diff).join('\n');
      for (const test of reference.tests ?? []) {
        const filePath = typeof test.file_path === 'string' ? test.file_path : '';
        const content = typeof test.content === 'string' ? test.content : '';
        if (!this.isSafeRelativePath(filePath) || !content) {
          continue;
        }
        if (patchText.includes(`+++ b/${filePath}\n`) || patchText.includes(`--- a/${filePath}\n`)) {
          continue;
        }
        const dest = path.join(testsDir, 'files', filePath);
        await fs.promises.mkdir(path.dirname(dest), { recursive: true });
        await fs.promises.writeFile(dest, content.replace(/\r\n/g, '\n'), 'utf8');
        writtenTestFiles.push(filePath);
      }

      const testSh = this.renderTestScript(detectedTestCommands, writtenTestFiles);

      await Promise.all([
        fs.promises.writeFile(path.join(stagingDir, 'instruction.md'), instructionMd, 'utf8'),
        fs.promises.writeFile(path.join(stagingDir, 'task.toml'), taskToml, 'utf8'),
        fs.promises.writeFile(path.join(envDir, 'Dockerfile'), dockerfile, 'utf8'),
        fs.promises.writeFile(path.join(solutionDir, 'solve.sh'), solveSh, { encoding: 'utf8', mode: 0o755 }),
        fs.promises.writeFile(path.join(testsDir, 'test.sh'), testSh, { encoding: 'utf8', mode: 0o755 }),
      ]);

      await fs.promises.rm(packageDir, { recursive: true, force: true });
      await fs.promises.rename(stagingDir, packageDir);

      task.status = 'finalized';
      await this.tasks.save(task);

      return this.getPackageDetails(packageId);
    } catch (error) {
      await fs.promises.rm(stagingDir, { recursive: true, force: true });
      throw error;
    }
  }

  async listPackages(): Promise<HarborPackageSummary[]> {
    const root = this.packagesRoot();
    if (!fs.existsSync(root)) {
      return [];
    }
    const entries = await fs.promises.readdir(root, { withFileTypes: true });
    const finalizedTasks = await this.tasks.find({
      where: { status: 'finalized' },
      order: { updatedAt: 'DESC' },
    });
    const taskById = new Map(finalizedTasks.map((t) => [t.id, t]));

    const summaries: HarborPackageSummary[] = [];
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith('.tmp-')) {
        continue;
      }
      const match = /^(.+)-v(\d+)$/.exec(entry.name);
      if (!match) {
        continue;
      }
      const taskId = match[1];
      const taskVersion = Number(match[2]);
      const pkgDir = path.join(root, entry.name);
      const stat = await fs.promises.stat(pkgDir);
      const files = await this.collectPackageFiles(pkgDir, false);
      const task = taskById.get(taskId);
      summaries.push({
        packageId: entry.name,
        taskId,
        taskVersion,
        title: task?.title ?? entry.name,
        category: task?.category ?? 'feature',
        difficulty: task?.difficulty ?? 'medium',
        status: task?.status ?? 'finalized',
        fileCount: files.length,
        createdAt: (task?.updatedAt ?? stat.mtime).toISOString(),
      });
    }
    return summaries.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async getPackageDetails(packageId: string) {
    this.assertSafePackageId(packageId);
    const pkgDir = path.join(this.packagesRoot(), packageId);
    if (!fs.existsSync(pkgDir)) {
      throw new NotFoundException('Harbor package was not found.');
    }
    const match = /^(.+)-v(\d+)$/.exec(packageId);
    const taskId = match ? match[1] : packageId;
    const taskVersion = match ? Number(match[2]) : 1;
    const task = await this.tasks.findOneBy({ id: taskId });
    const files = await this.collectPackageFiles(pkgDir, true);
    return {
      packageId,
      taskId,
      taskVersion,
      title: task?.title ?? packageId,
      category: task?.category ?? 'feature',
      difficulty: task?.difficulty ?? 'medium',
      status: task?.status ?? 'finalized',
      files,
    };
  }

  private async collectPackageFiles(pkgDir: string, includeContent: boolean): Promise<HarborPackageFile[]> {
    const results: HarborPackageFile[] = [];
    const walk = async (dir: string) => {
      const entries = await fs.promises.readdir(dir, { withFileTypes: true });
      for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
        const fullPath = path.join(dir, entry.name);
        const rel = path.relative(pkgDir, fullPath).replace(/\\/g, '/');
        if (rel === 'environment/repo' || rel.startsWith('environment/repo/')) {
          continue;
        }
        if (entry.isDirectory()) {
          await walk(fullPath);
        } else if (entry.isFile()) {
          const stat = await fs.promises.stat(fullPath);
          const content = includeContent && stat.size <= 512_000
            ? await fs.promises.readFile(fullPath, 'utf8')
            : '';
          results.push({ path: rel, size: stat.size, content });
        }
      }
    };
    await walk(pkgDir);
    return results;
  }

  private renderInstructionMarkdown(task: TaskEntity): string {
    const reqs = (task.requirements ?? []).map((r) => `- ${r}`).join('\n');
    const acs = (task.acceptanceCriteria ?? []).map((a) => `- ${a}`).join('\n');
    const cons = (task.constraints ?? []).map((c) => `- ${c}`).join('\n');
    return [
      `# ${task.title}`,
      '',
      task.description,
      '',
      '## Requirements',
      reqs || '- Implement the requested change.',
      '',
      '## Acceptance Criteria',
      acs || '- All existing and new tests pass.',
      ...(cons ? ['', '## Constraints', cons] : []),
      '',
    ].join('\n');
  }

  private renderTaskToml(task: TaskEntity, reference: ReferenceSolutionEntity): string {
    return [
      'version = "1.0"',
      '',
      '[metadata]',
      `task_id = "${task.id}"`,
      `task_version = ${task.currentVersion}`,
      `reference_version = ${reference.version}`,
      `category = "${task.category}"`,
      `difficulty = "${task.difficulty}"`,
      '',
      '[verifier]',
      'timeout_sec = 1800.0',
      'environment_mode = "shared"',
      '',
      '[agent]',
      'timeout_sec = 1800.0',
      '',
      '[environment]',
      'build_timeout_sec = 600.0',
      'cpus = 2',
      'memory_mb = 4096',
      'storage_mb = 10240',
      '',
    ].join('\n');
  }

  private renderDockerfile(repoPath: string | null): string {
    const hasPkgJson = repoPath ? fs.existsSync(path.join(repoPath, 'package.json')) : false;
    const hasYarn = repoPath ? fs.existsSync(path.join(repoPath, 'yarn.lock')) : false;
    const hasPnpm = repoPath ? fs.existsSync(path.join(repoPath, 'pnpm-lock.yaml')) : false;
    const hasPy = repoPath
      ? fs.existsSync(path.join(repoPath, 'pyproject.toml')) || fs.existsSync(path.join(repoPath, 'requirements.txt'))
      : false;
    const hasGo = repoPath ? fs.existsSync(path.join(repoPath, 'go.mod')) : false;

    if (hasPkgJson) {
      const installCmd = hasYarn
        ? 'yarn install --frozen-lockfile'
        : hasPnpm
          ? 'corepack enable && pnpm install --frozen-lockfile'
          : 'npm install';
      return [
        'FROM node:22-bookworm-slim',
        '',
        'RUN apt-get update && apt-get install -y --no-install-recommends bash git python3 ca-certificates \\',
        '    && rm -rf /var/lib/apt/lists/*',
        '',
        'WORKDIR /workspace',
        'COPY repo/ /workspace/',
        `RUN ${installCmd}`,
        'RUN git init -q && git config user.email "harbor@local" && git config user.name "Harbor" && git add -A && git commit -q -m "baseline"',
        '',
      ].join('\n');
    }

    if (hasPy) {
      const installCmd = repoPath && fs.existsSync(path.join(repoPath, 'requirements.txt'))
        ? 'pip install --no-cache-dir -r requirements.txt'
        : 'pip install --no-cache-dir -e .';
      return [
        'FROM python:3.12-slim',
        '',
        'RUN apt-get update && apt-get install -y --no-install-recommends bash git ca-certificates \\',
        '    && rm -rf /var/lib/apt/lists/*',
        '',
        'WORKDIR /workspace',
        'COPY repo/ /workspace/',
        `RUN ${installCmd}`,
        'RUN git init -q && git config user.email "harbor@local" && git config user.name "Harbor" && git add -A && git commit -q -m "baseline"',
        '',
      ].join('\n');
    }

    if (hasGo) {
      return [
        'FROM golang:1.22-bookworm',
        '',
        'WORKDIR /workspace',
        'COPY repo/ /workspace/',
        'RUN go mod download',
        'RUN git init -q && git config user.email "harbor@local" && git config user.name "Harbor" && git add -A && git commit -q -m "baseline"',
        '',
      ].join('\n');
    }

    return [
      'FROM ubuntu:24.04',
      '',
      'RUN apt-get update && apt-get install -y --no-install-recommends bash git python3 ca-certificates \\',
      '    && rm -rf /var/lib/apt/lists/*',
      '',
      'WORKDIR /workspace',
      'COPY repo/ /workspace/',
      'RUN git init -q && git config user.email "harbor@local" && git config user.name "Harbor" && git add -A && git commit -q -m "baseline"',
      '',
    ].join('\n');
  }

  private renderTestScript(testCommands: string[], extraTestFiles: string[]): string {
    const lines = [
      '#!/usr/bin/env bash',
      'set -euo pipefail',
      '',
      'mkdir -p /logs/verifier',
    ];
    if (extraTestFiles.length > 0) {
      lines.push('if [ -d /tests/files ]; then cp -r /tests/files/. /workspace/; fi');
    }
    const commands = testCommands.length ? testCommands : ['echo "No test command configured"'];
    lines.push('set +e');
    lines.push('STATUS=0');
    for (const cmd of commands) {
      lines.push(`${cmd} || STATUS=$?`);
    }
    lines.push('set -e');
    lines.push('if [ "$STATUS" -eq 0 ]; then echo 1 > /logs/verifier/reward.txt; else echo 0 > /logs/verifier/reward.txt; fi');
    lines.push('exit "$STATUS"');
    lines.push('');
    return lines.join('\n');
  }

  private fallbackSolveScript(reference: ReferenceSolutionEntity): string {
    return [
      '#!/usr/bin/env bash',
      'set -euo pipefail',
      `# Reference solution v${reference.version}`,
      'echo "No solve_script recorded for this reference." >&2',
      'exit 1',
      '',
    ].join('\n');
  }
}
