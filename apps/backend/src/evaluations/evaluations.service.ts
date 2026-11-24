import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Agent as UndiciAgent } from 'undici';
import { EvaluationEntity } from './entities/evaluation.entity';
import { AgentsService } from '../agents/agents.service';
import { TaskEntity } from '../tasks/entities/task.entity';

export class RunEvaluationDto {
  taskId: string;
  agentId: string;
  timeoutSeconds?: number;
}

export interface LeaderboardEntry {
  agentId: string;
  agentName: string;
  modelName: string;
  provider: string;
  harborHarness: string;
  totalRuns: number;
  passedRuns: number;
  failedRuns: number;
  passRate: number;
  averageReward: number;
  averageDurationMs: number;
  lastEvaluatedAt: string;
}

@Injectable()
export class EvaluationsService {
  private readonly logger = new Logger(EvaluationsService.name);
  private readonly runnerUrl: string;
  private readonly runnerToken: string;

  constructor(
    @InjectRepository(EvaluationEntity)
    private readonly evaluationRepo: Repository<EvaluationEntity>,
    @InjectRepository(TaskEntity)
    private readonly taskRepo: Repository<TaskEntity>,
    private readonly agentsService: AgentsService,
    private readonly config: ConfigService,
  ) {
    this.runnerUrl = this.config.get<string>('VALIDATION_RUNNER_URL', 'http://validation-runner:8010');
    this.runnerToken = this.config.get<string>('VALIDATION_RUNNER_TOKEN', 'local-validation-runner-token');
  }

  async list(taskId?: string, agentId?: string): Promise<EvaluationEntity[]> {
    const qb = this.evaluationRepo.createQueryBuilder('eval').orderBy('eval.createdAt', 'DESC');
    if (taskId) {
      qb.andWhere('eval.taskId = :taskId', { taskId });
    }
    if (agentId) {
      qb.andWhere('eval.agentId = :agentId', { agentId });
    }
    return qb.getMany();
  }

  async get(id: string): Promise<EvaluationEntity> {
    const evaluation = await this.evaluationRepo.findOneBy({ id });
    if (!evaluation) {
      throw new NotFoundException(`Evaluation "${id}" was not found.`);
    }
    return evaluation;
  }

  async runEvaluation(dto: RunEvaluationDto): Promise<EvaluationEntity> {
    const task = await this.taskRepo.findOneBy({ id: dto.taskId });
    if (!task) {
      throw new NotFoundException(`Task "${dto.taskId}" was not found.`);
    }

    const agent = await this.agentsService.get(dto.agentId);
    if (!agent) {
      throw new NotFoundException(`Agent "${dto.agentId}" was not found.`);
    }

    const apiKey = await this.agentsService.getDecryptedApiKey(dto.agentId);
    if (!apiKey) {
      throw new BadRequestException(`Agent "${agent.name}" has no configured API key. Please set an API key in Agent Settings before running Harbor evaluation.`);
    }

    const packagePath = task.harborPackagePath || `harbor-packages/${task.id}`;

    // Create a pending evaluation record
    const evaluation = this.evaluationRepo.create({
      taskId: task.id,
      agentId: agent.id,
      agentName: agent.name,
      modelName: agent.modelName || 'default-model',
      provider: agent.provider || 'Custom',
      status: 'running',
      reward: 0.0,
      score: 0.0,
      durationMs: 0,
      metrics: {},
      trajectoryLogs: 'Harbor evaluation initiated...\n',
      testOutput: '',
    });

    const saved = await this.evaluationRepo.save(evaluation);

    // Run evaluation asynchronously
    this.dispatchToHarbor(saved.id, task, agent, apiKey, packagePath, dto.timeoutSeconds || 600).catch(err => {
      this.logger.error(`Failed during Harbor evaluation execution: ${err.message}`, err.stack);
    });

    return saved;
  }

