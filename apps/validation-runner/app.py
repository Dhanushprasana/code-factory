import hmac
import io
import logging
import os
import re
import shutil
import signal
import subprocess
import tarfile
import tempfile
import threading
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Literal
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
AGENT_EXECUTABLES = {
    "npx", "npm", "node", "python", "python3", "gemini", "agy", "claude",
    "codex", "aider",
}
HARBOR_AGENTS = {"gemini-cli", "antigravity-cli", "claude-code", "codex"}
HARBOR_MODEL_PATTERN = re.compile(r"^[A-Za-z0-9._:/_+-]{1,256}$")
ALLOWED_EXECUTABLES = {
    "npm", "pnpm", "yarn", "node", "npx", "python", "python3", "pip", "pytest",
    "uv", "go", "cargo", "rustc", "mvn", "gradle", "make", "cmake", "ctest",
    "ninja", "meson", "g++", "gcc", "clang", "clang++", "pkg-config", "git",
}
MAX_COMMANDS_PER_PHASE = 20
MAX_ARGUMENT_LENGTH = 512
MAX_LOG_BYTES = 16_384
MAX_PATCH_BYTES = 8 * 1024 * 1024
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
    public_test_commands: list[CommandSpec] = Field(default_factory=list, max_length=MAX_COMMANDS_PER_PHASE)
    hidden_test_commands: list[CommandSpec] = Field(default_factory=list, max_length=MAX_COMMANDS_PER_PHASE)


class ExecutionRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    reference_id: str
    allow_network: bool = False
    repositories: list[RepositoryPlan] = Field(min_length=1, max_length=10)


class AgentCommandSpec(BaseModel):
    model_config = ConfigDict(extra="forbid")

    args: list[str] = Field(min_length=1, max_length=64)


class AgentExecutionRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    execution_id: str
    repository_ids: list[str] = Field(min_length=1, max_length=10)
    adapter_type: Literal["direct-cli", "harbor"] = "direct-cli"
    command: AgentCommandSpec | None = None
    harbor_agent: str | None = None
    model_name: str | None = None
    timeout_seconds: int = Field(ge=60, le=7200)
    credential_reference: str | None = None
    allow_network: bool = False


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


def _validate_agent_command(command: AgentCommandSpec) -> None:
    if command.args[0] not in AGENT_EXECUTABLES:
        raise HTTPException(status_code=400, detail="The requested agent executable is not supported.")
    if any(
        not isinstance(argument, str)
        or not argument
        or len(argument) > MAX_ARGUMENT_LENGTH
        or "\x00" in argument
        or re.search(
            r"AIza[0-9A-Za-z_-]{25,}|sk-(?:ant-)?[A-Za-z0-9_-]{20,}|"
            r"(?:GEMINI|GOOGLE|OPENAI|ANTHROPIC)_API_KEY\s*=\s*\S+|"
            r"--?(?:api-key|auth-token|token)(?:=|$)",
            argument,
            re.IGNORECASE,
        )
        for argument in command.args
    ):
        raise HTTPException(status_code=400, detail="An agent command contains an invalid or secret argument.")


def _validate_harbor_request(request: AgentExecutionRequest) -> None:
    if request.command is not None:
        raise HTTPException(status_code=400, detail="Harbor requests cannot include a direct CLI command.")
    if request.harbor_agent not in HARBOR_AGENTS:
        raise HTTPException(status_code=400, detail="The requested Harbor agent is not supported.")
    if not request.model_name or not HARBOR_MODEL_PATTERN.fullmatch(request.model_name):
        raise HTTPException(status_code=400, detail="A valid Harbor model name is required.")


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


def _agent_execution_workspace_path(execution_id: str) -> Path:
    if not REFERENCE_ID_PATTERN.fullmatch(execution_id):
        raise HTTPException(status_code=400, detail="The execution identifier is invalid.")
    workspace_path = ARTIFACT_ROOT / "agent-workspaces" / execution_id
    if workspace_path.is_symlink():
        raise HTTPException(status_code=400, detail="The agent workspace cannot be a symbolic link.")
    resolved_path = workspace_path.resolve()
    if ARTIFACT_ROOT not in resolved_path.parents or not resolved_path.is_dir():
        raise HTTPException(status_code=404, detail="The agent workspace was not found.")
    return resolved_path


