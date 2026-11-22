# Harbor Framework: Complete Dockerized Setup, Troubleshooting & Architecture Guide

A comprehensive, production-grade guide for orchestrating, evaluating, and running AI agents (including Google DeepMind's **Antigravity CLI**) inside fully sandboxed Docker environments using the **Harbor** evaluation framework.

---

## 1. High-Level Architecture & Lifecycle

Harbor is designed to evaluate autonomous agents based on the **end-state of an operating system**, rather than simple text outputs or string-matching.

### Evaluation Workflow

```mermaid
flowchart TD
    A[Job Config: job.yaml] -->|harbor run| B[Harbor Engine]
    B -->|Mount Docker Socket / DinD| C[Provision Task Container]
    C -->|Inject instruction.md| D[Agent Environment: Dockerfile]
    D -->|Executes inside sandbox| E[Agent: Antigravity CLI]
    E -->|read_file / edit_file / bash| F[Workspace State Modified]
    F -->|shared mode| G[Verifier: tests/test.sh]
    G -->|Grading| H[/logs/verifier/reward.txt: 1.0 or 0.0]
    H --> I[Harbor Aggregator: result.json]
    I --> J[Web Dashboard: harbor view]
```

### Key Lifecycle Phases

1. **Environment Setup:** Builds and runs the task's `environment/Dockerfile` (`sleep infinity` as PID 1).
2. **Agent Installation:** Downloads and provisions the required CLI agent (`antigravity-cli`, `claude-code`, etc.) inside the container via `docker exec`.
3. **Execution Phase:** Feeds `instruction.md` to the agent. The agent iteratively investigates, plans, edits files, and executes commands.
4. **Verification Phase:** Executes `tests/test.sh`. Evaluates the mutated workspace state and outputs a reward to `/logs/verifier/reward.txt`.
5. **Artifact & Trajectory Ingestion:** Dumps JSONL trajectories, tokens used, cost, tool traces, and final scores to `jobs/<job_name>/`.

---

## 2. Directory Layout of a Standard Harbor Task

Every task is self-contained. Below is the blueprint used for evaluation:

```
my-task/
├── instruction.md          # Natural-language task prompt given to the AI agent
├── task.toml               # Task metadata, timeout constraints, and verifier configuration
├── environment/
│   ├── Dockerfile          # Container environment specification where the task lives
│   └── <initial_files>     # Starter codebase, broken scripts, or configs
├── solution/
│   └── solve.sh            # Oracle reference solution (used for task validation)
└── tests/
    ├── test.sh             # Main verifier script (grades the environment)
    └── test_outputs.py     # Optional unit tests (e.g. pytest) called by test.sh
```

---

## 3. Post-Mortem: All Bugs Encountered & Exact Root Causes

During setup, we navigated several subtle configuration hurdles. Below is the complete record of every failure mode, root cause, and architectural fix.

### Bug 1: Invalid Task Package Name
* **Error:** `tasks\hello-python\task.toml [invalid-task-config] task.name: Invalid configuration (value_error)`
* **Root Cause:** Harbor adheres to package registry conventions. A task name cannot be a flat string (`hello-python`); it **must** follow the namespace format `org/name` (e.g., `poc/hello-python` or `benchmark/hello-python`).
* **Fix:**
  ```toml
  [task]
  name = "poc/hello-python"
  ```

---

### Bug 2: Missing Verifier Sandbox Definition
* **Error:** `tasks\hello-python\task.toml [shared-verifier] Verifier shares the agent sandbox; set verifier.environment_mode = "separate"`
* **Root Cause:** Harbor's default static linter strictly enforces `environment_mode = "separate"` to prevent untrusted agents from tampering with test scripts.
* **Fix:** Explicitly configure the execution mode in `task.toml`:
  ```toml
  [verifier]
  timeout_sec = 60.0
  environment_mode = "shared"
  ```

---

### Bug 3: Windows Shell Variable Scoping (`export` in PowerShell)
* **Error:** `antigravity-cli: no nonempty model API key selected. Set VERTEXAI_PROJECT or GEMINI_API_KEY...`
* **Root Cause:** The `export` command is a POSIX bash built-in. Executing `export GEMINI_API_KEY=...` in PowerShell silently fails to bind process environment variables in Windows.
* **Fix:** Use PowerShell syntax:
  ```powershell
  $env:GEMINI_API_KEY = "your_api_key_here"
  ```

---

### Bug 4: Harbor Automatic Provider Resolution Mapping to Vertex AI
* **Error:** `ValueError: Antigravity CLI backend 'vertex_ai' is unsupported; it requires the native Gemini API`
* **Root Cause:** When given a model string starting with `gemini-*`, Harbor's internal model resolver defaults to routing traffic through Google Cloud Vertex AI SDKs. `antigravity-cli` requires Google AI Studio's direct REST interface (`generativelanguage.googleapis.com`).
* **Fix:** Add `skip_model_parsing: true` and specify the API key selector in `job.yaml`:
  ```yaml
  agents:
    - name: antigravity-cli
      model_name: gemini-3.1-flash-lite
      skip_model_parsing: true
      model_api_key_name: GEMINI_API_KEY
  ```

---

### Bug 5: Job Directory Resumption Collision
* **Error:** `FileExistsError: Job directory jobs\hello-python-antigravity already exists and cannot be resumed with a different config.`
* **Root Cause:** Harbor guarantees benchmark immutability. If any parameter in `job.yaml` is modified, Harbor refuses to overwrite or append to an existing job folder of the same name.
* **Fix:** Purge the old job directory before re-running:
  ```powershell
  Remove-Item -Recurse -Force jobs\hello-python-antigravity
  ```

---

### Bug 6: Windows Code Page 1252 Unicode Mismatch
* **Error:** `UnicodeEncodeError: 'charmap' codec can't encode character '\u2192' in position 55`
* **Root Cause:** Harbor streams debug status containing Unicode arrows (`→`). Standard Windows terminals default to legacy CP1252, which fails to encode these glyphs.
* **Fix:** Force Python to run in UTF-8 mode:
  ```powershell
  $env:PYTHONUTF8 = "1"
  ```

---

### Bug 7: Model Deprecation for Newly Created API Keys
* **Error:** `Error 404, Message: This model models/gemini-2.5-flash is no longer available to new users. Please update your code to use models/gemini-3.8-flash.`
* **Root Cause:** Google AI Studio periodically deprecates older model endpoints for newly generated API credentials.
* **Fix:** Inspect available models using the Google Gemini API `v1beta/models` endpoint and bind an active model identifier (e.g., `gemini-3.8-flash` or `gemini-3.1-flash-lite`).

---

### Bug 8: Free Tier 503 Overload & 429 Quota Exhaustion
* **Error 1:** `ApiOverloadedError: Error 503 ... This model is currently experiencing high demand.`
* **Error 2:** `ApiRateLimitError: Error 429 ... Generate content requests per day limit exceeded on Free Tier` for `gemini-3.1-pro`.
* **Root Cause:** Google AI Studio Free Tier assigns minimal daily requests to Pro models and deprioritizes free traffic during demand spikes.
* **Fix:** Use **`gemini-3.1-flash-lite`**, which has high RPM and daily allowances under the Free tier.

---

### Bug 9: Verifier Isolation Mismatch (`separate` vs `shared`)
* **Error:** Agent executed flawlessly (`status: SUCCESS`, modified `=+` to `+=`, confirmed output `15`), but trial resulted in **`reward: 0.0`**.
* **Root Cause:** In `separate` mode, Harbor boots a fresh container to run `tests/test.sh`. Without an artifact pipeline configured to export mutated files from the agent container into the verifier container, the verifier tested the untouched, broken file.
* **Fix:** Set `environment_mode = "shared"` in `task.toml` for single-container challenges.

---

### Bug 10: Empty Logs in Docker Desktop
* **Symptom:** Docker Desktop container logs showed nothing during trial execution.
* **Root Cause:** Harbor starts the environment container with `sh -c 'sleep infinity'` as PID 1. All agent installations and commands are injected via `docker exec`, whose stdout streams directly to Harbor's host process rather than container PID 1.
* **Fix:** Monitor the live stream inside the container:
  ```bash
  docker exec -it <container_name> tail -f /logs/agent/antigravity-stream.jsonl
  ```

---

## 4. Fully Dockerized Deployment (Everything in Docker)

Running both Harbor and the target tasks inside isolated Docker containers eliminates host dependency issues.

### `Dockerfile.harbor` (The Harbor Orchestrator Image)

```dockerfile
FROM python:3.12-slim

# Install system dependencies & Docker CLI (to talk to host daemon via socket)
RUN apt-get update && apt-get install -y \
    ca-certificates \
    curl \
    git \
    make \
    docker.io \
    && rm -rf /var/lib/apt/lists/*

# Install Harbor Framework
RUN pip install --no-cache-dir harbor

WORKDIR /harbor-poc

# Set default encoding to UTF-8
ENV PYTHONUTF8=1

CMD ["harbor", "--help"]
```

---

### `docker-compose.yml` (Dual-Mode Orchestration)

```yaml
version: "3.9"

services:
  # 1. Harbor Runner Service (Runs Harbor and spawns task containers via host Docker daemon)
  harbor-runner:
    build:
      context: .
      dockerfile: Dockerfile
    container_name: harbor-runner
    volumes:
      # Mount the Docker socket so Harbor can spawn sibling containers
      - /var/run/docker.sock:/var/run/docker.sock
      - .:/harbor-poc
    environment:
      - GEMINI_API_KEY=${GEMINI_API_KEY}
      - PYTHONUTF8=1
    working_dir: /harbor-poc
    # Command to execute a job directly
    command: ["harbor", "run", "--config", "job.yaml"]
    profiles: ["runner"]

  # 2. Web Trajectory Viewer UI
  harbor-viewer:
    build:
      context: .
      dockerfile: Dockerfile
    container_name: harbor-viewer
    volumes:
      - ./jobs:/harbor-poc/jobs
    ports:
      - "8080:8080"
    working_dir: /harbor-poc
    command: ["harbor", "view", "jobs", "--host", "0.0.0.0", "--port", "8080"]
    profiles: ["ui"]

  # 3. Local Mock Simulator (Runs without AI agent or API keys)
  task-simulator:
    build:
      context: ./tasks/hello-python/environment
      dockerfile: Dockerfile
    container_name: harbor-task-sim
    volumes:
      - ./tasks/hello-python/tests:/tests:ro
      - ./tasks/hello-python/solution:/solution:ro
      - task-logs:/logs
    working_dir: /workspace
    command: >
      bash -c "
        echo '=== 1. Workspace State (Buggy) ===' &&
        python /workspace/buggy_sum.py || true &&
        echo '=== 2. Applying Reference Solution ===' &&
        bash /solution/solve.sh &&
        echo '=== 3. Running Verifier Script ===' &&
        bash /tests/test.sh &&
        echo '=== 4. Final Reward Score ===' &&
        cat /logs/verifier/reward.txt
      "
    profiles: ["simulate"]

volumes:
  task-logs:
```

---

## 5. Blueprint: Creating a Task from Scratch in Any Repository

Follow this recipe to evaluate an agent in any codebase.

### Step 1: Create Task Directory
```bash
mkdir -p tasks/fix-database-query/{environment,solution,tests}
```

### Step 2: Define `tasks/fix-database-query/task.toml`
```toml
version = "1.0"

[task]
name = "myorg/fix-database-query"

[metadata]
author_name = "Engineering Team"
category = "backend-engineering"
difficulty = "medium"
tags = ["python", "sql", "performance"]

[agent]
timeout_sec = 600.0

[verifier]
timeout_sec = 60.0
environment_mode = "shared"

[environment]
build_timeout_sec = 300.0
```

### Step 3: Define `tasks/fix-database-query/instruction.md`
```markdown
# Optimize SQL Query Execution

The database query in `/workspace/repository.py` is experiencing N+1 query performance degradation.

## Instructions
1. Inspect `/workspace/repository.py`.
2. Refactor the `get_user_orders()` function to use eager loading (`select_related` or `JOIN`).
3. Ensure running `pytest /workspace/tests` passes within 1.0 second.
```

### Step 4: Define `tasks/fix-database-query/environment/Dockerfile`
```dockerfile
FROM python:3.12-slim

WORKDIR /workspace

RUN apt-get update && apt-get install -y git curl && rm -rf /var/lib/apt/lists/*
RUN pip install pytest sqlalchemy

COPY ./repository.py /workspace/repository.py
COPY ./test_repo.py /workspace/tests/test_repo.py

# REQUIRED: Verifier logs output path
RUN mkdir -p /logs/verifier

CMD ["/bin/bash"]
```

### Step 5: Define `tasks/fix-database-query/solution/solve.sh`
```bash
#!/bin/bash
set -e
cat << 'EOF' > /workspace/repository.py
# Fixed implementation code here
EOF
```

### Step 6: Define `tasks/fix-database-query/tests/test.sh`
```bash
#!/bin/bash
REWARD_FILE="/logs/verifier/reward.txt"
mkdir -p /logs/verifier

pytest /workspace/tests/test_repo.py > /logs/verifier/pytest.log 2>&1
if [ $? -eq 0 ]; then
    echo "1.0" > "$REWARD_FILE"
else
    echo "0.0" > "$REWARD_FILE"
fi
exit 0
```

---

## 6. Execution Command Reference

### Docker-Only Commands (Host-Independent)

```bash
# 1. Run local mock simulation (no API keys required)
docker compose --profile simulate up --build

# 2. Run agent evaluation inside Docker
docker compose --profile runner run \
  -e GEMINI_API_KEY="AIzaSy..." \
  harbor-runner harbor run --config job.yaml

# 3. Launch Web Dashboard UI
docker compose --profile ui up -d
# Navigate to http://localhost:8080
```

### Local CLI Commands

```powershell
# Set Environment Variables
$env:PYTHONUTF8 = "1"
$env:GEMINI_API_KEY = "AIzaSy..."

# Lint task definition
harbor lint tasks/hello-python

# Run trial
harbor run --config job.yaml

# Monitor live agent progress inside container
docker exec -it <container_name> tail -f /logs/agent/antigravity-stream.jsonl

# Start web viewer
harbor view jobs --port 8080
```
