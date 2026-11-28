import {
  BadRequestException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import * as fs from 'fs';
import * as path from 'path';
import { request as undiciRequest } from 'undici';
import { Repository } from 'typeorm';
import { AgentEntity } from '../agents/entities/agent.entity';
import { HarborPackageService } from './harbor-package.service';

export interface HarborRunSummary {
  id: string;
  jobId: string;
  agentId: string;
  agentName: string;
  provider: string;
  harborAgent: string;
  modelName: string;
  packageId: string | null;
  taskTitle: string;
  status: 'queued' | 'running' | 'passed' | 'failed';
  passedTasks: number;
  totalTasks: number;
  score: number;
  durationSeconds: number;
  startedAt: string;
  finishedAt: string | null;
  error: string | null;
}

@Injectable()
export class HarborRunnerService {
  private readonly storagePath = process.env.ARTIFACT_STORAGE_PATH
    ? path.resolve(__dirname, '../../../../', process.env.ARTIFACT_STORAGE_PATH)
    : path.resolve(__dirname, '../../../../storage');

  constructor(
    private readonly config: ConfigService,
    @InjectRepository(AgentEntity)
    private readonly agents: Repository<AgentEntity>,
    private readonly harborPackages: HarborPackageService,
  ) {}

  private jobsRoot(): string {
    return path.join(this.storagePath, 'harbor-jobs');
  }

  async startRun(input: { agentId?: string; packageId?: string }): Promise<HarborRunSummary[]> {
    const allAgents = await this.agents.find({ order: { createdAt: 'DESC' } });
    const targetAgents = !input.agentId || input.agentId === 'all'
      ? allAgents.filter((a) => a.status === 'ready')
      : allAgents.filter((a) => a.id === input.agentId);

    if (!targetAgents.length) {
      throw new BadRequestException(
        !input.agentId || input.agentId === 'all'
          ? 'No ready agents found. Register or set an agent to Ready in Settings.'
          : 'Selected agent was not found.',
      );
    }

    const packages = await this.harborPackages.listPackages();
    const targetPackages = !input.packageId || input.packageId === 'all'
      ? packages
      : packages.filter((p) => p.packageId === input.packageId);

    if (!targetPackages.length) {
      throw new BadRequestException(
        'No finalized Harbor packages found. Finalize an approved task first.',
      );
    }

    const runnerUrl = this.config.get<string>('HARBOR_RUNNER_URL', 'http://harbor:8020').replace(/\/+$/, '');
    const queued: HarborRunSummary[] = [];

    for (const agent of targetAgents) {
      const harborAgent = typeof agent.settings?.harborAgent === 'string' && agent.settings.harborAgent.trim()
        ? agent.settings.harborAgent.trim()
        : 'aider';

      const rawModel = (agent.modelName || '').trim();
      const isOpenRouter = agent.provider.toLowerCase().includes('openrouter') || rawModel.startsWith('openrouter/');
      const isGeminiNative = !isOpenRouter && ['antigravity-cli', 'antigravity-sdk', 'gemini-cli'].includes(harborAgent);
      const modelName = isOpenRouter && rawModel.startsWith('openrouter/')
        ? rawModel.slice('openrouter/'.length)
        : rawModel || 'nvidia/nemotron-3.5-super-vl:free';

      const apiKeyEnv = agent.credentialReference?.trim() || 'OPENROUTER_API_KEY';
      const apiKey = typeof agent.settings?.apiKey === 'string' ? agent.settings.apiKey.trim() : '';

      const jobId = `run-${harborAgent}-${Date.now()}-${agent.id.slice(0, 6)}`;
      const jobDir = path.join(this.jobsRoot(), jobId);
      await fs.promises.mkdir(jobDir, { recursive: true });

      const taskPathsYaml = targetPackages
        .map((pkg) => `  - path: /workspace/storage/harbor-packages/${pkg.packageId}`)
        .join('\n');

      const agentLines = [
        `  - name: ${harborAgent}`,
        `    model_name: ${modelName}`,
      ];
      if (isOpenRouter) {
        agentLines.push(
          '    base_url: https://openrouter.ai/api/v1',
          `    model_api_key_name: ${apiKeyEnv}`,
          '    model_api_format: openai_chat_completions',
          '    skip_model_parsing: true',
        );
      } else if (isGeminiNative) {
        agentLines.push(
          '    skip_model_parsing: true',
          `    model_api_key_name: ${apiKeyEnv || 'GEMINI_API_KEY'}`,
        );
      } else if (apiKeyEnv) {
        agentLines.push(`    model_api_key_name: ${apiKeyEnv}`);
      }

      const jobYaml = [
        'schema_version: 1',
        `job_name: ${jobId}`,
        `jobs_dir: /workspace/storage/harbor-jobs/${jobId}/runs`,
        'n_concurrent_trials: 1',
        'n_attempts: 1',
        'timeout_multiplier: 2.0',
        '',
        'agents:',
        ...agentLines,
        '',
        'environment:',
        '  delete: false',
        '',
        'tasks:',
        taskPathsYaml,
        '',
      ].join('\n');

      const startedAt = new Date().toISOString();
      const taskTitle = targetPackages.length === 1
        ? targetPackages[0].title
        : `All packages (${targetPackages.length})`;

      await fs.promises.writeFile(
        path.join(jobDir, 'meta.json'),
        JSON.stringify({
          jobId,
          agentId: agent.id,
          agentName: agent.name,
          provider: agent.provider,
          harborAgent,
          modelName,
          packageId: targetPackages.length === 1 ? targetPackages[0].packageId : null,
          taskTitle,
          totalTasks: targetPackages.length,
          startedAt,
        }),
        'utf8',
      );

      try {
        const res = await undiciRequest(`${runnerUrl}/run`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            job_id: jobId,
            job_yaml: jobYaml,
            env: apiKey ? { [apiKeyEnv]: apiKey } : {},
          }),
        });
        if (res.statusCode < 200 || res.statusCode >= 300) {
          throw new Error(`Harbor runner returned HTTP ${res.statusCode}`);
        }
      } catch (error) {
        throw new ServiceUnavailableException(
          error instanceof Error
            ? `Could not start Harbor run: ${error.message}`
            : 'Could not reach the Harbor runner container.',
        );
      }

      queued.push({
        id: jobId,
        jobId,
        agentId: agent.id,
        agentName: agent.name,
        provider: agent.provider,
        harborAgent,
        modelName,
        packageId: targetPackages.length === 1 ? targetPackages[0].packageId : null,
        taskTitle,
        status: 'running',
        passedTasks: 0,
        totalTasks: targetPackages.length,
        score: 0,
        durationSeconds: 0,
        startedAt,
        finishedAt: null,
        error: null,
      });
    }

    return queued;
  }

  async listRuns(): Promise<HarborRunSummary[]> {
    const root = this.jobsRoot();
    if (!fs.existsSync(root)) {
      return [];
    }
    const allAgents = await this.agents.find();
    const packages = await this.harborPackages.listPackages();
    const pkgById = new Map(packages.map((p) => [p.packageId, p]));

    const entries = await fs.promises.readdir(root, { withFileTypes: true });
    const summaries: HarborRunSummary[] = [];

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const jobDir = path.join(root, entry.name);
      const meta = this.readJsonSafe(path.join(jobDir, 'meta.json'));
      const statusJson = this.readJsonSafe(path.join(jobDir, 'status.json'));
      const resultJson = this.findResultJson(path.join(jobDir, 'runs'));
      const jobYamlText = this.readTextSafe(path.join(jobDir, 'job.yaml'));

      let harborAgent = typeof meta?.harborAgent === 'string' ? meta.harborAgent : '';
      let modelName = typeof meta?.modelName === 'string' ? meta.modelName : '';
      let packageId = typeof meta?.packageId === 'string' ? meta.packageId : null;
      if (!harborAgent && jobYamlText) {
        harborAgent = /- name:\s*(\S+)/.exec(jobYamlText)?.[1] ?? 'aider';
      }
      if (!modelName && jobYamlText) {
        modelName = /model_name:\s*(\S+)/.exec(jobYamlText)?.[1] ?? 'unknown';
      }
      if (!packageId && jobYamlText) {
        packageId = /harbor-packages\/([^\s]+)/.exec(jobYamlText)?.[1] ?? null;
      }

      const matchedAgent = (typeof meta?.agentId === 'string'
        ? allAgents.find((a) => a.id === meta.agentId)
        : undefined)
        ?? allAgents.find((a) => a.settings?.harborAgent === harborAgent);

      const totalTasks = typeof resultJson?.n_total_trials === 'number'
        ? resultJson.n_total_trials
        : (typeof meta?.totalTasks === 'number' ? meta.totalTasks : 1);

      let score = 0;
      let passedTasks = 0;
      const evals = (resultJson?.stats as { evals?: Record<string, any> } | undefined)?.evals;
      if (evals && typeof evals === 'object') {
        const firstEval = Object.values(evals)[0] as Record<string, any> | undefined;
        const mean = firstEval?.metrics?.[0]?.mean;
        if (typeof mean === 'number') {
          score = Math.round(mean * 100);
          passedTasks = Math.round(mean * totalTasks);
        }
      }

      const startedAt = (resultJson?.started_at as string | undefined)
        ?? (statusJson?.started_at as string | undefined)
        ?? (meta?.startedAt as string | undefined)
        ?? (await fs.promises.stat(jobDir)).mtime.toISOString();
      const finishedAt = (resultJson?.finished_at as string | undefined)
        ?? (statusJson?.finished_at as string | undefined)
        ?? null;

      let durationSeconds = 0;
      if (startedAt && finishedAt) {
        const ms = new Date(finishedAt).getTime() - new Date(startedAt).getTime();
        if (Number.isFinite(ms) && ms >= 0) {
          durationSeconds = Math.round(ms / 1000);
        }
      }

      let status: HarborRunSummary['status'] = 'running';
      const erroredTrials = Number((resultJson?.stats as Record<string, any> | undefined)?.n_errored_trials ?? 0);
      const isResultFinished = Boolean(resultJson?.finished_at);
      const isRunnerRunning = statusJson?.status === 'running' && !isResultFinished;

      if (statusJson?.status === 'failed') {
        status = 'failed';
      } else if (isRunnerRunning) {
        status = 'running';
      } else if (resultJson && isResultFinished) {
        if (erroredTrials > 0) {
          status = 'failed';
          score = 0;
          passedTasks = 0;
        } else {
          status = score > 0 ? 'passed' : 'failed';
        }
      } else if (statusJson?.status === 'completed') {
        status = score > 0 ? 'passed' : 'failed';
      }

      const exceptionSummary = this.findTrialException(path.join(jobDir, 'runs'));
      const errorText = typeof statusJson?.error === 'string'
        ? statusJson.error
        : exceptionSummary;

      const taskTitle = (meta?.taskTitle as string | undefined)
        ?? (packageId ? pkgById.get(packageId)?.title : undefined)
        ?? packageId
        ?? entry.name;

      summaries.push({
        id: entry.name,
        jobId: entry.name,
        agentId: matchedAgent?.id ?? (typeof meta?.agentId === 'string' ? meta.agentId : harborAgent),
        agentName: matchedAgent?.name ?? (typeof meta?.agentName === 'string' ? meta.agentName : harborAgent),
        provider: matchedAgent?.provider ?? (typeof meta?.provider === 'string' ? meta.provider : 'Harbor'),
        harborAgent: harborAgent || 'aider',
        modelName,
        packageId,
        taskTitle,
        status,
        passedTasks,
        totalTasks,
        score,
        durationSeconds,
        startedAt,
        finishedAt,
        error: errorText,
      });
    }

    return summaries.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  }

  private readJsonSafe(filePath: string): Record<string, any> | null {
    try {
      if (!fs.existsSync(filePath)) return null;
      return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch {
      return null;
    }
  }

  private readTextSafe(filePath: string): string | null {
    try {
      if (!fs.existsSync(filePath)) return null;
      return fs.readFileSync(filePath, 'utf8');
    } catch {
      return null;
    }
  }

  private findResultJson(runsDir: string): Record<string, any> | null {
    try {
      if (!fs.existsSync(runsDir)) return null;
      for (const entry of fs.readdirSync(runsDir, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        const candidate = path.join(runsDir, entry.name, 'result.json');
        if (fs.existsSync(candidate)) {
          return JSON.parse(fs.readFileSync(candidate, 'utf8'));
        }
      }
      return null;
    } catch {
      return null;
    }
  }

  private findTrialException(runsDir: string): string | null {
    try {
      if (!fs.existsSync(runsDir)) return null;
      for (const runEntry of fs.readdirSync(runsDir, { withFileTypes: true })) {
        if (!runEntry.isDirectory()) continue;
        const runPath = path.join(runsDir, runEntry.name);
        for (const trialEntry of fs.readdirSync(runPath, { withFileTypes: true })) {
          if (!trialEntry.isDirectory()) continue;
          const excFile = path.join(runPath, trialEntry.name, 'exception.txt');
          if (fs.existsSync(excFile)) {
            const lines = fs.readFileSync(excFile, 'utf8').trim().split(/\r?\n/).filter(Boolean);
            if (lines.length) {
              return lines[lines.length - 1];
            }
          }
        }
      }
      return null;
    } catch {
      return null;
    }
  }

  async getRunArtifacts(jobId: string): Promise<{
    jobId: string;
    gitDiff: string;
    changedFiles: string[];
    files: Array<{ path: string; size: number; content: string }>;
  }> {
    if (!/^[a-zA-Z0-9_-]+$/.test(jobId)) {
      throw new BadRequestException('Invalid Harbor job identifier.');
    }
    const jobDir = path.join(this.jobsRoot(), jobId);
    if (!fs.existsSync(jobDir)) {
      throw new BadRequestException('Harbor job was not found.');
    }

    let gitDiff = this.readTextSafe(path.join(jobDir, 'agent_diff.patch')) ?? '';
    if (!gitDiff) {
      try {
        const runnerUrl = this.config.get<string>('HARBOR_RUNNER_URL', 'http://harbor:8020').replace(/\/+$/, '');
        const res = await undiciRequest(`${runnerUrl}/runs/${jobId}/diff`, { method: 'GET' });
        if (res.statusCode >= 200 && res.statusCode < 300) {
          const body = (await res.body.json()) as { git_diff?: string };
          if (typeof body.git_diff === 'string') {
            gitDiff = body.git_diff;
          }
        }
      } catch {
        // Ignore if harbor container is offline or trial container was removed.
      }
    }

    const files: Array<{ path: string; size: number; content: string }> = [];
    const textExts = new Set(['.txt', '.md', '.log', '.json', '.jsonl', '.yaml', '.yml', '.err', '.patch']);
    const walk = async (dir: string) => {
      const entries = await fs.promises.readdir(dir, { withFileTypes: true });
      for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
        const fullPath = path.join(dir, entry.name);
        const rel = path.relative(jobDir, fullPath).replace(/\\/g, '/');
        if (entry.isDirectory()) {
          await walk(fullPath);
        } else if (entry.isFile()) {
          const ext = path.extname(entry.name).toLowerCase();
          if (!textExts.has(ext) && entry.name !== 'Dockerfile') {
            continue;
          }
          const stat = await fs.promises.stat(fullPath);
          if (stat.size > 512_000) {
            files.push({
              path: rel,
              size: stat.size,
              content: (await fs.promises.readFile(fullPath, 'utf8')).slice(0, 200_000) + '\n... (truncated)',
            });
          } else {
            files.push({
              path: rel,
              size: stat.size,
              content: await fs.promises.readFile(fullPath, 'utf8'),
            });
          }
        }
      }
    };
    await walk(jobDir);

    const { changedFiles, fallbackDiff } = this.extractChangesFromLogs(gitDiff, files);
    if (!gitDiff && fallbackDiff) {
      gitDiff = fallbackDiff;
    }

    return { jobId, gitDiff, changedFiles, files };
  }

  private extractChangesFromLogs(
    gitDiff: string,
    files: Array<{ path: string; size: number; content: string }>,
  ): { changedFiles: string[]; fallbackDiff: string } {
    const found = new Set<string>();
    const diffChunks: string[] = [];

    if (gitDiff) {
      for (const line of gitDiff.split(/\r?\n/)) {
        const gitMatch = /^diff --git a\/(.+?) b\/(.+)$/.exec(line);
        if (gitMatch?.[2]) {
          found.add(gitMatch[2]);
          continue;
        }
        const plusMatch = /^\+\+\+ (?:b\/)?([^\t\r\n]+)$/.exec(line);
        if (plusMatch?.[1] && plusMatch[1] !== '/dev/null') {
          found.add(plusMatch[1].replace(/^b\//, ''));
        }
      }
    }

    if (found.size === 0) {
      for (const file of files) {
        if (file.path.endsWith('/agent/aider.txt')) {
          for (const match of file.content.matchAll(/Applied edit to\s+([^\s\r\n]+)/g)) {
            if (match[1]) found.add(match[1]);
          }
        } else if (file.path.endsWith('/agent/trajectory.json')) {
          try {
            const parsed = JSON.parse(file.content) as {
              steps?: Array<{
                tool_calls?: Array<{
                  function_name?: string;
                  arguments?: Record<string, any>;
                }>;
              }>;
            };
            const editTools = new Set([
              'edit_file',
              'write_file',
              'replace_file_content',
              'multi_replace_file_content',
              'write_to_file',
              'create_file',
            ]);
            for (const step of parsed.steps ?? []) {
              for (const call of step.tool_calls ?? []) {
                const fn = (call.function_name ?? '').toLowerCase();
                if (!editTools.has(fn)) continue;
                const args = call.arguments ?? {};
                const rawPath = args.Path ?? args.path ?? args.file_path ?? args.TargetFile ?? args.file;
                if (typeof rawPath !== 'string' || !rawPath.trim() || rawPath.startsWith('/tmp/')) {
                  continue;
                }
                const relPath = rawPath.replace(/^\/workspace\//, '').replace(/^\.\//, '');
                found.add(relPath);

                const target = typeof args.Target === 'string' ? args.Target : typeof args.TargetContent === 'string' ? args.TargetContent : '';
                const replacement = typeof args.Replacement === 'string'
                  ? args.Replacement
                  : typeof args.ReplacementContent === 'string'
                    ? args.ReplacementContent
                    : typeof args.Content === 'string'
                      ? args.Content
                      : typeof args.CodeContent === 'string'
                        ? args.CodeContent
                        : '';
                if (target || replacement) {
                  diffChunks.push(
                    `--- a/${relPath}`,
                    `+++ b/${relPath}`,
                    '@@',
                    ...target.split(/\r?\n/).filter((l, i, arr) => i < arr.length - 1 || l !== '').map((l) => `-${l}`),
                    ...replacement.split(/\r?\n/).filter((l, i, arr) => i < arr.length - 1 || l !== '').map((l) => `+${l}`),
                  );
                }
              }
            }
          } catch {
            // Fall back to regex if trajectory.json is truncated or malformed.
            for (const match of file.content.matchAll(/(?:"Path"|"path"|"file_path"|"TargetFile"|"file"):\s*"(?:\/workspace\/)?([^"\r\n]+)"/g)) {
              if (match[1] && !match[1].startsWith('/tmp/')) {
                found.add(match[1].replace(/^\/workspace\//, ''));
              }
            }
          }
        }
      }
    }

    return { changedFiles: Array.from(found), fallbackDiff: diffChunks.join('\n') };
  }
}