def _agent_workspace_path(execution_id: str, repository_id: str) -> Path:
    if not REPOSITORY_ID_PATTERN.fullmatch(repository_id):
        raise HTTPException(status_code=400, detail="A repository identifier is invalid.")
    workspace_root = _agent_execution_workspace_path(execution_id)
    repositories_path = workspace_root / "repositories"
    if repositories_path.is_symlink():
        raise HTTPException(status_code=400, detail="The agent repository folder cannot be a symbolic link.")
    repository_path = repositories_path / repository_id
    if repository_path.is_symlink():
        raise HTTPException(status_code=400, detail="The agent workspace repository cannot be a symbolic link.")
    resolved_path = repository_path.resolve()
    if workspace_root not in resolved_path.parents or not resolved_path.is_dir():
        raise HTTPException(status_code=404, detail="The agent workspace repository was not found.")
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


def _agent_secret(reference: str | None) -> tuple[str | None, str | None]:
    if reference is None:
        return None, None
    allowlist = {
        value.strip()
        for value in os.getenv(
            "AGENT_SECRET_ENV_ALLOWLIST",
            "GEMINI_API_KEY,GOOGLE_API_KEY,OPENAI_API_KEY,ANTHROPIC_API_KEY",
        ).split(",")
        if value.strip()
    }
    if reference not in allowlist or not re.fullmatch(r"[A-Z][A-Z0-9_]{0,127}", reference):
        raise HTTPException(status_code=400, detail="The credential reference is not an allowed secret name.")
    secret = os.getenv(reference)
    if not secret:
        raise HTTPException(status_code=400, detail=f"The configured secret '{reference}' is not available to the runner.")
    return reference, secret


def _harbor_model_name(harbor_agent: str, model_name: str) -> str:
    if harbor_agent in {"gemini-cli", "antigravity-cli"} and "/" not in model_name:
        return f"gemini/{model_name}"
    return model_name


