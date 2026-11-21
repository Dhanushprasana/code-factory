import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';
import { RepositoryEntity } from './repository.entity';

@Entity({ name: 'repository_snapshots' })
@Unique('uq_repository_snapshots_repo_commit', ['repositoryId', 'commitSha'])
export class RepositorySnapshotEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'repository_id', type: 'uuid' })
  repositoryId: string;

  @ManyToOne(() => RepositoryEntity, (repository) => repository.snapshots, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'repository_id' })
  repository: RepositoryEntity;

  @Column({ name: 'commit_sha', type: 'varchar', length: 40 })
  commitSha: string;

  @Column({ name: 'branch_name', type: 'varchar', length: 255, nullable: true })
  branchName: string | null;

  @Column({ type: 'varchar', length: 24, default: 'pending' })
  status: string;

  @Column({ name: 'checkout_path', type: 'text', nullable: true, select: false })
  checkoutPath: string | null;

  @CreateDateColumn({ name: 'captured_at', type: 'timestamptz' })
  capturedAt: Date;
}
