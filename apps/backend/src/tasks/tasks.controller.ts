import {
  Body,
  Controller,
  Get,
  Logger,
  Param,
  Patch,
  Post,
  Query,
  StreamableFile,
} from '@nestjs/common';
import { createReadStream, promises as fs } from 'fs';
import { ReferenceSolutionsService } from './reference-solutions.service';
import { TasksService } from './tasks.service';

@Controller()
export class TasksController {
  private readonly logger = new Logger(TasksController.name);

  constructor(
    private readonly tasksService: TasksService,
    private readonly referenceSolutions: ReferenceSolutionsService,
  ) {}

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

  @Post('tasks/:id/references/generate')
  generateReference(@Param('id') taskId: string, @Body() body: Record<string, unknown>) {
    return this.referenceSolutions.generate(taskId, body);
  }

  @Get('tasks/:id/references')
  references(@Param('id') taskId: string) {
    return this.referenceSolutions.listForTask(taskId);
  }

  @Get('references/:id')
  reference(@Param('id') referenceId: string) {
    return this.referenceSolutions.get(referenceId);
  }

  @Get('references/:id/artifacts')
  referenceArtifacts(@Param('id') referenceId: string) {
    return this.referenceSolutions.getArtifacts(referenceId);
  }

  @Post('references/:id/apply')
  applyReference(@Param('id') referenceId: string) {
    return this.referenceSolutions.applyPatches(referenceId);
  }

  @Get('references/:id/workspace/archive')
  async downloadReferenceWorkspace(@Param('id') referenceId: string) {
    const archive = await this.referenceSolutions.createWorkspaceArchive(referenceId);
    const stream = createReadStream(archive.path);
    stream.once('close', () => {
      void fs.rm(archive.path).catch((error: unknown) => {
        this.logger.error(
          `Could not remove temporary reference archive ${archive.filename}.`,
          error instanceof Error ? error.stack : undefined,
        );
      });
    });
    return new StreamableFile(stream, {
      type: 'application/gzip',
      disposition: `attachment; filename="${archive.filename}"`,
    });
  }

  @Post('references/:id/validation/execute')
  executeReferenceValidation(@Param('id') referenceId: string) {
    return this.referenceSolutions.executeValidation(referenceId);
  }

  @Patch('references/:id/review')
  reviewReference(@Param('id') referenceId: string, @Body() body: Record<string, unknown>) {
    return this.referenceSolutions.review(referenceId, body);
  }
}
