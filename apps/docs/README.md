# ForgeBench backend guide

This guide describes the backend structure and workflows implemented at the current project stage: project and repository setup, GitHub access, pinned repository snapshots, static repository analysis, AI-assisted task generation, reference-solution generation and review, and two-agent benchmarking.

## Backend modules

The NestJS application is composed from domain modules. Controllers own their HTTP routes; services own business logic; TypeORM entities live in an `entities` folder inside the module that owns the persisted data.

| Module | Responsibility | Persistence |
| --- | --- | --- |
| `AppModule` | Application composition, global configuration, PostgreSQL connection, and health check | Owns the root TypeORM connection |
| `ProjectsModule` | Create, list, update, and delete projects; return workspace counts | `projects/entities/project.entity.ts` |
| `RepositoriesModule` | Associate repositories with projects, list associations, remove links, and clone snapshots | `repositories/entities/` |
| `AnalysisModule` | Queue snapshot analysis, persist report history, and expose summaries and graph data | `analysis/entities/repository-analysis.entity.ts` |
| `TasksModule` | Retrieve context from selected analyzed baselines, generate AI task suggestions and provider-consistent reference plans/patches/tests, apply patches to isolated review copies, and save versioned task/reference records | `tasks/entities/` |
| `AgentsModule` | Register and configure coding agents and versioned agent settings | `agents/entities/` |
| `AgentsBenchmarkModule` | Queue two independent agent runs through Direct CLI or Harbor, collect patches, run isolated evaluations, and persist scores | `executions/entities/` |
| `GitHubModule` | Public repository discovery and allowlisted GitHub App access; list branches and commits | No local entity; GitHub remains the source of repository metadata |
| `WorkflowModule` | Legacy package workflow endpoints | Prototype state is stored in the artifact JSON file |

`TasksModule` owns task generation and reference-solution generation/review. Agent and benchmark records are persisted by `AgentsModule` and `AgentsBenchmarkModule`; the legacy workflow controller is not the benchmark execution API.

### Source layout

```text
apps/backend/src/
  app.controller.ts                 # Health endpoint
  app.module.ts                     # Root configuration and module composition
  main.ts                           # CORS, /api/v1 prefix, HTTP listener
  database/
    migrations/                     # Project, repository, analysis, task, and reference schema migrations
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
  tasks/
    tasks.controller.ts
    tasks.module.ts
    tasks.service.ts
    reference-solutions.service.ts
    reference-solutions.processor.ts
    entities/
      task-generation.entity.ts
      task.entity.ts
      task-version.entity.ts
      reference-solution.entity.ts
  agents/
    agents.controller.ts
    agents.service.ts
    entities/
  executions/
    agents-benchmark.controller.ts
    agent-benchmark.service.ts
    entities/
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

Agent assignments, executions, submissions, and evaluations use TypeORM entities. GitHub metadata is fetched from GitHub, while the legacy workflow state remains JSON-backed.

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

ProjectEntity 1 ─── * TaskGenerationEntity 1 ─── * TaskEntity 1 ─── * TaskVersionEntity
```

- **ProjectEntity** (`projects`) stores the project name, description, status, and timestamps.
- **RepositoryEntity** (`repositories`) stores a GitHub repository's provider ID, owner/name, HTTPS clone URL, visibility, default branch, and timestamps. Its provider/remote ID pair is unique so one repository can be reused by multiple projects.
- **ProjectRepositoryEntity** (`project_repositories`) links one project to one repository and stores that project's component role and selected branch/full commit SHA. A project/repository pair is unique.
- **RepositorySnapshotEntity** (`repository_snapshots`) records a checkout attempt/result for a repository and exact commit SHA. The repository/commit pair is unique; the local checkout path is not returned by the API.
- **RepositoryAnalysisEntity** (`repository_analyses`) records queued, running, completed, or failed analysis for one ready snapshot. It stores the source-grounded summary and report as JSONB, analyzer version, warnings, and any failure message.
- **TaskGenerationEntity** (`task_generation_runs`) records task-generation inputs, status/error, AI provider/model/prompt version, candidate drafts, and the context manifest used for the run.
- **TaskEntity** (`tasks`) stores a saved draft, its structured requirements/acceptance criteria, baseline and source-evidence manifests, and its current version number. Tasks remain editable drafts until the approved reference is selected for benchmarking.
- **TaskVersionEntity** (`task_versions`) stores an immutable JSONB snapshot for each saved or edited task version.

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

### Generate, review, and manage tasks

The Task Generator uses an analyzed repository baseline to prepare editable task drafts. It does not execute code, create pull requests, or run benchmark evaluations.

For the detailed end-to-end flow—including the exact UI/backend inputs, context retrieval, what the LLM receives, validation, provenance, provider configuration, and saving reviewed drafts—see [Task Generation: Complete Flow](./task-generation.md).

