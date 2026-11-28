import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { HarborPackageService } from './harbor-package.service';

describe('HarborPackageService', () => {
  it('builds a Harbor package directory on finalizeTask and lists/reads its files', async () => {
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'harbor-pkg-'));
    const repoDir = path.join(tmpRoot, 'repo');
    fs.mkdirSync(path.join(repoDir, 'src'), { recursive: true });
    fs.writeFileSync(path.join(repoDir, 'package.json'), JSON.stringify({ name: 'demo', scripts: { test: 'jest' } }));
    fs.writeFileSync(path.join(repoDir, 'yarn.lock'), '');
    fs.writeFileSync(path.join(repoDir, 'src', 'index.ts'), 'export const ok = true;\n');

    const task: Record<string, any> = {
      id: 'task-123',
      currentVersion: 1,
      title: 'Add order validation',
      description: 'Validate order payloads cleanly.',
      category: 'feature',
      difficulty: 'medium',
      status: 'draft',
      requirements: ['Reject empty orders', 'Accept valid orders'],
      acceptanceCriteria: ['Empty throws', 'Valid succeeds'],
      constraints: ['Keep backwards compatible'],
      baselineManifest: [{ repositoryId: 'repo-1', snapshotId: 'snap-1', commitSha: 'abc123' }],
      updatedAt: new Date(),
    };

    const reference: Record<string, any> = {
      id: 'ref-1',
      taskId: 'task-123',
      version: 2,
      status: 'approved',
      solveScript: '#!/usr/bin/env bash\nset -euo pipefail\necho applied\n',
      patches: [{ repository_id: 'repo-1', patch_diff: '' }],
      tests: [{
        repository_id: 'repo-1',
        file_path: 'src/new.test.ts',
        content: 'test("works", () => expect(true).toBe(true));\n',
      }],
      validation: {
        workspace: {
          repositories: [{ test_commands: ['yarn --cwd . test --forceExit --runInBand'] }],
        },
      },
    };

    const service = new HarborPackageService(
      {
        findOneBy: jest.fn().mockResolvedValue(task),
        find: jest.fn().mockResolvedValue([task]),
        save: jest.fn(async (val) => val),
      } as any,
      {
        findOne: jest.fn().mockResolvedValue(reference),
        findOneBy: jest.fn().mockResolvedValue(reference),
      } as any,
      {
        createQueryBuilder: jest.fn(() => ({
          addSelect: jest.fn().mockReturnThis(),
          where: jest.fn().mockReturnThis(),
          getOne: jest.fn().mockResolvedValue({ checkoutPath: repoDir }),
        })),
      } as any,
    );
    (service as any).storagePath = tmpRoot;

    try {
      const details = await service.finalizeTask('task-123');
      expect(task.status).toBe('finalized');
      expect(details.packageId).toBe('task-123-v1');
      const filePaths = details.files.map((f) => f.path);
      expect(filePaths).toEqual(
        expect.arrayContaining([
          'instruction.md',
          'task.toml',
          'environment/Dockerfile',
          'solution/solve.sh',
          'tests/test.sh',
          'tests/files/src/new.test.ts',
        ]),
      );

      const list = await service.listPackages();
      expect(list).toHaveLength(1);
      expect(list[0].packageId).toBe('task-123-v1');
    } finally {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    }
  });
});
