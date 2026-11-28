import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AnalysisModule } from '../analysis/analysis.module';
import { RepositoryAnalysisEntity } from '../analysis/entities/repository-analysis.entity';
import { ProjectEntity } from '../projects/entities/project.entity';
import { ProjectRepositoryEntity } from '../repositories/entities/project-repository.entity';
import { RepositoryEntity } from '../repositories/entities/repository.entity';
import { RepositorySnapshotEntity } from '../repositories/entities/repository-snapshot.entity';
import { ReferenceSolutionEntity } from './entities/reference-solution.entity';
import { TaskEntity } from './entities/task.entity';
import { TaskGenerationEntity } from './entities/task-generation.entity';
import { TaskVersionEntity } from './entities/task-version.entity';
import { ReferenceSolutionsProcessor } from './reference-solutions.processor';
import { ReferenceSolutionsService } from './reference-solutions.service';
import { TasksController } from './tasks.controller';
import { TasksService } from './tasks.service';

@Module({
  imports: [
    AnalysisModule,
    BullModule.registerQueue({ name: 'reference-generation' }),
    TypeOrmModule.forFeature([
      ProjectEntity,
      ProjectRepositoryEntity,
      RepositoryEntity,
      RepositoryAnalysisEntity,
      RepositorySnapshotEntity,
      TaskEntity,
      TaskGenerationEntity,
      TaskVersionEntity,
      ReferenceSolutionEntity,
    ]),
  ],
  controllers: [TasksController],
  providers: [TasksService, ReferenceSolutionsService, ReferenceSolutionsProcessor],
})
export class TasksModule {}
