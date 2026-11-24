import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddHarborVerificationToTasks1795280800000 implements MigrationInterface {
  name = 'AddHarborVerificationToTasks1795280800000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "tasks"
      ADD COLUMN IF NOT EXISTS "harbor_verification" jsonb
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "tasks"
      DROP COLUMN IF EXISTS "harbor_verification"
    `);
  }
}
