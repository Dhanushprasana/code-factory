import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { AppService } from '../app.service';

@Controller()
export class WorkflowController {
  constructor(private readonly appService: AppService) {}

  @Post('tasks/:id/generate-reference')
  generateReference(@Param('id') id: string) {
    return this.appService.generateReference(id);
  }

  @Get('packages')
  packages() {
    return this.appService.packages();
  }

  @Get('packages/:id')
  package(@Param('id') id: string) {
    return this.appService.package(id);
  }

  @Post('packages/:id/approve')
  approvePackage(@Param('id') id: string) {
    return this.appService.approvePackage(id);
  }

  @Post('packages/:id/export')
  exportPackage(@Param('id') id: string) {
    return this.appService.exportPackage(id);
  }

  @Post('tasks/:id/agents/execute')
  executeAgents(@Param('id') id: string, @Body() body: any) {
    return this.appService.executeAgents(id, body);
  }

  @Get('evaluations')
  evaluations() {
    return this.appService.evaluations();
  }
}
