import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';
import { simpleGit } from 'simple-git';
import { Repository } from 'typeorm';
import { GitHubService } from '../github/github.service';
import { ProjectsService } from '../projects/projects.service';
import { ProjectRepositoryEntity } from './entities/project-repository.entity';
import { RepositoryEntity } from './entities/repository.entity';
import { RepositorySnapshotEntity } from './entities/repository-snapshot.entity';

@Injectable()
export class RepositoriesService {
  private readonly storagePath = process.env.ARTIFACT_STORAGE_PATH
    ? path.resolve(__dirname, '../../../../', process.env.ARTIFACT_STORAGE_PATH)
    : path.resolve(__dirname, '../../../../storage');

  constructor(
    private readonly github: GitHubService,
    private readonly projectsService: ProjectsService,
    @InjectRepository(RepositoryEntity)
    private readonly repositories: Repository<RepositoryEntity>,
    @InjectRepository(ProjectRepositoryEntity)
    private readonly projectRepositories: Repository<ProjectRepositoryEntity>,
    @InjectRepository(RepositorySnapshotEntity)
    private readonly snapshots: Repository<RepositorySnapshotEntity>,
  ) {}

  private readonly allowedRoles = new Set([
    'frontend',
    'backend',
    'data_engineering',
    'ml',
    'other',
  ]);

  async list() {
    return this.projectRepositories.find({
      relations: { project: true, repository: true },
      order: { createdAt: 'DESC' },
    });
  }

  async listForProject(projectId: string) {
    await this.projectsService.assertExists(projectId);
    return this.projectRepositories.find({
      where: { projectId },
      relations: { repository: true },
      order: { createdAt: 'ASC' },
    });
  }

  async removeFromProject(projectId: string, repositoryId: string) {
    const association = await this.projectRepositories.findOne({
      where: { projectId, repositoryId },
    });
    if (!association) {
      throw new NotFoundException('Repository is not connected to this project.');
    }
    await this.projectRepositories.remove(association);
    return { removed: true, projectId, repositoryId };
  }

  async addToProject(
    projectId: string,
    input: { url?: string; role?: string; branch?: string; commitSha?: string },
  ) {
    await this.projectsService.assertExists(projectId);
    const address = this.github.parseRepositoryUrl(input.url ?? '');
    const metadata = await this.github.getRepository(address.owner, address.name);
    const role = input.role ?? 'other';
    if (!this.allowedRoles.has(role)) {
      throw new BadRequestException(`Unsupported repository role: ${role}.`);
    }
    if (input.branch !== undefined && typeof input.branch !== 'string') {
      throw new BadRequestException('Branch must be a string.');
    }
    const branch = input.branch?.trim() || metadata.default_branch || 'main';
    if (branch.length > 255) {
      throw new BadRequestException('Branch name is too long.');
    }
    if (input.commitSha !== undefined && typeof input.commitSha !== 'string') {
      throw new BadRequestException('Commit must be a hexadecimal Git SHA.');
    }
    const requestedSha = input.commitSha?.trim();
    if (requestedSha && !/^[a-f0-9]{7,40}$/i.test(requestedSha)) {
      throw new BadRequestException('Commit must be a hexadecimal Git SHA.');
    }
    const commit = requestedSha
      ? await this.github.getCommit(address.owner, address.name, requestedSha)
      : await this.latestCommit(address.owner, address.name, branch);

    let repository = await this.repositories.findOne({
      where: { provider: 'github', externalRepoId: String(metadata.id) },
    });
    if (!repository) {
      repository = this.repositories.create({
        provider: 'github',
        externalRepoId: String(metadata.id),
        owner: metadata.owner.login,
        name: metadata.name,
        fullName: metadata.full_name,
        cloneUrl: metadata.clone_url,
        isPrivate: metadata.private,
        defaultBranch: metadata.default_branch ?? 'main',
      });
      repository = await this.repositories.save(repository);
    } else {
      repository = await this.repositories.save({
        ...repository,
        owner: metadata.owner.login,
        name: metadata.name,
        fullName: metadata.full_name,
        cloneUrl: metadata.clone_url,
        isPrivate: metadata.private,
        defaultBranch: metadata.default_branch ?? 'main',
      });
    }

    let association = await this.projectRepositories.findOne({
      where: { projectId, repositoryId: repository.id },
    });
    if (!association) {
      association = this.projectRepositories.create({
        projectId,
        repositoryId: repository.id,
        repoRole: role,
        selectedBranch: branch,
        selectedCommitSha: commit.sha,
      });
    } else {
      association.repoRole = input.role === undefined ? association.repoRole : role;
      association.selectedBranch = branch;
      association.selectedCommitSha = commit.sha;
    }
    await this.projectRepositories.save(association);
    return this.projectRepositories.findOne({
      where: { id: association.id },
      relations: { repository: true },
    });
  }

