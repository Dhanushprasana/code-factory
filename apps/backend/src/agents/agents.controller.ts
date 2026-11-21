import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { AgentsService } from './agents.service';
import { CreateAgentDto } from './dto/create-agent.dto';
import { UpdateAgentDto } from './dto/update-agent.dto';

@Controller('agents')
export class AgentsController {
  constructor(private readonly agentsService: AgentsService) {}

  @Get()
  list() {
    return this.agentsService.list();
  }

  @Post('seed')
  seed() {
    return this.agentsService.seedDefaults();
  }

  @Post()
  create(@Body() body: CreateAgentDto) {
    return this.agentsService.create(body);
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.agentsService.get(id);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() body: UpdateAgentDto) {
    return this.agentsService.update(id, body);
  }

  @Delete(':id')
  delete(@Param('id') id: string) {
    return this.agentsService.delete(id);
  }
}