def _create_harbor_task(
    request: AgentExecutionRequest,
    workspace_path: Path,
    task_root: Path,
) -> None:
    environment_path = task_root / "environment"
    environment_path.mkdir(parents=True)
    archive = _archive_workspace(workspace_path)
    with tarfile.open(fileobj=io.BytesIO(archive), mode="r:") as source:
        for member in source.getmembers():
            target = (environment_path / member.name).resolve()
            if environment_path.resolve() not in target.parents or not (member.isdir() or member.isfile()):
                raise HTTPException(status_code=400, detail="The Harbor task workspace contains an unsupported archive entry.")
            source.extract(member, path=environment_path)

    task_file = workspace_path / "TASK.md"
    if not task_file.is_file() or task_file.stat().st_size > 200_000:
        raise HTTPException(status_code=400, detail="The Harbor task instructions are missing or too large.")
    task_instructions = task_file.read_text(encoding="utf-8")
    instruction = (
        "# ForgeBench coding task\n\n"
        "Read `/workspace/TASK.md` and implement its requirements. "
        "Make changes only inside `/workspace/repositories/` and do not access "
        "reference solutions or hidden tests.\n\n"
        f"{task_instructions}"
    )
    (task_root / "instruction.md").write_text(instruction, encoding="utf-8")
    (environment_path / "Dockerfile").write_text(
        f"FROM {VALIDATION_IMAGE}\n"
        "WORKDIR /workspace\n"
        "COPY . /workspace\n"
        "USER root\n"
        "RUN mkdir -p /logs/artifacts/repositories /logs/verifier "
        "&& chown -R node:node /workspace /logs\n"
        "USER node\n",
        encoding="utf-8",
    )

    repository_ids = " ".join(request.repository_ids)
    git_safe = "git -c safe.directory='*' -c core.whitespace=-trailing-space,-space-before-tab,-indent-with-non-tab,-cr-at-eol"
    collect_lines = [
        "set -eu",
        "PATH=/usr/local/bin:/usr/bin:/bin",
        "export PATH",
        "mkdir -p /logs/artifacts/repositories",
        "patch_valid=1",
        f"for repository_id in {repository_ids}; do",
        '  repository="/workspace/repositories/$repository_id"',
        '  if [ ! -d "$repository" ]; then continue; fi',
        f'  {git_safe} -C "$repository" add -A',
        f'  {git_safe} -C "$repository" reset -q -- TASK.md 2>/dev/null || true',
        '  patch_path="/logs/artifacts/repositories/$repository_id.patch"',
        f'  {git_safe} -C "$repository" diff --cached --binary -- . ":(exclude)TASK.md" > "$patch_path"',
        f'  if ! {git_safe} -C "$repository" diff --cached --check -- . ":(exclude)TASK.md"; then patch_valid=0; fi',
        "done",
        "printf '%s\\\\n' \"$patch_valid\" > /logs/artifacts/patch-valid.txt",
    ]
    verifier_lines = [
        "#!/bin/sh",
        "set -eu",
        "mkdir -p /logs/verifier /logs/artifacts/repositories",
        "if [ ! -f /logs/artifacts/patch-valid.txt ]; then",
        "  patch_valid=1",
        f"  for repository_id in {repository_ids}; do",
        '    repository="/workspace/repositories/$repository_id"',
        '    if [ ! -d "$repository" ]; then continue; fi',
        f'    {git_safe} -C "$repository" add -A',
        f'    {git_safe} -C "$repository" reset -q -- TASK.md 2>/dev/null || true',
        '    patch_path="/logs/artifacts/repositories/$repository_id.patch"',
        f'    {git_safe} -C "$repository" diff --cached --binary -- . ":(exclude)TASK.md" > "$patch_path"',
        f'    if ! {git_safe} -C "$repository" diff --cached --check -- . ":(exclude)TASK.md"; then patch_valid=0; fi',
        "  done",
        '  printf \'%s\\n\' "$patch_valid" > /logs/artifacts/patch-valid.txt',
        "fi",
        "has_patch=0",
        "patch_valid=0",
        f"for repository_id in {repository_ids}; do",
        '  patch_path="/logs/artifacts/repositories/$repository_id.patch"',
        '  if [ -s "$patch_path" ]; then has_patch=1; fi',
        "done",
        'if [ -f /logs/artifacts/patch-valid.txt ]; then patch_valid=$(cat /logs/artifacts/patch-valid.txt); fi',
        'if [ "$has_patch" -eq 1 ] && [ "$patch_valid" = "1" ]; then printf "1\\n" > /logs/verifier/reward.txt; '
        'else printf "0\\n" > /logs/verifier/reward.txt; fi',
    ]
    tests_path = task_root / "tests"
    tests_path.mkdir()
    verifier_path = tests_path / "test.sh"
    verifier_path.write_text("\n".join(verifier_lines) + "\n", encoding="utf-8")
    verifier_path.chmod(0o755)

    network_mode = "public" if request.allow_network else "no-network"
    task_name = f"forgebench/agent-{request.execution_id.replace('-', '')[:16]}"
    task_config = (
        'schema_version = "1.4"\n'
        'artifacts = ["/logs/artifacts"]\n\n'
        "[task]\n"
        f'name = "{task_name}"\n\n'
        "[metadata]\n"
        'category = "software-engineering"\n\n'
        "[environment]\n"
        'workdir = "/workspace"\n'
        f'network_mode = "{network_mode}"\n'
        "cpus = 2\n"
        "memory_mb = 2048\n\n"
        "[agent]\n"
        f"timeout_sec = {request.timeout_seconds}.0\n"
        'user = "node"\n'
        f'network_mode = "{network_mode}"\n\n'
        "[verifier]\n"
        "timeout_sec = 60.0\n"
        'environment_mode = "shared"\n'
        f'network_mode = "{network_mode}"\n'
        'user = "node"\n'
        "\n[[verifier.collect]]\n"
        'service = "main"\n'
        "timeout_sec = 60.0\n"
        'user = "node"\n'
        "command = \"\"\"" + "\n".join(collect_lines) + "\"\"\"\n"
    )
    (task_root / "task.toml").write_text(task_config, encoding="utf-8")


