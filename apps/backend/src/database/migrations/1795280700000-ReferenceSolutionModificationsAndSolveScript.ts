import { MigrationInterface, QueryRunner } from 'typeorm';

export class ReferenceSolutionModificationsAndSolveScript1795280700000 implements MigrationInterface {
  name = 'ReferenceSolutionModificationsAndSolveScript1795280700000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "tasks"
      ADD COLUMN IF NOT EXISTS "target_files" jsonb NOT NULL DEFAULT '[]'::jsonb
    `);
    await queryRunner.query(`
      ALTER TABLE "reference_solutions"
      ADD COLUMN IF NOT EXISTS "target_files" jsonb,
      ADD COLUMN IF NOT EXISTS "modifications" jsonb,
      ADD COLUMN IF NOT EXISTS "file_changes" jsonb,
      ADD COLUMN IF NOT EXISTS "solve_script" text
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "reference_solutions"
      DROP COLUMN IF EXISTS "solve_script",
      DROP COLUMN IF EXISTS "file_changes",
      DROP COLUMN IF EXISTS "modifications",
      DROP COLUMN IF EXISTS "target_files"
    `);
    await queryRunner.query(`
      ALTER TABLE "tasks"
      DROP COLUMN IF EXISTS "target_files"
    `);
  }
}
