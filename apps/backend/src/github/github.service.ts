import {
  Injectable,
  BadRequestException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { createAppAuth } from '@octokit/auth-app';
import { Octokit } from '@octokit/rest';
import { simpleGit } from 'simple-git';

export interface GitHubRepositoryAddress {
  owner: string;
  name: string;
}

interface AccessibleRepository {
  id: number;
  owner: { login: string };
  name: string;
  full_name: string;
  clone_url: string;
  private: boolean;
  default_branch: string | null;
}

interface GitHubHttpError {
  status?: number;
  message?: string;
  response?: {
    headers?: Record<string, string | number | undefined>;
  };
}

@Injectable()
export class GitHubService {
  private readonly appId = process.env.GITHUB_APP_ID;
  private readonly privateKey = process.env.GITHUB_APP_PRIVATE_KEY?.replace(/\\n/g, '\n');
  private readonly installationId = process.env.GITHUB_APP_INSTALLATION_ID;
  private readonly appSlug = process.env.GITHUB_APP_SLUG;
  private readonly githubToken = process.env.GITHUB_TOKEN?.trim();

  installationUrl() {
    if (!this.appSlug) {
      throw new ServiceUnavailableException('GitHub App installation is not configured.');
    }
    return { url: `https://github.com/apps/${encodeURIComponent(this.appSlug)}/installations/new` };
  }

  parseRepositoryUrl(value: string): GitHubRepositoryAddress {
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      throw new BadRequestException('Enter a valid GitHub repository URL.');
    }
    if (
      url.protocol !== 'https:' ||
      url.hostname.toLowerCase() !== 'github.com' ||
      url.port ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    ) {
      throw new BadRequestException('Only credential-free HTTPS GitHub repository URLs are supported.');
    }
    const segments = url.pathname.split('/').filter(Boolean);
    if (segments.length !== 2) {
      throw new BadRequestException('GitHub URL must use the https://github.com/owner/repository format.');
    }
    const owner = segments[0];
    const name = segments[1].replace(/\.git$/i, '');
    if (!/^[\w.-]+$/.test(owner) || !/^[\w.-]+$/.test(name) || name === '.' || name === '..') {
      throw new BadRequestException('The GitHub repository owner or name is invalid.');
    }
    return { owner, name };
  }

  async listRepositories(query?: string) {
    if (this.isConfigured()) {
      const octokit = await this.installationOctokit();
      const response = await this.withRateLimitHandling(() =>
        this.accessibleInstallationRepositories(octokit),
      );
      const normalizedQuery = query?.toLowerCase().trim();
      return response
        .filter((repository) =>
          !normalizedQuery ||
          repository.full_name.toLowerCase().includes(normalizedQuery) ||
          repository.name.toLowerCase().includes(normalizedQuery),
        )
        .map((repository) => this.toRepositorySummary(repository));
    }

    const normalizedQuery = query?.trim();
    if (!normalizedQuery) {
      return [];
    }
    const octokit = this.publicOctokit();
    const response = await this.withRateLimitHandling(() =>
      octokit.search.repos({
        q: `${normalizedQuery} in:name is:public`,
        per_page: 30,
      }),
    );
    return response.data.items.map((repository) => this.toRepositorySummary(repository));
  }

  async getRepository(owner: string, name: string) {
    try {
      const publicOctokit = this.publicOctokit();
      const response = await this.withRateLimitHandling(() =>
        publicOctokit.repos.get({ owner, repo: name }),
      );
      if (!response.data.private) {
        return response.data;
      }
    } catch (error) {
      if (!this.isNotFound(error)) {
        throw error;
      }
    }

    if (!this.isConfigured()) {
      throw new NotFoundException('Repository is private or unavailable. Connect the ForgeBench GitHub App to access it.');
    }

    const octokit = await this.authorizedInstallationOctokit(owner, name);
    try {
      const response = await octokit.repos.get({ owner, repo: name });
      return response.data;
    } catch (error) {
      if (this.isNotFound(error)) {
        throw new NotFoundException('Repository is not accessible to the configured GitHub App installation.');
      }
      throw error;
    }
  }

  async listBranches(owner: string, name: string) {
    const repository = await this.getRepository(owner, name);
    const octokit = repository.private
      ? await this.authorizedInstallationOctokit(owner, name)
      : this.publicOctokit();
    const response = await this.withRateLimitHandling(() =>
      octokit.paginate(octokit.repos.listBranches, {
        owner,
        repo: name,
        per_page: 100,
      }),
    );
    return response.map((branch) => ({ name: branch.name, commitSha: branch.commit.sha }));
  }

  async listCommits(owner: string, name: string, branch: string) {
    const repository = await this.getRepository(owner, name);
    const octokit = repository.private
      ? await this.authorizedInstallationOctokit(owner, name)
      : this.publicOctokit();
    const response = await this.withRateLimitHandling(() =>
      octokit.repos.listCommits({
        owner,
        repo: name,
        sha: branch,
        per_page: 30,
      }),
    );
    return response.data.map((commit) => ({
      sha: commit.sha,
      message: commit.commit.message,
      author: commit.commit.author?.name ?? null,
      authoredAt: commit.commit.author?.date ?? null,
    }));
  }

  async getCommit(owner: string, name: string, sha: string) {
    const repository = await this.getRepository(owner, name);
    const octokit = repository.private
      ? await this.authorizedInstallationOctokit(owner, name)
      : this.publicOctokit();
    const response = await this.withRateLimitHandling(() =>
      octokit.repos.getCommit({ owner, repo: name, ref: sha }),
    );
    return { sha: response.data.sha, branchDefault: repository.default_branch };
  }

  async cloneRepository(cloneUrl: string, destination: string, owner: string, name: string) {
    const repository = await this.getRepository(owner, name);
    const git = simpleGit();
    if (repository.private) {
      const octokit = await this.authorizedInstallationOctokit(owner, name);
      const auth = await octokit.auth();
      const token = typeof auth === 'string'
        ? auth
        : (auth as { token: string }).token;
      const authorization = Buffer.from(`x-access-token:${token}`).toString('base64');
      git.env({
        GIT_CONFIG_COUNT: '1',
        GIT_CONFIG_KEY_0: 'http.extraheader',
        GIT_CONFIG_VALUE_0: `AUTHORIZATION: basic ${authorization}`,
      });
    }
    await git.clone(cloneUrl, destination, ['--no-checkout', '--filter=blob:none']);
  }

  private isConfigured() {
    return Boolean(this.appId && this.privateKey && this.installationId);
  }

  private async installationOctokit() {
    if (!this.isConfigured()) {
      throw new ServiceUnavailableException('GitHub App credentials and installation ID are not configured.');
    }
    const auth = createAppAuth({
      appId: this.appId!,
      privateKey: this.privateKey!,
      installationId: Number(this.installationId),
    });
    const { token } = await auth({ type: 'installation' });
    return new Octokit({ auth: token });
  }

  private async authorizedInstallationOctokit(owner: string, name: string) {
    const octokit = await this.installationOctokit();
    const repositories = await this.accessibleInstallationRepositories(octokit);
    const allowed = repositories.some(
      (repository) => repository.owner.login.toLowerCase() === owner.toLowerCase() &&
        repository.name.toLowerCase() === name.toLowerCase(),
    );
    if (!allowed) {
      throw new NotFoundException('Repository is not in the GitHub App installation allowlist.');
    }
    return octokit;
  }

  private async accessibleInstallationRepositories(octokit: Octokit) {
    const repositories: AccessibleRepository[] = [];
    for (let page = 1; ; page += 1) {
      const response = await this.withRateLimitHandling(() =>
        octokit.apps.listReposAccessibleToInstallation({
          per_page: 100,
          page,
        }),
      );
      repositories.push(...response.data.repositories);
      if (response.data.repositories.length < 100) {
        return repositories;
      }
    }
  }

  private isNotFound(error: unknown): boolean {
    return typeof error === 'object' && error !== null && 'status' in error &&
      (error as { status?: number }).status === 404;
  }

  private publicOctokit() {
    return new Octokit(this.githubToken ? { auth: this.githubToken } : {});
  }

  private async withRateLimitHandling<T>(request: () => Promise<T>): Promise<T> {
    try {
      return await request();
    } catch (error) {
      if (this.isRateLimited(error)) {
        throw new ServiceUnavailableException(
          'GitHub API rate limit exceeded. Set GITHUB_TOKEN in apps/backend/.env or retry after the public quota resets.',
        );
      }
      throw error;
    }
  }

  private isRateLimited(error: unknown): error is GitHubHttpError {
    if (typeof error !== 'object' || error === null) {
      return false;
    }
    const githubError = error as GitHubHttpError;
    return githubError.status === 403 && (
      githubError.response?.headers?.['x-ratelimit-remaining'] === '0' ||
      githubError.message?.includes('API rate limit exceeded') === true
    );
  }

  private toRepositorySummary(repository: {
    id: number;
    owner: { login: string } | null;
    name: string;
    full_name: string;
    clone_url: string;
    private: boolean;
    default_branch: string | null;
  }) {
    return {
      externalRepoId: String(repository.id),
      owner: repository.owner?.login ?? '',
      name: repository.name,
      fullName: repository.full_name,
      cloneUrl: repository.clone_url,
      isPrivate: repository.private,
      defaultBranch: repository.default_branch ?? 'main',
    };
  }
}
