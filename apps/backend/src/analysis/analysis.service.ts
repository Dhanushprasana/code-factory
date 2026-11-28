import { Injectable, Logger, NotFoundException, Optional, ServiceUnavailableException, BadRequestException } from '@nestjs/common';
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
import { AnalyzedChunkInput, AnalyzedGraphInput, VectorContextService } from './vector-context.service';

interface AnalysisServiceResponse {
  operation_id: string;
  status: string;
  summary: Record<string, unknown>;
  report: Record<string, unknown>;
  chunks?: AnalyzedChunkInput[];
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
    @Optional()
    private readonly vectorContext?: VectorContextService,
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
        analyzerVersion: '0.1.1',
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
      if (this.vectorContext) {
        try {
          await this.vectorContext.persistAnalysisContext({
            repositoryId: repository.id,
            snapshotId: snapshot.id,
            commitSha: analysis.commitSha,
            chunks: result.chunks,
            graph: result.report.graph as AnalyzedGraphInput | undefined,
          });
          const hasOpenRouter = Boolean(this.config.get<string>('OPENROUTER_API_KEY')?.trim());
          const configuredProvider = this.config.get<string>('ANALYSIS_FEATURE_PROVIDER')?.trim();
          if (hasOpenRouter || configuredProvider === 'openrouter' || configuredProvider === 'ollama') {
            try {
              await this.extractFeaturesWithLlm(analysis.id, {
                provider: configuredProvider || (hasOpenRouter ? 'openrouter' : 'ollama'),
              });
            } catch (featureError) {
              this.logger.warn(
                `Could not run automatic LLM feature extraction for analysis ${analysis.id}: ${
                  featureError instanceof Error ? featureError.message : String(featureError)
                }`,
              );
            }
          }
        } catch (vectorError) {
          this.logger.warn(
            `Could not persist vector/graph context for snapshot ${snapshot.id}: ${
              vectorError instanceof Error ? vectorError.message : String(vectorError)
            }`,
          );
        }
      }
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

