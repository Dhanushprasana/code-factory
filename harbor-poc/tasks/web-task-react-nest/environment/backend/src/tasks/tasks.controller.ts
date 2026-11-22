import { Controller, Get, Post, Body } from '@nestjs/common';
import { TasksService, Task } from './tasks.service';

@Controller('tasks')
export class TasksController {
  constructor(private readonly tasksService: TasksService) {}

  @Get()
  getAll(): Task[] {
    return this.tasksService.getAll();
  }

  @Post()
  create(@Body() body: { title: string; priority: string }): Task {
    return this.tasksService.create(body.title, body.priority);
  }
}
