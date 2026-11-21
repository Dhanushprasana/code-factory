# ForgeBench backend guide

This guide describes the backend structure and runnable workflows implemented at the current project stage: project and repository setup, GitHub access, pinned repository snapshots, and static repository analysis.

## Backend modules

The NestJS application is composed from domain modules. Controllers own their HTTP routes; services own business logic; TypeORM entities live in an `entities` folder inside the module that owns the persisted data.

| Module | Responsibility | Persistence |
| --- | --- | --- |
| `AppModule` | Application composition, global configuration, PostgreSQL connection, and health check | Owns the root TypeORM connection |
| `ProjectsModule` | Create, list, update, and delete projects; return workspace counts | `projects/entities/project.entity.ts` |
| `RepositoriesModule` | Associate repositories with projects, list associations, remove links, and clone snapshots | `repositories/entities/` |
| `AnalysisModule` | Queue snapshot analysis, persist report history, and expose summaries and graph data | `analysis/entities/repository-analysis.entity.ts` |
| `GitHubModule` | Public repository discovery and allowlisted GitHub App access; list branches and commits | No local entity; GitHub remains the source of repository metadata |
| `WorkflowModule` | Existing task, package, agent, and evaluation API placeholders | No TypeORM entities; prototype state is stored in the artifact JSON file |

`WorkflowModule` is intentionally separated from the implemented setup flow. Its task, package, and evaluation responses are prototype placeholders, not database-backed AI generation, reference validation, coding-agent execution, or benchmark results. They are not presented as working features in the frontend.

### Source layout

```text
apps/backend/src/
  app.controller.ts                 # Health endpoint
  app.module.ts                     # Root configuration and module composition
  main.ts                           # CORS, /api/v1 prefix, HTTP listener
  database/
    migrations/                     # Initial project/repository schema migration
  projects/
    projects.controller.ts
    projects.module.ts
    projects.service.ts
    entities/
      project.entity.ts
  repositories/
    repositories.controller.ts
    repositories.module.ts
    repositories.service.ts
    entities/
      project-repository.entity.ts
      repository.entity.ts
      repository-snapshot.entity.ts
  analysis/
    analysis.controller.ts
    analysis.module.ts
    analysis.processor.ts
    analysis.service.ts
    entities/
      repository-analysis.entity.ts
  github/
    github.controller.ts
    github.module.ts
    github.service.ts
    entities/
      .gitkeep
  workflow/
    workflow.controller.ts
    workflow.module.ts
    entities/
      .gitkeep
  app.service.ts                    # Prototype workflow state used by WorkflowModule
```

Every feature module has an `entities/` directory. Only the modules that currently persist relational data contain TypeORM entity classes; GitHub metadata is fetched from GitHub and workflow placeholders use JSON state, so their folders are reserved for future persistence models. No new `*.spec.ts` files are part of this structure change.

## Entity model

```text
ProjectEntity 1 ─── * ProjectRepositoryEntity * ─── 1 RepositoryEntity
                                                    |
                                                    1
                                                    |
                                                    *
                                         RepositorySnapshotEntity
                                                    |
                                                    1
                                                    |
                                                    *
                                         RepositoryAnalysisEntity
```

- **ProjectEntity** (`projects`) stores the project name, description, status, and timestamps.
- **RepositoryEntity** (`repositories`) stores a GitHub repository's provider ID, owner/name, HTTPS clone URL, visibility, default branch, and timestamps. Its provider/remote ID pair is unique so one repository can be reused by multiple projects.
- **ProjectRepositoryEntity** (`project_repositories`) links one project to one repository and stores that project's component role and selected branch/full commit SHA. A project/repository pair is unique.
- **RepositorySnapshotEntity** (`repository_snapshots`) records a checkout attempt/result for a repository and exact commit SHA. The repository/commit pair is unique; the local checkout path is not returned by the API.
- **RepositoryAnalysisEntity** (`repository_analyses`) records queued, running, completed, or failed analysis for one ready snapshot. It stores the source-grounded summary and report as JSONB, analyzer version, warnings, and any failure message.

Deleting a project removes its project links through the database foreign key. Removing a repository from a project removes only that association. Repository records and snapshots are retained unless their owning repository is deleted.

## Request and data flow

### Application startup

