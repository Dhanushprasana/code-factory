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
import { execFile } from 'child_process';
import { randomUUID } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { promisify } from 'util';
import { request as undiciRequest } from 'undici';
import { Repository } from 'typeorm';
import { AgentConfigEntity } from '../agents/entities/agent-config.entity';
import { AgentEntity } from '../agents/entities/agent.entity';
import { RepositoryAnalysisEntity } from '../analysis/entities/repository-analysis.entity';
import { RepositoryEntity } from '../repositories/entities/repository.entity';
import { RepositorySnapshotEntity } from '../repositories/entities/repository-snapshot.entity';
import { ReferenceSolutionEntity } from '../tasks/entities/reference-solution.entity';
import { TaskEntity } from '../tasks/entities/task.entity';
import { TaskVersionEntity } from '../tasks/entities/task-version.entity';
import { AgentAssignmentEntity } from './entities/agent-assignment.entity';
import { AgentEvaluationEntity } from './entities/agent-evaluation.entity';
import { AgentExecutionEntity } from './entities/agent-execution.entity';
import { AgentSubmissionEntity } from './entities/agent-submission.entity';

const execFileAsync = promisify(execFile);

@Injectable()
export class AgentBenchmarkService {
  private readonly logger = new Logger(AgentBenchmarkService.name);
  private readonly storagePath = process.env.ARTIFACT_STORAGE_PATH
    ? path.resolve(__dirname, '../../../../', process.env.ARTIFACT_STORAGE_PATH)
    : path.resolve(__dirname, '../../../../storage');

  constructor(
    @InjectQueue('agent-execution') private readonly executionQueue: Queue,
    @InjectQueue('agent-evaluation') private readonly evaluationQueue: Queue,
    private readonly config: ConfigService,
    @InjectRepository(TaskEntity) private readonly tasks: Repository<TaskEntity>,
    @InjectRepository(TaskVersionEntity) private readonly taskVersions: Repository<TaskVersionEntity>,
    @InjectRepository(ReferenceSolutionEntity) private readonly references: Repository<ReferenceSolutionEntity>,
    @InjectRepository(AgentEntity) private readonly agents: Repository<AgentEntity>,
    @InjectRepository(AgentConfigEntity) private readonly configs: Repository<AgentConfigEntity>,
    @InjectRepository(RepositoryAnalysisEntity) private readonly analyses: Repository<RepositoryAnalysisEntity>,
    @InjectRepository(RepositorySnapshotEntity) private readonly snapshots: Repository<RepositorySnapshotEntity>,
    @InjectRepository(RepositoryEntity) private readonly repositories: Repository<RepositoryEntity>,
    @InjectRepository(AgentAssignmentEntity) private readonly assignments: Repository<AgentAssignmentEntity>,
    @InjectRepository(AgentExecutionEntity) private readonly executions: Repository<AgentExecutionEntity>,
    @InjectRepository(AgentSubmissionEntity) private readonly submissions: Repository<AgentSubmissionEntity>,
    @InjectRepository(AgentEvaluationEntity) private readonly evaluations: Repository<AgentEvaluationEntity>,
  ) {}

