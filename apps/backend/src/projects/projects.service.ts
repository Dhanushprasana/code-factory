import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ProjectEntity } from './entities/project.entity';
import { ProjectRepositoryEntity } from '../repositories/entities/project-repository.entity';

@Injectable()
export class ProjectsService {
  constructor(
    @InjectRepository(ProjectEntity)
    private readonly projects: Repository<ProjectEntity>,
    @InjectRepository(ProjectRepositoryEntity)
    private readonly projectRepositories: Repository<ProjectRepositoryEntity>,
  ) {}

  async list() {
    return this.projects.find({ order: { createdAt: 'DESC' } });
  }

  async counts() {
    const [totalProjects, repositoryCount] = await Promise.all([
      this.projects.count(),
      this.projectRepositories
        .createQueryBuilder('projectRepository')
        .select('COUNT(DISTINCT projectRepository.repositoryId)', 'count')
        .getRawOne<{ count: string }>(),
    ]);
    return { totalProjects, repositoriesConnected: Number(repositoryCount?.count ?? 0) };
  }

  async create(input: { name?: string; description?: string }) {
    const name = typeof input.name === 'string' ? input.name.trim() : '';
    if (!name) {
      throw new BadRequestException('Project name is required.');
    }
    return this.projects.save(this.projects.create({
      name,
      description: input.description?.trim() ?? '',
    }));
  }

  async get(id: string) {
    const project = await this.projects.findOne({ where: { id } });
    if (!project) {
      throw new NotFoundException(`Project ${id} was not found.`);
    }
    return project;
  }

  async update(id: string, input: { name?: string; description?: string; status?: string }) {
    const project = await this.get(id);
    if (input.name !== undefined) {
      if (typeof input.name !== 'string') {
        throw new BadRequestException('Project name must be a string.');
      }
      const name = input.name.trim();
      if (!name) {
        throw new BadRequestException('Project name cannot be empty.');
      }
      project.name = name;
    }
    if (input.description !== undefined) {
      if (typeof input.description !== 'string') {
        throw new BadRequestException('Project description must be a string.');
      }
      project.description = input.description.trim();
    }
    if (input.status !== undefined) {
      project.status = input.status;
    }
    return this.projects.save(project);
  }

  async delete(id: string) {
    const project = await this.get(id);
    await this.projects.remove(project);
    return { deleted: true, id };
  }

  async assertExists(id: string) {
    await this.get(id);
  }
}
