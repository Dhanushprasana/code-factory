import { BadRequestException, Controller, Get, Param, Query } from '@nestjs/common';
import { GitHubService } from './github.service';

@Controller('github')
export class GitHubController {
  constructor(private readonly githubService: GitHubService) {}

  @Get('install-url')
  installUrl() {
    return this.githubService.installationUrl();
  }

  @Get('repositories')
  repositories(@Query('query') query?: string) {
    return this.githubService.listRepositories(query);
  }

  @Get('repositories/:owner/:name/branches')
  branches(@Param('owner') owner: string, @Param('name') name: string) {
    return this.githubService.listBranches(owner, name);
  }

  @Get('repositories/:owner/:name/commits')
  commits(
    @Param('owner') owner: string,
    @Param('name') name: string,
    @Query('branch') branch?: string,
  ) {
    if (!branch?.trim()) {
      throw new BadRequestException('Branch is required to list commits.');
    }
    return this.githubService.listCommits(owner, name, branch);
  }
}