1. `main.ts` creates the Nest application, enables CORS, mounts API routes under `/api/v1`, and listens on the configured host/port.
2. `ConfigModule` loads `apps/backend/.env` and the process working directory's `.env`.
3. `AppModule` opens the PostgreSQL connection and imports the domain modules.
4. Domain modules register their TypeORM entities through `TypeOrmModule.forFeature`; `autoLoadEntities` gathers them for the root connection.
5. During this development stage `synchronize: true` lets TypeORM create/update tables from the entities. The initial migration is also registered and runs on startup.

**Important:** TypeORM synchronization is for local development only. It can change or remove columns when entity definitions change and must be disabled before using a production database. Back up any local data you need to keep.

### Create a project and add a repository

This flow has two distinct milestones: **Add repository** saves GitHub metadata and the selected baseline in PostgreSQL; **Clone snapshot** later copies the source into ForgeBench storage. Adding a repository does not clone, analyze, build, or test its files.

#### 1. Create the project

The frontend sends `POST /api/v1/projects` with the project name and optional description. `ProjectsController` delegates to `ProjectsService`, which validates that the name is non-empty and saves a `ProjectEntity` in the `projects` table. The returned project UUID is used by the repository actions.

#### 2. Load branches and commits

Repository search (`GET /api/v1/github/repositories?query=...`) is optional if the user enters a GitHub URL directly. Choosing a repository from search just fills that URL into the form; it does not yet create a database record.

When **Load branches** is clicked:

1. The frontend extracts the GitHub owner and repository name from the HTTPS URL.
2. It calls `GET /api/v1/github/repositories/:owner/:name/branches`.
3. `GitHubController` calls `GitHubService`, which requests the public branch list (using `GITHUB_TOKEN` when configured) or the GitHub App installation credentials for an allowlisted private repository.
4. The response is a list of branch names and latest commit SHAs. This lookup is read-only: it does not save branches or repositories in PostgreSQL.

Selecting a branch calls `GET /api/v1/github/repositories/:owner/:name/commits?branch=...`. `GitHubService` fetches recent commits for that branch (up to 30) and returns each full SHA, message, author, and authored time. The UI displays a shortened SHA for readability, but keeps the full SHA as the selected value. These branch and commit selections remain in the browser until **Add repository** is submitted.

#### 3. Click “Add repository”

The frontend sends `POST /api/v1/projects/:projectId/repositories` with a body like:

```json
{
  "url": "https://github.com/twentyhq/twenty.git",
  "role": "backend",
  "branch": "main",
  "commitSha": "full-or-abbreviated-commit-sha"
}
```

`RepositoriesController` calls `RepositoriesService.addToProject`. The service then:

1. Confirms the project UUID exists.
2. Parses and validates a credential-free HTTPS GitHub repository URL.
3. Fetches the repository's authoritative metadata from GitHub. Public repository reads use `GITHUB_TOKEN` when configured. For a private repository, the GitHub App must be installed with access to that repository.
4. Validates the selected component role and branch. If no branch was submitted, it uses the repository's default branch.
5. Validates the commit SHA. If a SHA was selected, it asks GitHub for that commit and stores the canonical full SHA returned by GitHub. If no SHA was submitted, it selects the latest commit on the chosen/default branch.
6. Looks up the global repository record by GitHub provider and GitHub's immutable repository ID. It creates the `RepositoryEntity` if this repository has not been seen before; otherwise it refreshes its GitHub metadata. This lets several projects refer to the same repository record.
7. Looks up the association for this exact project/repository pair. It creates a `ProjectRepositoryEntity` or updates the existing association's role, branch, and selected full SHA.
8. Returns the saved project/repository association with its repository relation. The frontend then reloads `GET /api/v1/projects/:projectId/repositories` and shows the repository row.

The database changes at this point are:

- **`repositories`**: one shared GitHub metadata row, keyed uniquely by provider and GitHub repository ID.
- **`project_repositories`**: one project-specific link containing `project_id`, `repository_id`, `repo_role`, `selected_branch`, and the full `selected_commit_sha`. A project/repository pair is unique.
- **`repository_snapshots`**: **no row is created yet**.

The repository's Git files are **not** copied to disk by **Add repository**. No snapshot directory is created, and no repository analysis, task generation, reference generation, build, or test is run at this step. If **Add repository** is used again for an already-linked repository, its project-specific branch/SHA selection is updated instead of creating a duplicate link.

These database saves are currently sequential rather than enclosed in one database transaction. If the repository metadata save succeeds but the later association save fails, the global repository record can remain without a project link; a retry can reuse that record.

#### 4. Click “Clone snapshot” (separate action)

Cloning starts only when the user clicks **Clone snapshot** on the saved repository row. The frontend sends `POST /api/v1/projects/:projectId/repositories/:repositoryId/snapshots`, using the association's selected branch and commit SHA.

