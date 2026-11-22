import {
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
  Column,
} from 'typeorm';
import { TaskEntity } from './task.entity';

@Entity({ name: 'task_versions' })
@Unique('uq_task_versions_task_version', ['taskId', 'version'])
export class TaskVersionEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'task_id', type: 'uuid' })
  taskId: string;

  @ManyToOne(() => TaskEntity, (task) => task.versions, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'task_id' })
  task: TaskEntity;

  @Column({ type: 'integer' })
  version: number;

  @Column({ type: 'jsonb' })
  content: Record<string, unknown>;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
