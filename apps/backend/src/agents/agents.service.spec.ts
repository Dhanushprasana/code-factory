import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Repository } from 'typeorm';
import { AgentConfigEntity } from './entities/agent-config.entity';
import { AgentEntity } from './entities/agent.entity';
import { AgentsService } from './agents.service';

describe('AgentsService', () => {
  let agentRepo: any;
  let configRepo: any;
  let service: AgentsService;

  beforeEach(() => {
    agentRepo = {
      count: jest.fn(),
      find: jest.fn(),
      findOne: jest.fn(),
      create: jest.fn((val) => ({ ...val })),
      save: jest.fn(async (val) => ({ id: 'agent-123', ...val })),
      remove: jest.fn(async (val) => val),
    };
    configRepo = {
      findOne: jest.fn(),
      create: jest.fn((val) => ({ id: 'config-123', ...val })),
      save: jest.fn(async (val) => val),
    };
    service = new AgentsService(
      agentRepo as unknown as Repository<AgentEntity>,
      configRepo as unknown as Repository<AgentConfigEntity>,
    );
  });

  it('creates an agent with defaults and initial config version 1', async () => {
    agentRepo.findOne.mockResolvedValue({
      id: 'agent-123',
      name: 'Claude Code',
      adapterType: 'direct-cli',
      provider: 'Anthropic',
      modelName: 'claude-3-7-sonnet',
      status: 'ready',
      configs: [],
    });

    const result = await service.create({
      name: '  Claude Code  ',
      provider: 'Anthropic',
      modelName: 'claude-3-7-sonnet',
    });

    expect(agentRepo.create).toHaveBeenCalledWith(expect.objectContaining({
      name: 'Claude Code',
      provider: 'Anthropic',
      adapterType: 'direct-cli',
      status: 'ready',
      modelName: 'claude-3-7-sonnet',
    }));
    expect(configRepo.save).toHaveBeenCalled();
    expect(result).toBeDefined();
    expect(result.id).toBe('agent-123');
  });

  it('rejects agent creation with empty name', async () => {
    await expect(service.create({ name: '   ' })).rejects.toThrow(BadRequestException);
  });

  it('accepts a secret environment reference but never accepts a literal API key', async () => {
    agentRepo.findOne.mockResolvedValue({
      id: 'agent-123',
      name: 'Gemini CLI',
      credentialReference: 'GEMINI_API_KEY',
      settings: {},
      configs: [],
    });

    await expect(service.create({
      name: 'Gemini CLI',
      credentialReference: 'GEMINI_API_KEY',
    })).resolves.toMatchObject({ credentialReference: 'GEMINI_API_KEY' });

    await expect(service.create({
      name: 'Unsafe Gemini',
      credentialReference: `AIza${'A'.repeat(30)}`,
    })).rejects.toThrow(BadRequestException);
  });

  it('rejects API keys embedded in an agent command', async () => {
    await expect(service.create({
      name: 'Unsafe Gemini',
      settings: { command: ['gemini', '--api-key', `AIza${'A'.repeat(30)}`] },
    })).rejects.toThrow(BadRequestException);
  });

  it('redacts invalid stored credential references and command arguments from API responses', async () => {
    agentRepo.findOne.mockResolvedValue({
      id: 'agent-123',
      name: 'Legacy Agent',
      credentialReference: `AIza${'A'.repeat(30)}`,
      settings: { command: ['gemini', '--api-key', `AIza${'A'.repeat(30)}`] },
      configs: [],
    });

    await expect(service.get('agent-123')).resolves.toMatchObject({
      credentialReference: null,
      settings: { command: [] },
    });
  });

  it('lists all agents ordered by createdAt DESC', async () => {
    agentRepo.find.mockResolvedValue([
      { id: '1', name: 'Agent 1' },
      { id: '2', name: 'Agent 2' },
    ]);

    const result = await service.list();
    expect(result).toHaveLength(2);
    expect(agentRepo.find).toHaveBeenCalledWith({
      relations: ['configs'],
      order: { createdAt: 'DESC' },
    });
  });

  it('retrieves an agent by id', async () => {
    agentRepo.findOne.mockResolvedValue({ id: 'agent-123', name: 'Agent 1' });
    const result = await service.get('agent-123');
    expect(result.name).toBe('Agent 1');
  });

  it('throws NotFoundException when agent does not exist', async () => {
    agentRepo.findOne.mockResolvedValue(null);
    await expect(service.get('non-existent')).rejects.toThrow(NotFoundException);
  });

  it('updates an agent and creates a new config version if model changed', async () => {
    const existingAgent = {
      id: 'agent-123',
      name: 'Old Name',
      modelName: 'gpt-4o',
      status: 'ready',
      settings: {},
    };
    agentRepo.findOne
      .mockResolvedValueOnce(existingAgent)
      .mockResolvedValueOnce({ ...existingAgent, name: 'New Name', modelName: 'gpt-4.5' });

    configRepo.findOne.mockResolvedValue({ configVersion: 1 });

    const result = await service.update('agent-123', {
      name: 'New Name',
      modelName: 'gpt-4.5',
    });

    expect(agentRepo.save).toHaveBeenCalled();
    expect(configRepo.create).toHaveBeenCalledWith(expect.objectContaining({
      agentId: 'agent-123',
      configVersion: 2,
      modelName: 'gpt-4.5',
    }));
    expect(result.name).toBe('New Name');
  });

  it('seeds built-in agents with Harbor adapters and migrates legacy direct-CLI profiles', async () => {
    const legacyGemini = {
      id: 'gemini-agent',
      name: 'Gemini CLI',
      adapterType: 'direct-cli',
      provider: 'Google AI Studio',
      modelName: 'gemini-3.1-flash-lite',
      status: 'ready',
      settings: { command: ['npx', 'gemini'] },
    };
    agentRepo.findOne.mockImplementation(async ({ where }) => (
      where.name === 'Gemini CLI' ? legacyGemini : null
    ));
    agentRepo.find.mockResolvedValue([]);
    const updateAgent = jest.spyOn(service, 'update').mockResolvedValue({} as AgentEntity);
    const createAgent = jest.spyOn(service, 'create').mockResolvedValue({} as AgentEntity);

    await service.seedDefaults();

    expect(updateAgent).toHaveBeenCalledWith('gemini-agent', expect.objectContaining({
      adapterType: 'harbor',
      modelName: 'gemini-3.1-flash-lite',
      credentialReference: 'GEMINI_API_KEY',
      settings: expect.objectContaining({ harborAgent: 'gemini-cli' }),
    }));
    expect(createAgent).toHaveBeenCalledWith(expect.objectContaining({
      name: 'Antigravity',
      adapterType: 'harbor',
      credentialReference: 'GEMINI_API_KEY',
      settings: expect.objectContaining({ harborAgent: 'antigravity-cli' }),
    }));
    expect(createAgent).toHaveBeenCalledWith(expect.objectContaining({
      name: 'Claude Code',
      adapterType: 'harbor',
      status: 'offline',
      credentialReference: 'ANTHROPIC_API_KEY',
      settings: expect.objectContaining({ harborAgent: 'claude-code' }),
    }));
    expect(createAgent).toHaveBeenCalledWith(expect.objectContaining({
      name: 'OpenAI Codex',
      adapterType: 'harbor',
      status: 'offline',
      credentialReference: 'OPENAI_API_KEY',
      settings: expect.objectContaining({ harborAgent: 'codex' }),
    }));
  });

  it('deletes an agent', async () => {
    const existingAgent = { id: 'agent-123', name: 'To Delete' };
    agentRepo.findOne.mockResolvedValue(existingAgent);

    const result = await service.delete('agent-123');
    expect(agentRepo.remove).toHaveBeenCalledWith(existingAgent);
    expect(result).toEqual({ deleted: true, id: 'agent-123' });
  });
});
