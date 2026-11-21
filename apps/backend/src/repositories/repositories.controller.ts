import { Body, Controller, Delete, Get, Param, Post } from '@nestjs/common';
import { RepositoriesService } from './repositories.service';

@Controller()
export class RepositoriesController {
  constructor(private readonly repositoriesService: RepositoriesService) {}

  @Get('repositories')
  repositories() {
    return this.repositoriesService.list();
  }

  @Get('projects/:id/repositories')
  projectRepositories(@Param('id') id: string) {
    return this.repositoriesService.listForProject(id);
  }

  @Post('projects/:id/repositories')
  addRepository(@Param('id') id: string, @Body() body: any) {
    return this.repositoriesService.addToProject(id, body);
  }

  @Delete('projects/:id/repositories/:repositoryId')
  removeRepository(
    @Param('id') projectId: string,
    @Param('repositoryId') repositoryId: string,
  ) {
    return this.repositoriesService.removeFromProject(projectId, repositoryId);
  }

  @Post('projects/:id/repositories/:repositoryId/snapshots')
  cloneRepository(
    @Param('id') projectId: string,
    @Param('repositoryId') repositoryId: string,
    @Body() body: any,
  ) {
    return this.repositoriesService.cloneSelectedCommit(projectId, repositoryId, body);
  }
}
