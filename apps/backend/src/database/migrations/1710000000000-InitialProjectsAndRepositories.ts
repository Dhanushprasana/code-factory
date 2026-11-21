import { MigrationInterface, QueryRunner } from 'typeorm';

export class InitialProjectsAndRepositories1710000000000 implements MigrationInterface {
  name = 'InitialProjectsAndRepositories1710000000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "projects" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "name" varchar(160) NOT NULL,
        "description" text NOT NULL DEFAULT '',
        "status" varchar(24) NOT NULL DEFAULT 'active',
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "pk_projects_id" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(`
      CREATE TABLE "repositories" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "provider" varchar(32) NOT NULL DEFAULT 'github',
        "external_repo_id" varchar(64) NOT NULL,
        "owner" varchar(100) NOT NULL,
        "name" varchar(100) NOT NULL,
        "full_name" varchar(201) NOT NULL,
        "clone_url" text NOT NULL,
        "is_private" boolean NOT NULL DEFAULT false,
        "default_branch" varchar(255) NOT NULL DEFAULT 'main',
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "pk_repositories_id" PRIMARY KEY ("id"),
        CONSTRAINT "uq_repositories_provider_external_id" UNIQUE ("provider", "external_repo_id")
      )
    `);
    await queryRunner.query(`
      CREATE TABLE "project_repositories" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "project_id" uuid NOT NULL,
        "repository_id" uuid NOT NULL,
        "repo_role" varchar(32) NOT NULL DEFAULT 'other',
        "selected_branch" varchar(255),
        "selected_commit_sha" varchar(40),
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "pk_project_repositories_id" PRIMARY KEY ("id"),
        CONSTRAINT "uq_project_repositories_project_repo" UNIQUE ("project_id", "repository_id"),
        CONSTRAINT "fk_project_repositories_project" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE,
        CONSTRAINT "fk_project_repositories_repository" FOREIGN KEY ("repository_id") REFERENCES "repositories"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(`
      CREATE TABLE "repository_snapshots" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "repository_id" uuid NOT NULL,
        "commit_sha" varchar(40) NOT NULL,
        "branch_name" varchar(255),
        "status" varchar(24) NOT NULL DEFAULT 'pending',
        "checkout_path" text,
        "captured_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "pk_repository_snapshots_id" PRIMARY KEY ("id"),
        CONSTRAINT "uq_repository_snapshots_repo_commit" UNIQUE ("repository_id", "commit_sha"),
        CONSTRAINT "fk_repository_snapshots_repository" FOREIGN KEY ("repository_id") REFERENCES "repositories"("id") ON DELETE CASCADE
      )
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "repository_snapshots"`);
    await queryRunner.query(`DROP TABLE "project_repositories"`);
    await queryRunner.query(`DROP TABLE "repositories"`);
    await queryRunner.query(`DROP TABLE "projects"`);
  }
}
