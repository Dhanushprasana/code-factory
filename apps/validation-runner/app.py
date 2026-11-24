import hmac
import io
import json
import logging
import os
import re
import shutil
import subprocess
import tarfile
import time
from datetime import datetime, timezone
from pathlib import Path
from uuid import uuid4

import docker
from fastapi import FastAPI, Header, HTTPException
from pydantic import BaseModel, ConfigDict, Field
from docker.types import Mount

app = FastAPI()
logger = logging.getLogger("validation-runner")

REFERENCE_ID_PATTERN = re.compile(
    r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$",
    re.IGNORECASE,
)
REPOSITORY_ID_PATTERN = re.compile(r"^[a-zA-Z0-9_-]{1,128}$")
ALLOWED_EXECUTABLES = {
    "npm", "pnpm", "yarn", "node", "python", "python3", "pip", "pytest",
    "go", "cargo", "rustc", "mvn", "gradle", "make",
}
MAX_COMMANDS_PER_PHASE = 20
MAX_ARGUMENT_LENGTH = 512
MAX_LOG_BYTES = 16_384
MAX_WORKSPACE_BYTES = int(os.getenv("VALIDATION_MAX_WORKSPACE_BYTES", str(512 * 1024 * 1024)))
MAX_WORKSPACE_FILES = int(os.getenv("VALIDATION_MAX_WORKSPACE_FILES", "50000"))
COMMAND_TIMEOUT_SECONDS = int(os.getenv("VALIDATION_COMMAND_TIMEOUT_SECONDS", "600"))
VALIDATION_IMAGE = os.getenv("VALIDATION_IMAGE", "code-factory-validation:local")
ARTIFACT_ROOT = Path(os.getenv("VALIDATION_ARTIFACT_ROOT", "/workspace/storage")).resolve()
EGRESS_NETWORK = os.getenv("VALIDATION_EGRESS_NETWORK", "forgebench-validation-egress")


class CommandSpec(BaseModel):
    model_config = ConfigDict(extra="forbid")

    args: list[str] = Field(min_length=1, max_length=32)


class RepositoryPlan(BaseModel):
    model_config = ConfigDict(extra="forbid")

    repository_id: str
    setup_commands: list[CommandSpec] = Field(default_factory=list, max_length=MAX_COMMANDS_PER_PHASE)
    build_commands: list[CommandSpec] = Field(default_factory=list, max_length=MAX_COMMANDS_PER_PHASE)
    test_commands: list[CommandSpec] = Field(default_factory=list, max_length=MAX_COMMANDS_PER_PHASE)


class ExecutionRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    reference_id: str
    allow_network: bool = False
    repositories: list[RepositoryPlan] = Field(min_length=1, max_length=10)


def _client():
    try:
        return docker.from_env(timeout=30)
    except docker.errors.DockerException as error:
        raise HTTPException(status_code=503, detail="The isolated validation container runtime is unavailable.") from error


def _authorize(authorization: str | None) -> None:
    expected_token = os.getenv("VALIDATION_RUNNER_TOKEN", "")
    supplied_token = authorization.removeprefix("Bearer ").strip() if authorization else ""
    if not expected_token or not hmac.compare_digest(supplied_token, expected_token):
        raise HTTPException(status_code=401, detail="Validation runner authentication failed.")


def _validate_command(command: CommandSpec) -> None:
    if command.args[0] not in ALLOWED_EXECUTABLES:
        raise HTTPException(status_code=400, detail="The requested validation command is not supported.")
    if any(
        not isinstance(argument, str)
        or not argument
        or len(argument) > MAX_ARGUMENT_LENGTH
        or "\x00" in argument
        for argument in command.args
    ):
        raise HTTPException(status_code=400, detail="A validation command contains an invalid argument.")


