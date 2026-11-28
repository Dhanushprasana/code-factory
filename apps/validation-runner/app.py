import hmac
import io
import logging
import os
import re
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
COMMAND_TIMEOUT_SECONDS = int(os.getenv("VALIDATION_COMMAND_TIMEOUT_SECONDS", "1800"))
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
