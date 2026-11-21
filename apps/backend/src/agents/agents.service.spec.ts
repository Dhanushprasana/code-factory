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

  it('deletes an agent', async () => {
    const existingAgent = { id: 'agent-123', name: 'To Delete' };
    agentRepo.findOne.mockResolvedValue(existingAgent);

    const result = await service.delete('agent-123');
    expect(agentRepo.remove).toHaveBeenCalledWith(existingAgent);
    expect(result).toEqual({ deleted: true, id: 'agent-123' });
  });
});