`RepositoriesService.cloneSelectedCommit`:

1. Loads the project/repository association and verifies the commit SHA.
2. Revalidates the commit with GitHub and obtains its canonical full SHA.
3. Uses `repository_snapshots` to reuse an already-ready snapshot when its checkout directory still exists. Otherwise it records the snapshot as `cloning`.
4. Clones into a temporary directory under `ARTIFACT_STORAGE_PATH/repositories/<repositoryId>/<fullSha>`, checks out the selected SHA detached, and verifies that `git rev-parse HEAD` exactly matches it.
5. On success, moves the temporary checkout into its final SHA-pinned directory, updates the association's selected baseline, and marks the snapshot `ready`.
6. On failure, removes the temporary checkout, records `failed`, and returns an error.

In the Docker setup, repository checkouts live in the shared `artifacts` volume at `/workspace/storage`; the AI service mounts that volume read-only. Private clone credentials are short-lived GitHub App installation tokens supplied to Git without embedding them in the clone URL or saving them in PostgreSQL.

### Analyze a repository snapshot

Analysis runs only for a successfully cloned (`ready`) snapshot. From a project's repository row, choose **Analyze**; the Repository Analysis page lets you select the same repository and start or revisit saved runs.

1. The frontend calls `POST /api/v1/repositories/:repositoryId/analyze` with the selected full `commitSha`.
2. The backend verifies the repository and a matching ready snapshot, creates a `RepositoryAnalysisEntity` with status `queued`, and places its ID on the `repository-analysis` BullMQ queue. If there is already a queued or running analysis for that snapshot, the existing run is returned instead of adding a duplicate.
3. The BullMQ worker marks it `running`, verifies that the snapshot checkout is under artifact storage, and sends a structured request to the Python AI service at `POST /api/v1/analyze`. The AI service mounts the artifact volume read-only; it never executes repository code, installs project dependencies, or runs build/test commands.
4. The Python scanner walks the pinned checkout with explicit bounds (maximum filesystem entries, route/entity scan files, Tree-sitter-parsed source files, file size, total source bytes, and report graph/tree size). It skips VCS/dependency/build directories, generated files, common secrets/environment files, and binary/large files.
5. The report is based on repository contents and manifests. It includes file/language counts, package managers and direct dependencies, detected frameworks and ORMs, configured build/test commands, entry points, source modules with file/route/entity/test counts, README headings, route/entity declarations with file/line evidence, and a bounded directory tree that samples files across modules. Tree-sitter parses JavaScript, TypeScript/TSX, and Python to extract symbols, imports, statically identifiable calls, and inheritance relationships into a dependency graph.
6. On success, the worker stores the summary, report, warnings, and analyzer version in `repository_analyses` and marks the run `completed`. On an error it stores a useful error message and marks the run `failed`; the UI polls the run and shows the status/report.

The analysis report follows the attached explorer design with **Overview**, **Feature map**, **File structure**, and **Module map** tabs. The feature map groups real source folders—including nested layouts such as `backend/src` and `frontend/src`—and their detected evidence; README headings are shown separately and are not treated as verified product capabilities. The expandable file tree is capped at 2,000 entries and shows file metadata, not source contents. The module map shows folder containment plus cross-module calls when static resolution finds them; missing edges do not prove that modules are unrelated. The views inherit the same pinned snapshot and analyzer limits as the report.

Analysis API routes (relative to `/api/v1`):

- `POST /repositories/:id/analyze` — start or reuse an analysis for the selected commit SHA.
- `GET /repositories/:id/analyses` — list up to 100 recent analysis runs for a repository.
- `GET /analyses/:id` — get status, summary, full report, warnings, and failure message.
- `GET /analyses/:id/summary` — get the completed summary.
- `GET /analyses/:id/graph` — get the completed static dependency graph.

The current report is deterministic static analysis; it does not call an LLM. Coverage percentages are not inferred from test-file names. The UI shows test files and configured commands, but does not execute tests or claim test coverage. Embedding generation, vector persistence/semantic search, and separate relational graph-node/edge tables remain future work; the current bounded graph is persisted as part of the JSONB report.

## HTTP API ownership

All paths below are relative to `/api/v1`.