def _workspace_path(reference_id: str, repository_id: str) -> Path:
    if not REFERENCE_ID_PATTERN.fullmatch(reference_id):
        raise HTTPException(status_code=400, detail="The reference identifier is invalid.")
    if not REPOSITORY_ID_PATTERN.fullmatch(repository_id):
        raise HTTPException(status_code=400, detail="The repository identifier is invalid.")
    workspace_root = ARTIFACT_ROOT / "reference-workspaces" / reference_id / "repositories"
    repository_path = workspace_root / repository_id
    if repository_path.is_symlink():
        raise HTTPException(status_code=400, detail="The review workspace repository cannot be a symbolic link.")
    resolved_root = workspace_root.resolve()
    resolved_path = repository_path.resolve()
    if resolved_root not in resolved_path.parents or not resolved_path.is_dir():
        raise HTTPException(status_code=404, detail="The applied reference workspace was not found.")
    return resolved_path


def _archive_workspace(repository_path: Path) -> bytes:
    buffer = io.BytesIO()
    file_count = 0
    total_bytes = 0
    with tarfile.open(fileobj=buffer, mode="w") as archive:
        for current_root, directories, filenames in os.walk(repository_path, followlinks=False):
            root = Path(current_root)
            for name in list(directories):
                source = root / name
                if source.is_symlink():
                    raise HTTPException(status_code=400, detail="The review workspace contains a symbolic link.")
                file_count += 1
                if file_count > MAX_WORKSPACE_FILES:
                    raise HTTPException(status_code=413, detail="The review workspace contains too many files.")
                info = archive.gettarinfo(str(source), arcname=source.relative_to(repository_path).as_posix())
                info.uid = 1000
                info.gid = 1000
                info.uname = "node"
                info.gname = "node"
                archive.addfile(info)
            for name in filenames:
                source = root / name
                if source.is_symlink() or not source.is_file():
                    raise HTTPException(status_code=400, detail="The review workspace contains an unsupported file.")
                total_bytes += source.stat().st_size
                file_count += 1
                if total_bytes > MAX_WORKSPACE_BYTES:
                    raise HTTPException(status_code=413, detail="The review workspace exceeds the configured size limit.")
                if file_count > MAX_WORKSPACE_FILES:
                    raise HTTPException(status_code=413, detail="The review workspace contains too many files.")
                info = archive.gettarinfo(str(source), arcname=source.relative_to(repository_path).as_posix())
                info.uid = 1000
                info.gid = 1000
                info.uname = "node"
                info.gname = "node"
                with source.open("rb") as file:
                    archive.addfile(info, file)
    return buffer.getvalue()


def _append_bounded(current: bytearray, chunk: bytes) -> bool:
    if not chunk:
        return False
    truncated = len(current) + len(chunk) > MAX_LOG_BYTES
    current.extend(chunk)
    if len(current) > MAX_LOG_BYTES:
        del current[: len(current) - MAX_LOG_BYTES]
    return truncated


def _run_command(container, command: CommandSpec, phase: str, repository_id: str, venv_path: str) -> dict:
    _validate_command(command)
    started_at = datetime.now(timezone.utc)
    started = time.monotonic()
    stdout = bytearray()
    stderr = bytearray()
    stdout_truncated = False
    stderr_truncated = False
    command_id = None
    try:
        created = container.client.api.exec_create(
            container.id,
            cmd=["timeout", "--signal=TERM", "--kill-after=5s", f"{COMMAND_TIMEOUT_SECONDS}s", *command.args],
            stdout=True,
            stderr=True,
            tty=False,
            workdir="/workspace",
            user="1000:1000",
            environment={
                "CI": "true",
                "HOME": "/tmp/home",
                "TMPDIR": "/tmp",
                "NPM_CONFIG_CACHE": "/tmp/npm-cache",
                "PIP_CACHE_DIR": "/tmp/pip-cache",
                "PATH": f"{venv_path}:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
            },
        )
        command_id = created["Id"]
        for output in container.client.api.exec_start(command_id, stream=True, demux=True):
            out_chunk, err_chunk = output
            stdout_truncated = _append_bounded(stdout, out_chunk) or stdout_truncated
            stderr_truncated = _append_bounded(stderr, err_chunk) or stderr_truncated
        exit_code = container.client.api.exec_inspect(command_id)["ExitCode"]
        status = "passed" if exit_code == 0 else "failed"
        error = None
    except docker.errors.DockerException as exception:
        exit_code = None
        status = "failed"
        error = str(exception)[:2000]

    return {
        "phase": phase,
        "command": command.args,
        "status": status,
        "exit_code": exit_code,
        "timed_out": exit_code == 124,
        "started_at": started_at.isoformat(),
        "duration_ms": round((time.monotonic() - started) * 1000),
        "stdout": stdout.decode("utf-8", errors="replace"),
        "stderr": stderr.decode("utf-8", errors="replace"),
        "stdout_truncated": stdout_truncated,
        "stderr_truncated": stderr_truncated,
        "error": error,
    }


