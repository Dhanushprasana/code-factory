import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';

export interface AnalyzedChunkInput {
  file_path: string;
  symbol_name?: string | null;
  chunk_type: string;
  language?: string | null;
  module_name?: string | null;
  start_line: number;
  end_line: number;
  content: string;
  embedding?: number[] | null;
  embedding_model?: string | null;
  embedding_dim?: number | null;
  metadata?: Record<string, unknown>;
}

export interface AnalyzedGraphInput {
  nodes?: Array<{
    id: string;
    type: string;
    name: string;
    file_path?: string | null;
    start_line?: number;
    end_line?: number;
  }>;
  edges?: Array<{
    source: string;
    target: string;
    type: string;
  }>;
}

export interface RetrievedVectorChunk {
  repository_id: string;
  snapshot_id: string;
  commit_sha: string;
  file_path: string;
  symbol_name: string | null;
  chunk_type: string;
  language: string | null;
  module_name: string | null;
  start_line: number;
  end_line: number;
  content: string;
  similarity: number;
  metadata: Record<string, unknown>;
}

@Injectable()
export class VectorContextService {
  private readonly logger = new Logger(VectorContextService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly config: ConfigService,
  ) {}

  async persistAnalysisContext(input: {
    repositoryId: string;
    snapshotId: string;
    commitSha: string;
    chunks?: AnalyzedChunkInput[];
    graph?: AnalyzedGraphInput;
  }): Promise<void> {
    const chunks = Array.isArray(input.chunks) ? input.chunks : [];
    const nodes = Array.isArray(input.graph?.nodes) ? input.graph.nodes : [];
    const edges = Array.isArray(input.graph?.edges) ? input.graph.edges : [];
    if (chunks.length === 0 && nodes.length === 0 && edges.length === 0) {
      return;
    }

    await this.dataSource.transaction(async (manager) => {
      await manager.query(`DELETE FROM "code_chunks" WHERE "snapshot_id" = $1`, [input.snapshotId]);
      await manager.query(`DELETE FROM "repository_edges" WHERE "snapshot_id" = $1`, [input.snapshotId]);
      await manager.query(`DELETE FROM "repository_nodes" WHERE "snapshot_id" = $1`, [input.snapshotId]);

      const nodeBatchSize = 200;
      for (let i = 0; i < nodes.length; i += nodeBatchSize) {
        const batch = nodes.slice(i, i + nodeBatchSize);
        const values: unknown[] = [];
        const placeholders: string[] = [];
        batch.forEach((node, index) => {
          const offset = index * 6;
          placeholders.push(
            `($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}, $${offset + 5}, $${offset + 6}::jsonb)`,
          );
          values.push(
            input.snapshotId,
            String(node.id).slice(0, 512),
            String(node.type || 'unknown').slice(0, 64),
            String(node.name || 'unknown').slice(0, 255),
            node.file_path ?? null,
            JSON.stringify({
              ...(node.start_line !== undefined ? { start_line: node.start_line } : {}),
              ...(node.end_line !== undefined ? { end_line: node.end_line } : {}),
            }),
          );
        });
        await manager.query(
          `INSERT INTO "repository_nodes" ("snapshot_id", "external_id", "node_type", "name", "file_path", "metadata")
           VALUES ${placeholders.join(', ')}
           ON CONFLICT ("snapshot_id", "external_id") DO NOTHING`,
          values,
        );
      }

      const edgeBatchSize = 250;
      for (let i = 0; i < edges.length; i += edgeBatchSize) {
        const batch = edges.slice(i, i + edgeBatchSize);
        const values: unknown[] = [];
        const placeholders: string[] = [];
        batch.forEach((edge, index) => {
          const offset = index * 4;
          placeholders.push(`($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4})`);
          values.push(
            input.snapshotId,
            String(edge.source).slice(0, 512),
            String(edge.target).slice(0, 512),
            String(edge.type || 'related').slice(0, 64),
          );
        });
        await manager.query(
          `INSERT INTO "repository_edges" ("snapshot_id", "source_external_id", "target_external_id", "relationship_type")
           VALUES ${placeholders.join(', ')}`,
          values,
        );
      }

      const chunkBatchSize = 50;
      const fieldsPerChunk = 15;
      for (let i = 0; i < chunks.length; i += chunkBatchSize) {
        const batch = chunks.slice(i, i + chunkBatchSize);
        const values: unknown[] = [];
        const placeholders: string[] = [];
        batch.forEach((chunk, index) => {
          const offset = index * fieldsPerChunk;
          const validEmbedding = Array.isArray(chunk.embedding)
            && chunk.embedding.length > 0
            && chunk.embedding.every((value) => typeof value === 'number' && Number.isFinite(value));
          const vectorLiteral = validEmbedding ? `[${chunk.embedding!.join(',')}]` : null;
          const dim = validEmbedding ? chunk.embedding!.length : null;
          placeholders.push(
            `($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}, $${offset + 5}, ` +
            `$${offset + 6}, $${offset + 7}, $${offset + 8}, $${offset + 9}, $${offset + 10}, ` +
            `$${offset + 11}, $${offset + 12}::vector, $${offset + 13}, $${offset + 14}, $${offset + 15}::jsonb)`,
          );
          values.push(
            input.repositoryId,
            input.snapshotId,
            input.commitSha,
            String(chunk.file_path),
            chunk.symbol_name ? String(chunk.symbol_name).slice(0, 255) : null,
            String(chunk.chunk_type || 'symbol').slice(0, 64),
            chunk.language ? String(chunk.language).slice(0, 64) : null,
            chunk.module_name ? String(chunk.module_name).slice(0, 255) : null,
            Math.max(1, Number(chunk.start_line) || 1),
            Math.max(1, Number(chunk.end_line) || 1),
            String(chunk.content ?? ''),
            vectorLiteral,
            chunk.embedding_model ? String(chunk.embedding_model).slice(0, 128) : null,
            dim,
            JSON.stringify(chunk.metadata ?? {}),
          );
        });
        await manager.query(
          `INSERT INTO "code_chunks" (
             "repository_id", "snapshot_id", "commit_sha", "file_path", "symbol_name",
             "chunk_type", "language", "module_name", "start_line", "end_line",
             "content", "embedding", "embedding_model", "embedding_dim", "metadata"
           ) VALUES ${placeholders.join(', ')}`,
          values,
        );
      }
    });
  }

