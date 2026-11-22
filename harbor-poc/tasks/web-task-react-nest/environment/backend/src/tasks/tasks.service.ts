import { Injectable, BadRequestException } from '@nestjs/common';

export interface Task {
  id: string;
  title: string;
  priority: 'LOW' | 'MEDIUM' | 'HIGH';
}

@Injectable()
export class TasksService {
  private tasks: Task[] = [];

  getAll(): Task[] {
    return this.tasks;
  }

  create(title: string, priority: string): Task {
    if (!title || typeof title !== 'string') {
      throw new BadRequestException('Title is required');
    }

    // BUG: The developer forgot 'HIGH' and rejects it!
    const validPriorities = ['LOW', 'MEDIUM'];
    const normalizedPriority = priority ? priority.toUpperCase() : 'MEDIUM';

    if (!validPriorities.includes(normalizedPriority)) {
      throw new BadRequestException('Invalid priority');
    }

    const newTask: Task = {
      id: String(this.tasks.length + 1),
      title,
      priority: normalizedPriority as 'LOW' | 'MEDIUM' | 'HIGH',
    };

    this.tasks.push(newTask);
    return newTask;
  }
}