  async cloneSelectedCommit(projectId: string, repositoryId: string, input: {
    branch?: string;
    commitSha?: string;
  }) {
    const association = await this.projectRepositories.findOne({
      where: { projectId, repositoryId },
      relations: { repository: true },
    });
    if (!association) {
      throw new NotFoundException('Repository is not connected to this project.');
    }
    const repository = association.repository;
    if (input.branch !== undefined && typeof input.branch !== 'string') {
      throw new BadRequestException('Branch must be a string.');
    }
    if (input.commitSha !== undefined && typeof input.commitSha !== 'string') {
      throw new BadRequestException('Commit must be a hexadecimal Git SHA.');
    }
    const branch = input.branch?.trim() || association.selectedBranch || repository.defaultBranch;
    const requestedSha = input.commitSha?.trim() || association.selectedCommitSha;
    if (!requestedSha || !/^[a-f0-9]{7,40}$/i.test(requestedSha)) {
      throw new BadRequestException('Select a valid commit SHA before creating a snapshot.');
    }
    const commit = await this.github.getCommit(repository.owner, repository.name, requestedSha);
    const snapshotPath = path.join(this.storagePath, 'repositories', repository.id, commit.sha);
    const existing = await this.snapshots.findOne({
      where: { repositoryId: repository.id, commitSha: commit.sha },
    });
    if (existing?.status === 'ready' && fs.existsSync(snapshotPath)) {
      return this.snapshotResponse(existing);
    }

    const snapshot = existing ?? this.snapshots.create({
      repositoryId: repository.id,
      commitSha: commit.sha,
      branchName: branch,
      status: 'cloning',
    });
    snapshot.status = 'cloning';
    snapshot.branchName = branch;
    snapshot.checkoutPath = snapshotPath;
    await this.snapshots.save(snapshot);

    const temporaryPath = `${snapshotPath}.tmp-${randomUUID()}`;
    fs.mkdirSync(path.dirname(snapshotPath), { recursive: true });
    try {
      await this.github.cloneRepository(
        repository.cloneUrl,
        temporaryPath,
        repository.owner,
        repository.name,
      );
      const git = simpleGit(temporaryPath);
      await git.checkout(['--detach', commit.sha]);
      const actualSha = (await git.revparse(['HEAD'])).trim();
      if (actualSha.toLowerCase() !== commit.sha.toLowerCase()) {
        throw new Error(`Checked out ${actualSha}, expected ${commit.sha}.`);
      }
      if (fs.existsSync(snapshotPath)) {
        fs.rmSync(snapshotPath, { recursive: true, force: true });
      }
      fs.renameSync(temporaryPath, snapshotPath);
      association.selectedBranch = branch;
      association.selectedCommitSha = commit.sha;
      await this.projectRepositories.save(association);
      snapshot.status = 'ready';
      snapshot.checkoutPath = snapshotPath;
      return this.snapshotResponse(await this.snapshots.save(snapshot));
    } catch (error) {
      if (fs.existsSync(temporaryPath)) {
        fs.rmSync(temporaryPath, { recursive: true, force: true });
      }
      snapshot.status = 'failed';
      await this.snapshots.save(snapshot);
      throw error;
    }
  }

  private async latestCommit(owner: string, name: string, branch: string) {
    const commits = await this.github.listCommits(owner, name, branch);
    const commit = commits[0];
    if (!commit) {
      throw new NotFoundException(`Branch ${branch} has no commits.`);
    }
    return { sha: commit.sha, branchDefault: branch };
  }

  private snapshotResponse(snapshot: RepositorySnapshotEntity) {
    return {
      id: snapshot.id,
      repositoryId: snapshot.repositoryId,
      commitSha: snapshot.commitSha,
      branchName: snapshot.branchName,
      status: snapshot.status,
      capturedAt: snapshot.capturedAt,
    };
  }
}
