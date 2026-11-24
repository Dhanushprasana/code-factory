import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AgentEntity } from '../agents/entities/agent.entity';
import { AgentConfigEntity } from '../agents/entities/agent-config.entity';
import { RepositoryAnalysisEntity } from '../analysis/entities/repository-analysis.entity';
import { RepositoryEntity } from '../repositories/entities/repository.entity';
import { RepositorySnapshotEntity } from '../repositories/entities/repository-snapshot.entity';
import { ReferenceSolutionEntity } from '../tasks/entities/reference-solution.entity';
import { TaskEntity } from '../tasks/entities/task.entity';
import { TaskVersionEntity } from '../tasks/entities/task-version.entity';
import { AgentAssignmentEntity } from './entities/agent-assignment.entity';
import { AgentExecutionEntity } from './entities/agent-execution.entity';
import { AgentSubmissionEntity } from './entities/agent-submission.entity';
import { AgentEvaluationEntity } from './entities/agent-evaluation.entity';
import { AgentBenchmarkService } from './agent-benchmark.service';
import { AgentExecutionProcessor } from './agent-execution.processor';
import { AgentEvaluationProcessor } from './agent-evaluation.processor';
import { AgentsBenchmarkController } from './agents-benchmark.controller';

@Module({
  imports: [
    BullModule.registerQueue(
      { name: 'agent-execution' },
      { name: 'agent-evaluation' },
    ),
    TypeOrmModule.forFeature([
      AgentEntity,
      AgentConfigEntity,
      RepositoryAnalysisEntity,
      RepositorySnapshotEntity,
      RepositoryEntity,
      TaskEntity,
      TaskVersionEntity,
      ReferenceSolutionEntity,
      AgentAssignmentEntity,
      AgentExecutionEntity,
      AgentSubmissionEntity,
      AgentEvaluationEntity,
    ]),
  ],
  controllers: [AgentsBenchmarkController],
  providers: [
    AgentBenchmarkService,
    AgentExecutionProcessor,
    AgentEvaluationProcessor,
  ],
  exports: [AgentBenchmarkService],
})
export class AgentsBenchmarkModule {}
