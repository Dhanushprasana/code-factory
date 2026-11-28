import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';
import { TaskEntity } from './task.entity';

@Entity({ name: 'reference_solutions' })
@Unique('uq_reference_solutions_task_version', ['taskId', 'version'])
export class ReferenceSolutionEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'task_id', type: 'uuid' })
  taskId: string;

  @ManyToOne(() => TaskEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'task_id' })
  task: TaskEntity;

  @Column({ name: 'task_version', type: 'integer' })
  taskVersion: number;

  @Column({ type: 'integer' })
  version: number;

  @Column({ type: 'varchar', length: 32, default: 'queued' })
  status: string;

  @Column({ type: 'varchar', length: 24 })
  provider: string;

  @Column({ type: 'varchar', length: 128, nullable: true })
  model: string | null;

  @Column({ name: 'prompt_version', type: 'varchar', length: 64, nullable: true })
  promptVersion: string | null;

  @Column({ type: 'jsonb' })
  input: Record<string, unknown>;

  @Column({ name: 'implementation_plan', type: 'jsonb', nullable: true })
  implementationPlan: Record<string, unknown>[] | null;

  @Column({ type: 'jsonb', nullable: true })
  patches: Array<{ repository_id: string; patch_diff: string }> | null;

  @Column({ name: 'target_files', type: 'jsonb', nullable: true })
  targetFiles: string[] | null;

  @Column({ type: 'jsonb', nullable: true })
  modifications: Record<string, unknown>[] | null;

  @Column({ name: 'file_changes', type: 'jsonb', nullable: true })
  fileChanges: Array<{
    repository_id: string;
    file_path: string;
    operation: string;
    original_content: string;
    modified_content: string;
  }> | null;

  @Column({ name: 'solve_script', type: 'text', nullable: true })
  solveScript: string | null;

  @Column({ type: 'jsonb', nullable: true })
  tests: Record<string, unknown>[] | null;

  @Column({ name: 'context_manifest', type: 'jsonb', nullable: true })
  contextManifest: Record<string, unknown> | null;

  @Column({ type: 'jsonb', default: () => "'{}'::jsonb" })
  validation: Record<string, unknown>;

  @Column({ name: 'review_note', type: 'text', nullable: true })
  reviewNote: string | null;

  @Column({ name: 'error_message', type: 'text', nullable: true })
  errorMessage: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
