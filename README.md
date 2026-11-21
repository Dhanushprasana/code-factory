# ForgeBench

ForgeBench is a local prototype for repository-grounded coding benchmarks. The currently implemented workflow covers PostgreSQL-backed projects, GitHub repository access, immutable commit snapshots, and static repository analysis.

## Applications

- `apps/frontend` - React + TypeScript + Vite dashboard
- `apps/backend` - NestJS REST API, TypeORM entities and migrations, and GitHub App adapter
- `apps/ai-service` - FastAPI bounded static repository analyzer
- `docker-compose.yml` - PostgreSQL 16 with pgvector and Redis

## Implemented prototype workflow

- Create and edit projects in PostgreSQL.
- Discover public repositories by GitHub search, or list repositories accessible to a configured GitHub App installation.
- Connect repositories to a project with an explicit component role.
- List branches and recent commits, then record the selected branch and full commit SHA.
- Clone a selected snapshot and verify `HEAD` matches the immutable SHA.
- Reuse a repository record across projects while keeping project-specific branch/commit selections separate.
- Analyze a ready snapshot asynchronously and save reports by commit.
- Explore overview metrics, detected feature/source areas, file structure, and a static module map.

The analyzer inspects repository files and manifests without running repository code, installing dependencies, or executing tests. AI task/reference generation, coding-agent execution, and benchmark evaluation are not implemented end-to-end yet; their prototype API placeholders are not shown as working frontend features.

For detailed backend modules, database entities, API flow, analyzer limits, configuration, and the complete run session, see [apps/docs/README.md](apps/docs/README.md).

## Run the entire application in Docker

Run these commands from the repository root in Windows PowerShell, with Docker Desktop running. The local `.env` file is created only if it does not already exist:

```powershell
if (-not (Test-Path apps\backend\.env)) {
  Copy-Item apps\backend\.env.example apps\backend\.env
}
docker compose --env-file apps\backend\.env up --build -d
docker compose ps
```

Wait until services are healthy. The stack runs PostgreSQL, Redis, the NestJS backend, the FastAPI AI service, and the React frontend in containers. Access the UI at [http://localhost:5173](http://localhost:5173), backend health at [http://localhost:4000/api/v1/health](http://localhost:4000/api/v1/health), and AI health at [http://localhost:8000/health](http://localhost:8000/health).

Open the UI and follow this session:

1. Create a project.
2. Add a public GitHub repository (search or HTTPS URL), load branches, and select a branch, commit, and component role. **Add repository** saves the association; it does not clone the source.
3. Select **Clone snapshot** and wait for `ready`. The checkout is pinned to the chosen full commit SHA.
4. Select **Analyze**. When the run completes, review **Overview**, **Feature map**, **File structure**, and **Module map**.

Public GitHub requests work without authentication subject to GitHub's shared quota. For a higher quota, set `GITHUB_TOKEN` only in the ignored `apps\backend\.env`. Private repository access requires a GitHub App with **Contents: read-only** and **Metadata: read-only** permissions, installed only on repositories ForgeBench should access. Never put credentials in `.env.example` or commit `.env`.

Follow service logs with:

```powershell
docker compose logs -f backend ai-service frontend
```

Stop the containers without deleting PostgreSQL data or repository artifacts:

```powershell
docker compose down
```

To remove the containers and their persisted databases/artifacts, use `docker compose down -v` only when you intend to erase that local data.

## Test

```powershell
npm run test
npm run build
```

`npm run test` runs the backend Jest suite and AI-service pytest suite; `npm run build` builds the backend and frontend. Do not expose the development credentials beyond a trusted local machine.
