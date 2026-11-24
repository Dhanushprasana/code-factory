import { BadRequestException } from '@nestjs/common';
import { AgentBenchmarkService } from './agent-benchmark.service';

jest.mock('@nestjs/bullmq', () => ({ InjectQueue: () => () => undefined }));

describe('AgentBenchmarkService', () => {
  it('awards public and hidden test points proportionally to passed commands', () => {
    const service = Object.create(AgentBenchmarkService.prototype) as AgentBenchmarkService;
    const phaseScore = (service as unknown as {
      phaseScore: (results: Array<Record<string, unknown>>, weight: number) => number;
    }).phaseScore;

    expect(phaseScore([
      { status: 'passed' },
      { status: 'failed' },
      { status: 'passed' },
    ], 60)).toBe(40);
    expect(phaseScore([], 20)).toBe(0);
  });

  it('requires an approved reference and exactly two distinct ready agents', async () => {
    const service = Object.create(AgentBenchmarkService.prototype) as AgentBenchmarkService;
    Object.assign(service, {
      tasks: {
        findOneBy: jest.fn().mockResolvedValue({
          id: 'task-1',
          currentVersion: 1,
          baselineManifest: [{ repositoryId: 'repo-1' }],
        }),
      },
      references: {
        findOne: jest.fn().mockResolvedValue(null),
      },
    });

    await expect(service.startTaskExecution('task-1', { agentIds: ['a', 'b'] }))
      .rejects.toThrow(BadRequestException);
  });

  it('rejects an approved reference from an older task version', async () => {
    const service = Object.create(AgentBenchmarkService.prototype) as AgentBenchmarkService;
    Object.assign(service, {
      tasks: {
        findOneBy: jest.fn().mockResolvedValue({
          id: 'task-1',
          currentVersion: 2,
          baselineManifest: [{ repositoryId: 'repo-1' }],
        }),
      },
      references: {
        findOne: jest.fn().mockResolvedValue({
          id: 'reference-1',
          status: 'approved',
          taskVersion: 1,
        }),
      },
    });

    await expect(service.startTaskExecution('task-1', { agentIds: ['a', 'b'] }))
      .rejects.toThrow('must match the task current version');
  });

  it('queues two independent assignments and executions for an approved benchmark', async () => {
    const executionQueue = { add: jest.fn().mockResolvedValue(undefined) };
    const assignments = {
      create: jest.fn((value) => value),
      save: jest.fn(async (value) => ({ id: `assignment-${value.agentId}`, ...value })),
    };
    const executions = {
      create: jest.fn((value) => value),
      save: jest.fn(async (value) => ({ id: `execution-${value.assignmentId}`, ...value, submissions: [] })),
    };
    const submissions = {
      create: jest.fn((value) => value),
      save: jest.fn(async (value) => value),
    };
    const evaluations = {
      create: jest.fn((value) => value),
      save: jest.fn(async (value) => value),
    };
    const service = Object.create(AgentBenchmarkService.prototype) as AgentBenchmarkService;
    Object.assign(service, {
      executionQueue,
      evaluationQueue: { add: jest.fn() },
      tasks: {
        findOneBy: jest.fn().mockResolvedValue({
          id: 'task-1',
          currentVersion: 2,
          baselineManifest: [{ repositoryId: 'repo-1', snapshotId: 'snapshot-1', analysisId: 'analysis-1', commitSha: 'abc' }],
        }),
      },
      references: {
        findOne: jest.fn().mockResolvedValue({
          id: 'reference-1',
          status: 'approved',
          version: 1,
          taskVersion: 2,
        }),
      },
      agents: {
        findOneBy: jest.fn(async ({ id }: { id: string }) => ({
          id,
          name: id === 'a' ? 'Agent A' : 'Agent B',
          adapterType: 'direct-cli',
          status: 'ready',
          modelName: 'test-model',
          settings: {},
        })),
      },
      configs: {
        findOne: jest.fn().mockResolvedValue(null),
      },
      assignments,
      executions,
      submissions,
      evaluations,
    });

    const result = await service.startTaskExecution('task-1', { agentIds: ['a', 'b'] });

    expect(result.status).toBe('queued');
    expect(result.assignments).toHaveLength(2);
    expect(executionQueue.add).toHaveBeenCalledTimes(2);
  });

  it('stores hidden test files and command in the approved reference validation record', async () => {
    const reference = {
      id: 'reference-1',
      status: 'approved',
      validation: { hiddenTests: [] },
    };
    const references = {
      findOneBy: jest.fn().mockResolvedValue(reference),
      save: jest.fn(async (value) => value),
    };
    const service = Object.create(AgentBenchmarkService.prototype) as AgentBenchmarkService;
    Object.assign(service, { references });

    const result = await service.configureHiddenTests('reference-1', {
      repositoryId: 'repo-1',
      filePath: 'tests/hidden.spec.ts',
      content: 'describe("hidden", () => {});',
      command: ['npm', 'test', '--', 'tests/hidden.spec.ts'],
    });

    expect(result.hiddenTests).toHaveLength(1);
    expect(reference.validation.hiddenTests[0].filePath).toBe('tests/hidden.spec.ts');
  });
});
