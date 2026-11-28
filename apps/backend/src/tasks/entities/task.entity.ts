import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { ProjectEntity } from '../../projects/entities/project.entity';
import { TaskGenerationEntity } from './task-generation.entity';
import { TaskVersionEntity } from './task-version.entity';

@Entity({ name: 'tasks' })
export class TaskEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'project_id', type: 'uuid' })
  projectId: string;

  @ManyToOne(() => ProjectEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'project_id' })
  project: ProjectEntity;

  @Column({ name: 'generation_id', type: 'uuid', nullable: true })
  generationId: string | null;

  @ManyToOne(() => TaskGenerationEntity, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'generation_id' })
  generation: TaskGenerationEntity | null;

  @Column({ name: 'current_version', type: 'integer', default: 1 })
  currentVersion: number;

  @Column({ type: 'varchar', length: 160 })
  title: string;

  @Column({ type: 'text' })
  description: string;

  @Column({ type: 'varchar', length: 32 })
  category: string;

  @Column({ type: 'varchar', length: 16 })
  difficulty: string;

  @Column({ type: 'varchar', length: 24, default: 'draft' })
  status: string;

  @Column({ type: 'jsonb', default: () => "'[]'::jsonb" })
  requirements: string[];

  @Column({ name: 'acceptance_criteria', type: 'jsonb', default: () => "'[]'::jsonb" })
  acceptanceCriteria: string[];

  @Column({ type: 'jsonb', default: () => "'[]'::jsonb" })
  constraints: string[];

  @Column({ name: 'affected_modules', type: 'jsonb', default: () => "'[]'::jsonb" })
  affectedModules: string[];

  @Column({ name: 'target_files', type: 'jsonb', default: () => "'[]'::jsonb" })
  targetFiles: string[];

  @Column({ name: 'baseline_manifest', type: 'jsonb' })
  baselineManifest: Record<string, unknown>[];

  @Column({ name: 'context_manifest', type: 'jsonb' })
  contextManifest: Record<string, unknown>;

  @Column({ type: 'jsonb', default: () => "'[]'::jsonb" })
  evidence: Record<string, unknown>[];

  @OneToMany(() => TaskVersionEntity, (version) => version.task)
  versions: TaskVersionEntity[];

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
