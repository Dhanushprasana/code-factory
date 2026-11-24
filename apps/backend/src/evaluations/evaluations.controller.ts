import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { EvaluationsService, RunEvaluationDto } from './evaluations.service';

@Controller()
export class EvaluationsController {
  constructor(private readonly evaluationsService: EvaluationsService) {}

  @Get('evaluations')
  list(
    @Query('taskId') taskId?: string,
    @Query('agentId') agentId?: string,
  ) {
    return this.evaluationsService.list(taskId, agentId);
  }

  @Get('evaluations/:id')
  get(@Param('id') id: string) {
    return this.evaluationsService.get(id);
  }

  @Post('evaluations/run')
  run(@Body() body: RunEvaluationDto) {
    return this.evaluationsService.runEvaluation(body);
  }

  @Get('leaderboard')
  leaderboard() {
    return this.evaluationsService.getLeaderboard();
  }
}
