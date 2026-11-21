import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AgentEntity } from './entities/agent.entity';
import { AgentConfigEntity } from './entities/agent-config.entity';
import { CreateAgentDto } from './dto/create-agent.dto';
import { UpdateAgentDto } from './dto/update-agent.dto';

@Injectable()
export class AgentsService {
  constructor(
    @InjectRepository(AgentEntity)
    private readonly agentRepo: Repository<AgentEntity>,
    @InjectRepository(AgentConfigEntity)
    private readonly configRepo: Repository<AgentConfigEntity>,
  ) {}

  async list(): Promise<AgentEntity[]> {
    return this.agentRepo.find({
      relations: ['configs'],
      order: { createdAt: 'DESC' },
    });
  }

  async get(id: string): Promise<AgentEntity> {
    const agent = await this.agentRepo.findOne({
      where: { id },
      relations: ['configs'],
    });
    if (!agent) {
      throw new NotFoundException(`Agent with id "${id}" was not found.`);
    }
    return agent;
  }

  async create(input: CreateAgentDto): Promise<AgentEntity> {
    const name = typeof input.name === 'string' ? input.name.trim() : '';
    if (!name) {
      throw new BadRequestException('Agent name is required.');
    }

    const agent = this.agentRepo.create({
      name,
      adapterType: input.adapterType?.trim() || 'direct-cli',
      provider: input.provider?.trim() || 'Custom',
      description: input.description?.trim() || '',
      status: input.status?.trim() || 'ready',
      modelName: input.modelName?.trim() || '',
      settings: input.settings || {},
      credentialReference: input.credentialReference || null,
    });

    const savedAgent = await this.agentRepo.save(agent);

    // If modelName or settings provided, create the initial agent config version 1
    if (savedAgent.modelName || Object.keys(savedAgent.settings).length > 0) {
      const config = this.configRepo.create({
        agentId: savedAgent.id,
        configVersion: 1,
        modelName: savedAgent.modelName || 'default',
        settings: savedAgent.settings,
        credentialReference: savedAgent.credentialReference,
      });
      await this.configRepo.save(config);
    }

    return this.get(savedAgent.id);
  }

  async update(id: string, input: UpdateAgentDto): Promise<AgentEntity> {
    const agent = await this.get(id);

    if (input.name !== undefined) {
      if (typeof input.name !== 'string' || !input.name.trim()) {
        throw new BadRequestException('Agent name cannot be empty.');
      }
      agent.name = input.name.trim();
    }

    if (input.adapterType !== undefined) {
      agent.adapterType = input.adapterType.trim();
    }

    if (input.provider !== undefined) {
      agent.provider = input.provider.trim();
    }

    if (input.description !== undefined) {
      agent.description = input.description.trim();
    }

    if (input.status !== undefined) {
      agent.status = input.status.trim();
    }

    let configUpdated = false;
    if (input.modelName !== undefined) {
      agent.modelName = input.modelName.trim();
      configUpdated = true;
    }

    if (input.settings !== undefined) {
      agent.settings = input.settings;
      configUpdated = true;
    }

    if (input.credentialReference !== undefined) {
      agent.credentialReference = input.credentialReference;
      configUpdated = true;
    }

    const updatedAgent = await this.agentRepo.save(agent);

    if (configUpdated) {
      const latestConfig = await this.configRepo.findOne({
        where: { agentId: id },
        order: { configVersion: 'DESC' },
      });
      const nextVersion = latestConfig ? latestConfig.configVersion + 1 : 1;

      const newConfig = this.configRepo.create({
        agentId: id,
        configVersion: nextVersion,
        modelName: updatedAgent.modelName || 'default',
        settings: updatedAgent.settings,
        credentialReference: updatedAgent.credentialReference,
      });
      await this.configRepo.save(newConfig);
    }

    return this.get(id);
  }

  async delete(id: string): Promise<{ deleted: boolean; id: string }> {
    const agent = await this.get(id);
    await this.agentRepo.remove(agent);
    return { deleted: true, id };
  }

  async seedDefaults(): Promise<AgentEntity[]> {
    const count = await this.agentRepo.count();
    if (count > 0) {
      return this.list();
    }

    const defaultAgents: CreateAgentDto[] = [
      {
        name: 'OpenAI Codex',
        adapterType: 'direct-cli',
        provider: 'OpenAI',
        modelName: 'gpt-4.5-preview-coding',
        description: 'Autonomous coding agent running edits, tool calling, and execution validation loops.',
        status: 'ready',
        settings: { executionMode: 'docker-sandbox', timeoutMinutes: 25 },
      },
      {
        name: 'Claude Code',
        adapterType: 'direct-cli',
        provider: 'Anthropic',
        modelName: 'claude-3-7-sonnet',
        description: 'Terminal-first agentic developer with iterative test-driven development and file analysis.',
        status: 'ready',
        settings: { executionMode: 'cli-subshell', timeoutMinutes: 30 },
      },
      {
        name: 'Antigravity',
        adapterType: 'direct-cli',
        provider: 'Google DeepMind',
        modelName: 'gemini-2.5-pro-agentic',
        description: 'Autonomous reasoning engine with active workspace instrumentation and architectural verification.',
        status: 'ready',
        settings: { executionMode: 'container-worktree', timeoutMinutes: 20 },
      },
      {
        name: 'Harbor Baseline Agent',
        adapterType: 'harbor',
        provider: 'Self-Hosted',
        modelName: 'vLLM-DeepSeek-Coder-33B',
        description: 'Harbor execution adapter bridge running in isolated container worktrees.',
        status: 'offline',
        settings: { executionMode: 'harbor-bridge', timeoutMinutes: 35 },
      },
    ];

    for (const item of defaultAgents) {
      await this.create(item);
    }

    return this.list();
  }
}