  async retrieveSemanticChunks(input: {
    snapshotIds: string[];
    queryText: string;
    limit?: number;
  }): Promise<Record<string, RetrievedVectorChunk[]>> {
    const snapshotIds = [...new Set(input.snapshotIds.filter(Boolean))];
    if (!snapshotIds.length || !input.queryText.trim()) {
      return {};
    }

    const limit = Math.min(80, Math.max(10, input.limit ?? 36));
    const embedded = await this.embedQuery(input.queryText);
    const bySnapshot: Record<string, RetrievedVectorChunk[]> = {};

    try {
      if (embedded && embedded.vector.length > 0) {
        const vectorLiteral = `[${embedded.vector.join(',')}]`;
        const rows = await this.dataSource.query(
          `SELECT
             "repository_id",
             "snapshot_id",
             "commit_sha",
             "file_path",
             "symbol_name",
             "chunk_type",
             "language",
             "module_name",
             "start_line",
             "end_line",
             "content",
             "metadata",
             1 - ("embedding" <=> $1::vector) AS similarity
           FROM "code_chunks"
           WHERE "snapshot_id" = ANY($2::uuid[])
             AND "embedding" IS NOT NULL
             AND "embedding_dim" = $3
           ORDER BY "embedding" <=> $1::vector ASC
           LIMIT $4`,
          [vectorLiteral, snapshotIds, embedded.vector.length, limit],
        ) as Array<Record<string, unknown>>;

        for (const row of rows) {
          const snapshotId = String(row.snapshot_id);
          bySnapshot[snapshotId] ??= [];
          bySnapshot[snapshotId].push({
            repository_id: String(row.repository_id),
            snapshot_id: snapshotId,
            commit_sha: String(row.commit_sha),
            file_path: String(row.file_path),
            symbol_name: typeof row.symbol_name === 'string' ? row.symbol_name : null,
            chunk_type: String(row.chunk_type ?? 'symbol'),
            language: typeof row.language === 'string' ? row.language : null,
            module_name: typeof row.module_name === 'string' ? row.module_name : null,
            start_line: Number(row.start_line) || 1,
            end_line: Number(row.end_line) || 1,
            content: String(row.content ?? ''),
            similarity: Number(row.similarity) || 0,
            metadata: (row.metadata && typeof row.metadata === 'object'
              ? row.metadata
              : {}) as Record<string, unknown>,
          });
        }
      }

      const missingSnapshots = snapshotIds.filter((id) => !(bySnapshot[id]?.length));
      if (missingSnapshots.length > 0) {
        const fallbackRows = await this.dataSource.query(
          `SELECT
             "repository_id",
             "snapshot_id",
             "commit_sha",
             "file_path",
             "symbol_name",
             "chunk_type",
             "language",
             "module_name",
             "start_line",
             "end_line",
             "content",
             "metadata"
           FROM "code_chunks"
           WHERE "snapshot_id" = ANY($1::uuid[])
           ORDER BY
             CASE WHEN "chunk_type" IN ('doc', 'module', 'test') THEN 0 ELSE 1 END,
             "created_at" ASC
           LIMIT $2`,
          [missingSnapshots, limit],
        ) as Array<Record<string, unknown>>;

        for (const row of fallbackRows) {
          const snapshotId = String(row.snapshot_id);
          bySnapshot[snapshotId] ??= [];
          bySnapshot[snapshotId].push({
            repository_id: String(row.repository_id),
            snapshot_id: snapshotId,
            commit_sha: String(row.commit_sha),
            file_path: String(row.file_path),
            symbol_name: typeof row.symbol_name === 'string' ? row.symbol_name : null,
            chunk_type: String(row.chunk_type ?? 'symbol'),
            language: typeof row.language === 'string' ? row.language : null,
            module_name: typeof row.module_name === 'string' ? row.module_name : null,
            start_line: Number(row.start_line) || 1,
            end_line: Number(row.end_line) || 1,
            content: String(row.content ?? ''),
            similarity: 0.25,
            metadata: (row.metadata && typeof row.metadata === 'object'
              ? row.metadata
              : {}) as Record<string, unknown>,
          });
        }
      }
    } catch (error) {
      this.logger.warn(
        `pgvector retrieval skipped: ${error instanceof Error ? error.message : String(error)}`,
      );
      return {};
    }

    return bySnapshot;
  }

