import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AgentEntity } from './entities/agent.entity';
import { AgentConfigEntity } from './entities/agent-config.entity';
import { CreateAgentDto } from './dto/create-agent.dto';
import { UpdateAgentDto } from './dto/update-agent.dto';

const AGENT_CREDENTIAL_REFERENCES = new Set([
  'GEMINI_API_KEY',
  'GOOGLE_API_KEY',
  'OPENAI_API_KEY',
  'ANTHROPIC_API_KEY',
]);

@Injectable()
export class AgentsService {
  constructor(
    @InjectRepository(AgentEntity)
    private readonly agentRepo: Repository<AgentEntity>,
    @InjectRepository(AgentConfigEntity)
    private readonly configRepo: Repository<AgentConfigEntity>,
  ) {}

  async list(): Promise<AgentEntity[]> {
    const agents = await this.agentRepo.find({
      relations: ['configs'],
      order: { createdAt: 'DESC' },
    });
    return agents.map((agent) => this.sanitizeAgent(agent));
  }

  async get(id: string): Promise<AgentEntity> {
    const agent = await this.agentRepo.findOne({
      where: { id },
      relations: ['configs'],
    });
    if (!agent) {
      throw new NotFoundException(`Agent with id "${id}" was not found.`);
    }
    return this.sanitizeAgent(agent);
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
      settings: this.normalizeSettings(input.settings || {}),
      credentialReference: this.normalizeCredentialReference(input.credentialReference),
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
      agent.settings = this.normalizeSettings(input.settings);
      configUpdated = true;
    }

    if (input.credentialReference !== undefined) {
      agent.credentialReference = this.normalizeCredentialReference(input.credentialReference);
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
    const agent = await this.agentRepo.findOne({ where: { id }, relations: ['configs'] });
    if (!agent) {
      throw new NotFoundException(`Agent with id "${id}" was not found.`);
    }
    await this.agentRepo.remove(agent);
    return { deleted: true, id };
  }

  async seedDefaults(): Promise<AgentEntity[]> {
    const defaultAgents: CreateAgentDto[] = [
      {
        name: 'OpenAI Codex',
        adapterType: 'harbor',
        provider: 'OpenAI',
        modelName: 'gpt-5-codex',
        description: 'OpenAI Codex executed by Harbor; requires OPENAI_API_KEY.',
        status: 'offline',
        credentialReference: 'OPENAI_API_KEY',
        settings: {
          executionMode: 'harbor-bridge',
          harborAgent: 'codex',
          timeoutMinutes: 25,
          allowNetwork: true,
        },
      },
      {
        name: 'Claude Code',
        adapterType: 'harbor',
        provider: 'Anthropic',
        modelName: 'claude-sonnet-4-5',
        description: 'Claude Code executed by Harbor; requires ANTHROPIC_API_KEY.',
        status: 'offline',
        credentialReference: 'ANTHROPIC_API_KEY',
        settings: {
          executionMode: 'harbor-bridge',
          harborAgent: 'claude-code',
          timeoutMinutes: 25,
          allowNetwork: true,
        },
      },
      {
        name: 'Antigravity',
        adapterType: 'harbor',
        provider: 'Google AI Studio',
        modelName: 'gemini-3.1-flash-lite',
        description: 'Google Antigravity CLI executed by Harbor using the configured Gemini API key.',
        status: 'ready',
        credentialReference: 'GEMINI_API_KEY',
        settings: {
          executionMode: 'harbor-bridge',
          harborAgent: 'antigravity-cli',
          timeoutMinutes: 25,
          allowNetwork: true,
        },
      },
      {
        name: 'Gemini CLI',
        adapterType: 'harbor',
        provider: 'Google AI Studio',
        modelName: 'gemini-3.1-flash-lite',
        description: 'Gemini CLI executed by Harbor using the runner-injected Gemini API key.',
        status: 'ready',
        credentialReference: 'GEMINI_API_KEY',
        settings: {
          executionMode: 'harbor-bridge',
          harborAgent: 'gemini-cli',
          timeoutMinutes: 25,
          allowNetwork: true,
        },
      },
      {
        name: 'Harbor Baseline Agent',
        adapterType: 'harbor',
        provider: 'Google AI Studio',
        modelName: 'gemini/gemini-3.1-flash-lite',
        description: 'Gemini CLI executed and evaluated by the Harbor framework in an isolated task environment.',
        status: 'ready',
        credentialReference: 'GEMINI_API_KEY',
        settings: {
          executionMode: 'harbor-bridge',
          harborAgent: 'gemini-cli',
          timeoutMinutes: 25,
          allowNetwork: true,
        },
      },
    ];

    for (const item of defaultAgents) {
      const existing = await this.agentRepo.findOne({ where: { name: item.name } });
      if (!existing) {
        await this.create(item);
      } else if (existing.adapterType === 'direct-cli') {
        await this.update(existing.id, {
          adapterType: item.adapterType,
          provider: item.provider,
          modelName: item.modelName,
          description: item.description,
          status: item.status,
          credentialReference: item.credentialReference ?? null,
          settings: item.settings ?? {},
        });
      }
    }

    return this.list();
  }

  private normalizeCredentialReference(value: string | null | undefined) {
    if (value == null || value === '') return null;
    if (!AGENT_CREDENTIAL_REFERENCES.has(value)) {
      throw new BadRequestException(
        'Credential reference must be an allowlisted environment variable name; do not enter the secret value.',
      );
    }
    return value;
  }

  private normalizeSettings(value: Record<string, any>) {
    const command = value.command;
    if (Array.isArray(command) && command.some((argument) =>
      typeof argument === 'string' && this.containsSecretValue(argument))) {
      throw new BadRequestException(
        'Agent commands cannot contain API key values. Configure a credential reference instead.',
      );
    }
    return value;
  }

  private sanitizeAgent(agent: AgentEntity): AgentEntity {
    return {
      ...agent,
      credentialReference: AGENT_CREDENTIAL_REFERENCES.has(agent.credentialReference ?? '')
        ? agent.credentialReference
        : null,
      settings: this.sanitizeSettings(agent.settings),
      configs: agent.configs?.map((config) => ({
        ...config,
        credentialReference: AGENT_CREDENTIAL_REFERENCES.has(config.credentialReference ?? '')
          ? config.credentialReference
          : null,
        settings: this.sanitizeSettings(config.settings),
      })),
    };
  }

  private sanitizeSettings(value: Record<string, any>) {
    const command = value?.command;
    if (Array.isArray(command) && command.some((argument) =>
      typeof argument === 'string' && this.containsSecretValue(argument))) {
      return { ...value, command: [] };
    }
    return value ?? {};
  }

  private containsSecretValue(value: string) {
    return /AIza[0-9A-Za-z_-]{25,}|sk-(?:ant-)?[A-Za-z0-9_-]{20,}|(?:GEMINI|GOOGLE|OPENAI|ANTHROPIC)_API_KEY\s*=\s*\S+|--?(?:api-key|auth-token|token)(?:=|$)/i
      .test(value);
  }
}