For generating file-by-file implementation plans, repository-specific code patches, public tests, provider continuity, pinned-snapshot patch preflight, reference history, and the human validation/review gate, see [Reference Solution Generation and Review](./reference-solutions.md).

For the investigation of a malformed generated patch rejected by `git apply --check`, including the exact hunk-count mismatch and recovery steps, see [Reference Patch Application Failure Report](./reference-patch-application-failure-report.md).

For the two-agent execution, isolated submission collection, public/hidden test evaluation, Gemini CLI credentials, score model, and current Harbor integration scope, see [Agent Execution and Evaluation](./agent-execution-evaluation.md).

For a chronological status of the project, current workflow, active showstoppers, test evidence, and recommended improvements, see [Project Improvements and Showstoppers](./project-improvements-and-showstoppers.md).

1. The frontend loads `GET /api/v1/projects/:id/task-context`. For each repository attached to the project, the backend finds the latest completed analysis for that association's currently selected commit and verifies that its snapshot is still ready. The API returns analysis IDs, roles, module names, and readiness, but never returns local checkout paths.
2. Select one or more ready component analyses, enter an optional task idea, category, difficulty, constraints, and suggestion count, choose **OpenRouter** or **Ollama**, then request suggestions. The backend checks that each selected analysis belongs to the project and matches the project's pinned commit before creating a generation-history row.
3. The backend resolves verified checkout paths from the ready snapshot records and sends the analysis summary/report and pinned metadata to the Python service. The Python service only accepts paths under `REPOSITORY_SCAN_ROOT`.
4. The Context Engine ranks supported source files using lexical matches over repository paths, extracted symbols, routes, and entities; it includes structural/test evidence and expands a bounded number of static dependency neighbors. It extracts bounded source chunks and records file, symbol, line range, snapshot, and commit provenance. The current retrieval modes are `keyword`, `structure`, and `static_graph`; embeddings and vector semantic search are not implemented.
5. In Task Generator, select **OpenRouter** or **Ollama** for each generation. Both use the OpenAI-compatible chat-completions format. OpenRouter sends the bounded context to the configured hosted model and requires `OPENROUTER_API_KEY`; Ollama sends it to the configured Ollama endpoint and does not need a cloud API key. Ollama requests a strict JSON schema constrained to the requested suggestion count, known modules, and retrieved evidence references; the AI service validates the response before saving it.
6. The backend persists the completed generation, provider/model/prompt version, candidate suggestions, and provenance manifest. In the review UI, edit a suggestion and save it as a task draft. Saved drafts are listed in the Task Library; edits create a new immutable version, and the task detail view shows its evidence and version history.

OpenRouter settings are `OPENROUTER_API_KEY`, `OPENROUTER_BASE_URL` (default `https://openrouter.ai/api/v1`), and `OPENROUTER_MODEL` (default `baidu/ernie-5.5-flash-preview:free`). The key is passed to the AI-service container and is not stored in PostgreSQL. Ollama settings are `OLLAMA_BASE_URL` (default `http://host.docker.internal:11434/v1`), `OLLAMA_MODEL` (default `qwen2.5:7b`), and `OLLAMA_CONTEXT_LENGTH` (default `16384`). `TASK_CONTEXT_TOKEN_BUDGET` and `TASK_OUTPUT_TOKEN_BUDGET` apply to either provider. Missing or invalid provider configuration returns a clear error rather than fabricated suggestions.

OpenRouter is a hosted service: selected repository source excerpts and task context are sent to the configured OpenRouter model. Ollama can keep those excerpts on a local model endpoint; ensure the configured endpoint is actually local if that is a data-handling requirement. The provider can be selected independently for each generation, and the selected provider/model are retained in generation history.

For Docker-based Ollama, Compose includes an optional `ollama` profile so the model server does not consume resources unless requested. Set `OLLAMA_BASE_URL=http://ollama:11434/v1` in the local environment, start that profile, and pull the configured model as described in the run session below. Alternatively, install Ollama on the host and use the default `host.docker.internal` URL.

## HTTP API ownership

All paths below are relative to `/api/v1`.