  async retrieveSnapshotOverviewChunks(
    snapshotId: string,
    maxChunks = 140,
  ): Promise<RetrievedVectorChunk[]> {
    if (!snapshotId) {
      return [];
    }
    const limit = Math.min(200, Math.max(20, maxChunks));
    try {
      const rows = await this.dataSource.query(
        `SELECT
           "repository_id",
           "snapshot_id",
           "commit_sha",
           "file_path",
           "symbol_name",
           "chunk_type",
           "language",
           "module_name",
           "start_line",
           "end_line",
           "content",
           "metadata"
         FROM "code_chunks"
         WHERE "snapshot_id" = $1::uuid
         ORDER BY
           CASE
             WHEN "file_path" ~* '(^|/)(bench|benchmarks|typia-case|website|apps/docs|examples|fixtures)(/|$)' THEN 2
             WHEN "chunk_type" = 'test' OR "file_path" ~* '(\\.test\\.|\\.spec\\.|__tests__|/tests?/)' THEN 1
             ELSE 0
           END ASC,
           CASE WHEN "chunk_type" IN ('doc', 'module') THEN 0 ELSE 1 END ASC,
           "created_at" ASC
         LIMIT $2`,
        [snapshotId, limit],
      ) as Array<Record<string, unknown>>;

      return rows.map((row) => ({
        repository_id: String(row.repository_id),
        snapshot_id: String(row.snapshot_id),
        commit_sha: String(row.commit_sha),
        file_path: String(row.file_path),
        symbol_name: typeof row.symbol_name === 'string' ? row.symbol_name : null,
        chunk_type: String(row.chunk_type ?? 'symbol'),
        language: typeof row.language === 'string' ? row.language : null,
        module_name: typeof row.module_name === 'string' ? row.module_name : null,
        start_line: Number(row.start_line) || 1,
        end_line: Number(row.end_line) || 1,
        content: String(row.content ?? ''),
        similarity: 0.5,
        metadata: (row.metadata && typeof row.metadata === 'object'
          ? row.metadata
          : {}) as Record<string, unknown>,
      }));
    } catch (error) {
      this.logger.warn(
        `Snapshot overview chunk retrieval skipped: ${error instanceof Error ? error.message : String(error)}`,
      );
      return [];
    }
  }

  private async embedQuery(text: string): Promise<{ vector: number[]; model: string } | null> {
    const serviceUrl = this.config.get<string>('AI_SERVICE_URL', 'http://localhost:8000')
      .replace(/\/+$/, '');
    try {
      const response = await fetch(`${serviceUrl}/api/v1/embeddings`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ texts: [text.slice(0, 4000)] }),
        signal: AbortSignal.timeout(15_000),
      });
      if (!response.ok) {
        return null;
      }
      const payload = await response.json() as {
        embeddings?: number[][];
        model?: string;
      };
      const vector = payload.embeddings?.[0];
      if (!Array.isArray(vector) || vector.length === 0) {
        return null;
      }
      return { vector, model: payload.model ?? 'unknown' };
    } catch {
      return null;
    }
  }
}