  async startTaskExecution(taskId: string, input: Record<string, unknown>) {
    const task = await this.tasks.findOneBy({ id: taskId });
    if (!task) throw new NotFoundException('Task was not found.');

    const reference = await this.references.findOne({
      where: { taskId, status: 'approved' },
      order: { version: 'DESC' },
    });
    if (!reference) {
      throw new BadRequestException('An approved reference solution is required before agent execution.');
    }
    if (reference.taskVersion !== task.currentVersion) {
      throw new BadRequestException('The approved reference solution must match the task current version.');
    }
    const agentIds = Array.isArray(input.agentIds)
      ? input.agentIds.filter((value): value is string => typeof value === 'string')
      : [];
    if (agentIds.length !== 2 || new Set(agentIds).size !== 2) {
      throw new BadRequestException('Select exactly two different coding agents.');
    }
    const selectedAgents = await Promise.all(agentIds.map((id) => this.agents.findOneBy({ id })));
    if (selectedAgents.some((agent) => !agent || agent.status !== 'ready')) {
      throw new BadRequestException('Both selected agents must exist and be ready.');
    }
    const agents = selectedAgents as AgentEntity[];
    const baseline = task.baselineManifest;
    if (!Array.isArray(baseline) || baseline.length === 0) {
      throw new BadRequestException('The task has no pinned repository baseline.');
    }

    const batch: AgentAssignmentEntity[] = [];
    for (const agent of agents) {
      const config = await this.configs.findOne({
        where: { agentId: agent.id },
        order: { configVersion: 'DESC' },
      });
      const assignment = await this.assignments.save(this.assignments.create({
        taskId,
        taskVersion: task.currentVersion,
        referenceId: reference.id,
        agentId: agent.id,
        configId: config?.id ?? null,
        status: 'queued',
        baselineManifest: baseline,
      }));
      const execution = await this.executions.save(this.executions.create({
        assignmentId: assignment.id,
        status: 'queued',
        adapterType: agent.adapterType,
        metadata: {
          taskId,
          taskVersion: task.currentVersion,
          referenceId: reference.id,
          agentName: agent.name,
          modelName: agent.modelName,
          baselineCommitCount: baseline.length,
        },
      }));
      await this.submissions.save(this.submissions.create({
        executionId: execution.id,
        status: 'pending',
        patchDiff: null,
        patchValid: false,
        metadata: {},
      }));
      await this.executionQueue.add(
        'execute',
        { executionId: execution.id },
        { jobId: `execute-${execution.id}`, attempts: 1, removeOnComplete: 100, removeOnFail: 100 },
      );
      assignment.executions = [execution];
      batch.push(assignment);
    }
    return {
      taskId,
      referenceId: reference.id,
      status: 'queued',
      assignments: batch,
    };
  }

