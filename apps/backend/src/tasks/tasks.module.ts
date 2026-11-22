import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RepositoryAnalysisEntity } from '../analysis/entities/repository-analysis.entity';
import { ProjectEntity } from '../projects/entities/project.entity';
import { ProjectRepositoryEntity } from '../repositories/entities/project-repository.entity';
import { RepositorySnapshotEntity } from '../repositories/entities/repository-snapshot.entity';
import { TaskEntity } from './entities/task.entity';
import { TaskGenerationEntity } from './entities/task-generation.entity';
import { TaskVersionEntity } from './entities/task-version.entity';
import { TasksController } from './tasks.controller';
import { TasksService } from './tasks.service';

@Module({
  imports: [TypeOrmModule.forFeature([
    ProjectEntity,
    ProjectRepositoryEntity,
    RepositoryAnalysisEntity,
    RepositorySnapshotEntity,
    TaskEntity,
    TaskGenerationEntity,
    TaskVersionEntity,
  ])],
  controllers: [TasksController],
  providers: [TasksService],
})
export class TasksModule {}
