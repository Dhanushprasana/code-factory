import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RepositoryAnalysisEntity } from './entities/repository-analysis.entity';
import { AnalysisController } from './analysis.controller';
import { AnalysisProcessor } from './analysis.processor';
import { AnalysisService } from './analysis.service';
import { RepositoryEntity } from '../repositories/entities/repository.entity';
import { RepositorySnapshotEntity } from '../repositories/entities/repository-snapshot.entity';

@Module({
  imports: [
    BullModule.registerQueue({ name: 'repository-analysis' }),
    TypeOrmModule.forFeature([
      RepositoryAnalysisEntity,
      RepositoryEntity,
      RepositorySnapshotEntity,
    ]),
  ],
  controllers: [AnalysisController],
  providers: [AnalysisService, AnalysisProcessor],
})
export class AnalysisModule {}
