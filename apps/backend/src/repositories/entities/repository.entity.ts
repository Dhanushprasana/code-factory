import {
  Column,
  CreateDateColumn,
  Entity,
  OneToMany,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';
import { ProjectRepositoryEntity } from './project-repository.entity';
import { RepositorySnapshotEntity } from './repository-snapshot.entity';
import { RepositoryAnalysisEntity } from '../../analysis/entities/repository-analysis.entity';

@Entity({ name: 'repositories' })
@Unique('uq_repositories_provider_external_id', ['provider', 'externalRepoId'])
export class RepositoryEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 32, default: 'github' })
  provider: string;

  @Column({ name: 'external_repo_id', type: 'varchar', length: 64 })
  externalRepoId: string;

  @Column({ type: 'varchar', length: 100 })
  owner: string;

  @Column({ type: 'varchar', length: 100 })
  name: string;

  @Column({ name: 'full_name', type: 'varchar', length: 201 })
  fullName: string;

  @Column({ name: 'clone_url', type: 'text' })
  cloneUrl: string;

  @Column({ name: 'is_private', type: 'boolean', default: false })
  isPrivate: boolean;

  @Column({ name: 'default_branch', type: 'varchar', length: 255, default: 'main' })
  defaultBranch: string;

  @OneToMany(() => ProjectRepositoryEntity, (projectRepository) => projectRepository.repository)
  projects: ProjectRepositoryEntity[];

  @OneToMany(() => RepositorySnapshotEntity, (snapshot) => snapshot.repository)
  snapshots: RepositorySnapshotEntity[];

  @OneToMany(() => RepositoryAnalysisEntity, (analysis) => analysis.repository)
  analyses: RepositoryAnalysisEntity[];

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