def _run_harbor_process(command: list[str], cwd: Path, environment: dict[str, str], timeout: int):
    if not shutil.which("harbor"):
        raise HTTPException(status_code=503, detail="The Harbor runner image does not have the Harbor CLI installed.")
    try:
        process = subprocess.Popen(
            command,
            cwd=cwd,
            env=environment,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            start_new_session=True,
        )
    except OSError as error:
        raise HTTPException(status_code=503, detail="The Harbor CLI could not be started.") from error
    output = bytearray()
    output_truncated = False

    def collect_output():
        nonlocal output_truncated
        if process.stdout is None:
            return
        while True:
            chunk = process.stdout.read(4096)
            if not chunk:
                return
            output_truncated = _append_bounded(output, chunk) or output_truncated

    reader = threading.Thread(target=collect_output, daemon=True)
    reader.start()
    timed_out = False
    try:
        exit_code = process.wait(timeout=timeout)
    except subprocess.TimeoutExpired:
        timed_out = True
        try:
            os.killpg(process.pid, signal.SIGTERM)
        except ProcessLookupError:
            pass
        try:
            exit_code = process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            try:
                os.killpg(process.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
            exit_code = process.wait()
    reader.join(timeout=10)
    return exit_code, bytes(output), output_truncated, timed_out


def _harbor_provider_failure(logs: str) -> str | None:
    lowered_logs = logs.lower()
    if "apioverloadederror" in lowered_logs or "error 503" in lowered_logs:
        return (
            "The model provider returned HTTP 503 because it is temporarily overloaded. "
            "Retry after demand drops or select another model."
        )
    if (
        "apiratelimiterror" in lowered_logs
        or "quota exceeded" in lowered_logs
        or "status: 429" in lowered_logs
    ):
        return (
            "The model provider returned HTTP 429 because its rate limit or quota was exceeded. "
            "Wait for quota to reset or review the provider's limits and billing."
        )
    return None


def _run_harbor_agent(request: AgentExecutionRequest) -> dict:
    workspace_path = _agent_execution_workspace_path(request.execution_id)
    if len(set(request.repository_ids)) != len(request.repository_ids):
        raise HTTPException(status_code=400, detail="A repository may only be included once per agent run.")
    for repository_id in request.repository_ids:
        _agent_workspace_path(request.execution_id, repository_id)

    secret_name, secret = _agent_secret(request.credential_reference)
    started_at = datetime.now(timezone.utc)
    started = time.monotonic()
    with tempfile.TemporaryDirectory(prefix="forgebench-harbor-") as temporary_directory:
        temporary_root = Path(temporary_directory)
        task_root = temporary_root / "task"
        task_root.mkdir()
        jobs_root = temporary_root / "jobs"
        jobs_root.mkdir()
        _create_harbor_task(request, workspace_path, task_root)

        harbor_agent = request.harbor_agent
        if harbor_agent is None or request.model_name is None:
            raise HTTPException(status_code=400, detail="Harbor agent and model settings are required.")
        model_name = _harbor_model_name(harbor_agent, request.model_name)
        job_name = f"forgebench-{request.execution_id.replace('-', '')[:16]}"
        command = [
            "harbor",
            "run",
            "-p",
            str(task_root),
            "-a",
            harbor_agent,
            "-m",
            model_name,
            "-o",
            str(jobs_root),
            "--job-name",
            job_name,
            "-n",
            "1",
        ]
        environment = {
            "CI": "true",
            "HOME": str(temporary_root / "home"),
            "TMPDIR": str(temporary_root),
            "PATH": os.getenv("PATH", "/usr/local/bin:/usr/bin:/bin"),
        }
        Path(environment["HOME"]).mkdir()
        docker_host = os.getenv("DOCKER_HOST")
        if docker_host:
            environment["DOCKER_HOST"] = docker_host
        if secret_name and secret:
            environment[secret_name] = secret
        exit_code, output, output_truncated, timed_out = _run_harbor_process(
            command,
            temporary_root,
            environment,
            request.timeout_seconds + 600,
        )
        combined_output = bytearray(output)
        diagnostic_paths = sorted(jobs_root.rglob("exception.txt"))
        diagnostic_paths.extend(sorted(jobs_root.rglob("agent/*.txt")))
        for diagnostic_path in diagnostic_paths:
            if (
                diagnostic_path.is_symlink()
                or jobs_root.resolve() not in diagnostic_path.resolve().parents
                or not diagnostic_path.is_file()
            ):
                continue
            with diagnostic_path.open("rb") as diagnostic_file:
                diagnostic_file.seek(max(0, diagnostic_path.stat().st_size - MAX_LOG_BYTES))
                diagnostic = diagnostic_file.read(MAX_LOG_BYTES)
            _append_bounded(
                combined_output,
                f"\n--- Harbor {diagnostic_path.relative_to(jobs_root)} ---\n".encode() + diagnostic,
            )
        logs = _redact(combined_output.decode("utf-8", errors="replace"), [secret] if secret else [])

        patch_bundles: dict[str, str] = {}
        patch_valid = False
        total_patch_bytes = 0
        for repository_id in request.repository_ids:
            patch_files = sorted(jobs_root.rglob(f"{repository_id}.patch"))
            if not patch_files:
                continue
            patch_file = patch_files[-1]
            if patch_file.is_symlink() or jobs_root.resolve() not in patch_file.resolve().parents:
                continue
            patch_size = patch_file.stat().st_size
            total_patch_bytes += patch_size
            if total_patch_bytes > MAX_PATCH_BYTES:
                raise HTTPException(status_code=413, detail="The collected Harbor patch exceeded the configured limit.")
            patch = patch_file.read_text(encoding="utf-8", errors="replace")
            if patch.strip():
                patch_bundles[repository_id] = patch

        patch_valid_files = sorted(jobs_root.rglob("patch-valid.txt"))
        if patch_valid_files:
            validity_file = patch_valid_files[-1]
            if not validity_file.is_symlink() and jobs_root.resolve() in validity_file.resolve().parents:
                patch_valid = validity_file.read_text(encoding="utf-8").strip() == "1"
        reward_files = sorted(jobs_root.rglob("reward.txt"))
        reward = None
        if reward_files:
            reward_file = reward_files[-1]
            if not reward_file.is_symlink() and jobs_root.resolve() in reward_file.resolve().parents:
                reward = reward_file.read_text(encoding="utf-8").strip()

        secret_in_patch = bool(secret) and any(secret in patch for patch in patch_bundles.values())
        if secret_in_patch:
            patch_bundles = {}
            logs = f"{logs}\nHarbor submission rejected because it contained a configured secret."
        patch_valid = patch_valid and bool(patch_bundles) and not secret_in_patch
        status = "passed" if exit_code == 0 and reward == "1" and patch_valid else "failed"
        if timed_out:
            error = "Harbor job timed out."
        elif exit_code != 0:
            error = _harbor_provider_failure(logs) or "Harbor job failed."
        elif not patch_bundles:
            error = _harbor_provider_failure(logs) or "Harbor completed without producing a code patch."
        elif not patch_valid or reward != "1":
            error = "Harbor verifier rejected the submission."
        else:
            error = None
        patch_diff = "\n".join(patch_bundles.values())
        return {
            "status": status,
            "exit_code": exit_code,
            "duration_ms": round((time.monotonic() - started) * 1000),
            "started_at": started_at.isoformat(),
            "logs": logs,
            "stdout_truncated": output_truncated,
            "stderr_truncated": False,
            "patch_diff": patch_diff,
            "patch_bundles": patch_bundles,
            "patch_valid": patch_valid,
            "secret_exposed": secret_in_patch,
            "error": error,
            "harbor_job_name": job_name,
        }


def _append_bounded(current: bytearray, chunk: bytes, max_bytes: int = MAX_LOG_BYTES) -> bool:
    if not chunk:
        return False
    truncated = len(current) + len(chunk) > max_bytes
    current.extend(chunk)
    if len(current) > max_bytes:
        del current[: len(current) - max_bytes]
    return truncated


def _run_command(container, command: CommandSpec, phase: str, repository_id: str, venv_path: str) -> dict:
    _validate_command(command)
    command_args = command.args
    if command_args[0] == "pnpm":
        command_args = ["corepack", "pnpm@9.15.0", *command_args[1:]]
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
            cmd=["timeout", "--signal=TERM", "--kill-after=5s", f"{COMMAND_TIMEOUT_SECONDS}s", *command_args],
            stdout=True,
            stderr=True,
            tty=False,
            workdir="/workspace",
            user="1000:1000",
            environment={
                "CI": "true",
                "HOME": "/tmp",
                "TMPDIR": "/tmp",
                "NPM_CONFIG_CACHE": "/tmp/npm-cache",
                "PIP_CACHE_DIR": "/tmp/pip-cache",
                "COREPACK_ENABLE_PROJECT_SPEC": "0",
                "COREPACK_HOME": "/home/node/.cache/corepack",
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


def _exec_in_container(
    container,
    command: list[str],
    environment: dict[str, str],
    max_output_bytes: int,
    workdir: str = "/workspace",
):
    stdout = bytearray()
    stderr = bytearray()
    stdout_truncated = False
    stderr_truncated = False
    created = container.client.api.exec_create(
        container.id,
        cmd=command,
        stdout=True,
        stderr=True,
        tty=False,
        workdir=workdir,
        user="1000:1000",
        environment=environment,
    )
    command_id = created["Id"]
    for output in container.client.api.exec_start(command_id, stream=True, demux=True):
        out_chunk, err_chunk = output
        if out_chunk:
            stdout_truncated = _append_bounded(stdout, out_chunk, max_output_bytes) or stdout_truncated
        if err_chunk:
            stderr_truncated = _append_bounded(stderr, err_chunk, max_output_bytes) or stderr_truncated
    if stdout_truncated or stderr_truncated:
        raise HTTPException(status_code=413, detail="The agent command output exceeded the configured limit.")
    return (
        container.client.api.exec_inspect(command_id)["ExitCode"],
        stdout,
        stderr,
        stdout_truncated,
        stderr_truncated,
    )


def _redact(value: str, secrets: list[str]) -> str:
    for secret in secrets:
        if secret:
            value = value.replace(secret, "[REDACTED]")
    return value


def _run_agent(client, request: AgentExecutionRequest) -> dict:
    if request.command is None:
        raise HTTPException(status_code=400, detail="A direct CLI command is required.")
    workspace_path = _agent_execution_workspace_path(request.execution_id)
    if len(set(request.repository_ids)) != len(request.repository_ids):
        raise HTTPException(status_code=400, detail="A repository may only be included once per agent run.")
    for repository_id in request.repository_ids:
        _agent_workspace_path(request.execution_id, repository_id)
    archive = _archive_workspace(workspace_path)
    container = None
    workspace_volume = None
    network = None
    started_at = datetime.now(timezone.utc)
    started = time.monotonic()
    secret_name, secret = _agent_secret(request.credential_reference)
    secrets = [secret] if secret else []
    try:
        client.images.get(VALIDATION_IMAGE)
        workspace_volume = client.volumes.create(
            name=f"forgebench-agent-workspace-{uuid4().hex}",
            driver="local",
            driver_opts={
                "type": "tmpfs",
                "device": "tmpfs",
                "o": "size=4294967296,uid=1000,gid=1000,mode=1777",
            },
            labels={"forgebench.execution_id": request.execution_id, "forgebench.agent": "true"},
        )
        container = client.containers.create(
            VALIDATION_IMAGE,
            command=["sleep", "infinity"],
            name=f"forgebench-agent-{uuid4().hex}",
            detach=True,
            network_mode="none",
            user="1000:1000",
            working_dir="/workspace",
            cap_drop=["ALL"],
            security_opt=["no-new-privileges:true"],
            pids_limit=256,
            mem_limit="2g",
            memswap_limit="2g",
            nano_cpus=2_000_000_000,
            tmpfs={"/tmp": "rw,nosuid,nodev,size=1073741824,mode=1777"},
            mounts=[Mount(target="/workspace", source=workspace_volume.name, type="volume")],
            environment={
                "CI": "true",
                "HOME": "/tmp/home",
                "TMPDIR": "/tmp",
                "NPM_CONFIG_CACHE": "/tmp/npm-cache",
                "PIP_CACHE_DIR": "/tmp/pip-cache",
            },
            labels={"forgebench.execution_id": request.execution_id, "forgebench.agent": "true"},
        )
        container.start()
        if not container.put_archive("/workspace", archive):
            raise HTTPException(status_code=500, detail="Could not copy the task workspace into the isolated agent container.")
        if request.allow_network:
            if os.getenv("AGENT_EXECUTION_ALLOW_NETWORK", "false").lower() != "true":
                raise HTTPException(status_code=403, detail="Agent network access is disabled by runner policy.")
            network = client.networks.get(EGRESS_NETWORK)
            network.connect(container)

        child_environment = {
            "CI": "true",
            "HOME": "/tmp",
            "TMPDIR": "/tmp",
            "NPM_CONFIG_CACHE": "/tmp/npm-cache",
            "PIP_CACHE_DIR": "/tmp/pip-cache",
            "PATH": "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
        }
        if secret_name and secret:
            child_environment[secret_name] = secret
        exit_code, stdout, stderr, stdout_truncated, stderr_truncated = _exec_in_container(
            container,
            [
                "timeout", "--signal=TERM", "--kill-after=5s",
                f"{request.timeout_seconds}s", *request.command.args,
            ],
            child_environment,
            MAX_LOG_BYTES,
            workdir=f"/workspace/repositories/{request.repository_ids[0]}",
        )
        log = _redact(
            (stdout + b"\n" + stderr).decode("utf-8", errors="replace"),
            secrets,
        )
        patch_bundles: dict[str, str] = {}
        patches_valid = True
        total_patch_bytes = 0
        for repository_id in request.repository_ids:
            repository_workdir = f"/workspace/repositories/{repository_id}"
            git_exit, _, _, _, _ = _exec_in_container(
                container,
                ["git", "-c", "safe.directory=*", "add", "-A"],
                child_environment,
                MAX_LOG_BYTES,
                workdir=repository_workdir,
            )
            if git_exit != 0:
                raise HTTPException(status_code=500, detail="Could not stage agent workspace changes.")
            patch_exit, patch_output, _, _, _ = _exec_in_container(
                container,
                ["git", "-c", "safe.directory=*", "diff", "--cached", "--binary", "--", ".", ":(exclude)TASK.md"],
                child_environment,
                MAX_PATCH_BYTES,
                workdir=repository_workdir,
            )
            if patch_exit != 0:
                raise HTTPException(status_code=500, detail="Could not collect the agent submission patch.")
            total_patch_bytes += len(patch_output)
            if total_patch_bytes > MAX_PATCH_BYTES:
                raise HTTPException(status_code=413, detail="The collected agent patch exceeded the configured limit.")
            check_exit, _, _, _, _ = _exec_in_container(
                container,
                [
                    "git",
                    "-c", "safe.directory=*",
                    "-c", "core.whitespace=-trailing-space,-space-before-tab,-indent-with-non-tab,-cr-at-eol",
                    "diff", "--cached", "--check", "--", ".", ":(exclude)TASK.md",
                ],
                child_environment,
                MAX_LOG_BYTES,
                workdir=repository_workdir,
            )
            if check_exit != 0:
                patches_valid = False
            patch = patch_output.decode("utf-8", errors="replace")
            if patch.strip():
                patch_bundles[repository_id] = patch
        secret_in_patch = any(
            secret and secret in patch
            for patch in patch_bundles.values()
            for secret in secrets
        )
        if secret_in_patch:
            patch_bundles = {}
            exit_code = exit_code or 1
            log = f"{log}\nAgent submission rejected because it contained a configured secret."
        patch = "\n".join(patch_bundles.values())
        return {
            "status": "passed" if exit_code == 0 else "failed",
            "exit_code": exit_code,
            "duration_ms": round((time.monotonic() - started) * 1000),
            "started_at": started_at.isoformat(),
            "logs": log,
            "stdout_truncated": stdout_truncated,
            "stderr_truncated": stderr_truncated,
            "patch_diff": patch,
            "patch_bundles": patch_bundles,
            "patch_valid": bool(patch_bundles) and patches_valid and not secret_in_patch,
            "secret_exposed": secret_in_patch,
            "error": (
                "Agent command timed out."
                if exit_code == 124
                else "Agent command failed."
                if exit_code != 0 and not secret_in_patch
                else None
            ),
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
    public_test_results: list[dict] = []
    hidden_test_results: list[dict] = []
    public_commands = repository.public_test_commands or repository.test_commands
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
            public_test_results = _blocked_commands(public_commands, "public_test")
            hidden_test_results = _blocked_commands(repository.hidden_test_commands, "hidden_test")
        else:
            for command in repository.build_commands:
                build_results.append(_run_command(container, command, "build", repository.repository_id, venv_path))
            for command in public_commands:
                public_test_results.append(
                    _run_command(container, command, "public_test", repository.repository_id, venv_path)
                )
            for command in repository.hidden_test_commands:
                hidden_test_results.append(
                    _run_command(container, command, "hidden_test", repository.repository_id, venv_path)
                )

        test_results = public_test_results + hidden_test_results
        test_status = _phase_status(test_results)

        return {
            "repository_id": repository.repository_id,
            "status": "passed" if (
                not setup_failed
                and _phase_status(build_results) == "passed"
                and test_status == "passed"
            ) else "failed",
            "environment": {
                "image": VALIDATION_IMAGE,
                "network_policy": "dependency setup only" if allow_network else "disabled",
                "node_version": _tool_version(container, ["node", "--version"]),
                "python_version": _tool_version(container, ["python3", "--version"]),
            },
            "setup_status": _phase_status(setup_results, no_commands="passed"),
            "build_status": _phase_status(build_results),
            "test_status": test_status,
            "public_test_status": _phase_status(public_test_results),
            "hidden_test_status": _phase_status(hidden_test_results),
            "setup": setup_results,
            "build": build_results,
            "tests": test_results,
            "public_tests": public_test_results,
            "hidden_tests": hidden_test_results,
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
        for command in (
            repository.setup_commands + repository.build_commands + repository.test_commands
            + repository.public_test_commands + repository.hidden_test_commands
        ):
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


@app.post("/execute-agent")
def execute_agent(request: AgentExecutionRequest, authorization: str | None = Header(default=None)):
    _authorize(authorization)
    if not REFERENCE_ID_PATTERN.fullmatch(request.execution_id):
        raise HTTPException(status_code=400, detail="The execution identifier is invalid.")
    if request.adapter_type == "harbor":
        _validate_harbor_request(request)
    elif request.command is None:
        raise HTTPException(status_code=400, detail="A direct CLI command is required.")
    else:
        _validate_agent_command(request.command)
    if len(set(request.repository_ids)) != len(request.repository_ids):
        raise HTTPException(status_code=400, detail="A repository may only be included once per agent run.")
    for repository_id in request.repository_ids:
        _agent_workspace_path(request.execution_id, repository_id)
    _agent_secret(request.credential_reference)
    if request.allow_network and os.getenv("AGENT_EXECUTION_ALLOW_NETWORK", "false").lower() != "true":
        raise HTTPException(status_code=403, detail="Agent network access is disabled by runner policy.")
    client = _client()
    try:
        client.images.get(VALIDATION_IMAGE)
        if request.adapter_type == "harbor":
            return _run_harbor_agent(request)
        if request.allow_network:
            try:
                client.networks.get(EGRESS_NETWORK)
            except docker.errors.NotFound:
                client.networks.create(
                    EGRESS_NETWORK,
                    driver="bridge",
                    labels={"forgebench.validation": "agent-egress"},
                )
        return _run_agent(client, request)
    except HTTPException:
        raise
    except docker.errors.DockerException as error:
        logger.exception("Could not run a coding agent in the isolated container.")
        detail = str(error).splitlines()[0][:1000] or "Docker returned an unknown error."
        raise HTTPException(
            status_code=503,
            detail=f"The isolated agent container could not be started: {detail}",
        ) from error
    finally:
        client.close()
