import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { AgentBenchmarkService } from './agent-benchmark.service';

@Processor('agent-execution')
export class AgentExecutionProcessor extends WorkerHost {
  constructor(private readonly benchmark: AgentBenchmarkService) {
    super();
  }

  async process(job: Job<{ executionId: string }>): Promise<void> {
    await this.benchmark.processExecution(job.data.executionId);
  }
}
