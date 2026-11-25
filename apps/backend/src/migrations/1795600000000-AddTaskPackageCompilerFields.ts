import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddTaskPackageCompilerFields1795600000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "tasks"
      ADD COLUMN IF NOT EXISTS "package_ir" jsonb,
      ADD COLUMN IF NOT EXISTS "validation_summary" jsonb,
      ADD COLUMN IF NOT EXISTS "lifecycle_status" varchar(32)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "tasks"
      DROP COLUMN IF EXISTS "lifecycle_status",
      DROP COLUMN IF EXISTS "validation_summary",
      DROP COLUMN IF EXISTS "package_ir"
    `);
  }
}
