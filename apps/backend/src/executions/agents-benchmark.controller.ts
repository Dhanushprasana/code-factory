import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { AgentBenchmarkService } from './agent-benchmark.service';

@Controller()
export class AgentsBenchmarkController {
  constructor(private readonly benchmarkService: AgentBenchmarkService) {}

  @Post('tasks/:id/agents/execute')
  execute(@Param('id') taskId: string, @Body() body: Record<string, unknown>) {
    return this.benchmarkService.startTaskExecution(taskId, body);
  }

  @Get('tasks/:id/benchmark')
  benchmark(@Param('id') taskId: string) {
    return this.benchmarkService.getTaskBenchmark(taskId);
  }

  @Get('executions/:id')
  execution(@Param('id') executionId: string) {
    return this.benchmarkService.getExecution(executionId);
  }

  @Post('references/:id/hidden-tests')
  configureHiddenTests(@Param('id') referenceId: string, @Body() body: Record<string, unknown>) {
    return this.benchmarkService.configureHiddenTests(referenceId, body);
  }

  @Get('evaluations/:id')
  evaluation(@Param('id') evaluationId: string) {
    return this.benchmarkService.getEvaluation(evaluationId);
  }
}
