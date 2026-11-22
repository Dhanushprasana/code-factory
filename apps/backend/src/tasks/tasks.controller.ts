import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { TasksService } from './tasks.service';

@Controller()
export class TasksController {
  constructor(private readonly tasksService: TasksService) {}

  @Get('projects/:id/task-context')
  projectContext(@Param('id') projectId: string) {
    return this.tasksService.getProjectContext(projectId);
  }

  @Get('projects/:id/task-generations')
  generations(@Param('id') projectId: string) {
    return this.tasksService.listGenerations(projectId);
  }

  @Post('projects/:id/tasks/suggest')
  suggest(@Param('id') projectId: string, @Body() body: Record<string, unknown>) {
    return this.tasksService.suggestTasks(projectId, body);
  }

  @Get('projects/:id/tasks')
  projectTasks(@Param('id') projectId: string) {
    return this.tasksService.listProjectTasks(projectId);
  }

  @Post('projects/:id/tasks')
  create(@Param('id') projectId: string, @Body() body: Record<string, unknown>) {
    return this.tasksService.createTask(projectId, body);
  }

  @Get('tasks')
  tasks(@Query('projectId') projectId?: string) {
    return this.tasksService.listTasks(projectId);
  }

  @Get('tasks/:id/versions')
  versions(@Param('id') taskId: string) {
    return this.tasksService.listVersions(taskId);
  }

  @Get('tasks/:id')
  task(@Param('id') taskId: string) {
    return this.tasksService.getTask(taskId);
  }

  @Patch('tasks/:id')
  update(@Param('id') taskId: string, @Body() body: Record<string, unknown>) {
    return this.tasksService.updateTask(taskId, body);
  }
}
