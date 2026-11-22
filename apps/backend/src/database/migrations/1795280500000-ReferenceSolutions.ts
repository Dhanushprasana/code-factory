import { MigrationInterface, QueryRunner } from 'typeorm';

export class ReferenceSolutions1795280500000 implements MigrationInterface {
  name = 'ReferenceSolutions1795280500000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "reference_solutions" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "task_id" uuid NOT NULL,
        "task_version" integer NOT NULL,
        "version" integer NOT NULL,
        "status" varchar(32) NOT NULL DEFAULT 'queued',
        "provider" varchar(24) NOT NULL,
        "model" varchar(128),
        "prompt_version" varchar(64),
        "input" jsonb NOT NULL,
        "implementation_plan" jsonb,
        "patches" jsonb,
        "tests" jsonb,
        "context_manifest" jsonb,
        "validation" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "review_note" text,
        "error_message" text,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "pk_reference_solutions_id" PRIMARY KEY ("id"),
        CONSTRAINT "uq_reference_solutions_task_version" UNIQUE ("task_id", "version"),
        CONSTRAINT "fk_reference_solutions_task" FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "ix_reference_solutions_task_created"
      ON "reference_solutions" ("task_id", "created_at" DESC)
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "ix_reference_solutions_task_created"`);
    await queryRunner.query(`DROP TABLE "reference_solutions"`);
  }
}
