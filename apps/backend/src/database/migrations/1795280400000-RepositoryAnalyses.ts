import { MigrationInterface, QueryRunner } from 'typeorm';

export class RepositoryAnalyses1795280400000 implements MigrationInterface {
  name = 'RepositoryAnalyses1795280400000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "repository_analyses" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "repository_id" uuid NOT NULL,
        "snapshot_id" uuid NOT NULL,
        "commit_sha" varchar(40) NOT NULL,
        "status" varchar(24) NOT NULL DEFAULT 'queued',
        "analyzer_version" varchar(32) NOT NULL,
        "summary" jsonb,
        "report" jsonb,
        "warnings" jsonb NOT NULL DEFAULT '[]'::jsonb,
        "error_message" text,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "pk_repository_analyses_id" PRIMARY KEY ("id"),
        CONSTRAINT "fk_repository_analyses_repository" FOREIGN KEY ("repository_id") REFERENCES "repositories"("id") ON DELETE CASCADE,
        CONSTRAINT "fk_repository_analyses_snapshot" FOREIGN KEY ("snapshot_id") REFERENCES "repository_snapshots"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "ix_repository_analyses_repository_created"
      ON "repository_analyses" ("repository_id", "created_at" DESC)
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "ix_repository_analyses_repository_created"`);
    await queryRunner.query(`DROP TABLE "repository_analyses"`);
  }
}
