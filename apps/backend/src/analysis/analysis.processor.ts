import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { AnalysisService } from './analysis.service';

@Processor('repository-analysis')
export class AnalysisProcessor extends WorkerHost {
  constructor(private readonly analysisService: AnalysisService) {
    super();
  }

  async process(job: Job<{ analysisId: string }>): Promise<void> {
    if (job.name === 'generate-context') {
      await this.analysisService.processContextGeneration(job.data.analysisId);
    } else {
      await this.analysisService.processAnalysis(job.data.analysisId);
    }
  }
}
