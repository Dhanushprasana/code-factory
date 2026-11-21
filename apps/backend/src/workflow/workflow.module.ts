import { Module } from '@nestjs/common';
import { AppService } from '../app.service';
import { WorkflowController } from './workflow.controller';

@Module({
  controllers: [WorkflowController],
  providers: [AppService],
})
export class WorkflowModule {}
