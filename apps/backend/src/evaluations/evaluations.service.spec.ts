import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Repository } from 'typeorm';
import { EvaluationEntity } from './entities/evaluation.entity';
import { TaskEntity } from '../tasks/entities/task.entity';
import { EvaluationsService } from './evaluations.service';
import { AgentsService } from '../agents/agents.service';

describe('EvaluationsService', () => {
  let evaluationRepo: any;
  let taskRepo: any;
  let agentsService: any;
  let configService: any;
  let service: EvaluationsService;

  beforeEach(() => {
    evaluationRepo = {
      find: jest.fn(),
      findOneBy: jest.fn(),
      create: jest.fn((val) => ({ id: 'eval-1', ...val })),
      save: jest.fn(async (val) => ({ id: 'eval-1', ...val })),
      update: jest.fn(async () => ({})),
      createQueryBuilder: jest.fn(() => ({
        orderBy: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([]),
      })),
    };

    taskRepo = {
      findOneBy: jest.fn(),
    };

    agentsService = {
      get: jest.fn(),
      getDecryptedApiKey: jest.fn(),
    };

    configService = {
      get: jest.fn((key: string, def: any) => def),
    };

    service = new EvaluationsService(
      evaluationRepo as unknown as Repository<EvaluationEntity>,
      taskRepo as unknown as Repository<TaskEntity>,
      agentsService as unknown as AgentsService,
      configService as unknown as ConfigService,
    );
  });

  it('lists evaluations using query builder', async () => {
    const results = await service.list('task-1', 'agent-1');
    expect(evaluationRepo.createQueryBuilder).toHaveBeenCalledWith('eval');
    expect(results).toEqual([]);
  });

  it('retrieves an evaluation by id', async () => {
    evaluationRepo.findOneBy.mockResolvedValue({ id: 'eval-123', status: 'passed' });
    const result = await service.get('eval-123');
    expect(result.id).toBe('eval-123');
  });

  it('throws NotFoundException when evaluation is not found', async () => {
    evaluationRepo.findOneBy.mockResolvedValue(null);
    await expect(service.get('nonexistent')).rejects.toThrow(NotFoundException);
  });

  it('throws NotFoundException when task is not found on runEvaluation', async () => {
    taskRepo.findOneBy.mockResolvedValue(null);
    await expect(service.runEvaluation({ taskId: 't-1', agentId: 'a-1' })).rejects.toThrow(NotFoundException);
  });

  it('throws NotFoundException when agent is not found on runEvaluation', async () => {
    taskRepo.findOneBy.mockResolvedValue({ id: 't-1' });
    agentsService.get.mockResolvedValue(null);
    await expect(service.runEvaluation({ taskId: 't-1', agentId: 'a-1' })).rejects.toThrow(NotFoundException);
  });

  it('throws BadRequestException when agent has no API key', async () => {
    taskRepo.findOneBy.mockResolvedValue({ id: 't-1' });
    agentsService.get.mockResolvedValue({ id: 'a-1', name: 'Claude Agent' });
    agentsService.getDecryptedApiKey.mockResolvedValue(null);

    await expect(service.runEvaluation({ taskId: 't-1', agentId: 'a-1' })).rejects.toThrow(BadRequestException);
  });

  it('creates and returns evaluation when API key is present', async () => {
    taskRepo.findOneBy.mockResolvedValue({ id: 't-1', harborPackagePath: 'packages/t-1' });
    agentsService.get.mockResolvedValue({ id: 'a-1', name: 'Claude Agent', modelName: 'claude-3-7-sonnet', provider: 'Anthropic' });
    agentsService.getDecryptedApiKey.mockResolvedValue('sk-test-key');

    const result = await service.runEvaluation({ taskId: 't-1', agentId: 'a-1' });
    expect(evaluationRepo.create).toHaveBeenCalledWith(expect.objectContaining({
      taskId: 't-1',
      agentId: 'a-1',
      status: 'running',
    }));
    expect(result.id).toBe('eval-1');
  });

  it('calculates leaderboard metrics accurately', async () => {
    const mockEvaluations = [
      {
        id: '1',
        agentId: 'agent-1',
        agentName: 'Claude Code',
        modelName: 'claude-3-7-sonnet',
        provider: 'Anthropic',
        status: 'passed',
        reward: 1.0,
        durationMs: 5000,
        createdAt: new Date('2026-01-01'),
      },
      {
        id: '2',
        agentId: 'agent-1',
        agentName: 'Claude Code',
        modelName: 'claude-3-7-sonnet',
        provider: 'Anthropic',
        status: 'failed',
        reward: 0.0,
        durationMs: 7000,
        createdAt: new Date('2026-01-02'),
      },
      {
        id: '3',
        agentId: 'agent-2',
        agentName: 'GPT-4o',
        modelName: 'gpt-4o',
        provider: 'OpenAI',
        status: 'passed',
        reward: 1.0,
        durationMs: 4000,
        createdAt: new Date('2026-01-03'),
      },
    ];

    evaluationRepo.find.mockResolvedValue(mockEvaluations);

    const leaderboard = await service.getLeaderboard();
    expect(leaderboard).toHaveLength(2);

    // Agent-2 has 100% pass rate, should be ranked first
    expect(leaderboard[0].agentId).toBe('agent-2');
    expect(leaderboard[0].passRate).toBe(100);
    expect(leaderboard[0].totalRuns).toBe(1);

    // Agent-1 has 50% pass rate
    expect(leaderboard[1].agentId).toBe('agent-1');
    expect(leaderboard[1].passRate).toBe(50);
    expect(leaderboard[1].totalRuns).toBe(2);
    expect(leaderboard[1].averageDurationMs).toBe(6000);
  });
});
