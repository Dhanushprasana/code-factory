# Harbor POC

A self-contained **Proof-of-Concept** for the [Harbor](https://github.com/google-deepmind/harbor) AI agent evaluation framework. Harbor orchestrates sandboxed tasks in Docker containers and measures how well AI agents solve them.

> **No API key required** to explore the task structure and run the included simulator. You only need an API key to run a live AI agent trial.

---

## Table of Contents

1. [What is Harbor?](#what-is-harbor)
2. [Prerequisites](#prerequisites)
3. [Project Structure](#project-structure)
4. [Quick Start](#quick-start)
5. [Running a Live Trial with an AI Agent](#running-a-live-trial-with-an-ai-agent)
6. [Creating Your Own Task](#creating-your-own-task)
7. [Understanding Rewards and Scoring](#understanding-rewards-and-scoring)
8. [Cloud Scaling with Daytona / Modal](#cloud-scaling-with-daytona--modal)
9. [Troubleshooting](#troubleshooting)

---

## What is Harbor?

Harbor is an **AI agent evaluation framework** that:

- Spins up an isolated Docker container (the *environment*) containing a task for an agent to solve.
- Launches an AI agent (Claude, GPT-4, etc.) inside or alongside that environment.
- After the agent finishes (or times out), runs a *verifier* script that grades the result and writes a numeric reward to `/logs/verifier/reward.txt`.
- Collects results across many tasks to benchmark agent capabilities.

Each task is a self-contained directory with:

| File | Purpose |
|------|---------|
| `instruction.md` | Natural-language instructions shown to the agent |
| `task.toml` | Metadata and timeout configuration |
| `environment/Dockerfile` | Defines the sandbox the agent operates in |
| `solution/solve.sh` | Oracle / reference solution (not shown to agent) |
| `tests/test.sh` | Verifier script — writes `0` or `1` to reward file |

---

## Prerequisites

| Tool | Minimum Version | Install |
|------|----------------|---------|
| Docker | 24+ | https://docs.docker.com/get-docker/ |
| Docker Compose | v2 (bundled with Docker Desktop) | — |
| Python | 3.11+ | https://www.python.org/downloads/ |
| make | any | Pre-installed on Linux/macOS; use [GnuWin32](http://gnuwin32.sourceforge.net/packages/make.htm) on Windows |

---

## Project Structure

```
harbor-poc/
├── README.md                          # This file
├── Dockerfile                         # Harbor runner image (installs harbor CLI)
├── docker-compose.yml                 # Orchestration for all services
├── Makefile                           # Convenience commands
├── .env.example                       # Environment variable template
│
├── tasks/
│   └── hello-python/                  # Sample task: fix a buggy Python script
│       ├── instruction.md             # Task instructions for the agent
│       ├── task.toml                  # Task metadata and timeouts
│       ├── environment/
│       │   ├── Dockerfile             # Task sandbox image
│       │   └── buggy_sum.py          # Pre-placed buggy script
│       ├── solution/
│       │   └── solve.sh              # Oracle solution
│       └── tests/
│           ├── test.sh               # Verifier (writes reward)
│           └── test_outputs.py       # pytest-based verifier
│
└── scripts/
    ├── run_local_trial.sh            # Full local simulation (no agent)
    └── verify_task.sh               # Validate task file structure
```

### The `hello-python` Task

The agent is placed in a Docker container with a buggy Python script at `/workspace/buggy_sum.py`. The script uses `=+` instead of `+=`, causing it to output `5` instead of `15`. The agent must identify and fix the bug.

**Buggy code:**
```python
total =+ num  # BUG: resets total to +num every iteration
```

**Fixed code:**
```python
total += num  # CORRECT: accumulates the sum
```

---

## Quick Start

### 1. Clone and configure

```bash
git clone <this-repo> harbor-poc
cd harbor-poc
cp .env.example .env
# Edit .env to add your API key (only needed for live agent runs)
```

### 2. Run the full simulation (no API key needed)

This builds the task environment, runs the buggy script, applies the oracle solution, and runs the verifier — all without an AI agent:

```bash
# Using Make
make simulate

# Or directly with Docker Compose
docker compose --profile simulate up --abort-on-container-exit task-simulator
```

Expected output:

```
=== Harbor Task Simulator ===
--- Task Environment Ready ---
Workspace contents:
total 4
-rw-r--r-- 1 root root ... buggy_sum.py

--- Running the BUGGY script (before fix) ---
Sum of [1, 2, 3, 4, 5] = 5

--- Applying oracle solution ---
Solution applied: fixed =+ to += in buggy_sum.py
Sum of [1, 2, 3, 4, 5] = 15

--- Running verifier tests ---
Running verifier for hello-python task...
Script output: Sum of [1, 2, 3, 4, 5] = 15
PASS: Correct sum output detected
Reward written to /logs/verifier/reward.txt: 1

--- Reward result ---
1
```

### 3. Open an interactive shell in the task environment

Explore the environment as an agent would see it:

```bash
make task-shell
# Inside the container:
cat /workspace/buggy_sum.py
python /workspace/buggy_sum.py
```

### 4. Validate the task structure

```bash
bash scripts/verify_task.sh tasks/hello-python
```

---

## Running a Live Trial with an AI Agent

### Install Harbor CLI

```bash
pip install harbor
harbor --help
```

### Run a trial

```bash
# Set your API key
export ANTHROPIC_API_KEY=your-key-here

# Run the hello-python task with Claude
harbor run tasks/hello-python --agent claude-3-5-sonnet-20241022

# Run with GPT-4
harbor run tasks/hello-python --agent gpt-4o
```

Harbor will:
1. Build the task environment Docker image
2. Start the container
3. Launch the agent with the contents of `instruction.md`
4. Wait for the agent to finish (or time out per `task.toml`)
5. Run the verifier and report the reward

### Docker-based runner

You can also run Harbor itself in a container (useful in CI):

```bash
# Build the harbor runner image
make build

# Run using Docker Compose
docker compose --profile runner run harbor-runner harbor run tasks/hello-python --agent claude-3-5-sonnet-20241022
```

---

## Creating Your Own Task

Follow these steps to add a new task to Harbor.

### Step 1: Create the task directory

```bash
mkdir -p tasks/my-task/{environment,solution,tests}
```

### Step 2: Write `instruction.md`

Describe what the agent should do in clear natural language. Be specific about:
- What files exist and where
- What the expected output or state change is
- Any constraints

```markdown
# My Task

There is a file at `/workspace/data.json`. Your task is to ...
```

### Step 3: Configure `task.toml`

```toml
version = "1.0"

[task]
name = "my-task"

[metadata]
author_name = "Your Name"
category = "data-processing"
difficulty = "medium"
tags = ["python", "json"]

[agent]
timeout_sec = 180.0

[verifier]
timeout_sec = 60.0

[environment]
build_timeout_sec = 300.0
```

### Step 4: Build the environment `Dockerfile`

Start from a suitable base image and place any initial files:

```dockerfile
FROM python:3.12-slim

WORKDIR /workspace

RUN pip install requests pandas  # any libraries the agent can use

COPY initial_files/ /workspace/

RUN mkdir -p /logs/verifier

CMD ["/bin/bash"]
```

> [!IMPORTANT]
> Always create `/logs/verifier/` in your Dockerfile — the verifier writes the reward there.

### Step 5: Write the oracle solution `solution/solve.sh`

```bash
#!/bin/bash
set -e
# This is the reference solution — not shown to the agent
python - << 'EOF'
import json
# ... fix the data
EOF
echo "Solution applied"
```

### Step 6: Write the verifier `tests/test.sh`

```bash
#!/bin/bash
REWARD_FILE="/logs/verifier/reward.txt"
mkdir -p /logs/verifier

# Check the result
if python /workspace/check.py; then
    echo "1" > "$REWARD_FILE"
else
    echo "0" > "$REWARD_FILE"
fi
echo "Reward: $(cat $REWARD_FILE)"
```

> [!NOTE]
> The verifier must always write `0` or `1` to `/logs/verifier/reward.txt` and exit cleanly (exit code 0). Never let the verifier crash without writing a reward.

### Step 7: Validate your task

```bash
bash scripts/verify_task.sh tasks/my-task
```

---

## Understanding Rewards and Scoring

Harbor uses a simple reward signal:

| Value | Meaning |
|-------|---------|
| `1`   | Agent successfully completed the task |
| `0`   | Agent failed or produced incorrect results |

The reward is written to `/logs/verifier/reward.txt` by your `tests/test.sh` verifier script. Harbor reads this file after the verifier container exits.

**Partial rewards** (values between 0 and 1) are also supported — for example:
```bash
echo "0.5" > "$REWARD_FILE"  # Partial credit
```

You can aggregate rewards across many trials to compute a **pass@k** score, measuring how often an agent solves a task within `k` attempts.

---

## Cloud Scaling with Daytona / Modal

For large-scale evaluations, Harbor supports cloud sandbox providers so you don't have to run Docker locally.

### Daytona

[Daytona](https://www.daytona.io/) provides on-demand cloud development environments.

```bash
# Add your Daytona API key to .env
DAYTONA_API_KEY=your-daytona-key

# Run with Daytona sandbox
harbor run tasks/hello-python \
    --agent claude-3-5-sonnet-20241022 \
    --sandbox daytona
```

### Modal

[Modal](https://modal.com/) runs containers serverlessly at scale.

```bash
# Add Modal credentials to .env
MODAL_TOKEN_ID=your-token-id
MODAL_TOKEN_SECRET=your-token-secret

# Run with Modal sandbox
harbor run tasks/hello-python \
    --agent claude-3-5-sonnet-20241022 \
    --sandbox modal
```

### Batch evaluation

Run a task across multiple agents and aggregate results:

```bash
harbor batch \
    --tasks tasks/ \
    --agents claude-3-5-sonnet-20241022,gpt-4o \
    --trials 5 \
    --output results.json
```

---

## Troubleshooting

### `docker: command not found`
Install Docker Desktop from https://docs.docker.com/get-docker/ and ensure it is running.

### `permission denied while trying to connect to the Docker daemon`
On Linux, add your user to the `docker` group:
```bash
sudo usermod -aG docker $USER
newgrp docker
```

### The simulator exits with reward `0`
Check that:
1. The verifier script ran successfully: `make logs`
2. The `/logs/verifier/` directory exists in the container (should be created by `Dockerfile`)
3. The oracle solution applied correctly — try `make task-shell` and run `bash /solution/solve.sh` manually

### `harbor: command not found`
Install it: `pip install harbor` — requires Python 3.11+. Check `python --version`.

### Shell scripts have Windows line endings (CRLF)
On Windows, convert scripts before mounting:
```bash
# In WSL or Git Bash
dos2unix scripts/*.sh tasks/**/*.sh
```
Or use the included scripts which are already written with LF endings.

### Docker build fails for the Harbor runner image
The `Dockerfile` at the project root installs `docker.io` inside the container (for Docker-in-Docker). If your Docker version is older, try replacing `docker.io` with `docker-ce-cli` in the Dockerfile.

### `make` is not recognized on Windows
Use [GnuWin32 make](http://gnuwin32.sourceforge.net/packages/make.htm) or run the Docker Compose commands directly as shown in the Quick Start section.
