import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { ProjectsService } from './projects.service';

@Controller()
export class ProjectsController {
  constructor(private readonly projectsService: ProjectsService) {}

  @Get('dashboard')
  dashboard() {
    return this.projectsService.counts();
  }

  @Get('projects')
  projects() {
    return this.projectsService.list();
  }

  @Post('projects')
  createProject(@Body() body: any) {
    return this.projectsService.create(body);
  }

  @Get('projects/:id')
  project(@Param('id') id: string) {
    return this.projectsService.get(id);
  }

  @Patch('projects/:id')
  updateProject(@Param('id') id: string, @Body() body: any) {
    return this.projectsService.update(id, body);
  }

  @Delete('projects/:id')
  deleteProject(@Param('id') id: string) {
    return this.projectsService.delete(id);
  }
}