| Controller/module | Routes |
| --- | --- |
| `AppController` | `GET /health` |
| `ProjectsController` | `GET /dashboard`, `GET /projects`, `POST /projects`, `GET /projects/:id`, `PATCH /projects/:id`, `DELETE /projects/:id` |
| `GitHubController` | `GET /github/install-url`, `GET /github/repositories`, `GET /github/repositories/:owner/:name/branches`, `GET /github/repositories/:owner/:name/commits?branch=...` |
| `RepositoriesController` | `GET /repositories`, `GET /projects/:id/repositories`, `POST /projects/:id/repositories`, `DELETE /projects/:id/repositories/:repositoryId`, `POST /projects/:id/repositories/:repositoryId/snapshots` |
| `AnalysisController` | `POST /repositories/:id/analyze`, `GET /repositories/:id/analyses`, `GET /analyses/:id`, `GET /analyses/:id/summary`, `GET /analyses/:id/graph` |
| `TasksController` | `GET /projects/:id/task-context`, `GET /projects/:id/task-generations`, `POST /projects/:id/tasks/suggest` (body includes `provider: "openrouter" \| "ollama"`), `GET /projects/:id/tasks`, `POST /projects/:id/tasks`, `GET /tasks?projectId=...`, `GET /tasks/:id`, `PATCH /tasks/:id`, `GET /tasks/:id/versions`, `POST /tasks/:id/references/generate`, `GET /tasks/:id/references`, `GET /references/:id`, `POST /references/:id/validation`, `PATCH /references/:id/review` |
| `WorkflowController` | Legacy package workflow endpoints |
| `AgentsController` | `GET /agents`, `POST /agents`, `PATCH /agents/:id`, `POST /agents/seed` |
| `AgentsBenchmarkController` | `POST /tasks/:id/agents/execute`, `GET /tasks/:id/benchmark`, `GET /executions/:id`, `GET /evaluations/:id`, `POST /references/:id/hidden-tests` |

## Technology

- **NestJS / TypeScript** provide the HTTP API and module/dependency-injection boundaries.
- **TypeORM / PostgreSQL** persist projects, repository metadata, associations, and snapshot records.
- **Octokit** handles public GitHub API calls and GitHub App installation authentication.
- **simple-git / Git** clone repositories and verify immutable commit checkouts.
- **BullMQ / Redis** run repository analysis outside the HTTP request and track its durable PostgreSQL status.
- **Python / FastAPI / Tree-sitter** scan pinned source files and produce repository metadata and a bounded static graph; the AI service also performs bounded task-context retrieval and validates OpenAI-compatible chat completions from the selected provider.
- **OpenRouter / Ollama** provide selectable hosted or local model backends for task suggestions. OpenRouter needs an API key; Ollama needs a running server and a pulled local model.
- **Docker Compose** runs PostgreSQL, Redis, the backend, AI service, and frontend for the local prototype. Repository analysis uses Redis for its queue and the AI service for static scanning.

## End-to-end run session

This is the recommended way to start and use the whole prototype. Run the commands from the repository root in Windows PowerShell. Install and start Docker Desktop first.

### 1. Prepare local configuration

Create the ignored local environment file only if you do not already have one:

```powershell
if (-not (Test-Path apps\backend\.env)) {
  Copy-Item apps\backend\.env.example apps\backend\.env
}
```

Public GitHub access works without a token, subject to GitHub's shared rate limit. For higher public API quotas, set `GITHUB_TOKEN` only in `apps\backend\.env`. For private repositories, configure the GitHub App values described in [Configuration](#configuration). Never put credentials in `.env.example` or commit `apps\backend\.env`.

To enable OpenRouter task suggestions, add an OpenRouter API key to the ignored `apps\backend\.env` as `OPENROUTER_API_KEY=...`. This is optional for starting the app and for repository analysis. OpenRouter sends selected source excerpts to its hosted model; review your data-sharing requirements before using it.

For local Ollama, either use the optional Compose profile or install Ollama on the host. For the Compose profile, set `OLLAMA_BASE_URL=http://ollama:11434/v1` in `apps\backend\.env`; start the profile and download the configured model:

```powershell
docker compose --profile ollama --env-file apps\backend\.env up -d ollama ai-service
docker compose --profile ollama exec ollama ollama pull qwen2.5:7b
```

Change the `ollama pull` model to match `OLLAMA_MODEL`. The model is downloaded into the persistent `ollama_data` Docker volume. The host-installed option uses `http://host.docker.internal:11434/v1`; Ollama must be running and reachable from the containers.

For a smaller local model, set `OLLAMA_MODEL=qwen2.5:3b` in `apps/backend/.env` and pull that tag instead of the default 7B model. Qwen 2.5 3B has been verified with a live repository-grounded task-generation request in this Compose setup.

### 2. Start all services

```powershell
docker compose --env-file apps\backend\.env up --build -d
docker compose ps
```

Wait until each service reports `healthy` or `running`. Compose starts PostgreSQL, Redis, the NestJS backend, the FastAPI AI service, and the React frontend. The ports are bound to localhost:

- Frontend: [http://localhost:5173](http://localhost:5173)
- Backend health: [http://localhost:4000/api/v1/health](http://localhost:4000/api/v1/health)
- AI service health: [http://localhost:8000/health](http://localhost:8000/health)
- PostgreSQL: `localhost:5432`
- Redis: `localhost:6379`

Check the health endpoints from PowerShell if needed:

```powershell
Invoke-RestMethod http://localhost:4000/api/v1/health
Invoke-RestMethod http://localhost:8000/health
Invoke-WebRequest -UseBasicParsing http://localhost:5173/health
```

### 3. Use the application

1. Open [http://localhost:5173](http://localhost:5173) and create a project.
2. Add a repository using GitHub search or its HTTPS URL. Load branches, choose a branch and commit, set the component role, then select **Add repository**. This saves repository metadata and the baseline selection; it does not clone files.
3. On the repository row, select **Clone snapshot** and wait for the snapshot to become `ready`. The checkout is pinned to the selected full commit SHA and stored in the Docker artifact volume.
4. Select **Analyze** for that repository and start an analysis. The page shows the queued/running/completed state and keeps previous reports in analysis history.
5. In a completed report, use **Overview**, **Feature map**, **File structure**, and **Module map** to inspect the saved snapshot. The maps are based on detected source directories (including nested layouts such as `backend/src` and `frontend/src`); the scanner does not execute repository code or infer product features with an LLM.
6. Open **Task Generator**, select one or more ready analyses for the project's currently selected commit, and enter the task-generation preferences. Review and edit the source-grounded suggestions, then save chosen drafts.
7. Open **Task Library** to list saved drafts. Select a task to review its baseline/evidence and version history; editing a saved task creates a new version.
8. In the selected task's **Reference implementation** panel, generate a file-by-file plan, patch bundle, and test files. The reference uses the provider from the task-generation run. The backend checks each generated patch against its pinned snapshot before marking the reference ready for review. Apply passing patches to a separate copy, download it, run reviewed build/test commands in your controlled environment, and record the results. ForgeBench does not execute repository code.

Reports are immutable records of their analyzed snapshot and analyzer version. If you select a different commit or want to use an updated analyzer, start a new analysis; an older saved report is not rewritten.

Choose OpenRouter or Ollama in the Task Generator. OpenRouter requires its key; Ollama requires the configured endpoint and model to be available. The current context retrieval is bounded lexical/structural/static-graph retrieval, not embedding/vector search. No task is automatically executed or evaluated.

### 4. Logs and shutdown

```powershell
docker compose logs -f backend ai-service frontend
```

Stop following logs with `Ctrl+C`; this does not stop the containers. To stop the application and keep database and repository data:

```powershell
docker compose down
```

`docker compose down -v` also deletes the PostgreSQL, Redis, and artifact volumes. Use it only when you intentionally want to erase local application data.

### Development commands and tests

For host-based development, the root scripts are `npm run dev:backend`, `npm run dev:frontend`, and `npm run dev:ai`. Run PostgreSQL and Redis with Compose; repository analysis also requires the AI service and shared artifact storage, so use the full Docker session above for end-to-end verification.

```powershell
npm run build
npm run test
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
| `AI_SERVICE_URL` | Internal URL of the Python analysis and task-context service |
| `OPENROUTER_API_KEY` | OpenRouter API key; passed to the AI-service container |
| `OPENROUTER_BASE_URL` | OpenRouter API base URL (default `https://openrouter.ai/api/v1`) |
| `OPENROUTER_MODEL` | OpenRouter model slug (default `baidu/ernie-5.5-flash-preview:free`) |
| `OLLAMA_BASE_URL` | Ollama OpenAI-compatible base URL (default `http://host.docker.internal:11434/v1`; use `http://ollama:11434/v1` for the Compose profile) |
| `OLLAMA_MODEL` | Ollama model tag (default `qwen2.5:7b`) |
| `OLLAMA_CONTEXT_LENGTH` | Context window configured on the optional Ollama container (default `16384`) |
| `TASK_CONTEXT_TOKEN_BUDGET` | Approximate source-context token budget (default `10000`) |
| `TASK_OUTPUT_TOKEN_BUDGET` | Provider task-generation output token budget (default `3000`) |
| `REFERENCE_OUTPUT_TOKEN_BUDGET` | Maximum output tokens requested for generated reference solutions (default `64000`) |

When `OPENROUTER_API_KEY` is stored in `apps/backend/.env`, start or recreate the AI service with `docker compose --env-file apps\backend\.env ...`. The backend's service-level `env_file` only configures the backend container; Compose needs `--env-file` to interpolate the key into the AI-service environment.

The example leaves `GITHUB_TOKEN` blank. Without authentication, GitHub limits public REST API requests by the shared client IP; set a token only in `apps/backend/.env` to authenticate public repository search, branch, and commit requests. Keep the token local and do not commit it. If GitHub rejects configured credentials, the API returns an actionable upstream error instead of a generic 500. Revoke and replace any credential that has been committed or shared. The token is not used to access private repositories; private repository access continues to require the GitHub App allowlist.

For a GitHub App, grant only the read permissions required for repository contents and metadata, and install it only on repositories ForgeBench should access. Keep the private key in the local environment file; do not commit it.
