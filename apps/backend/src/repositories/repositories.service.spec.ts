import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { simpleGit } from 'simple-git';
import { Repository } from 'typeorm';
import { GitHubService } from '../github/github.service';
import { ProjectsService } from '../projects/projects.service';
import { ProjectRepositoryEntity } from './entities/project-repository.entity';
import { RepositoryEntity } from './entities/repository.entity';
import { RepositorySnapshotEntity } from './entities/repository-snapshot.entity';
import { RepositoriesService } from './repositories.service';

describe('RepositoriesService snapshot cloning', () => {
  const originalStoragePath = process.env.ARTIFACT_STORAGE_PATH;
  let temporaryRoot: string;

  afterEach(() => {
    if (originalStoragePath === undefined) {
      delete process.env.ARTIFACT_STORAGE_PATH;
    } else {
      process.env.ARTIFACT_STORAGE_PATH = originalStoragePath;
    }
    if (temporaryRoot && fs.existsSync(temporaryRoot)) {
      fs.rmSync(temporaryRoot, { recursive: true, force: true });
    }
  });

  it('clones and verifies the selected immutable commit SHA', async () => {
    temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'forgebench-snapshot-'));
    process.env.ARTIFACT_STORAGE_PATH = path.relative(
      path.resolve(__dirname, '../../../../'),
      path.join(temporaryRoot, 'storage'),
    );
    const sourcePath = path.join(temporaryRoot, 'source');
    fs.mkdirSync(sourcePath);
    const sourceGit = simpleGit(sourcePath);
    await sourceGit.init();
    fs.writeFileSync(path.join(sourcePath, 'README.md'), 'pinned source\n');
    await sourceGit.add('README.md');
    await sourceGit.commit('initial snapshot');
    const commitSha = (await sourceGit.revparse(['HEAD'])).trim();

    const association = {
      id: 'association-1',
      projectId: 'project-1',
      repositoryId: 'repository-1',
      selectedBranch: 'main',
      selectedCommitSha: commitSha,
      repository: {
        id: 'repository-1',
        owner: 'example',
        name: 'sample',
        cloneUrl: 'https://github.com/example/sample.git',
        defaultBranch: 'main',
      },
    };
    const github = new GitHubService();
    jest.spyOn(github, 'getCommit').mockResolvedValue({ sha: commitSha, branchDefault: 'main' });
    jest.spyOn(github, 'cloneRepository').mockImplementation(async (_url, destination) => {
      await simpleGit().clone(sourcePath, destination, ['--no-checkout']);
    });
    const projectRepositories = {
      findOne: jest.fn().mockResolvedValue(association),
      save: jest.fn(async (value) => value),
    };
    const snapshots = {
      findOne: jest.fn().mockResolvedValue(null),
      create: jest.fn((value) => value),
      save: jest.fn(async (value) => value),
    };
    const service = new RepositoriesService(
      github,
      {} as ProjectsService,
      {} as Repository<RepositoryEntity>,
      projectRepositories as unknown as Repository<ProjectRepositoryEntity>,
      snapshots as unknown as Repository<RepositorySnapshotEntity>,
    );

    const snapshot = await service.cloneSelectedCommit('project-1', 'repository-1', {});
    const snapshotPath = path.join(temporaryRoot, 'storage', 'repositories', 'repository-1', commitSha);
    expect(snapshot.status).toBe('ready');
    expect(snapshot).not.toHaveProperty('checkoutPath');
    expect(await simpleGit(snapshotPath).revparse(['HEAD'])).toBe(commitSha);
    expect(association.selectedCommitSha).toBe(commitSha);
  });
});
