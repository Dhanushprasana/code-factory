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
import { ProjectEntity } from '../../projects/entities/project.entity';
import { RepositoryEntity } from './repository.entity';

@Entity({ name: 'project_repositories' })
@Unique('uq_project_repositories_project_repo', ['projectId', 'repositoryId'])
export class ProjectRepositoryEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'project_id', type: 'uuid' })
  projectId: string;

  @ManyToOne(() => ProjectEntity, (project) => project.repositories, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'project_id' })
  project: ProjectEntity;

  @Column({ name: 'repository_id', type: 'uuid' })
  repositoryId: string;

  @ManyToOne(() => RepositoryEntity, (repository) => repository.projects, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'repository_id' })
  repository: RepositoryEntity;

  @Column({ name: 'repo_role', type: 'varchar', length: 32, default: 'other' })
  repoRole: string;

  @Column({ name: 'selected_branch', type: 'varchar', length: 255, nullable: true })
  selectedBranch: string | null;

  @Column({ name: 'selected_commit_sha', type: 'varchar', length: 40, nullable: true })
  selectedCommitSha: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