def _blocked_commands(commands: list[CommandSpec], phase: str) -> list[dict]:
    return [
        {
            "phase": phase,
            "command": command.args,
            "status": "blocked",
            "exit_code": None,
            "timed_out": False,
            "stdout": "",
            "stderr": "",
            "error": "Environment setup failed; this command was not run.",
        }
        for command in commands
    ]


def _phase_status(results: list[dict], no_commands: str = "not_configured") -> str:
    if not results:
        return no_commands
    if any(result["status"] == "failed" for result in results):
        return "failed"
    if any(result["status"] == "blocked" for result in results):
        return "blocked"
    return "passed"


def _run_repository(client, request: ExecutionRequest, repository: RepositoryPlan, allow_network: bool) -> dict:
    repository_path = _workspace_path(request.reference_id, repository.repository_id)
    archive = _archive_workspace(repository_path)
    container = None
    workspace_volume = None
    network = None
    setup_results: list[dict] = []
    build_results: list[dict] = []
    test_results: list[dict] = []
    started_at = datetime.now(timezone.utc)
    try:
        client.images.get(VALIDATION_IMAGE)
        workspace_volume = client.volumes.create(
            name=f"forgebench-validation-workspace-{uuid4().hex}",
            driver="local",
            driver_opts={
                "type": "tmpfs",
                "device": "tmpfs",
                "o": "size=4294967296,uid=1000,gid=1000,mode=1777",
            },
            labels={"forgebench.reference_id": request.reference_id, "forgebench.validation": "true"},
        )
        container = client.containers.create(
            VALIDATION_IMAGE,
            command=["sleep", "infinity"],
            name=f"reference-validation-{uuid4().hex}",
            detach=True,
            user="1000:1000",
            working_dir="/workspace",
            cap_drop=["ALL"],
            security_opt=["no-new-privileges:true"],
            pids_limit=256,
            mem_limit="2g",
            memswap_limit="2g",
            nano_cpus=2_000_000_000,
            tmpfs={
                "/tmp": "rw,nosuid,nodev,size=1073741824,mode=1777",
            },
            mounts=[Mount(target="/workspace", source=workspace_volume.name, type="volume")],
            environment={
                "CI": "true",
                "HOME": "/tmp/home",
                "TMPDIR": "/tmp",
                "NPM_CONFIG_CACHE": "/tmp/npm-cache",
                "PIP_CACHE_DIR": "/tmp/pip-cache",
            },
            labels={"forgebench.reference_id": request.reference_id, "forgebench.validation": "true"},
        )
        container.start()
        if not container.put_archive("/workspace", archive):
            raise HTTPException(status_code=500, detail="Could not copy the review workspace into the isolated container.")
        try:
            bridge_network = client.networks.get("bridge")
            bridge_network.disconnect(container)
        except docker.errors.DockerException:
            pass
        if allow_network and repository.setup_commands:
            network = client.networks.get(EGRESS_NETWORK)
            network.connect(container)

        venv_path = "/workspace/.venv/bin"
        setup_failed = False
        for command in repository.setup_commands:
            result = _run_command(container, command, "setup", repository.repository_id, venv_path)
            setup_results.append(result)
            if result["status"] != "passed":
                setup_failed = True
                break
        if setup_failed:
            setup_results.extend(
                _blocked_commands(repository.setup_commands[len(setup_results):], "setup")
            )
        if network is not None:
            network.disconnect(container)
            network = None

        if setup_failed:
            build_results = _blocked_commands(repository.build_commands, "build")
            test_results = _blocked_commands(repository.test_commands, "test")
        else:
            for command in repository.build_commands:
                build_results.append(_run_command(container, command, "build", repository.repository_id, venv_path))
            for command in repository.test_commands:
                test_results.append(_run_command(container, command, "test", repository.repository_id, venv_path))

        return {
            "repository_id": repository.repository_id,
            "status": "passed" if (
                not setup_failed
                and _phase_status(build_results) == "passed"
                and _phase_status(test_results) == "passed"
            ) else "failed",
            "environment": {
                "image": VALIDATION_IMAGE,
                "network_policy": "dependency setup only" if allow_network else "disabled",
                "node_version": _tool_version(container, ["node", "--version"]),
                "python_version": _tool_version(container, ["python3", "--version"]),
            },
            "setup_status": _phase_status(setup_results, no_commands="passed"),
            "build_status": _phase_status(build_results),
            "test_status": _phase_status(test_results),
            "setup": setup_results,
            "build": build_results,
            "tests": test_results,
            "started_at": started_at.isoformat(),
            "duration_ms": round((datetime.now(timezone.utc) - started_at).total_seconds() * 1000),
        }
    finally:
        if network is not None and container is not None:
            try:
                network.disconnect(container)
            except docker.errors.DockerException:
                pass
        if container is not None:
            try:
                container.remove(force=True)
            except docker.errors.DockerException:
                pass
        if workspace_volume is not None:
            try:
                workspace_volume.remove(force=True)
            except docker.errors.DockerException:
                pass


