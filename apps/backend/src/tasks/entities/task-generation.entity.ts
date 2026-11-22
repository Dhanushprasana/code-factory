import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { ProjectEntity } from '../../projects/entities/project.entity';

@Entity({ name: 'task_generation_runs' })
export class TaskGenerationEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'project_id', type: 'uuid' })
  projectId: string;

  @ManyToOne(() => ProjectEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'project_id' })
  project: ProjectEntity;

  @Column({ type: 'varchar', length: 24, default: 'running' })
  status: string;

  @Column({ type: 'jsonb' })
  input: Record<string, unknown>;

  @Column({ type: 'varchar', length: 64, nullable: true })
  provider: string | null;

  @Column({ type: 'varchar', length: 128, nullable: true })
  model: string | null;

  @Column({ name: 'prompt_version', type: 'varchar', length: 64, nullable: true })
  promptVersion: string | null;

  @Column({ name: 'context_manifest', type: 'jsonb', nullable: true })
  contextManifest: Record<string, unknown> | null;

  @Column({ type: 'jsonb', nullable: true })
  candidates: Record<string, unknown>[] | null;

  @Column({ name: 'error_message', type: 'text', nullable: true })
  errorMessage: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
