import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { AgentBenchmarkService } from './agent-benchmark.service';

@Processor('agent-evaluation')
export class AgentEvaluationProcessor extends WorkerHost {
  constructor(private readonly benchmark: AgentBenchmarkService) {
    super();
  }

  async process(job: Job<{ evaluationId: string }>): Promise<void> {
    await this.benchmark.processEvaluation(job.data.evaluationId);
  }
}
