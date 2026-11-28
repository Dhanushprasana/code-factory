import { MigrationInterface, QueryRunner } from 'typeorm';

export class VectorAndGraphContext1795280700000 implements MigrationInterface {
  name = 'VectorAndGraphContext1795280700000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS vector`);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "repository_nodes" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "snapshot_id" uuid NOT NULL,
        "external_id" varchar(512) NOT NULL,
        "node_type" varchar(64) NOT NULL,
        "name" varchar(255) NOT NULL,
        "file_path" text,
        "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "pk_repository_nodes_id" PRIMARY KEY ("id"),
        CONSTRAINT "uq_repository_nodes_snapshot_ext" UNIQUE ("snapshot_id", "external_id"),
        CONSTRAINT "fk_repository_nodes_snapshot" FOREIGN KEY ("snapshot_id") REFERENCES "repository_snapshots"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "ix_repository_nodes_snapshot_file"
      ON "repository_nodes" ("snapshot_id", "file_path")
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "repository_edges" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "snapshot_id" uuid NOT NULL,
        "source_external_id" varchar(512) NOT NULL,
        "target_external_id" varchar(512) NOT NULL,
        "relationship_type" varchar(64) NOT NULL,
        "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "pk_repository_edges_id" PRIMARY KEY ("id"),
        CONSTRAINT "fk_repository_edges_snapshot" FOREIGN KEY ("snapshot_id") REFERENCES "repository_snapshots"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "ix_repository_edges_snapshot_source"
      ON "repository_edges" ("snapshot_id", "source_external_id")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "ix_repository_edges_snapshot_target"
      ON "repository_edges" ("snapshot_id", "target_external_id")
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "code_chunks" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "repository_id" uuid NOT NULL,
        "snapshot_id" uuid NOT NULL,
        "commit_sha" varchar(40) NOT NULL,
        "file_path" text NOT NULL,
        "symbol_name" varchar(255),
        "chunk_type" varchar(64) NOT NULL,
        "language" varchar(64),
        "module_name" varchar(255),
        "start_line" integer NOT NULL,
        "end_line" integer NOT NULL,
        "content" text NOT NULL,
        "embedding" vector,
        "embedding_model" varchar(128),
        "embedding_dim" integer,
        "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "pk_code_chunks_id" PRIMARY KEY ("id"),
        CONSTRAINT "fk_code_chunks_repository" FOREIGN KEY ("repository_id") REFERENCES "repositories"("id") ON DELETE CASCADE,
        CONSTRAINT "fk_code_chunks_snapshot" FOREIGN KEY ("snapshot_id") REFERENCES "repository_snapshots"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "ix_code_chunks_snapshot_file"
      ON "code_chunks" ("snapshot_id", "file_path")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "ix_code_chunks_snapshot_module"
      ON "code_chunks" ("snapshot_id", "module_name")
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "ix_code_chunks_snapshot_module"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "ix_code_chunks_snapshot_file"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "code_chunks"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "ix_repository_edges_snapshot_target"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "ix_repository_edges_snapshot_source"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "repository_edges"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "ix_repository_nodes_snapshot_file"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "repository_nodes"`);
  }
}
