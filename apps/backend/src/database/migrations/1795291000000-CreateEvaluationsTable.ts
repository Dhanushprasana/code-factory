import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateEvaluationsTable1795291000000 implements MigrationInterface {
  name = 'CreateEvaluationsTable1795291000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "evaluations" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "task_id" uuid NOT NULL REFERENCES "tasks"("id") ON DELETE CASCADE,
        "agent_id" uuid NOT NULL REFERENCES "agents"("id") ON DELETE CASCADE,
        "agent_config_id" uuid,
        "agent_name" varchar(160) NOT NULL,
        "model_name" varchar(128) NOT NULL,
        "provider" varchar(64) NOT NULL DEFAULT 'Custom',
        "status" varchar(32) NOT NULL DEFAULT 'pending',
        "reward" numeric(5, 2) NOT NULL DEFAULT 0.0,
        "score" numeric(5, 2) NOT NULL DEFAULT 0.0,
        "duration_ms" integer NOT NULL DEFAULT 0,
        "metrics" jsonb NOT NULL DEFAULT '{}',
        "trajectory_logs" text NOT NULL DEFAULT '',
        "test_output" text NOT NULL DEFAULT '',
        "error_message" text,
        "harbor_job_id" varchar(128),
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now()
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_evaluations_task_id" ON "evaluations"("task_id");
      CREATE INDEX IF NOT EXISTS "idx_evaluations_agent_id" ON "evaluations"("agent_id");
      CREATE INDEX IF NOT EXISTS "idx_evaluations_status" ON "evaluations"("status");
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "evaluations"`);
  }
}
