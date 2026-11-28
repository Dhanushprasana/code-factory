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
      if (resultJson) {
        const errored = Number((resultJson.stats as Record<string, any> | undefined)?.n_errored_trials ?? 0);
        status = score > 0 && errored === 0 ? 'passed' : 'failed';
      } else if (statusJson?.status === 'failed') {
        status = 'failed';
      } else if (statusJson?.status === 'completed') {
        status = score > 0 ? 'passed' : 'failed';
      }

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
        error: typeof statusJson?.error === 'string' ? statusJson.error : null,
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
}
