import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddEncryptedApiKeyToAgents1795290000000 implements MigrationInterface {
  name = 'AddEncryptedApiKeyToAgents1795290000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "agents"
      ADD COLUMN IF NOT EXISTS "encrypted_api_key" text,
      ADD COLUMN IF NOT EXISTS "api_key_iv" varchar(64),
      ADD COLUMN IF NOT EXISTS "api_key_tag" varchar(64),
      ADD COLUMN IF NOT EXISTS "api_key_masked" varchar(64),
      ADD COLUMN IF NOT EXISTS "harbor_harness" varchar(64) DEFAULT 'openrouter'
    `);

    await queryRunner.query(`
      ALTER TABLE "agent_configs"
      ADD COLUMN IF NOT EXISTS "encrypted_api_key" text,
      ADD COLUMN IF NOT EXISTS "api_key_iv" varchar(64),
      ADD COLUMN IF NOT EXISTS "api_key_tag" varchar(64),
      ADD COLUMN IF NOT EXISTS "api_key_masked" varchar(64),
      ADD COLUMN IF NOT EXISTS "harbor_harness" varchar(64) DEFAULT 'openrouter'
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "agents"
      DROP COLUMN IF EXISTS "encrypted_api_key",
      DROP COLUMN IF EXISTS "api_key_iv",
      DROP COLUMN IF EXISTS "api_key_tag",
      DROP COLUMN IF EXISTS "api_key_masked",
      DROP COLUMN IF EXISTS "harbor_harness"
    `);

    await queryRunner.query(`
      ALTER TABLE "agent_configs"
      DROP COLUMN IF EXISTS "encrypted_api_key",
      DROP COLUMN IF EXISTS "api_key_iv",
      DROP COLUMN IF EXISTS "api_key_tag",
      DROP COLUMN IF EXISTS "api_key_masked",
      DROP COLUMN IF EXISTS "harbor_harness"
    `);
  }
}
