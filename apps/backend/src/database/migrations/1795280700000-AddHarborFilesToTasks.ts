import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddHarborFilesToTasks1795280700000 implements MigrationInterface {
  name = 'AddHarborFilesToTasks1795280700000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "tasks"
      ADD COLUMN IF NOT EXISTS "harbor_files" jsonb,
      ADD COLUMN IF NOT EXISTS "harbor_package_path" varchar(500)
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "tasks"
      DROP COLUMN IF EXISTS "harbor_package_path",
      DROP COLUMN IF EXISTS "harbor_files"
    `);
  }
}
