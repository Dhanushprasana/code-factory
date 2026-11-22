import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { ReferenceSolutionsService } from './reference-solutions.service';

@Processor('reference-generation')
export class ReferenceSolutionsProcessor extends WorkerHost {
  constructor(private readonly referenceSolutions: ReferenceSolutionsService) {
    super();
  }

  async process(job: Job<{ referenceId: string }>): Promise<void> {
    await this.referenceSolutions.processGeneration(job.data.referenceId);
  }
}
