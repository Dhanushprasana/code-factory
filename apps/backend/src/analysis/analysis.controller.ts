import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { AnalysisService } from './analysis.service';

@Controller()
export class AnalysisController {
  constructor(private readonly analysisService: AnalysisService) {}

  @Post('repositories/:id/analyze')
  startAnalysis(
    @Param('id') repositoryId: string,
    @Body() body: { commitSha?: unknown } | null = {},
  ) {
    return this.analysisService.startAnalysis(repositoryId, body);
  }

  @Get('repositories/:id/analyses')
  listAnalyses(@Param('id') repositoryId: string) {
    return this.analysisService.listForRepository(repositoryId);
  }

  @Get('analyses/:id')
  getAnalysis(@Param('id') analysisId: string) {
    return this.analysisService.getAnalysis(analysisId);
  }

  @Get('analyses/:id/summary')
  getSummary(@Param('id') analysisId: string) {
    return this.analysisService.getSummary(analysisId);
  }

  @Get('analyses/:id/graph')
  getGraph(@Param('id') analysisId: string) {
    return this.analysisService.getGraph(analysisId);
  }

  @Post('analyses/:id/features')
  extractFeatures(
    @Param('id') analysisId: string,
    @Body() body: { provider?: unknown } | null = {},
  ) {
    return this.analysisService.extractFeaturesWithLlm(analysisId, body);
  }
}
