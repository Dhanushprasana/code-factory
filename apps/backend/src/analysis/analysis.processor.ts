import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { AnalysisService } from './analysis.service';

@Processor('repository-analysis')
export class AnalysisProcessor extends WorkerHost {
  constructor(private readonly analysisService: AnalysisService) {
    super();
  }

  async process(job: Job<{ analysisId: string }>): Promise<void> {
    await this.analysisService.processAnalysis(job.data.analysisId);
  }
}
