import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddContextToRepositoryAnalyses1795280600000 implements MigrationInterface {
  name = 'AddContextToRepositoryAnalyses1795280600000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "repository_analyses"
      ADD COLUMN IF NOT EXISTS "context_markdown" text,
      ADD COLUMN IF NOT EXISTS "context_status" varchar(24) DEFAULT 'pending',
      ADD COLUMN IF NOT EXISTS "context_error" text
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "repository_analyses"
      DROP COLUMN IF EXISTS "context_error",
      DROP COLUMN IF EXISTS "context_status",
      DROP COLUMN IF EXISTS "context_markdown"
    `);
  }
}
