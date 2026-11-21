import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { ConfigService } from '@nestjs/config';
import { Queue } from 'bullmq';
import * as fs from 'fs';
import * as path from 'path';
import { In, Repository } from 'typeorm';
import { InjectRepository } from '@nestjs/typeorm';
import { RepositoryAnalysisEntity } from './entities/repository-analysis.entity';
import { RepositoryEntity } from '../repositories/entities/repository.entity';
import { RepositorySnapshotEntity } from '../repositories/entities/repository-snapshot.entity';

interface AnalysisServiceResponse {
  operation_id: string;
  status: string;
  summary: Record<string, unknown>;
  report: Record<string, unknown>;
  warnings: string[];
}

@Injectable()
export class AnalysisService {
  private readonly logger = new Logger(AnalysisService.name);
  private readonly storagePath = process.env.ARTIFACT_STORAGE_PATH
    ? path.resolve(__dirname, '../../../../', process.env.ARTIFACT_STORAGE_PATH)
    : path.resolve(__dirname, '../../../../storage');

  constructor(
    @InjectQueue('repository-analysis')
    private readonly analysisQueue: Queue,
    private readonly config: ConfigService,
    @InjectRepository(RepositoryAnalysisEntity)
    private readonly analyses: Repository<RepositoryAnalysisEntity>,
    @InjectRepository(RepositoryEntity)
    private readonly repositories: Repository<RepositoryEntity>,
    @InjectRepository(RepositorySnapshotEntity)
    private readonly snapshots: Repository<RepositorySnapshotEntity>,
  ) {}

