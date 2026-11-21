import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateAgentsTables1710000000001 implements MigrationInterface {
  name = 'CreateAgentsTables1710000000001';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "agents" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "name" varchar(160) NOT NULL,
        "adapter_type" varchar(64) NOT NULL DEFAULT 'direct-cli',
        "provider" varchar(64) NOT NULL DEFAULT 'custom',
        "description" text NOT NULL DEFAULT '',
        "status" varchar(24) NOT NULL DEFAULT 'ready',
        "model_name" varchar(128) NOT NULL DEFAULT '',
        "settings" jsonb NOT NULL DEFAULT '{}',
        "credential_reference" varchar(255),
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "pk_agents_id" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "agent_configs" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "agent_id" uuid NOT NULL,
        "config_version" int NOT NULL DEFAULT 1,
        "model_name" varchar(128) NOT NULL,
        "settings" jsonb NOT NULL DEFAULT '{}',
        "credential_reference" varchar(255),
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "pk_agent_configs_id" PRIMARY KEY ("id"),
        CONSTRAINT "uq_agent_configs_version" UNIQUE ("agent_id", "config_version"),
        CONSTRAINT "fk_agent_configs_agent" FOREIGN KEY ("agent_id") REFERENCES "agents"("id") ON DELETE CASCADE
      )
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "agent_configs"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "agents"`);
  }
}
