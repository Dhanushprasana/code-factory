import { BadRequestException } from '@nestjs/common';
import { createServer } from 'http';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
jest.mock('@nestjs/bullmq', () => ({ InjectQueue: () => () => undefined }));
import { ReferenceSolutionsService } from './reference-solutions.service';

describe('ReferenceSolutionsService review gates', () => {
  const createService = (reference: Record<string, any>) => {
    const service = Object.create(ReferenceSolutionsService.prototype) as ReferenceSolutionsService;
    const references = {
      findOneBy: jest.fn().mockResolvedValue(reference),
      save: jest.fn(async (value) => value),
    };
    Object.assign(service, { references });
    return { service, references };
  };

  it.each(['openrouter', 'ollama'])('reuses the task-generation provider: %s', async (provider) => {
    const queue = { add: jest.fn().mockResolvedValue(undefined) };
    const referenceRepository = {
      findOne: jest.fn().mockResolvedValue(null),
      create: jest.fn((value) => value),
      save: jest.fn(async (value) => ({ id: 'reference-1', ...value })),
    };
    const service = Object.create(ReferenceSolutionsService.prototype) as ReferenceSolutionsService;
    Object.assign(service, {
      tasks: {
        findOneBy: jest.fn().mockResolvedValue({
          id: 'task-1',
          projectId: 'project-1',
          generationId: 'generation-1',
          currentVersion: 1,
          baselineManifest: [],
        }),
      },
      generations: {
        findOneBy: jest.fn().mockResolvedValue({ provider }),
      },
      taskVersions: {
        findOneBy: jest.fn().mockResolvedValue({ content: { title: 'Saved task' } }),
      },
      references: referenceRepository,
      referenceQueue: queue,
    });

    const result = await service.generate('task-1');

    expect(result.provider).toBe(provider);
    expect(queue.add).toHaveBeenCalledWith(
      'generate',
      { referenceId: 'reference-1' },
      expect.objectContaining({ jobId: 'reference-1' }),
    );
  });

  it.each([
    {
      name: 'corrupt',
      patchDiff: (
        'diff --git a/src/index.js b/src/index.js\n'
        + '--- a/src/index.js\n+++ b/src/index.js\n'
        + '@@ -1,1 +1,2 @@\n export const missing = true;\n+export const other = true;\n'
      ),
      expectedStatus: 'failed',
      expectedPreflight: 'failed',
      expectedError: 'does not apply',
      expectedPatchDiff: undefined,
      expectedRepairAttempts: 1,
    },
    {
      name: 'applicable',
      patchDiff: (
        'diff --git a/src/index.js b/src/index.js\n'
        + '--- a/src/index.js\n+++ b/src/index.js\n'
        + "@@ -1 +1 @@\n-export const value = 'old';\n+export const value = 'new';\n"
      ),
      expectedStatus: 'pending_review',
      expectedPreflight: 'passed',
      expectedError: undefined,
      expectedPatchDiff: (
        'diff --git a/src/index.js b/src/index.js\n'
        + '--- a/src/index.js\n+++ b/src/index.js\n'
        + "@@ -1,1 +1,1 @@\n-export const value = 'old';\n+export const value = 'new';\n"
      ),
      expectedRepairAttempts: 0,
    },
    {
      name: 'missing file headers and incorrect hunk counts',
      patchDiff: (
        'diff --git a/src/index.js b/src/index.js\n'
        + "@@ -1,6 +1,10 @@\n-export const value = 'old';\n+export const value = 'new';\n"
      ),
      expectedStatus: 'pending_review',
      expectedPreflight: 'passed',
      expectedError: undefined,
      expectedPatchDiff: (
        'diff --git a/src/index.js b/src/index.js\n'
        + '--- a/src/index.js\n+++ b/src/index.js\n'
        + "@@ -1,1 +1,1 @@\n-export const value = 'old';\n+export const value = 'new';\n"
      ),
      expectedRepairAttempts: 0,
    },
    {
      name: 'repairs a preflight failure once',
      patchDiff: (
        'diff --git a/src/index.js b/src/index.js\n'
        + '--- a/src/index.js\n+++ b/src/index.js\n'
        + "@@ -1 +1 @@\n-export const value = 'not-old';\n+export const value = 'new';\n"
      ),
      repairPatchDiff: (
        'diff --git a/src/index.js b/src/index.js\n'
        + '--- a/src/index.js\n+++ b/src/index.js\n'
        + "@@ -1 +1 @@\n-export const value = 'old';\n+export const value = 'new';\n"
      ),
      expectedStatus: 'pending_review',
      expectedPreflight: 'passed',
      expectedError: undefined,
      expectedPatchDiff: (
        'diff --git a/src/index.js b/src/index.js\n'
        + '--- a/src/index.js\n+++ b/src/index.js\n'
        + "@@ -1,1 +1,1 @@\n-export const value = 'old';\n+export const value = 'new';\n"
      ),
      expectedRepairAttempts: 1,
    },
    {
      name: 'repairs a file header incorrectly included as hunk context',
      patchDiff: (
        'diff --git a/src/index.js b/src/index.js\n'
        + '--- a/src/index.js\n+++ b/src/index.js\n'
        + '@@ -1,2 +1,2 @@\n-export const value = \'old\';\n+export const value = \'new\';\n'
        + ' diff --git a/src/other.js b/src/other.js\n'
        + '--- a/src/other.js\n+++ b/src/other.js\n'
        + '@@ -1 +1 @@\n-const other = \'old\';\n+const other = \'new\';\n'
      ),
      expectedStatus: 'pending_review',
      expectedPreflight: 'passed',
      expectedError: undefined,
      expectedPatchDiff: (
        'diff --git a/src/index.js b/src/index.js\n'
        + '--- a/src/index.js\n+++ b/src/index.js\n'
        + "@@ -1,1 +1,1 @@\n-export const value = 'old';\n+export const value = 'new';\n"
        + 'diff --git a/src/other.js b/src/other.js\n'
        + '--- a/src/other.js\n+++ b/src/other.js\n'
        + "@@ -1,1 +1,1 @@\n-const other = 'old';\n+const other = 'new';\n"
      ),
      expectedRepairAttempts: 0,
    },
    {
      name: 'repairs overlapping hunk start positions',
      patchDiff: (
        'diff --git a/src/index.js b/src/index.js\n'
        + '--- a/src/index.js\n+++ b/src/index.js\n'
        + '@@ -1,2 +1,2 @@\n-first\n+FIRST\n second\n'
        + '@@ -2,2 +2,2 @@\n-third\n+THIRD\n fourth\n'
      ),
      expectedStatus: 'pending_review',
      expectedPreflight: 'passed',
      expectedError: undefined,
      expectedPatchDiff: (
        'diff --git a/src/index.js b/src/index.js\n'
        + '--- a/src/index.js\n+++ b/src/index.js\n'
        + '@@ -1,2 +1,2 @@\n-first\n+FIRST\n second\n'
        + '@@ -3,2 +3,2 @@\n-third\n+THIRD\n fourth\n'
      ),
      expectedRepairAttempts: 0,
    },
    {
      name: 'repairs blank context lines missing their unified-diff prefix',
      patchDiff: (
        'diff --git a/src/index.js b/src/index.js\n'
        + '--- a/src/index.js\n+++ b/src/index.js\n'
        + '@@ -1,2 +1,3 @@\n one\n\n two\n+three\n'
      ),
      expectedStatus: 'pending_review',
      expectedPreflight: 'passed',
      expectedError: undefined,
      expectedPatchDiff: (
        'diff --git a/src/index.js b/src/index.js\n'
        + '--- a/src/index.js\n+++ b/src/index.js\n'
        + '@@ -1,3 +1,4 @@\n one\n \n two\n+three\n'
      ),
      expectedRepairAttempts: 0,
    },
    {
      name: 'converts an added line to context when exact pinned neighbors prove it already exists',
      patchDiff: (
        'diff --git a/src/index.js b/src/index.js\n'
        + '--- a/src/index.js\n+++ b/src/index.js\n'
        + '@@ -1,3 +1,4 @@\n before\n+existing\n after\n-gone\n+GONE\n'
      ),
      expectedStatus: 'pending_review',
      expectedPreflight: 'passed',
      expectedError: undefined,
      expectedPatchDiff: (
        'diff --git a/src/index.js b/src/index.js\n'
        + '--- a/src/index.js\n+++ b/src/index.js\n'
        + '@@ -1,4 +1,4 @@\n before\n existing\n after\n-gone\n+GONE\n'
      ),
      expectedRepairAttempts: 0,
    },
    {
      name: 'does not convert an addition when exact pinned neighbors do not prove it already exists',
      patchDiff: (
        'diff --git a/src/index.js b/src/index.js\n'
        + '--- a/src/index.js\n+++ b/src/index.js\n'
        + '@@ -1,3 +1,4 @@\n before\n+existing\n after\n-gone\n+GONE\n'
      ),
      repairPatchDiff: (
        'diff --git a/src/index.js b/src/index.js\n'
        + '--- a/src/index.js\n+++ b/src/index.js\n'
        + '@@ -1,4 +1,4 @@\n before\n-other\n+existing\n after\n-gone\n+GONE\n'
      ),
      expectedStatus: 'pending_review',
      expectedPreflight: 'passed',
      expectedError: undefined,
      expectedPatchDiff: (
        'diff --git a/src/index.js b/src/index.js\n'
        + '--- a/src/index.js\n+++ b/src/index.js\n'
        + '@@ -1,4 +1,4 @@\n before\n-other\n+existing\n after\n-gone\n+GONE\n'
      ),
      expectedRepairAttempts: 1,
    },
    {
      name: 'adds the required final newline when the model omits it',
      patchDiff: (
        'diff --git a/src/index.js b/src/index.js\n'
        + '--- a/src/index.js\n+++ b/src/index.js\n'
        + "@@ -1 +1 @@\n-export const value = 'old';\n+export const value = 'new';"
      ),
      expectedStatus: 'pending_review',
      expectedPreflight: 'passed',
      expectedError: undefined,
      expectedPatchDiff: (
        'diff --git a/src/index.js b/src/index.js\n'
        + '--- a/src/index.js\n+++ b/src/index.js\n'
        + "@@ -1,1 +1,1 @@\n-export const value = 'old';\n+export const value = 'new';\n"
      ),
      expectedRepairAttempts: 0,
    },
  ])('preflights generated patches before review: $name', async ({
    name,
    patchDiff,
    repairPatchDiff,
    expectedStatus,
    expectedPreflight,
    expectedError,
    expectedPatchDiff,
    expectedRepairAttempts,
  }) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'reference-preflight-'));
    const snapshotPath = path.join(root, 'snapshots', 'repo-1');
    fs.mkdirSync(path.join(snapshotPath, 'src'), { recursive: true });
    const baselineContent = name === 'repairs overlapping hunk start positions'
      ? 'first\nsecond\nthird\nfourth\n'
      : name === 'repairs blank context lines missing their unified-diff prefix'
        ? 'one\n\ntwo\n'
      : name === 'converts an added line to context when exact pinned neighbors prove it already exists'
        ? 'before\nexisting\nafter\ngone\n'
      : name === 'does not convert an addition when exact pinned neighbors do not prove it already exists'
        ? 'before\nother\nafter\ngone\n'
      : "export const value = 'old';\n";
    fs.writeFileSync(path.join(snapshotPath, 'src', 'index.js'), baselineContent);
    if (expectedPatchDiff?.includes('src/other.js')) {
      fs.writeFileSync(path.join(snapshotPath, 'src', 'other.js'), "const other = 'old';\n");
    }
    const reference: Record<string, any> = {
      id: 'reference-corrupt',
      status: 'queued',
      taskVersion: 1,
      provider: 'ollama',
      input: {
        projectId: 'project-1',
        task: {
          title: 'Update value',
          description: 'Update the exported value.',
          category: 'feature',
          difficulty: 'easy',
          requirements: [],
          acceptanceCriteria: [],
          constraints: [],
          affectedModules: [],
        },
        baselineManifest: [{
          repositoryId: 'repo-1',
          snapshotId: 'snapshot-1',
          analysisId: 'analysis-1',
          commitSha: 'abc123',
        }],
      },
      validation: { patch_preflight: 'not_run' },
    };
    const query = {
      addSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getOne: jest.fn().mockResolvedValue({ checkoutPath: snapshotPath }),
    };
    const references = {
      findOneBy: jest.fn().mockResolvedValue(reference),
      save: jest.fn(async (value) => value),
    };
    const aiResponse = {
      operation_id: 'reference-corrupt',
      status: 'pending_review',
      provider: 'ollama',
      model: 'qwen2.5:3b',
      prompt_version: 'reference-factory-v6',
      implementation_plan: [{ repository_id: 'repo-1', file_path: 'src/index.js' }],
      patches: [{
        repository_id: 'repo-1',
        patch_diff: patchDiff,
      }],
      tests: [{ repository_id: 'repo-1', file_path: 'tests/index.test.js' }],
      context_manifest: {},
      validation: { patch_format: 'passed', test_files_present: 'passed' },
    };
    const requestBodies: Array<Record<string, any>> = [];
    const repairResponse = repairPatchDiff
      ? {
        operation_id: 'reference-corrupt-repair',
        status: 'pending_review',
        provider: 'ollama',
        model: 'qwen2.5:3b',
        prompt_version: 'reference-factory-v8',
        patches: [{ repository_id: 'repo-1', patch_diff: repairPatchDiff }],
        context_manifest: {},
      }
      : aiResponse;
    const server = createServer(async (request, response) => {
      let body = '';
      for await (const chunk of request) {
        body += chunk.toString();
      }
      requestBodies.push(JSON.parse(body));
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify(requestBodies.length > 1 ? repairResponse : aiResponse));
    });
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    const address = server.address();
    if (!address || typeof address === 'string') {
      throw new Error('Could not start the AI-service test server.');
    }
    const service = Object.create(ReferenceSolutionsService.prototype) as ReferenceSolutionsService;
    Object.assign(service, {
      storagePath: root,
      logger: { error: jest.fn(), warn: jest.fn() },
      references,
      config: { get: jest.fn().mockReturnValue(`http://127.0.0.1:${address.port}`) },
      analyses: {
        findOneBy: jest.fn().mockResolvedValue({
          repositoryId: 'repo-1',
          snapshotId: 'snapshot-1',
          commitSha: 'abc123',
          summary: {},
          report: {},
        }),
      },
      snapshots: { createQueryBuilder: jest.fn().mockReturnValue(query) },
      repositories: { findOneBy: jest.fn().mockResolvedValue({ fullName: 'owner/repo' }) },
    });

    try {
      await service.processGeneration(reference.id);

      expect(reference.status).toBe(expectedStatus);
      expect(reference.validation.patch_preflight).toBe(expectedPreflight);
      expect(reference.validation.patch_repair_attempts ?? 0).toBe(expectedRepairAttempts);
      if (expectedRepairAttempts > 0) {
        if (requestBodies.length !== 2) {
          throw new Error(`Expected one repair request. Final error: ${reference.errorMessage}`);
        }
        expect(requestBodies[1].patch_repair).toEqual(expect.objectContaining({
          repository_id: 'repo-1',
          patch_diff: expect.any(String),
          preflight_error: expect.stringContaining('does not apply'),
        }));
        if (name === 'does not convert an addition when exact pinned neighbors do not prove it already exists') {
          expect(requestBodies[1].patch_repair.patch_diff).toContain('\n+existing\n');
        }
      } else {
        expect(requestBodies).toHaveLength(1);
        expect(requestBodies[0].patch_repair).toBeUndefined();
      }
      if (expectedStatus === 'failed') {
        expect(reference.errorMessage).toContain(expectedError);
        expect(reference.patches[0].patch_diff).toBeDefined();
        expect(reference.model).toBe('qwen2.5:3b');
        expect(reference.promptVersion).toBe('reference-factory-v6');
      } else {
        expect(reference.errorMessage).toBeUndefined();
        expect(reference.patches[0].patch_diff).toBe(expectedPatchDiff);
      }
      expect(fs.readFileSync(path.join(snapshotPath, 'src', 'index.js'), 'utf8'))
        .toBe(baselineContent);
      expect(fs.readdirSync(root).some((entry) => entry.startsWith('.reference-preflight-'))).toBe(false);
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => error ? reject(error) : resolve());
      });
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('does not allow approval until a reviewer records passing build and test validation', async () => {
    const reference: Record<string, any> = {
      id: 'reference-1',
      status: 'pending_review',
      patches: [{ repository_id: 'repo-1', patch_diff: 'diff --git a/src/file.ts b/src/file.ts' }],
      tests: [{ file_path: 'test/file.spec.ts' }],
      validation: { build: 'not_run', tests: 'not_run', execution_mode: 'not_run' },
    };
    const { service } = createService(reference);

    await expect(service.review('reference-1', { action: 'approve' }))
      .rejects.toThrow(BadRequestException);
  });

  it('does not allow automatic execution after a reference leaves pending review', async () => {
    const { service, references } = createService({
      id: 'reference-1',
      status: 'changes_requested',
      validation: { build: 'not_run', tests: 'not_run', execution_mode: 'not_run' },
    });

    await expect(service.executeValidation('reference-1')).rejects.toThrow(BadRequestException);

    expect(references.save).not.toHaveBeenCalled();
  });

  it('requires an applied workspace before automatic execution can be queued', async () => {
    const { service, references } = createService({
      id: 'reference-1',
      status: 'pending_review',
      validation: { apply_status: 'not_applied', build: 'not_run', tests: 'not_run' },
    });

    await expect(service.executeValidation('reference-1'))
      .rejects.toThrow('Apply the patches to a review workspace');

    expect(references.save).not.toHaveBeenCalled();
  });

  it('discovers nested package manifests and builds prefixed npm commands', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'reference-manifests-'));
    try {
      fs.mkdirSync(path.join(root, 'backend'), { recursive: true });
      fs.mkdirSync(path.join(root, 'frontend'), { recursive: true });
      fs.writeFileSync(path.join(root, 'backend', 'package.json'), JSON.stringify({
        scripts: { build: 'nest build', test: 'jest' },
      }));
      fs.writeFileSync(path.join(root, 'frontend', 'package.json'), JSON.stringify({
        scripts: { build: 'vite build', test: 'vitest run' },
      }));
      const service = Object.create(ReferenceSolutionsService.prototype) as ReferenceSolutionsService;
      const manifests = (service as any).findProjectManifests(root) as string[];
      const commands = (service as any).suggestBuildAndTestCommands(root) as {
        setup: string[][];
        buildArgs: string[][];
        testArgs: string[][];
      };

      expect(manifests).toHaveLength(2);
      expect(commands.setup).toEqual([
        ['npm', '--prefix', 'backend', 'install'],
        ['npm', '--prefix', 'frontend', 'install'],
      ]);
      expect(commands.buildArgs).toEqual([
        ['npm', '--prefix', 'backend', 'run', 'build'],
        ['npm', '--prefix', 'frontend', 'run', 'build'],
      ]);
      expect(commands.testArgs).toEqual([
        ['npm', '--prefix', 'backend', 'test'],
        ['npm', '--prefix', 'frontend', 'test'],
      ]);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('discovers Vitest and test:unit frontend commands', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'reference-frontend-tests-'));
    try {
      const frontend = path.join(root, 'frontend');
      fs.mkdirSync(frontend, { recursive: true });
      fs.writeFileSync(path.join(frontend, 'package.json'), JSON.stringify({
        scripts: { build: 'vite build' },
        devDependencies: { vitest: '^2.0.0' },
      }));
      fs.writeFileSync(path.join(frontend, 'vitest.config.ts'), 'export default {};\n');

      const service = Object.create(ReferenceSolutionsService.prototype) as ReferenceSolutionsService;
      const commands = (service as any).suggestBuildAndTestCommands(root) as {
        testArgs: string[][];
        tests: string[];
      };

      expect(commands.tests).toEqual(['npm --prefix frontend exec vitest -- run']);
      expect(commands.testArgs).toEqual([[
        'npm',
        '--prefix',
        'frontend',
        'exec',
        'vitest',
        '--',
        'run',
      ]]);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('applies valid patches and generated tests to a copy of the pinned snapshot', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'reference-apply-'));
    try {
      const snapshotPath = path.join(root, 'snapshots', 'repo-1');
      fs.mkdirSync(path.join(snapshotPath, 'src'), { recursive: true });
      fs.writeFileSync(path.join(snapshotPath, 'src', 'index.js'), "export const value = 'old';\n");
      fs.writeFileSync(path.join(snapshotPath, 'package.json'), JSON.stringify({
        scripts: { build: 'node build.js', test: 'node test.js' },
      }));
      const reference = {
        id: 'reference-1',
        status: 'pending_review',
        input: {
          baselineManifest: [{
            repositoryId: 'repo-1',
            snapshotId: 'snapshot-1',
            analysisId: 'analysis-1',
            commitSha: 'abc123',
          }],
        },
        patches: [{
          repository_id: 'repo-1',
          patch_diff: (
            'diff --git a/src/index.js b/src/index.js\n'
            + '--- a/src/index.js\n+++ b/src/index.js\n'
            + "@@ -1 +1 @@\n-export const value = 'old';\n+export const value = 'new';\n"
          ),
        }],
        tests: [{
          repository_id: 'repo-1',
          file_path: 'tests/reference.test.js',
          content: "import { value } from '../src/index.js';\n",
        }],
        validation: { build: 'not_run', tests: 'not_run', execution_mode: 'not_run' },
      };
      const query = {
        addSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getOne: jest.fn().mockResolvedValue({ checkoutPath: snapshotPath }),
      };
      const references = {
        findOneBy: jest.fn().mockResolvedValue(reference),
        save: jest.fn(async (value) => value),
      };
      const service = Object.create(ReferenceSolutionsService.prototype) as ReferenceSolutionsService;
      Object.assign(service, {
        storagePath: root,
        references,
        analyses: {
          findOneBy: jest.fn().mockResolvedValue({
            repositoryId: 'repo-1',
            snapshotId: 'snapshot-1',
            commitSha: 'abc123',
            summary: {},
            report: {},
          }),
        },
        snapshots: { createQueryBuilder: jest.fn().mockReturnValue(query) },
        repositories: { findOneBy: jest.fn().mockResolvedValue({ fullName: 'owner/repo' }) },
      });

      const applied = await service.applyPatches('reference-1');
      const workspace = path.join(root, 'reference-workspaces', 'reference-1', 'repositories', 'repo-1');

      expect(applied.validation.apply_status).toBe('applied');
      expect(fs.readFileSync(path.join(workspace, 'src', 'index.js'), 'utf8').replace(/\r\n/g, '\n'))
        .toBe("export const value = 'new';\n");
      expect(fs.readFileSync(path.join(workspace, 'tests', 'reference.test.js'), 'utf8'))
        .toContain("import { value }");
      expect(applied.validation.workspace.repositories[0].build_commands).toEqual(['npm run build']);
      expect(applied.validation.workspace.repositories[0].test_commands).toEqual(['npm test']);
      expect(applied.validation.workspace.repositories[0].setup_commands).toEqual([['npm', 'install']]);
      expect(applied.validation.workspace.repositories[0].build_command_args).toEqual([['npm', 'run', 'build']]);
      expect(applied.validation.workspace.repositories[0].test_command_args).toEqual([['npm', 'test']]);
      expect(fs.readFileSync(path.join(snapshotPath, 'src', 'index.js'), 'utf8').replace(/\r\n/g, '\n'))
        .toBe("export const value = 'old';\n");
      const archive = await service.createWorkspaceArchive('reference-1');
      expect(archive.filename).toBe('reference-reference-1-workspace.tar.gz');
      expect(fs.statSync(archive.path).size).toBeGreaterThan(0);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('rejects a patch that does not apply and leaves the pinned snapshot unchanged', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'reference-apply-invalid-'));
    try {
      const snapshotPath = path.join(root, 'snapshots', 'repo-1');
      fs.mkdirSync(path.join(snapshotPath, 'src'), { recursive: true });
      fs.writeFileSync(path.join(snapshotPath, 'src', 'index.js'), "export const value = 'real';\n");
      const reference = {
        id: 'reference-invalid',
        status: 'pending_review',
        input: {
          baselineManifest: [{
            repositoryId: 'repo-1',
            snapshotId: 'snapshot-1',
            analysisId: 'analysis-1',
            commitSha: 'abc123',
          }],
        },
        patches: [{
          repository_id: 'repo-1',
          patch_diff: (
            'diff --git a/src/index.js b/src/index.js\n'
            + '--- a/src/index.js\n+++ b/src/index.js\n'
            + '@@ -1 +1,2 @@\n-old line\n+new line\n'
          ),
        }],
        tests: [],
        validation: { build: 'not_run', tests: 'not_run', execution_mode: 'not_run' },
      };
      const query = {
        addSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getOne: jest.fn().mockResolvedValue({ checkoutPath: snapshotPath }),
      };
      const service = Object.create(ReferenceSolutionsService.prototype) as ReferenceSolutionsService;
      Object.assign(service, {
        storagePath: root,
        references: {
          findOneBy: jest.fn().mockResolvedValue(reference),
          save: jest.fn(async (value) => value),
        },
        analyses: {
          findOneBy: jest.fn().mockResolvedValue({
            repositoryId: 'repo-1',
            snapshotId: 'snapshot-1',
            commitSha: 'abc123',
            summary: {},
            report: {},
          }),
        },
        snapshots: { createQueryBuilder: jest.fn().mockReturnValue(query) },
        repositories: { findOneBy: jest.fn().mockResolvedValue({ fullName: 'owner/repo' }) },
      });

      await expect(service.applyPatches('reference-invalid'))
        .rejects.toThrow('does not apply cleanly to the pinned snapshot');

      expect(reference.validation.apply_status).toBe('failed');
      expect(fs.readFileSync(path.join(snapshotPath, 'src', 'index.js'), 'utf8'))
        .toBe("export const value = 'real';\n");
      expect(fs.existsSync(path.join(root, 'reference-workspaces', 'reference-invalid'))).toBe(false);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('queues isolated automatic execution and approves only with passing evidence', async () => {
    const reference: Record<string, any> = {
      id: 'reference-1',
      status: 'pending_review',
      patches: [{ repository_id: 'repo-1', patch_diff: 'diff --git a/src/file.ts b/src/file.ts' }],
      tests: [{ file_path: 'test/file.spec.ts' }],
      validation: {
        apply_status: 'applied',
        build: 'not_run',
        tests: 'not_run',
        execution_mode: 'not_run',
        workspace: {
          status: 'applied',
          repositories: [{
            repository_id: 'repo-1',
            setup_commands: [['npm', 'ci']],
            build_command_args: [['npm', 'run', 'build']],
            test_command_args: [['npm', 'test']],
          }],
        },
      },
    };
    const { service, references } = createService(reference);
    const queue = { add: jest.fn().mockResolvedValue(undefined) };
    const validationResponse = {
      run_id: 'runner-id',
      status: 'passed',
      execution_mode: 'automatic_container',
      network_policy: 'disabled',
      repositories: [{
        repository_id: 'repo-1',
        status: 'passed',
        build_status: 'passed',
        test_status: 'passed',
        build: [{ command: ['npm', 'run', 'build'], status: 'passed', exit_code: 0, stdout: 'built' }],
        tests: [{ command: ['npm', 'test'], status: 'passed', exit_code: 0, stdout: 'tests passed' }],
      }],
    };
    const server = createServer((_request, response) => {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify(validationResponse));
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') {
      throw new Error('Could not start the validation runner test server.');
    }
    Object.assign(service, {
      referenceQueue: queue,
      config: {
        get: jest.fn((key: string) => key === 'VALIDATION_RUNNER_URL'
          ? `http://127.0.0.1:${address.port}`
          : key === 'VALIDATION_RUNNER_TOKEN'
            ? 'test-token'
            : key === 'REFERENCE_VALIDATION_ALLOW_NETWORK'
              ? 'false'
              : undefined),
      },
    });

    try {
      const queued = await service.executeValidation('reference-1');
      const runId = queued.validation.current_validation_run_id as string;
      expect(queue.add).toHaveBeenCalledWith(
        'validate',
        { referenceId: 'reference-1', runId },
        expect.objectContaining({ jobId: `validate-reference-1-${runId}` }),
      );
      await service.processValidation('reference-1', runId);

      expect(reference.validation.build).toBe('passed');
      expect(reference.validation.tests).toBe('passed');
      expect(reference.validation.execution_mode).toBe('automatic_container');
      expect(reference.validation.execution_runs[0].status).toBe('passed');
      expect(reference.validation.execution_runs[0].repositories[0].tests[0].stdout).toBe('tests passed');
      const approved = await service.review('reference-1', { action: 'approve' });
      expect(approved.status).toBe('approved');
      expect(references.save).toHaveBeenCalled();
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => error ? reject(error) : resolve());
      });
    }
  });

  it('records failed command output and does not allow approval after a failed run', async () => {
    const reference: Record<string, any> = {
      id: 'reference-1',
      status: 'pending_review',
      patches: [{ repository_id: 'repo-1', patch_diff: 'diff --git a/src/file.ts b/src/file.ts' }],
      tests: [{ file_path: 'test/file.spec.ts' }],
      validation: {
        apply_status: 'applied',
        build: 'not_run',
        tests: 'not_run',
        execution_mode: 'not_run',
        workspace: { status: 'applied', repositories: [{ repository_id: 'repo-1' }] },
      },
    };
    const { service } = createService(reference);
    const server = createServer((_request, response) => {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({
        status: 'failed',
        network_policy: 'disabled',
        repositories: [{
          repository_id: 'repo-1',
          status: 'failed',
          build_status: 'failed',
          test_status: 'passed',
          build: [{
            command: ['npm', 'run', 'build'],
            status: 'failed',
            exit_code: 1,
            stderr: 'Type error: missing export',
          }],
          tests: [{ command: ['npm', 'test'], status: 'passed', exit_code: 0 }],
        }],
      }));
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') {
      throw new Error('Could not start the validation runner test server.');
    }
    Object.assign(service, {
      config: {
        get: jest.fn((key: string) => key === 'VALIDATION_RUNNER_URL'
          ? `http://127.0.0.1:${address.port}`
          : key === 'VALIDATION_RUNNER_TOKEN'
            ? 'test-token'
            : key === 'REFERENCE_VALIDATION_ALLOW_NETWORK'
              ? 'false'
              : undefined),
      },
    });
    const runId = 'run-failure';
    reference.validation.execution_runs = [{ run_id: runId, status: 'queued' }];

    try {
      await service.processValidation('reference-1', runId);
      expect(reference.validation.build).toBe('failed');
      expect(reference.validation.tests).toBe('passed');
      expect(reference.validation.execution_runs[0].repositories[0].build[0].stderr)
        .toContain('missing export');
      await expect(service.review('reference-1', { action: 'approve' }))
        .rejects.toThrow('passing build and test execution evidence');
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => error ? reject(error) : resolve());
      });
    }
  });
});