  async processExecution(executionId: string) {
    const execution = await this.executions.findOne({
      where: { id: executionId },
      relations: ['assignment', 'assignment.agent', 'assignment.config', 'submissions'],
    });
    if (!execution || execution.status !== 'queued') return;
    execution.status = 'running';
    execution.startedAt = new Date();
    await this.executions.save(execution);

    try {
      const task = await this.tasks.findOneBy({ id: execution.assignment.taskId });
      if (!task) throw new Error('The assigned task is no longer available.');
      const taskVersion = await this.taskVersions.findOneBy({
        taskId: task.id,
        version: execution.assignment.taskVersion,
      });
      if (!taskVersion) throw new Error('The assigned task version is no longer available.');
      const taskContent = taskVersion.content;
      if (typeof taskContent.title !== 'string' || typeof taskContent.description !== 'string') {
        throw new Error('The assigned task version is invalid.');
      }
      const baseline = await this.resolveBaseline(execution.assignment.baselineManifest);
      const root = path.join(this.storagePath, 'agent-workspaces', execution.id);
      this.assertStoragePath(root);
      await fs.promises.rm(root, { recursive: true, force: true });
      await fs.promises.mkdir(root, { recursive: true });

      const repositories: Array<{ repositoryId: string; repositoryPath: string }> = [];
      for (const item of baseline) {
        const repositoryId = item.repository_id as string;
        const sourcePath = item.repository_path as string;
        const repositoryPath = path.join(root, 'repositories', repositoryId);
        await fs.promises.mkdir(path.dirname(repositoryPath), { recursive: true });
        await fs.promises.cp(sourcePath, repositoryPath, {
          recursive: true,
          filter: (source) => this.shouldCopySnapshotEntry(source),
        });
        repositories.push({ repositoryId, repositoryPath });
      }

      const instruction = [
        '# ForgeBench Coding Agent Instructions',
        '',
        `Task: ${taskContent.title}`,
        '',
        taskContent.description,
        '',
        'Requirements:',
        ...(Array.isArray(taskContent.requirements)
          ? taskContent.requirements.filter((item): item is string => typeof item === 'string').map((item) => `- ${item}`)
          : []),
        '',
        'Acceptance criteria:',
        ...(Array.isArray(taskContent.acceptanceCriteria)
          ? taskContent.acceptanceCriteria.filter((item): item is string => typeof item === 'string').map((item) => `- ${item}`)
          : []),
        '',
        'Constraints:',
        ...(Array.isArray(taskContent.constraints)
          ? taskContent.constraints.filter((item): item is string => typeof item === 'string').map((item) => `- ${item}`)
          : []),
        '',
        'Do not access reference solutions or hidden tests.',
      ].join('\n');
      await fs.promises.writeFile(path.join(root, 'TASK.md'), instruction);
      for (const repository of repositories) {
        await fs.promises.copyFile(
          path.join(root, 'TASK.md'),
          path.join(repository.repositoryPath, 'TASK.md'),
        );
        await this.initializeSubmissionRepository(repository.repositoryPath);
      }

      const agent = execution.assignment.agent;
      const settings = execution.assignment.config?.settings ?? agent.settings ?? {};
      const command = this.readAdapterCommand(settings);
      const isHarbor = agent.adapterType === 'harbor';
      if (!command && !isHarbor) {
        throw new Error(
          'Direct CLI adapter is not configured. Set settings.command to the agent executable and arguments.',
        );
      }

      const runnerUrl = this.config.get<string>(
        isHarbor ? 'HARBOR_RUNNER_URL' : 'VALIDATION_RUNNER_URL',
      );
      const runnerToken = this.config.get<string>('VALIDATION_RUNNER_TOKEN');
      if (!runnerUrl || !runnerToken) {
        throw new ServiceUnavailableException(
          isHarbor
            ? 'Harbor execution is not configured. Set HARBOR_RUNNER_URL and VALIDATION_RUNNER_TOKEN.'
            : 'Isolated agent execution is not configured. Set VALIDATION_RUNNER_URL and VALIDATION_RUNNER_TOKEN.',
        );
      }
      if (repositories.length === 0) throw new Error('The task has no repository workspace for agent execution.');
      const timeoutMinutes = Math.min(120, Math.max(1, Number(settings.timeoutMinutes) || 25));
      const runnerTimeoutMs = timeoutMinutes * 60_000 + (isHarbor ? 10 : 0) * 60_000 + 30_000;
      const response = await undiciRequest(`${runnerUrl.replace(/\/+$/, '')}/execute-agent`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${runnerToken}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          execution_id: execution.id,
          repository_ids: repositories.map((item) => item.repositoryId),
          adapter_type: isHarbor ? 'harbor' : 'direct-cli',
          ...(isHarbor
            ? {
              harbor_agent: typeof settings.harborAgent === 'string'
                ? settings.harborAgent
                : 'gemini-cli',
              model_name: agent.modelName,
            }
            : command
              ? { command: { args: [command.executable, ...command.args] } }
              : {}),
          timeout_seconds: Math.max(60, Math.round(timeoutMinutes * 60)),
          credential_reference: execution.assignment.config?.credentialReference
            ?? agent.credentialReference
            ?? null,
          allow_network: settings.allowNetwork === true
            && this.config.get<string>('AGENT_EXECUTION_ALLOW_NETWORK') === 'true',
        }),
        headersTimeout: runnerTimeoutMs,
        bodyTimeout: runnerTimeoutMs,
      });
      const result = await response.body.json() as Record<string, unknown>;
      if (response.statusCode < 200 || response.statusCode >= 300) {
        throw new Error(typeof result.detail === 'string'
          ? result.detail
          : 'The isolated agent runner returned an error.');
      }
      const adapterOutput = typeof result.logs === 'string' ? result.logs : '';
      const rawPatchBundles = result.patch_bundles
        && typeof result.patch_bundles === 'object'
        && !Array.isArray(result.patch_bundles)
        ? result.patch_bundles as Record<string, unknown>
        : {};
      const patchBundles: Record<string, string> = {};
      for (const repository of repositories) {
        const patch = rawPatchBundles[repository.repositoryId];
        if (typeof patch === 'string' && patch.trim()) {
          patchBundles[repository.repositoryId] = patch;
        }
      }
      const patchDiff = Object.values(patchBundles).join('\n');
      const patchValid = result.patch_valid === true && Object.keys(patchBundles).length > 0;

      const logPath = path.join(root, 'execution.log');
      execution.workspacePath = root;
      execution.logArtifact = logPath;
      await fs.promises.writeFile(logPath, adapterOutput.slice(-2_000_000));
      if (result.status !== 'passed') {
        throw new Error(typeof result.error === 'string'
          ? result.error
          : 'The coding agent command failed in the isolated runner.');
      }
      if (!patchDiff.trim()) {
        throw new Error('The coding agent completed without producing a code change.');
      }
      execution.status = 'submitted';
      execution.completedAt = new Date();
      execution.workspacePath = root;
      execution.logArtifact = logPath;
      execution.metadata = {
        ...execution.metadata,
        patchValid,
        patchBytes: Buffer.byteLength(patchDiff),
        repositoryCount: repositories.length,
      };
      await this.executions.save(execution);

      const submission = execution.submissions[0];
      submission.status = 'submitted';
      submission.patchDiff = patchDiff || null;
      submission.patchValid = patchValid;
      submission.artifactPath = logPath;
      submission.metadata = {
        adapterType: agent.adapterType,
        agentName: agent.name,
        modelName: agent.modelName,
        patchBytes: Buffer.byteLength(patchDiff),
        patchBundles,
        runner: {
          durationMs: result.duration_ms,
          stdoutTruncated: result.stdout_truncated,
          stderrTruncated: result.stderr_truncated,
        },
      };
      await this.submissions.save(submission);
      execution.assignment.status = 'submitted';
      await this.assignments.save(execution.assignment);

      const evaluation = await this.evaluations.save(this.evaluations.create({
        submissionId: submission.id,
        referenceId: execution.assignment.referenceId,
        status: 'queued',
        testResults: [],
        metrics: {},
      }));
      await this.evaluationQueue.add(
        'evaluate',
        { evaluationId: evaluation.id },
        { jobId: `evaluate-${evaluation.id}`, attempts: 1, removeOnComplete: 100, removeOnFail: 100 },
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Agent execution failed unexpectedly.';
      execution.status = 'failed';
      execution.completedAt = new Date();
      execution.errorMessage = message.slice(0, 4000);
      await this.executions.save(execution);
      if (execution.assignment) {
        execution.assignment.status = 'failed';
        await this.assignments.save(execution.assignment);
      }
      const submission = execution.submissions[0];
      if (submission) {
        submission.status = 'failed';
        submission.artifactPath = execution.logArtifact;
        submission.metadata = { error: message.slice(0, 4000) };
        await this.submissions.save(submission);
      }
      this.logger.error(`Agent execution ${executionId} failed: ${message}`);
    }
  }

  async processEvaluation(evaluationId: string) {
    const evaluation = await this.evaluations.findOne({
      where: { id: evaluationId },
      relations: ['submission', 'submission.execution', 'submission.execution.assignment', 'reference'],
    });
    if (!evaluation || evaluation.status !== 'queued') return;
    evaluation.status = 'running';
    evaluation.startedAt = new Date();
    await this.evaluations.save(evaluation);

    try {
      const submission = evaluation.submission;
      const assignment = submission.execution.assignment;
      if (evaluation.reference.taskVersion !== assignment.taskVersion) {
        throw new Error('The evaluation reference does not match the assigned task version.');
      }
      const task = await this.tasks.findOneBy({ id: assignment.taskId });
      if (!task) throw new Error('The evaluation task is no longer available.');
      const taskVersion = await this.taskVersions.findOneBy({
        taskId: task.id,
        version: assignment.taskVersion,
      });
      if (!taskVersion) throw new Error('The assigned task version is no longer available.');
      const baseline = await this.resolveBaseline(assignment.baselineManifest);
      const workspaceRoot = path.join(this.storagePath, 'reference-workspaces', evaluation.id);
      this.assertStoragePath(workspaceRoot);
      await fs.promises.rm(workspaceRoot, { recursive: true, force: true });
      await fs.promises.mkdir(workspaceRoot, { recursive: true });

      const repositoryPlans: Array<Record<string, unknown>> = [];
      const hiddenSuite = this.readHiddenSuite(evaluation.reference.validation);
      const publicTests = Array.isArray(evaluation.reference.tests)
        ? (evaluation.reference.tests as Array<Record<string, unknown>>)
        : [];
      let patchApplied = false;
      const patchBundles = (submission.metadata.patchBundles ?? {}) as Record<string, string>;
      const appliedRepositories: string[] = [];
      const patchApplyErrors: Record<string, string> = {};
      const patchRepositories = Object.keys(patchBundles);
      for (const item of baseline) {
        const repositoryId = item.repository_id as string;
        const sourcePath = item.repository_path as string;
        const repositoryPatch = patchBundles[repositoryId] ?? '';
        const repositoryPath = path.join(workspaceRoot, 'repositories', repositoryId);
        await fs.promises.mkdir(path.dirname(repositoryPath), { recursive: true });
        await fs.promises.cp(sourcePath, repositoryPath, {
          recursive: true,
          filter: (source) => this.shouldCopySnapshotEntry(source),
        });
        if (repositoryPatch) {
          const patchPath = path.join(workspaceRoot, `.evaluation-${repositoryId}.patch`);
          await fs.promises.mkdir(path.dirname(patchPath), { recursive: true });
          await fs.promises.writeFile(patchPath, repositoryPatch, { flag: 'w' });
          const applyError = await this.tryApplyEvaluationPatch(repositoryPath, patchPath);
          if (applyError === null) {
            appliedRepositories.push(repositoryId);
          } else {
            patchApplyErrors[repositoryId] = applyError;
          }
        }

        // Write approved reference's generated public test files into evaluation workspace (without overwriting agent code)
        for (const publicTest of publicTests) {
          if (publicTest.repository_id !== repositoryId) continue;
          const filePath = publicTest.file_path;
          const content = publicTest.content;
          if (typeof filePath !== 'string' || typeof content !== 'string' || !this.isSafeRelativePath(filePath)) {
            continue;
          }
          const testDestination = path.resolve(repositoryPath, filePath);
          const relTest = path.relative(repositoryPath, testDestination);
          if (!relTest || relTest.startsWith('..') || path.isAbsolute(relTest)) continue;
          if (!fs.existsSync(testDestination)) {
            await fs.promises.mkdir(path.dirname(testDestination), { recursive: true });
            await fs.promises.writeFile(testDestination, content, { flag: 'wx' });
          }
        }

        for (const hidden of hiddenSuite) {
          if (hidden.repositoryId !== repositoryId) continue;
          if (!this.isSafeRelativePath(hidden.filePath)) {
            throw new BadRequestException('A hidden test path is invalid.');
          }
          const hiddenPath = path.resolve(repositoryPath, hidden.filePath);
          const relative = path.relative(repositoryPath, hiddenPath);
          if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
            throw new BadRequestException('A hidden test file is outside the evaluation workspace.');
          }
          let parentPath = repositoryPath;
          for (const segment of hidden.filePath.split('/').slice(0, -1)) {
            parentPath = path.join(parentPath, segment);
            try {
              const parent = await fs.promises.lstat(parentPath);
              if (parent.isSymbolicLink() || !parent.isDirectory()) {
                throw new BadRequestException('A hidden test path crosses an unsafe workspace entry.');
              }
            } catch (error) {
              if (error instanceof BadRequestException) throw error;
              if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
            }
          }
          await fs.promises.mkdir(path.dirname(hiddenPath), { recursive: true });
          await fs.promises.writeFile(hiddenPath, hidden.content, { flag: 'wx' });
        }

        const workspace = evaluation.reference.validation.workspace as {
          repositories?: Array<{
            repository_id?: string;
            setup_commands?: string[][];
            build_command_args?: string[][];
            test_command_args?: string[][];
          }>;
        } | undefined;
        const repositoryWorkspace = workspace?.repositories?.find(
          (item) => item.repository_id === repositoryId,
        );
        repositoryPlans.push({
          repository_id: repositoryId,
          setup_commands: (repositoryWorkspace?.setup_commands ?? []).map((args) => ({ args })),
          build_commands: (repositoryWorkspace?.build_command_args ?? []).map((args) => ({ args })),
          public_test_commands: (repositoryWorkspace?.test_command_args ?? []).map((args) => ({ args })),
          hidden_test_commands: hiddenSuite
            .filter((hidden) => hidden.repositoryId === repositoryId)
            .map((hidden) => ({ args: hidden.command })),
        });
      }
      patchApplied = patchRepositories.length > 0
        && patchRepositories.every((repositoryId) => appliedRepositories.includes(repositoryId));

      const runnerUrl = this.config.get<string>('VALIDATION_RUNNER_URL');
      const runnerToken = this.config.get<string>('VALIDATION_RUNNER_TOKEN');
      if (!runnerUrl || !runnerToken) {
        throw new ServiceUnavailableException(
          'Automatic evaluation is not configured. Set VALIDATION_RUNNER_URL and VALIDATION_RUNNER_TOKEN.',
        );
      }
      const response = await undiciRequest(`${runnerUrl.replace(/\/+$/, '')}/execute`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${runnerToken}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          reference_id: evaluation.id,
          allow_network: this.config.get<string>('REFERENCE_VALIDATION_ALLOW_NETWORK') === 'true',
          repositories: repositoryPlans,
        }),
        headersTimeout: 1_800_000,
        bodyTimeout: 1_800_000,
      });
      const result = await response.body.json() as Record<string, unknown>;
      if (response.statusCode < 200 || response.statusCode >= 300) {
        throw new Error(typeof result.detail === 'string'
          ? result.detail
          : 'The evaluation runner returned an error.');
      }

      const repositoryResults = Array.isArray(result.repositories)
        ? result.repositories as Array<Record<string, unknown>>
        : [];
      const buildResults = repositoryResults.flatMap((item) =>
        Array.isArray(item.build) ? item.build as Array<Record<string, unknown>> : []);
      const publicTestResults = repositoryResults.flatMap((item) =>
        Array.isArray(item.public_tests) ? item.public_tests as Array<Record<string, unknown>> : []);
      const hiddenTestResults = repositoryResults.flatMap((item) =>
        Array.isArray(item.hidden_tests) ? item.hidden_tests as Array<Record<string, unknown>> : []);
      const buildPassed = patchApplied
        && buildResults.length > 0
        && buildResults.every((item) => item.status === 'passed');

      const patchScore = patchApplied && submission.patchValid ? 10 : 0;
      const buildScore = buildPassed ? 10 : 0;
      const publicScore = patchApplied ? this.phaseScore(publicTestResults, 20) : 0;
      const hiddenScore = patchApplied ? this.phaseScore(hiddenTestResults, 60) : 0;
      const totalScore = patchScore + buildScore + publicScore + hiddenScore;
      const metrics = {
        patchValidity: patchScore,
        patchValidityRaw: patchApplied && submission.patchValid,
        ...(Object.keys(patchApplyErrors).length > 0 ? { patchApplyErrors } : {}),
        buildTypeCheck: buildScore,
        buildTypeCheckRaw: buildPassed,
        publicRegressionTests: publicScore,
        publicRegressionTestsRaw: {
          configured: publicTestResults.length > 0,
          passed: publicTestResults.filter((item) => item.status === 'passed').length,
          total: publicTestResults.length,
        },
        hiddenTestCorrectness: hiddenScore,
        hiddenTestCorrectnessRaw: {
          configured: hiddenTestResults.length > 0,
          passed: hiddenTestResults.filter((item) => item.status === 'passed').length,
          total: hiddenTestResults.length,
        },
        hiddenTestConfigured: hiddenTestResults.length > 0,
        totalScore,
      };
      evaluation.status = 'completed';
      evaluation.completedAt = new Date();
      evaluation.workspacePath = workspaceRoot;
      evaluation.testResults = repositoryResults;
      evaluation.metrics = metrics;
      evaluation.totalScore = totalScore;
      await this.evaluations.save(evaluation);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Evaluation failed unexpectedly.';
      evaluation.status = 'failed';
      evaluation.completedAt = new Date();
      evaluation.errorMessage = message.slice(0, 4000);
      evaluation.metrics = {
        patchValidity: 0,
        buildTypeCheck: 0,
        publicRegressionTests: 0,
        hiddenTestCorrectness: 0,
        totalScore: 0,
        error: message,
      };
      evaluation.totalScore = 0;
      await this.evaluations.save(evaluation);
      this.logger.error(`Agent evaluation ${evaluationId} failed: ${message}`);
    }
  }

  private phaseScore(results: Array<Record<string, unknown>>, weight: number) {
    if (results.length === 0) return 0;
    const passed = results.filter((result) => result.status === 'passed').length;
    return Math.round((passed / results.length) * weight * 100) / 100;
  }

  async configureHiddenTests(referenceId: string, input: Record<string, unknown>) {
    const reference = await this.references.findOneBy({ id: referenceId });
    if (!reference) throw new NotFoundException('Reference solution was not found.');
    if (reference.status !== 'approved') {
      throw new BadRequestException('Hidden tests can only be configured for an approved reference.');
    }
    const repositoryId = input.repositoryId;
    const filePath = input.filePath;
    const content = input.content;
    const command = input.command;
    if (typeof repositoryId !== 'string'
      || typeof filePath !== 'string'
      || typeof content !== 'string'
      || !this.isSafeRelativePath(filePath)
      || !Array.isArray(command)
      || command.length === 0
      || command.some((arg) => typeof arg !== 'string' || arg.length === 0)) {
      throw new BadRequestException('Hidden test configuration requires repositoryId, safe filePath, content, and command.');
    }
    const existing = this.readHiddenSuite(reference.validation);
    existing.push({
      repositoryId,
      filePath,
      content,
      command,
    });
    reference.validation = {
      ...reference.validation,
      hiddenTests: existing,
    };
    await this.references.save(reference);
    return { referenceId, hiddenTests: existing };
  }

  async getExecution(executionId: string) {
    const execution = await this.executions.findOne({
      where: { id: executionId },
      relations: ['assignment', 'assignment.agent', 'submissions'],
    });
    if (!execution) throw new NotFoundException('Agent execution was not found.');
    return execution;
  }

  async getEvaluation(evaluationId: string) {
    const evaluation = await this.evaluations.findOne({
      where: { id: evaluationId },
      relations: ['submission', 'submission.execution', 'submission.execution.assignment', 'submission.execution.assignment.agent'],
    });
    if (!evaluation) throw new NotFoundException('Evaluation was not found.');
    return evaluation;
  }

  async getTaskBenchmark(taskId: string) {
    const task = await this.tasks.findOneBy({ id: taskId });
    if (!task) throw new NotFoundException('Task was not found.');
    const assignments = await this.assignments.find({
      where: { taskId },
      relations: ['agent', 'executions', 'executions.submissions', 'executions.submissions.evaluations'],
      order: { assignedAt: 'DESC' },
    });
    return {
      taskId,
      taskVersion: task.currentVersion,
      assignments,
    };
  }

  private readAdapterCommand(settings: Record<string, unknown>) {
    const command = settings.command;
    if (!Array.isArray(command) || command.length === 0
      || command.some((value) => typeof value !== 'string' || value.length === 0)) {
      return null;
    }
    return { executable: command[0] as string, args: command.slice(1) as string[] };
  }

  private readHiddenSuite(validation: Record<string, unknown>) {
    const hidden = Array.isArray(validation.hiddenTests)
      ? validation.hiddenTests as Array<Record<string, unknown>>
      : [];
    return hidden.flatMap((item) => {
      if (typeof item.repositoryId !== 'string'
        || typeof item.filePath !== 'string'
        || typeof item.content !== 'string'
        || !Array.isArray(item.command)
        || item.command.length === 0
        || item.command.some((arg) => typeof arg !== 'string')) {
        return [];
      }
      return [{
        repositoryId: item.repositoryId,
        filePath: item.filePath,
        content: item.content,
        command: item.command as string[],
      }];
    });
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
    if (excludedNames.has(name)) return false;
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

  private assertStoragePath(workspacePath: string) {
    const resolved = path.resolve(workspacePath);
    const relative = path.relative(this.storagePath, resolved);
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
      throw new BadRequestException('A benchmark workspace is outside the configured artifact storage root.');
    }
  }

  private async tryApplyEvaluationPatch(repositoryPath: string, patchPath: string): Promise<string | null> {
    const attemptModes: string[][] = [
      ['apply', '--recount', '--allow-binary-replacement', '--whitespace=nowarn'],
      ['apply', '--recount', '--allow-binary-replacement', '--ignore-space-change', '--whitespace=nowarn'],
      ['apply', '--recount', '--allow-binary-replacement', '--3way', '--whitespace=nowarn'],
    ];
    let lastError = 'git apply failed.';
    for (const mode of attemptModes) {
      try {
        await execFileAsync('git', [...mode, '--check', '--', patchPath], {
          cwd: repositoryPath,
          timeout: 30_000,
          maxBuffer: 4 * 1024 * 1024,
          windowsHide: true,
        });
        await execFileAsync('git', [...mode, '--', patchPath], {
          cwd: repositoryPath,
          timeout: 30_000,
          maxBuffer: 4 * 1024 * 1024,
          windowsHide: true,
        });
        return null;
      } catch (error) {
        const stderr = error && typeof error === 'object' && 'stderr' in error && typeof error.stderr === 'string'
          ? error.stderr.trim()
          : '';
        lastError = stderr || (error instanceof Error ? error.message : 'git apply failed.');
      }
    }
    this.logger.warn(`Evaluation patch apply failed in ${repositoryPath}: ${lastError.slice(0, 500)}`);
    return lastError.slice(0, 1500);
  }

  private async initializeSubmissionRepository(repositoryPath: string) {
    await execFileAsync('git', ['init', '-q'], { cwd: repositoryPath, timeout: 30_000 });
    await execFileAsync('git', ['config', 'user.email', 'forgebench@local'], { cwd: repositoryPath });
    await execFileAsync('git', ['config', 'user.name', 'ForgeBench Agent'], { cwd: repositoryPath });
    const excludePath = path.join(repositoryPath, '.git', 'info', 'exclude');
    await fs.promises.mkdir(path.dirname(excludePath), { recursive: true });
    await fs.promises.writeFile(
      excludePath,
      [
        'TASK.md',
        'node_modules/',
        '.venv/',
        'venv/',
        '__pycache__/',
        '.pytest_cache/',
        '*.pyc',
        '*.pyo',
        '*.o',
        '*.obj',
        '*.a',
        '*.so',
        '*.dylib',
        '*.dll',
        'dist/',
        'build/',
        'cmake-build-*/',
        'CMakeCache.txt',
        'CMakeFiles/',
        '.next/',
        '.turbo/',
        'coverage/',
      ].join('\n') + '\n',
      'utf8',
    );
    await execFileAsync('git', ['add', '-A'], { cwd: repositoryPath });
    await execFileAsync('git', ['-c', 'commit.gpgsign=false', 'commit', '-qm', 'Pinned baseline'], {
      cwd: repositoryPath,
    });
  }

  private async resolveBaseline(value: unknown) {
    if (!Array.isArray(value) || value.length === 0) {
      throw new BadRequestException('The task baseline manifest is invalid.');
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
      if (typeof repositoryId !== 'string' || typeof snapshotId !== 'string'
        || typeof analysisId !== 'string' || typeof commitSha !== 'string') {
        throw new BadRequestException('The task baseline manifest is incomplete.');
      }
      const analysis = await this.analyses.findOneBy({ id: analysisId, status: 'completed' });
      if (!analysis || analysis.repositoryId !== repositoryId
        || analysis.snapshotId !== snapshotId
        || analysis.commitSha.toLowerCase() !== commitSha.toLowerCase()) {
        throw new BadRequestException('The task baseline analysis does not match its pinned commit.');
      }
      const snapshot = await this.snapshots
        .createQueryBuilder('snapshot')
        .addSelect('snapshot.checkoutPath')
        .where('snapshot.id = :snapshotId', { snapshotId })
        .andWhere('snapshot.repositoryId = :repositoryId', { repositoryId })
        .andWhere('snapshot.status = :status', { status: 'ready' })
        .getOne();
      if (!snapshot?.checkoutPath || !fs.existsSync(snapshot.checkoutPath)) {
        throw new BadRequestException('A repository snapshot in the task baseline is unavailable.');
      }
      this.assertStoragePath(snapshot.checkoutPath);
      const repository = await this.repositories.findOneBy({ id: repositoryId });
      if (!repository) throw new BadRequestException('A repository in the task baseline is unavailable.');
      resolved.push({
        repository_id: repositoryId,
        repository_name: repository.fullName,
        repository_path: snapshot.checkoutPath,
        commit_sha: commitSha,
      });
    }
    return resolved;
  }
}