  async startAnalysis(
    repositoryId: string,
    input: { commitSha?: unknown } | null = {},
  ) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
      throw new BadRequestException('Analysis request body must be an object.');
    }
    const repository = await this.repositories.findOneBy({ id: repositoryId });
    if (!repository) {
      throw new NotFoundException('Repository was not found.');
    }

    if (input.commitSha !== undefined && typeof input.commitSha !== 'string') {
      throw new BadRequestException('Commit must be a hexadecimal Git SHA.');
    }
    const requestedSha = typeof input.commitSha === 'string' ? input.commitSha.trim() : '';
    if (requestedSha && !/^[a-f0-9]{7,40}$/i.test(requestedSha)) {
      throw new BadRequestException('Commit must be a hexadecimal Git SHA.');
    }
    const snapshot = await this.findReadySnapshot(repositoryId, requestedSha);
    if (!snapshot) {
      throw new BadRequestException(
        'Clone a ready snapshot for this repository and commit before starting analysis.',
      );
    }
    if (!snapshot.checkoutPath || !fs.existsSync(snapshot.checkoutPath)) {
      throw new BadRequestException('The ready snapshot checkout is no longer available.');
    }

    const active = await this.analyses.findOne({
      where: { snapshotId: snapshot.id, status: In(['queued', 'running']) },
      order: { createdAt: 'DESC' },
    });
    if (active) {
      return this.toAnalysisSummary(active);
    }

    const analysis = await this.analyses.save(
      this.analyses.create({
        repositoryId,
        snapshotId: snapshot.id,
        commitSha: snapshot.commitSha,
        status: 'queued',
        analyzerVersion: '0.1.0',
        warnings: [],
      }),
    );
    try {
      await this.analysisQueue.add(
        'analyze',
        { analysisId: analysis.id },
        { jobId: analysis.id, attempts: 1, removeOnComplete: 100, removeOnFail: 100 },
      );
    } catch (error) {
      analysis.status = 'failed';
      analysis.errorMessage = this.errorMessage(error);
      await this.analyses.save(analysis);
      this.logger.error(
        `Could not enqueue analysis ${analysis.id}.`,
        error instanceof Error ? error.stack : undefined,
      );
      throw new ServiceUnavailableException(
        'Repository analysis could not be queued. Check the Redis connection and try again.',
      );
    }
    return this.toAnalysisSummary(analysis);
  }

  async listForRepository(repositoryId: string) {
    const repository = await this.repositories.findOneBy({ id: repositoryId });
    if (!repository) {
      throw new NotFoundException('Repository was not found.');
    }
    const analyses = await this.analyses.find({
      where: { repositoryId },
      order: { createdAt: 'DESC' },
      take: 100,
    });
    return analyses.map((analysis) => this.toAnalysisSummary(analysis));
  }

  async getAnalysis(analysisId: string) {
    const analysis = await this.findAnalysis(analysisId);
    return {
      ...this.toAnalysisSummary(analysis),
      summary: analysis.summary,
      report: analysis.report,
      warnings: analysis.warnings,
      errorMessage: analysis.errorMessage,
      updatedAt: analysis.updatedAt,
    };
  }

  async getSummary(analysisId: string) {
    const analysis = await this.findAnalysis(analysisId);
    if (analysis.status !== 'completed' || !analysis.summary) {
      throw new BadRequestException('The analysis summary is not available yet.');
    }
    return { analysisId, summary: analysis.summary, warnings: analysis.warnings };
  }

  async getGraph(analysisId: string) {
    const analysis = await this.findAnalysis(analysisId);
    if (analysis.status !== 'completed' || !analysis.report) {
      throw new BadRequestException('The analysis graph is not available yet.');
    }
    const graph = analysis.report.graph;
    return { analysisId, graph: graph ?? { nodes: [], edges: [] } };
  }

  async processAnalysis(analysisId: string): Promise<void> {
    const analysis = await this.findAnalysis(analysisId);
    if (analysis.status === 'completed') {
      return;
    }
    analysis.status = 'running';
    analysis.errorMessage = null;
    await this.analyses.save(analysis);

    try {
      const snapshot = await this.snapshots
        .createQueryBuilder('snapshot')
        .addSelect('snapshot.checkoutPath')
        .where('snapshot.id = :snapshotId', { snapshotId: analysis.snapshotId })
        .andWhere('snapshot.repositoryId = :repositoryId', {
          repositoryId: analysis.repositoryId,
        })
        .andWhere('snapshot.status = :status', { status: 'ready' })
        .getOne();
      if (!snapshot?.checkoutPath || !fs.existsSync(snapshot.checkoutPath)) {
        throw new Error('The ready repository snapshot checkout is unavailable.');
      }
      this.assertStoragePath(snapshot.checkoutPath);
      const repository = await this.repositories.findOneBy({ id: analysis.repositoryId });
      if (!repository) {
        throw new Error('The analyzed repository record no longer exists.');
      }

      const serviceUrl = this.config.get<string>('AI_SERVICE_URL', 'http://localhost:8000')
        .replace(/\/+$/, '');
      const response = await fetch(`${serviceUrl}/api/v1/analyze`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          operation_id: analysis.id,
          repository_id: repository.id,
          snapshot_id: snapshot.id,
          commit_sha: analysis.commitSha,
          repository_path: snapshot.checkoutPath,
          ecosystem: this.inferEcosystem(snapshot.checkoutPath),
        }),
        signal: AbortSignal.timeout(10 * 60 * 1000),
      });
      if (!response.ok) {
        const detail = await response.text();
        throw new Error(
          `AI service returned HTTP ${response.status}${detail ? `: ${detail.slice(0, 500)}` : ''}.`,
        );
      }
      const result = await response.json() as AnalysisServiceResponse;
      if (
        result.status !== 'completed'
        || !result.summary
        || typeof result.summary !== 'object'
        || !result.report
        || typeof result.report !== 'object'
      ) {
        throw new Error('AI service returned an invalid or incomplete analysis response.');
      }
      analysis.summary = result.summary;
      analysis.report = result.report;
      analysis.warnings = Array.isArray(result.warnings) ? result.warnings : [];
      analysis.status = 'completed';
      analysis.errorMessage = null;
      await this.analyses.save(analysis);
    } catch (error) {
      analysis.status = 'failed';
      analysis.errorMessage = this.errorMessage(error);
      await this.analyses.save(analysis);
      this.logger.error(
        `Repository analysis ${analysis.id} failed: ${analysis.errorMessage}`,
        error instanceof Error ? error.stack : undefined,
      );
      throw error;
    }
  }

  private async findReadySnapshot(repositoryId: string, commitSha?: string) {
    const query = this.snapshots
      .createQueryBuilder('snapshot')
      .addSelect('snapshot.checkoutPath')
      .where('snapshot.repositoryId = :repositoryId', { repositoryId })
      .andWhere('snapshot.status = :status', { status: 'ready' });
    if (commitSha) {
      query.andWhere('LOWER(snapshot.commitSha) = LOWER(:commitSha)', { commitSha });
    }
    return query.orderBy('snapshot.capturedAt', 'DESC').getOne();
  }

  private async findAnalysis(analysisId: string) {
    const analysis = await this.analyses.findOneBy({ id: analysisId });
    if (!analysis) {
      throw new NotFoundException('Repository analysis was not found.');
    }
    return analysis;
  }

  private toAnalysisSummary(analysis: RepositoryAnalysisEntity) {
    return {
      id: analysis.id,
      repositoryId: analysis.repositoryId,
      snapshotId: analysis.snapshotId,
      commitSha: analysis.commitSha,
      status: analysis.status,
      analyzerVersion: analysis.analyzerVersion,
      createdAt: analysis.createdAt,
      updatedAt: analysis.updatedAt,
    };
  }

  private assertStoragePath(checkoutPath: string) {
    const resolved = path.resolve(checkoutPath);
    const relative = path.relative(this.storagePath, resolved);
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
      throw new Error('Snapshot checkout path is outside the configured artifact storage root.');
    }
  }

  private inferEcosystem(checkoutPath: string) {
    if (fs.existsSync(path.join(checkoutPath, 'package.json'))) {
      return 'node-typescript';
    }
    if (
      fs.existsSync(path.join(checkoutPath, 'pyproject.toml'))
      || fs.existsSync(path.join(checkoutPath, 'requirements.txt'))
    ) {
      return 'python';
    }
    return 'mixed';
  }

  private errorMessage(error: unknown) {
    return error instanceof Error ? error.message : String(error);
  }
}
