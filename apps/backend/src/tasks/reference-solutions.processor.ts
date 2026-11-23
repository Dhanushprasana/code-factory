import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { ReferenceSolutionsService } from './reference-solutions.service';

@Processor('reference-generation')
export class ReferenceSolutionsProcessor extends WorkerHost {
  constructor(private readonly referenceSolutions: ReferenceSolutionsService) {
    super();
  }

  async process(job: Job<{ referenceId: string; runId?: string }>): Promise<void> {
    if (job.name === 'validate') {
      if (job.data.runId) {
        await this.referenceSolutions.processValidation(job.data.referenceId, job.data.runId);
      }
      return;
    }
    await this.referenceSolutions.processGeneration(job.data.referenceId);
  }
}
