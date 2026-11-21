# ForgeBench

ForgeBench is a local prototype for creating repository-grounded coding benchmark tasks. The current development milestone is project and repository setup: PostgreSQL-backed projects, GitHub repository discovery, and immutable commit snapshots.

## Applications

- `apps/frontend` - React + TypeScript + Vite dashboard
- `apps/backend` - NestJS REST API, TypeORM entities/migration, and GitHub App adapter
- `apps/ai-service` - FastAPI AI and repository-analysis contracts
- `docker-compose.yml` - PostgreSQL 16 with pgvector and Redis

## Day 1-2 foundation

- Create and edit projects in PostgreSQL.
- Discover public repositories by GitHub search, or list repositories accessible to a configured GitHub App installation.
- Connect repositories to a project with an explicit component role.
- List branches and recent commits, then record the selected branch and full commit SHA.
- Clone a selected snapshot and verify `HEAD` matches the immutable SHA.
- Reuse a repository record across projects while keeping project-specific branch/commit selections separate.

Later roadmap features—including AI task/reference generation, execution isolation, and agent evaluation—are not represented as working integrations yet.

For the detailed backend module structure, entity model, request flow, API ownership, development configuration, and run instructions, see [apps/docs/README.md](apps/docs/README.md).

## Run the whole stack in Docker

```powershell
Copy-Item apps\backend\.env.example apps\backend\.env
docker compose --env-file apps\backend\.env up --build -d
docker compose ps
```

This runs PostgreSQL, Redis, the NestJS backend, the FastAPI AI service, and the React frontend in containers. The web/API ports are bound to localhost. Access the UI at `http://localhost:5173`, backend health at `http://localhost:4000/api/v1/health`, and AI health at `http://localhost:8000/health`.

Edit `apps/backend/.env` before starting if you need custom database or GitHub settings. Set `GITHUB_TOKEN` to a personal access token to avoid the low shared unauthenticated GitHub API quota when searching public repositories or loading branches and commits. For private repositories, create a GitHub App with **Contents: read-only** and **Metadata: read-only** permissions, install it only on repositories ForgeBench should access, then set `GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY`, `GITHUB_APP_INSTALLATION_ID`, and `GITHUB_APP_SLUG`. The private key remains on the backend; installation tokens are short-lived and are not written to repository records or clone URLs.

```powershell
docker compose logs -f backend ai-service frontend
```

The backend runs project/repository migrations on startup. PostgreSQL data and repository artifacts persist in Docker volumes. To stop the containers without deleting data:

```powershell
docker compose down
```

To remove the containers and their persisted databases/artifacts, use `docker compose down -v`.

Open the UI, create a project, connect a public repository or install/configure the GitHub App, select a branch/commit, and clone its snapshot.

## Test

```powershell
npm run test
npm run build
```

PostgreSQL integration tests require the local database service to be running. Do not expose the development credentials beyond a trusted local machine.
