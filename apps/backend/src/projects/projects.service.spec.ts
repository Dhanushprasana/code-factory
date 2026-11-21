import { BadRequestException } from '@nestjs/common';
import { Repository } from 'typeorm';
import { ProjectRepositoryEntity } from '../repositories/entities/project-repository.entity';
import { ProjectEntity } from './entities/project.entity';
import { ProjectsService } from './projects.service';

describe('ProjectsService', () => {
  it('creates a project with a normalized name and description', async () => {
    const projects = {
      create: jest.fn((value) => value),
      save: jest.fn(async (value) => ({ id: 'project-id', ...value })),
    };
    const service = new ProjectsService(
      projects as unknown as Repository<ProjectEntity>,
      {} as Repository<ProjectRepositoryEntity>,
    );

    await expect(service.create({ name: '  Checkout  ', description: '  benchmark  ' }))
      .resolves.toMatchObject({ name: 'Checkout', description: 'benchmark' });
  });

  it('requires a non-empty project name', async () => {
    const service = new ProjectsService(
      {} as Repository<ProjectEntity>,
      {} as Repository<ProjectRepositoryEntity>,
    );

    await expect(service.create({ name: '  ' })).rejects.toThrow(BadRequestException);
  });
});