| Controller/module | Routes |
| --- | --- |
| `AppController` | `GET /health` |
| `ProjectsController` | `GET /dashboard`, `GET /projects`, `POST /projects`, `GET /projects/:id`, `PATCH /projects/:id`, `DELETE /projects/:id` |
| `GitHubController` | `GET /github/install-url`, `GET /github/repositories`, `GET /github/repositories/:owner/:name/branches`, `GET /github/repositories/:owner/:name/commits?branch=...` |
| `RepositoriesController` | `GET /repositories`, `GET /projects/:id/repositories`, `POST /projects/:id/repositories`, `DELETE /projects/:id/repositories/:repositoryId`, `POST /projects/:id/repositories/:repositoryId/snapshots` |
| `AnalysisController` | `POST /repositories/:id/analyze`, `GET /repositories/:id/analyses`, `GET /analyses/:id`, `GET /analyses/:id/summary`, `GET /analyses/:id/graph` |
| `WorkflowController` | Task, package, agent, and evaluation placeholder endpoints; see the scope note above |

## Technology

- **NestJS / TypeScript** provide the HTTP API and module/dependency-injection boundaries.
- **TypeORM / PostgreSQL** persist projects, repository metadata, associations, and snapshot records.
- **Octokit** handles public GitHub API calls and GitHub App installation authentication.
- **simple-git / Git** clone repositories and verify immutable commit checkouts.
- **BullMQ / Redis** run repository analysis outside the HTTP request and track its durable PostgreSQL status.
- **Python / FastAPI / Tree-sitter** scan pinned source files and produce repository metadata and a bounded static graph.
- **Docker Compose** runs PostgreSQL, Redis, the backend, AI service, and frontend for the local prototype. The current backend setup flow requires PostgreSQL; Redis and the AI service are available for later workflow implementation.

## Run the application

### Full Docker stack (recommended)

From the repository root in PowerShell:

```powershell
Copy-Item apps\backend\.env.example apps\backend\.env
# Add GitHub App values to apps\backend\.env if private repository access is needed.
docker compose --env-file apps\backend\.env up --build -d
docker compose ps
```

The Compose file starts PostgreSQL, Redis, the NestJS backend, the FastAPI AI service, and the React frontend. Service ports are bound to localhost:

- Frontend: `http://localhost:5173`
- Backend health: `http://localhost:4000/api/v1/health`
- AI service health: `http://localhost:8000/health`
- PostgreSQL: `localhost:5432`
- Redis: `localhost:6379`

Follow logs with `docker compose logs -f backend frontend ai-service`. Stop the stack with `docker compose down`; this keeps database and artifact volumes. `docker compose down -v` also deletes persisted volumes.

### Backend on the host

Prerequisites: Node.js 22, npm, and a reachable PostgreSQL database. The example database settings match the Compose PostgreSQL service.

```powershell
Copy-Item apps\backend\.env.example apps\backend\.env
docker compose --env-file apps\backend\.env up -d postgres
npm install
npm --prefix apps/backend run start:dev
```

The backend listens at `http://localhost:4000/api/v1`. To run the frontend in another terminal, use `npm --prefix apps/frontend run dev`. Optional AI service commands and its dependencies are documented in `apps/ai-service/`.

### Build and tests

```powershell
npm --prefix apps/backend run build
npm --prefix apps/backend run test -- --runInBand
```

## Configuration

Backend configuration is read from `apps/backend/.env` (copy `.env.example` first):

| Variable | Purpose |
| --- | --- |
| `HOST`, `PORT` | Backend bind address and port |
| `DATABASE_HOST`, `DATABASE_PORT`, `DATABASE_NAME`, `DATABASE_USER`, `DATABASE_PASSWORD` | PostgreSQL connection |
| `GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY`, `GITHUB_APP_INSTALLATION_ID`, `GITHUB_APP_SLUG` | Optional GitHub App access for private repositories |
| `GITHUB_TOKEN` | Optional PAT for higher GitHub REST API quota when using public repositories |
| `ARTIFACT_STORAGE_PATH` | Local workflow/repository artifact directory |
| `AI_SERVICE_URL` | AI service URL for later integration |

The example leaves `GITHUB_TOKEN` blank. Without authentication, GitHub limits public REST API requests by the shared client IP; set a token only in `apps/backend/.env` to authenticate public repository search, branch, and commit requests. Keep the token local and do not commit it. If GitHub rejects configured credentials, the API returns an actionable upstream error instead of a generic 500. Revoke and replace any credential that has been committed or shared. The token is not used to access private repositories; private repository access continues to require the GitHub App allowlist.

For a GitHub App, grant only the read permissions required for repository contents and metadata, and install it only on repositories ForgeBench should access. Keep the private key in the local environment file; do not commit it.