def _tool_version(container, command: list[str]) -> str | None:
    try:
        result = container.exec_run(command, user="1000:1000", demux=True)
        if result.exit_code != 0:
            return None
        output = result.output[0] if isinstance(result.output, tuple) else result.output
        return output.decode("utf-8", errors="replace").strip()[:128] if output else None
    except docker.errors.DockerException:
        return None


@app.get("/health")
def health():
    client = _client()
    try:
        client.ping()
        client.images.get(VALIDATION_IMAGE)
    except docker.errors.DockerException as error:
        raise HTTPException(status_code=503, detail="The validation image or container runtime is unavailable.") from error
    return {"status": "ok", "image": VALIDATION_IMAGE}


@app.post("/execute")
def execute(request: ExecutionRequest, authorization: str | None = Header(default=None)):
    _authorize(authorization)
    if not REFERENCE_ID_PATTERN.fullmatch(request.reference_id):
        raise HTTPException(status_code=400, detail="The reference identifier is invalid.")
    repository_ids = [repository.repository_id for repository in request.repositories]
    if len(set(repository_ids)) != len(repository_ids):
        raise HTTPException(status_code=400, detail="A repository may only be validated once per run.")
    for repository in request.repositories:
        if not REPOSITORY_ID_PATTERN.fullmatch(repository.repository_id):
            raise HTTPException(status_code=400, detail="A repository identifier is invalid.")
        for command in repository.setup_commands + repository.build_commands + repository.test_commands:
            _validate_command(command)

    server_allows_network = os.getenv("VALIDATION_ALLOW_NETWORK", "false").lower() == "true"
    allow_network = request.allow_network and server_allows_network
    client = _client()
    try:
        client.images.get(VALIDATION_IMAGE)
        if allow_network and any(repository.setup_commands for repository in request.repositories):
            try:
                client.networks.get(EGRESS_NETWORK)
            except docker.errors.NotFound:
                client.networks.create(
                    EGRESS_NETWORK,
                    driver="bridge",
                    labels={"forgebench.validation": "dependency-setup-egress"},
                )
        repositories = [
            _run_repository(client, request, repository, allow_network)
            for repository in request.repositories
        ]
    except HTTPException:
        raise
    except docker.errors.DockerException as error:
        logger.exception("Could not run a repository in the isolated validation container.")
        detail = str(error).splitlines()[0][:1000] or "Docker returned an unknown error."
        raise HTTPException(
            status_code=503,
            detail=f"The validation container could not be started: {detail}",
        ) from error
    finally:
        client.close()

    return {
        "run_id": str(uuid4()),
        "status": "passed" if all(repository["status"] == "passed" for repository in repositories) else "failed",
        "execution_mode": "automatic_container",
        "network_policy": "dependency setup only" if allow_network else "disabled",
        "repositories": repositories,
    }


