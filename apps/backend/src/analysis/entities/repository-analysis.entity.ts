import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { RepositoryEntity } from '../../repositories/entities/repository.entity';
import { RepositorySnapshotEntity } from '../../repositories/entities/repository-snapshot.entity';

@Entity({ name: 'repository_analyses' })
export class RepositoryAnalysisEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'repository_id', type: 'uuid' })
  repositoryId: string;

  @ManyToOne(() => RepositoryEntity, (repository) => repository.analyses, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'repository_id' })
  repository: RepositoryEntity;

  @Column({ name: 'snapshot_id', type: 'uuid' })
  snapshotId: string;

  @ManyToOne(() => RepositorySnapshotEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'snapshot_id' })
  snapshot: RepositorySnapshotEntity;

  @Column({ name: 'commit_sha', type: 'varchar', length: 40 })
  commitSha: string;

  @Column({ type: 'varchar', length: 24, default: 'queued' })
  status: string;

  @Column({ name: 'analyzer_version', type: 'varchar', length: 32 })
  analyzerVersion: string;

  @Column({ type: 'jsonb', nullable: true })
  summary: Record<string, unknown> | null;

  @Column({ type: 'jsonb', nullable: true })
  report: Record<string, unknown> | null;

  @Column({ type: 'jsonb', default: () => "'[]'::jsonb" })
  warnings: string[];

  @Column({ name: 'error_message', type: 'text', nullable: true })
  errorMessage: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
