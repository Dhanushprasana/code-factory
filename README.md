# ForgeBench

ForgeBench is a local prototype for repository-grounded coding benchmarks. Implemented workflows cover PostgreSQL-backed projects, GitHub repository access, immutable commit snapshots, static repository analysis, and source-grounded AI task generation/review.

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
- Retrieve bounded source context from selected analyzed baselines, choose OpenRouter or Ollama for task suggestions, review/edit them, and save versioned task drafts.
- Generate provider-consistent reference plans, repository-specific patches/tests, and review version history. Apply patches to a separate copy of the pinned snapshot, download it, then record manually run build/test results before approval.

The analyzer inspects repository files and manifests without running repository code, installing dependencies, or executing tests. Task and reference generation use bounded keyword/structure/static-graph retrieval (not vector search). OpenRouter sends selected excerpts to its hosted model and requires an API key; Ollama can process the excerpts on a configured local model endpoint. Reference builds/tests are not run in ForgeBench; coding-agent execution and benchmark evaluation are not implemented end-to-end.

Choose the provider per generation in Task Generator. Configure OpenRouter or Ollama model settings in the ignored `apps/backend/.env`; OpenRouter needs `OPENROUTER_API_KEY`, while Ollama needs a running endpoint and pulled model. Ollama can run in the optional Docker Compose `ollama` profile. The app and repository analysis run without either provider being configured, and the task page returns a clear error if the selected provider is unavailable.

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
5. Open **Task Generator**, select analyzed components and an AI provider, then review and save generated task drafts.
6. In **Task Library**, select a saved task to review its baseline/version and generate a reference plan, patch bundle, and public test files. Apply the bundle to an isolated copy and download it. ForgeBench never executes repository build/test scripts; run them after review and record the results before approval.

For OpenRouter, set `OPENROUTER_API_KEY` in `apps\backend\.env`. When starting or recreating the AI service, include `--env-file apps\backend\.env`; the backend's `env_file` setting alone does not pass that file's variables to the AI-service container. For Ollama, set the endpoint/model and optionally start the Compose `ollama` profile. See [apps/docs/README.md](apps/docs/README.md) for provider setup, local-model commands, and the full run session.

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