class HarborEvaluationRequest(BaseModel):
    model_config = ConfigDict(extra="ignore")

    evaluation_id: str
    task_id: str
    package_path: str
    model_name: str
    harbor_harness: str = "openrouter"
    api_key: str
    timeout_seconds: int = 600
    harbor_files: dict[str, str] | None = None


def _normalize_task_toml(toml_str: str) -> str:
    def _repl(match):
        prefix = match.group(1)
        q1 = match.group(2)
        val = match.group(3)
        q2 = match.group(4)
        if "/" not in val:
            val = f"forgebench/{val}"
        return f"{prefix}{q1}{val}{q2}"

    return re.sub(r'(\bname\s*=\s*)(["\'])([^"\']+)(["\'])', _repl, toml_str, count=1)


def _ensure_dockerfile_agent_dependencies(dockerfile_content: str) -> str:
    """Inject aider pre-installation into task environment Dockerfiles.

    Strategy: install uv + Python 3.12 + aider-chat at image build time so
    Harbor's trial setup can skip the slow per-trial aider.chat/install.sh script
    (we set skip_install: true in job.yaml). This avoids the conflict where
    aider's install.sh downloads its own old uv (0.5.x) which cannot find the
    Python 3.12 managed by the newer uv we installed (0.13.x).
    """
    if "aider-chat" in dockerfile_content:
        # Already patched
        return dockerfile_content

    setup_block = (
        "\n# Pre-install aider for Harbor agent (skip_install: true in job.yaml)\n"
        "RUN (command -v apk >/dev/null 2>&1 && apk add --no-cache bash curl git coreutils python3 py3-pip) || \\\n"
        "    (command -v apt-get >/dev/null 2>&1 && apt-get update -qq && \\\n"
        "     apt-get install -y --no-install-recommends bash curl git coreutils ca-certificates python3 python3-pip && \\\n"
        "     rm -rf /var/lib/apt/lists/*) || true\n"
        "RUN curl -LsSf https://astral.sh/uv/install.sh | sh\n"
        "ENV PATH=\"/root/.local/bin:$PATH\"\n"
        "RUN uv python install 3.12 && \\\n"
        "    uv tool install --python 3.12 aider-chat && \\\n"
        "    ln -sf /root/.local/bin/aider /usr/local/bin/aider\n"
        "RUN for p in node_modules/ dist/ .next/ coverage/ .venv/ __pycache__/ '*.log'; do echo \"$p\" >> /app/.gitignore; done && \\\n"
        "    cp /app/.gitignore /app/.aiderignore\n"
    )

    if "WORKDIR" in dockerfile_content:
        dockerfile_content = re.sub(
            r"(WORKDIR\s+[^\n]+\n)",
            lambda m: m.group(1) + setup_block,
            dockerfile_content,
            count=1,
        )
    else:
        dockerfile_content = re.sub(
            r"(FROM\s+[^\n]+\n)",
            lambda m: m.group(1) + setup_block,
            dockerfile_content,
            count=1,
        )

    return dockerfile_content


