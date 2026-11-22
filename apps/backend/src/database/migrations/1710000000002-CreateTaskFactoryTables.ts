import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateTaskFactoryTables1710000000002 implements MigrationInterface {
  name = 'CreateTaskFactoryTables1710000000002';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "task_generation_runs" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "project_id" uuid NOT NULL,
        "status" varchar(24) NOT NULL DEFAULT 'running',
        "input" jsonb NOT NULL,
        "provider" varchar(64),
        "model" varchar(128),
        "prompt_version" varchar(64),
        "context_manifest" jsonb,
        "candidates" jsonb,
        "error_message" text,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "pk_task_generation_runs_id" PRIMARY KEY ("id"),
        CONSTRAINT "fk_task_generation_runs_project" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "ix_task_generation_runs_project_created"
      ON "task_generation_runs" ("project_id", "created_at" DESC)
    `);
    await queryRunner.query(`
      CREATE TABLE "tasks" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "project_id" uuid NOT NULL,
        "generation_id" uuid,
        "current_version" integer NOT NULL DEFAULT 1,
        "title" varchar(160) NOT NULL,
        "description" text NOT NULL,
        "category" varchar(32) NOT NULL,
        "difficulty" varchar(16) NOT NULL,
        "status" varchar(24) NOT NULL DEFAULT 'draft',
        "requirements" jsonb NOT NULL DEFAULT '[]'::jsonb,
        "acceptance_criteria" jsonb NOT NULL DEFAULT '[]'::jsonb,
        "constraints" jsonb NOT NULL DEFAULT '[]'::jsonb,
        "affected_modules" jsonb NOT NULL DEFAULT '[]'::jsonb,
        "baseline_manifest" jsonb NOT NULL,
        "context_manifest" jsonb NOT NULL,
        "evidence" jsonb NOT NULL DEFAULT '[]'::jsonb,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "pk_tasks_id" PRIMARY KEY ("id"),
        CONSTRAINT "fk_tasks_project" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE,
        CONSTRAINT "fk_tasks_generation" FOREIGN KEY ("generation_id") REFERENCES "task_generation_runs"("id") ON DELETE SET NULL
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "ix_tasks_project_updated"
      ON "tasks" ("project_id", "updated_at" DESC)
    `);
    await queryRunner.query(`
      CREATE TABLE "task_versions" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "task_id" uuid NOT NULL,
        "version" integer NOT NULL,
        "content" jsonb NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "pk_task_versions_id" PRIMARY KEY ("id"),
        CONSTRAINT "uq_task_versions_task_version" UNIQUE ("task_id", "version"),
        CONSTRAINT "fk_task_versions_task" FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE CASCADE
      )
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "task_versions"`);
    await queryRunner.query(`DROP INDEX "ix_tasks_project_updated"`);
    await queryRunner.query(`DROP TABLE "tasks"`);
    await queryRunner.query(`DROP INDEX "ix_task_generation_runs_project_created"`);
    await queryRunner.query(`DROP TABLE "task_generation_runs"`);
  }
}