  private async dispatchToHarbor(
    evaluationId: string,
    task: TaskEntity,
    agent: any,
    apiKey: string,
    packagePath: string,
    timeoutSeconds: number,
  ) {
    const startTime = Date.now();
    const dispatcher = new UndiciAgent({
      headersTimeout: 0,
      bodyTimeout: 0,
      connectTimeout: 30_000,
    });
    try {
      const response = await fetch(`${this.runnerUrl}/harbor/evaluate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.runnerToken}`,
        },
        body: JSON.stringify({
          evaluation_id: evaluationId,
          task_id: task.id,
          package_path: packagePath,
          model_name: agent.modelName,
          harbor_harness: agent.harborHarness || 'openrouter',
          api_key: apiKey,
          timeout_seconds: timeoutSeconds,
          harbor_files: task.harborFiles,
        }),
        // @ts-expect-error undici dispatcher is supported in Node fetch
        dispatcher,
        signal: AbortSignal.timeout((timeoutSeconds + 180) * 1000),
      });

      const result = await response.json().catch(() => ({}));

      const durationMs = Date.now() - startTime;
      const isSuccess = response.ok && result.status === 'passed';

      await this.evaluationRepo.update(evaluationId, {
        status: isSuccess ? 'passed' : (result.status === 'failed' ? 'failed' : 'error'),
        reward: typeof result.reward === 'number' ? result.reward : (isSuccess ? 1.0 : 0.0),
        score: typeof result.score === 'number' ? result.score : (isSuccess ? 1.0 : 0.0),
        durationMs: result.duration_ms || durationMs,
        metrics: result.metrics || {},
        trajectoryLogs: result.trajectory_logs || result.logs || '(No trajectory logs captured)',
        testOutput: result.test_output || '',
        errorMessage: result.error_message || (!response.ok ? `Runner responded with HTTP ${response.status}` : null),
      });
    } catch (error: any) {
      const detail = error?.cause?.message ? `${error.message} (${error.cause.message})` : (error.message || 'Unknown runner error');
      await this.evaluationRepo.update(evaluationId, {
        status: 'error',
        durationMs: Date.now() - startTime,
        errorMessage: detail,
        trajectoryLogs: `Execution failed with error: ${detail}`,
      });
    } finally {
      await dispatcher.close().catch(() => undefined);
    }
  }

  async getLeaderboard(): Promise<LeaderboardEntry[]> {
    const all = await this.evaluationRepo.find({
      order: { createdAt: 'DESC' },
    });

    const byAgent = new Map<string, EvaluationEntity[]>();
    for (const evalItem of all) {
      const existing = byAgent.get(evalItem.agentId) || [];
      existing.push(evalItem);
      byAgent.set(evalItem.agentId, existing);
    }

    const leaderboard: LeaderboardEntry[] = [];
    for (const [agentId, runs] of byAgent.entries()) {
      const first = runs[0];
      const totalRuns = runs.length;
      const passedRuns = runs.filter(r => r.status === 'passed' || r.reward >= 1.0).length;
      const failedRuns = totalRuns - passedRuns;
      const passRate = totalRuns > 0 ? Number(((passedRuns / totalRuns) * 100).toFixed(1)) : 0;
      const totalReward = runs.reduce((sum, r) => sum + Number(r.reward || 0), 0);
      const averageReward = totalRuns > 0 ? Number((totalReward / totalRuns).toFixed(2)) : 0;
      const totalDuration = runs.reduce((sum, r) => sum + (r.durationMs || 0), 0);
      const averageDurationMs = totalRuns > 0 ? Math.round(totalDuration / totalRuns) : 0;

      leaderboard.push({
        agentId,
        agentName: first.agentName,
        modelName: first.modelName,
        provider: first.provider,
        harborHarness: 'openrouter',
        totalRuns,
        passedRuns,
        failedRuns,
        passRate,
        averageReward,
        averageDurationMs,
        lastEvaluatedAt: first.createdAt ? first.createdAt.toISOString() : new Date().toISOString(),
      });
    }

    // Sort by passRate DESC, then totalRuns DESC
    return leaderboard.sort((a, b) => {
      if (b.passRate !== a.passRate) return b.passRate - a.passRate;
      return b.totalRuns - a.totalRuns;
    });
  }
}
