import { MigrationInterface, QueryRunner } from 'typeorm';

export class AgentExecutions1795280600000 implements MigrationInterface {
  name = 'AgentExecutions1795280600000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "agent_assignments" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "task_id" uuid NOT NULL,
        "task_version" integer NOT NULL,
        "reference_id" uuid NOT NULL,
        "agent_id" uuid NOT NULL,
        "config_id" uuid,
        "status" varchar(24) NOT NULL DEFAULT 'queued',
        "baseline_manifest" jsonb NOT NULL,
        "assigned_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "pk_agent_assignments_id" PRIMARY KEY ("id"),
        CONSTRAINT "fk_agent_assignments_task" FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE CASCADE,
        CONSTRAINT "fk_agent_assignments_reference" FOREIGN KEY ("reference_id") REFERENCES "reference_solutions"("id") ON DELETE CASCADE,
        CONSTRAINT "fk_agent_assignments_agent" FOREIGN KEY ("agent_id") REFERENCES "agents"("id") ON DELETE CASCADE,
        CONSTRAINT "fk_agent_assignments_config" FOREIGN KEY ("config_id") REFERENCES "agent_configs"("id") ON DELETE SET NULL
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "ix_agent_assignments_task_reference"
      ON "agent_assignments" ("task_id", "reference_id")
    `);

    await queryRunner.query(`
      CREATE TABLE "agent_executions" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "assignment_id" uuid NOT NULL,
        "status" varchar(24) NOT NULL DEFAULT 'queued',
        "adapter_type" varchar(64) NOT NULL,
        "started_at" timestamptz,
        "completed_at" timestamptz,
        "workspace_path" text,
        "metadata" jsonb NOT NULL DEFAULT '{}',
        "log_artifact" text,
        "error_message" text,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "pk_agent_executions_id" PRIMARY KEY ("id"),
        CONSTRAINT "fk_agent_executions_assignment" FOREIGN KEY ("assignment_id") REFERENCES "agent_assignments"("id") ON DELETE CASCADE
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "agent_submissions" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "execution_id" uuid NOT NULL,
        "status" varchar(24) NOT NULL DEFAULT 'collected',
        "patch_diff" text,
        "patch_valid" boolean NOT NULL DEFAULT false,
        "metadata" jsonb NOT NULL DEFAULT '{}',
        "artifact_path" text,
        "submitted_at" timestamptz NOT NULL DEFAULT now(),
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "pk_agent_submissions_id" PRIMARY KEY ("id"),
        CONSTRAINT "fk_agent_submissions_execution" FOREIGN KEY ("execution_id") REFERENCES "agent_executions"("id") ON DELETE CASCADE
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "agent_evaluations" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "submission_id" uuid NOT NULL,
        "reference_id" uuid NOT NULL,
        "status" varchar(24) NOT NULL DEFAULT 'queued',
        "workspace_path" text,
        "test_results" jsonb NOT NULL DEFAULT '[]',
        "metrics" jsonb NOT NULL DEFAULT '{}',
        "total_score" numeric(6,2),
        "started_at" timestamptz,
        "completed_at" timestamptz,
        "error_message" text,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "pk_agent_evaluations_id" PRIMARY KEY ("id"),
        CONSTRAINT "fk_agent_evaluations_submission" FOREIGN KEY ("submission_id") REFERENCES "agent_submissions"("id") ON DELETE CASCADE,
        CONSTRAINT "fk_agent_evaluations_reference" FOREIGN KEY ("reference_id") REFERENCES "reference_solutions"("id") ON DELETE CASCADE
      )
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "agent_evaluations"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "agent_submissions"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "agent_executions"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "ix_agent_assignments_task_reference"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "agent_assignments"`);
  }
}
