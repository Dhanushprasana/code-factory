import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { GitHubModule } from '../github/github.module';
import { ProjectsModule } from '../projects/projects.module';
import { ProjectRepositoryEntity } from './entities/project-repository.entity';
import { RepositoryEntity } from './entities/repository.entity';
import { RepositorySnapshotEntity } from './entities/repository-snapshot.entity';
import { RepositoriesController } from './repositories.controller';
import { RepositoriesService } from './repositories.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      ProjectRepositoryEntity,
      RepositoryEntity,
      RepositorySnapshotEntity,
    ]),
    GitHubModule,
    ProjectsModule,
  ],
  controllers: [RepositoriesController],
  providers: [RepositoriesService],
})
export class RepositoriesModule {}