  async extractFeaturesWithLlm(
    analysisId: string,
    input: { provider?: unknown } | null = {},
  ) {
    const analysis = await this.findAnalysis(analysisId);
    if (analysis.status !== 'completed' || !analysis.summary || !analysis.report) {
      throw new BadRequestException('Repository analysis must be completed before extracting AI features.');
    }
    if (!this.vectorContext) {
      throw new ServiceUnavailableException('Vector context storage is not available.');
    }
    const requestedProvider = input?.provider;
    let provider: 'openrouter' | 'ollama';
    if (requestedProvider === 'openrouter' || requestedProvider === 'ollama') {
      provider = requestedProvider;
    } else if (requestedProvider !== undefined) {
      throw new BadRequestException('Provider must be openrouter or ollama.');
    } else {
      provider = this.config.get<string>('OPENROUTER_API_KEY')?.trim() ? 'openrouter' : 'ollama';
    }

    const repository = await this.repositories.findOneBy({ id: analysis.repositoryId });
    const overviewChunks = await this.vectorContext.retrieveSnapshotOverviewChunks(analysis.snapshotId, 140);
    const vectorChunks = overviewChunks.length
      ? overviewChunks
      : (await this.vectorContext.retrieveSemanticChunks({
        snapshotIds: [analysis.snapshotId],
        queryText: 'repository overview core features public API modules commands schemas serialization validation',
        limit: 80,
      }))[analysis.snapshotId] ?? [];
    if (!vectorChunks.length) {
      throw new BadRequestException(
        'No vector code chunks are stored for this snapshot yet. Re-run repository analysis first.',
      );
    }

    const reportSymbols = Array.isArray(analysis.report.symbols) ? analysis.report.symbols : [];
    const nonCorePattern = /(^|\/)(bench|benchmarks|typia-case|website|apps\/docs|examples|fixtures)(\/|$)|(\.test\.|\.spec\.|__tests__)/i;
    const publicApiSymbols = Array.from(new Set(
      reportSymbols
        .filter((sym): sym is Record<string, unknown> => (
          typeof sym === 'object' && sym !== null && typeof sym.file_path === 'string' && !nonCorePattern.test(sym.file_path)
        ))
        .sort((a, b) => Number(Boolean(b.exported)) - Number(Boolean(a.exported)))
        .map((sym) => String(sym.name ?? '').trim())
        .filter((name) => name.length > 1),
    )).slice(0, 250);
    const summaryWithApis = {
      ...analysis.summary,
      public_api_symbols: publicApiSymbols,
    };

    const serviceUrl = this.config.get<string>('AI_SERVICE_URL', 'http://localhost:8000')
      .replace(/\/+$/, '');
    const response = await fetch(`${serviceUrl}/api/v1/analysis/features`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        repository_id: analysis.repositoryId,
        snapshot_id: analysis.snapshotId,
        commit_sha: analysis.commitSha,
        repository_name: repository?.fullName ?? analysis.repositoryId,
        provider,
        summary: summaryWithApis,
        vector_chunks: vectorChunks,
      }),
      signal: AbortSignal.timeout(120_000),
    });
    if (!response.ok) {
      const detail = await response.text();
      throw new BadRequestException(
        `AI service returned HTTP ${response.status}${detail ? `: ${detail.slice(0, 400)}` : ''}.`,
      );
    }
    const payload = await response.json() as {
      repository_overview?: string;
      features?: Array<Record<string, unknown>>;
      provider?: string;
      model?: string;
    };

    let featureInventory: Array<Record<string, unknown>> = [];
    try {
      const invResponse = await fetch(`${serviceUrl}/api/v1/analysis/inventory`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          repository_id: analysis.repositoryId,
          snapshot_id: analysis.snapshotId,
          commit_sha: analysis.commitSha,
          repository_name: repository?.fullName ?? analysis.repositoryId,
          provider,
          summary: summaryWithApis,
          vector_chunks: vectorChunks,
        }),
        signal: AbortSignal.timeout(120_000),
      });
      if (invResponse.ok) {
        const invPayload = await invResponse.json() as { inventory?: Array<Record<string, unknown>> };
        featureInventory = Array.isArray(invPayload.inventory) ? invPayload.inventory : [];
      }
    } catch (invError) {
      this.logger.warn(
        `Could not extract feature inventory for analysis ${analysisId}: ${
          invError instanceof Error ? invError.message : String(invError)
        }`,
      );
    }

    const nextSummary = {
      ...analysis.summary,
      ai_repository_overview: payload.repository_overview,
      ai_existing_features: payload.features ?? [],
      ai_feature_inventory: featureInventory,
      ai_features_provider: payload.provider ?? provider,
      ai_features_model: payload.model ?? null,
    };
    const nextReport = {
      ...analysis.report,
      ai_repository_overview: payload.repository_overview,
      ai_existing_features: payload.features ?? [],
      ai_feature_inventory: featureInventory,
    };
    analysis.summary = nextSummary;
    analysis.report = nextReport;
    return this.analyses.save(analysis);
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
    const hasNode = fs.existsSync(path.join(checkoutPath, 'package.json'));
    const hasPython = fs.existsSync(path.join(checkoutPath, 'pyproject.toml'))
      || fs.existsSync(path.join(checkoutPath, 'requirements.txt'))
      || fs.existsSync(path.join(checkoutPath, 'setup.py'));
    const hasCpp = fs.existsSync(path.join(checkoutPath, 'CMakeLists.txt'))
      || fs.existsSync(path.join(checkoutPath, 'meson.build'))
      || fs.existsSync(path.join(checkoutPath, 'Makefile'));
    if (hasNode && !hasPython && !hasCpp) {
      return 'node-typescript';
    }
    if (hasPython && !hasNode && !hasCpp) {
      return 'python';
    }
    if (hasCpp && !hasNode && !hasPython) {
      return 'cpp';
    }
    return 'mixed';
  }

  private errorMessage(error: unknown) {
    return error instanceof Error ? error.message : String(error);
  }
}