@app.post("/harbor/evaluate")
def evaluate_harbor_task(
    request: HarborEvaluationRequest,
    authorization: str | None = Header(default=None),
):
    _authorize(authorization)
    start_time = time.time()

    package_dir = ARTIFACT_ROOT / request.package_path
    if not package_dir.exists():
        package_dir.mkdir(parents=True, exist_ok=True)

    # If package directory is empty or missing files, populate from harbor_files
    if request.harbor_files:
        h = request.harbor_files
        if h.get("instruction_md"):
            (package_dir / "instruction.md").write_text(h["instruction_md"], encoding="utf-8")
        if h.get("task_toml"):
            (package_dir / "task.toml").write_text(_normalize_task_toml(h["task_toml"]), encoding="utf-8")
        if h.get("dockerfile"):
            env_dir = package_dir / "environment"
            env_dir.mkdir(exist_ok=True)
            (env_dir / "Dockerfile").write_text(_ensure_dockerfile_agent_dependencies(h["dockerfile"]), encoding="utf-8")
        if h.get("solve_sh"):
            sol_dir = package_dir / "solution"
            sol_dir.mkdir(exist_ok=True)
            (sol_dir / "solve.sh").write_text(h["solve_sh"], encoding="utf-8")
        if h.get("test_sh"):
            test_dir = package_dir / "tests"
            test_dir.mkdir(exist_ok=True)
            (test_dir / "test.sh").write_text(h["test_sh"], encoding="utf-8")

    # Ensure task.toml on disk adheres to Harbor's required org/name package naming
    task_toml_path = package_dir / "task.toml"
    if task_toml_path.exists():
        current_toml = task_toml_path.read_text(encoding="utf-8")
        normalized_toml = _normalize_task_toml(current_toml)
        if normalized_toml != current_toml:
            task_toml_path.write_text(normalized_toml, encoding="utf-8")

    # Ensure environment directory has codebase snapshot files and Harbor dependencies
    env_dir = package_dir / "environment"
    env_dir.mkdir(exist_ok=True)
    dockerignore_file = env_dir / ".dockerignore"
    if not dockerignore_file.exists():
        dockerignore_file.write_text(
            "**/node_modules\n**/dist\n**/.git\n**/.next\n**/__pycache__\n**/.venv\n",
            encoding="utf-8",
        )
    dockerfile_file = env_dir / "Dockerfile"
    if dockerfile_file.exists():
        df_content = dockerfile_file.read_text(encoding="utf-8")
        patched_df = _ensure_dockerfile_agent_dependencies(df_content)
        if patched_df != df_content:
            dockerfile_file.write_text(patched_df, encoding="utf-8")

    repo_dirs = list((ARTIFACT_ROOT / "repositories").glob("*/*"))
    if repo_dirs and len([p for p in env_dir.iterdir() if p.name not in ("Dockerfile", ".dockerignore")]) == 0:
        latest_repo = repo_dirs[0]
        for item in latest_repo.iterdir():
            if item.name not in (".git", "Dockerfile", "node_modules", "dist", ".next", "__pycache__", ".venv"):
                target = env_dir / item.name
                if not target.exists():
                    if item.is_dir():
                        shutil.copytree(
                            item,
                            target,
                            dirs_exist_ok=True,
                            ignore=shutil.ignore_patterns("node_modules", ".git", "dist", ".next", "__pycache__", ".venv"),
                        )
                    else:
                        shutil.copy2(item, target)

    # Set up credentials in environment for Harbor execution
    eval_env = os.environ.copy()
    harness = (request.harbor_harness or "aider").lower()

    # Supported Harbor agents from `harbor agent list`
    VALID_HARBOR_AGENTS = {
        'aider', 'claude-code', 'codex', 'openhands', 'swe-agent',
        'gemini-cli', 'cline-cli', 'goose', 'opencode', 'devin',
        'copilot-cli', 'cursor-cli', 'qwen-coder', 'mini-swe-agent'
    }

    # Resolve agent runner for Harbor job.yaml
    if harness in VALID_HARBOR_AGENTS:
        agent_name = harness
    elif harness in ("anthropic", "claude") and "claude" in request.model_name.lower():
        agent_name = "claude-code"
    elif harness in ("openai", "gpt") and "gpt" in request.model_name.lower():
        agent_name = "codex"
    elif harness in ("gemini", "google"):
        agent_name = "gemini-cli"
    else:
        # Default to aider for openrouter, custom, ollama, and multi-model evaluations
        agent_name = "aider"

    clean_model = request.model_name
    base_url = None
    model_api_key_name = None
    model_api_format = None
    skip_model_parsing = False

    if harness in ("anthropic", "claude") or "claude" in request.model_name.lower():
        eval_env["ANTHROPIC_API_KEY"] = request.api_key
        model_api_key_name = "ANTHROPIC_API_KEY"
        clean_model = request.model_name.removeprefix("anthropic/")
        if agent_name == "aider":
            base_url = "https://api.anthropic.com/v1"
            model_api_format = "anthropic_messages"
            skip_model_parsing = True
    elif harness in ("openai", "gpt") or "gpt" in request.model_name.lower():
        eval_env["OPENAI_API_KEY"] = request.api_key
        model_api_key_name = "OPENAI_API_KEY"
        clean_model = request.model_name.removeprefix("openai/")
        if agent_name == "aider":
            base_url = "https://api.openai.com/v1"
            model_api_format = "openai_chat_completions"
            skip_model_parsing = True
    elif harness in ("gemini", "google") or "gemini" in request.model_name.lower():
        eval_env["GEMINI_API_KEY"] = request.api_key
        model_api_key_name = "GEMINI_API_KEY"
        clean_model = request.model_name.removeprefix("gemini/")
    else:
        eval_env["OPENROUTER_API_KEY"] = request.api_key
        base_url = None
        model_api_key_name = "OPENROUTER_API_KEY"
        model_api_format = None
        skip_model_parsing = False
        bare_model = request.model_name.removeprefix("openrouter/")
        clean_model = f"openrouter/{bare_model}" if agent_name == "aider" else bare_model

    eval_env["HARBOR_TASK_DIR"] = str(package_dir)
    eval_env["HARBOR_MODEL"] = clean_model

    # Synthesize job.yaml for Harbor job orchestration
    job_id = f"eval-{request.evaluation_id}"
    job_dir = package_dir / "jobs" / job_id
    if job_dir.exists():
        shutil.rmtree(job_dir, ignore_errors=True)

    # Also clean up any legacy task-level job lock directories
    legacy_job_dir = package_dir / "jobs" / f"eval-{request.task_id}"
    if legacy_job_dir.exists():
        shutil.rmtree(legacy_job_dir, ignore_errors=True)

    agent_lines = [
        f"  - name: {agent_name}",
        f"    model_name: {clean_model}",
    ]
    if base_url:
        agent_lines.append(f"    base_url: {base_url}")
    if model_api_key_name:
        agent_lines.append(f"    model_api_key_name: {model_api_key_name}")
    if model_api_format:
        agent_lines.append(f"    model_api_format: {model_api_format}")
    if skip_model_parsing:
        agent_lines.append("    skip_model_parsing: true")
    # aider is pre-installed in the task environment Dockerfile; skip Harbor's
    # per-trial aider.chat/install.sh to avoid uv version conflicts
    if agent_name == "aider":
        agent_lines.append("    kwargs:")
        agent_lines.append("      skip_install: true")

    agents_yaml_block = "\n".join(agent_lines)

    job_yaml_path = package_dir / "job.yaml"
    job_yaml_content = f"""schema_version: 1
job_name: {job_id}
jobs_dir: jobs
n_concurrent_trials: 1
n_attempts: 1
timeout_multiplier: 2.0

tasks:
  - path: "{package_dir.as_posix()}"

agents:
{agents_yaml_block}

environment:
  type: docker
"""
    job_yaml_path.write_text(job_yaml_content, encoding="utf-8")

    logger.info(
        "Starting Harbor evaluation for task %s with agent %s on model %s (job.yaml generated)",
        request.task_id,
        agent_name,
        clean_model,
    )

    trajectory_logs = []
    test_output = ""
    reward = 0.0
    status = "failed"
    error_message = None

    # Check if harbor CLI or python module is installed
    harbor_bin = shutil.which("harbor")
    cmd = []
    if harbor_bin:
        cmd = [
            harbor_bin,
            "run",
            "-c", str(job_yaml_path),
        ]
    else:
        # Fallback to python -m harbor if installed in venv
        cmd = [
            "python3",
            "-m", "harbor",
            "run",
            "-c", str(job_yaml_path),
        ]

    try:
        proc = subprocess.run(
            cmd,
            cwd=str(package_dir),
            env=eval_env,
            capture_output=True,
            text=True,
            timeout=request.timeout_seconds,
        )

        stdout = proc.stdout or ""
        stderr = proc.stderr or ""
        trajectory_logs.append(stdout)
        if stderr:
            trajectory_logs.append(f"\n[stderr]\n{stderr}")

        # Check result.json from Harbor job directory
        result_json_path = package_dir / "jobs" / job_id / "result.json"
        has_error = False
        if result_json_path.exists():
            try:
                res_data = json.loads(result_json_path.read_text(encoding="utf-8"))
                stats = res_data.get("stats", {})
                if stats.get("n_errored_trials", 0) > 0:
                    has_error = True
                evals = stats.get("evals", {})
                for eval_key, eval_val in evals.items():
                    if isinstance(eval_val, dict):
                        if eval_val.get("n_errors", 0) > 0:
                            has_error = True
                        reward_stats = eval_val.get("reward_stats", {})
                        if "mean" in reward_stats and reward_stats["mean"] is not None:
                            reward = float(reward_stats["mean"])
                        elif "reward" in eval_val and eval_val["reward"] is not None:
                            reward = float(eval_val["reward"])
            except Exception as e:
                logger.warning("Could not parse Harbor result.json: %s", e)

        # Check reward from verifier log file if not already determined from result.json
        if reward == 0.0 and not has_error:
            reward_candidates = list(package_dir.glob("**/reward.txt")) + list(ARTIFACT_ROOT.glob("logs/verifier/reward.txt"))
            for rf in reward_candidates:
                try:
                    reward = float(rf.read_text(encoding="utf-8").strip())
                    break
                except Exception:
                    pass

        # Capture any agent trajectory logs (e.g. aider.txt, aider.chat.history.md)
        agent_logs = list(package_dir.glob("**/aider.txt")) + list(package_dir.glob("**/aider.chat.history.md"))
        for al in agent_logs:
            try:
                al_content = al.read_text(encoding="utf-8").strip()
                if al_content:
                    trajectory_logs.append(f"\n[{al.name}]\n{al_content}")
            except Exception:
                pass

        if has_error:
            status = "failed"
            error_message = "Harbor reported one or more trial errors or exceptions during execution."
        elif reward >= 1.0:
            status = "passed"
        else:
            status = "failed"

    except subprocess.TimeoutExpired:
        status = "failed"
        error_message = f"Harbor evaluation timed out after {request.timeout_seconds} seconds."
        trajectory_logs.append(f"\n[error] {error_message}")
    except FileNotFoundError:
        # If harbor is not yet installed in the container, provide clear diagnostic
        status = "error"
        error_message = "Harbor binary was not found. Please ensure 'pip install harbor' has finished inside the validation-runner container."
        trajectory_logs.append(f"\n[error] {error_message}")
    except Exception as e:
        status = "error"
        error_message = f"Harbor execution error: {str(e)}"
        trajectory_logs.append(f"\n[error] {error_message}")

    duration_ms = int((time.time() - start_time) * 1000)

    return {
        "evaluation_id": request.evaluation_id,
        "task_id": request.task_id,
        "status": status,
        "reward": reward,
        "score": reward,
        "duration_ms": duration_ms,
        "trajectory_logs": "\n".join(trajectory_logs),
        "test_output": test_output,
        "metrics": {
            "model": request.model_name,
            "harness": harness,
            "timeout_seconds": request.timeout_seconds,
        },
        "error_message": error_message,
    }
