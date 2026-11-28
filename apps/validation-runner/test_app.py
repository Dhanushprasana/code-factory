import os
import tomllib
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from app import (
    AgentCommandSpec,
    AgentExecutionRequest,
    CommandSpec,
    RepositoryPlan,
    VALIDATION_IMAGE,
    _agent_secret,
    _agent_workspace_path,
    _append_bounded,
    _archive_workspace,
    _create_harbor_task,
    _harbor_model_name,
    _harbor_provider_failure,
    _phase_status,
    _redact,
    _run_command,
    _validate_agent_command,
    _validate_command,
    _validate_harbor_request,
    _workspace_path,
)


def test_command_validation_rejects_shells_and_empty_arguments():
    with pytest.raises(HTTPException):
        _validate_command(CommandSpec(args=["sh", "-c", "npm test"]))
    with pytest.raises(HTTPException):
        _validate_command(CommandSpec(args=["npm", ""]))


def test_run_command_configures_corepack_for_isolated_validation():
    class FakeDockerAPI:
        environment = None
        command = None

        def exec_create(self, container_id, **kwargs):
            self.environment = kwargs["environment"]
            self.command = kwargs["cmd"]
            return {"Id": "fake-exec"}

        def exec_start(self, command_id, stream, demux):
            return iter([(b"completed", None)])

        def exec_inspect(self, command_id):
            return {"ExitCode": 0}

    api = FakeDockerAPI()
    container = SimpleNamespace(
        id="fake-container",
        client=SimpleNamespace(api=api),
    )

    result = _run_command(
        container,
        CommandSpec(args=["pnpm", "--dir", ".", "install", "--frozen-lockfile"]),
        "setup",
        "repo-1",
        "/workspace/.venv/bin",
    )

    assert result["status"] == "passed"
    assert api.environment["COREPACK_ENABLE_PROJECT_SPEC"] == "0"
    assert api.environment["COREPACK_HOME"] == "/home/node/.cache/corepack"
    assert api.command[-6:] == [
        "corepack",
        "pnpm@9.15.0",
        "--dir",
        ".",
        "install",
        "--frozen-lockfile",
    ]


def test_agent_command_validation_allows_gemini_cli_and_rejects_shell_execution():
    _validate_agent_command(
        AgentCommandSpec(args=["npx", "--yes", "@google/gemini-cli", "-p", "Read TASK.md"])
    )
    with pytest.raises(HTTPException):
        _validate_agent_command(AgentCommandSpec(args=["sh", "-c", "echo unsafe"]))
    with pytest.raises(HTTPException):
        _validate_agent_command(
            AgentCommandSpec(args=["gemini", "--api-key", "AIza" + "A" * 30])
        )
    with pytest.raises(HTTPException):
        _validate_agent_command(AgentCommandSpec(args=["gemini", "--api-key", "GEMINI_API_KEY"]))


def test_harbor_request_requires_an_allowlisted_agent_and_model():
    request = AgentExecutionRequest(
        execution_id="a579aa57-ea3a-42db-9285-fafaa0ea4aa2",
        repository_ids=["repo-1"],
        adapter_type="harbor",
        harbor_agent="gemini-cli",
        model_name="gemini-2.5-flash",
        timeout_seconds=60,
    )
    for harbor_agent in ("gemini-cli", "antigravity-cli", "claude-code", "codex"):
        _validate_harbor_request(request.model_copy(update={"harbor_agent": harbor_agent}))

    with pytest.raises(HTTPException):
        _validate_harbor_request(request.model_copy(update={"harbor_agent": "custom-shell"}))
    with pytest.raises(HTTPException):
        _validate_harbor_request(request.model_copy(update={"model_name": "gemini flash; echo unsafe"}))


def test_harbor_task_packages_only_the_agent_workspace_and_writes_patch_verifier(
    tmp_path, monkeypatch
):
    execution_id = "a579aa57-ea3a-42db-9285-fafaa0ea4aa2"
    repository_id = "repo-1"
    workspace = tmp_path / "agent-workspaces" / execution_id
    repository = workspace / "repositories" / repository_id
    repository.mkdir(parents=True)
    (workspace / "TASK.md").write_text("Implement the public task.", encoding="utf-8")
    (repository / "source.txt").write_text("public source", encoding="utf-8")
    monkeypatch.setattr("app.VALIDATION_IMAGE", "code-factory-validation:local")

    request = AgentExecutionRequest(
        execution_id=execution_id,
        repository_ids=[repository_id],
        adapter_type="harbor",
        harbor_agent="gemini-cli",
        model_name="gemini-2.5-flash",
        timeout_seconds=60,
        allow_network=True,
    )
    task_root = tmp_path / "task"
    task_root.mkdir()

    _create_harbor_task(request, workspace, task_root)

    assert (task_root / "environment" / "repositories" / repository_id / "source.txt").read_text(
        encoding="utf-8"
    ) == "public source"
    task_config = tomllib.loads((task_root / "task.toml").read_text(encoding="utf-8"))
    assert "docker_image" not in task_config["environment"]
    assert task_config["environment"]["workdir"] == "/workspace"
    assert task_config["environment"]["network_mode"] == "public"
    assert task_config["agent"]["network_mode"] == "public"
    assert task_config["verifier"]["network_mode"] == "public"
    assert task_config["artifacts"] == ["/logs/artifacts"]
    collect_config = task_config["verifier"]["collect"][0]
    assert collect_config["service"] == "main"
    assert "diff --cached --binary" in collect_config["command"]
    assert "/logs/artifacts/patch-valid.txt" in collect_config["command"]
    verifier = (task_root / "tests" / "test.sh").read_text(encoding="utf-8")
    assert "git diff" not in verifier
    assert "/logs/verifier/reward.txt" in verifier
    assert not (task_root / "solution").exists()
    assert f"FROM {VALIDATION_IMAGE}" in (task_root / "environment" / "Dockerfile").read_text(
        encoding="utf-8"
    )

    restricted_task_root = tmp_path / "restricted-task"
    restricted_task_root.mkdir()
    _create_harbor_task(
        request.model_copy(update={"allow_network": False}),
        workspace,
        restricted_task_root,
    )
    restricted_config = tomllib.loads((restricted_task_root / "task.toml").read_text(encoding="utf-8"))
    assert restricted_config["environment"]["network_mode"] == "no-network"
    assert restricted_config["agent"]["network_mode"] == "no-network"
    assert restricted_config["verifier"]["network_mode"] == "no-network"


def test_agent_secret_uses_only_an_allowed_environment_name(monkeypatch):
    for reference in (
        "GEMINI_API_KEY",
        "GOOGLE_API_KEY",
        "OPENAI_API_KEY",
        "ANTHROPIC_API_KEY",
    ):
        monkeypatch.setenv(reference, f"test-{reference}")
        assert _agent_secret(reference) == (reference, f"test-{reference}")

    with pytest.raises(HTTPException):
        _agent_secret("HOME")


def test_agent_secret_fails_clearly_when_not_configured(monkeypatch):
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)

    with pytest.raises(HTTPException, match="not available"):
        _agent_secret("GEMINI_API_KEY")


def test_google_harbor_agents_default_to_the_api_key_model_provider():
    assert _harbor_model_name("gemini-cli", "gemini-2.5-flash") == "gemini/gemini-2.5-flash"
    assert _harbor_model_name("gemini-cli", "gemini/gemini-2.5-flash") == "gemini/gemini-2.5-flash"
    assert _harbor_model_name("antigravity-cli", "gemini-3.1-flash-lite") == "gemini/gemini-3.1-flash-lite"
    assert _harbor_model_name("antigravity-cli", "gemini/gemini-3.1-flash-lite") == "gemini/gemini-3.1-flash-lite"


def test_agent_logs_redact_configured_secrets():
    assert _redact("provider key: secret-value", ["secret-value"]) == "provider key: [REDACTED]"


@pytest.mark.parametrize(
    ("logs", "expected"),
    [
        (
            "ApiOverloadedError: Error 503, model currently experiencing high demand",
            "The model provider returned HTTP 503 because it is temporarily overloaded. "
            "Retry after demand drops or select another model.",
        ),
        (
            "ApiRateLimitError: quota exceeded; status: 429",
            "The model provider returned HTTP 429 because its rate limit or quota was exceeded. "
            "Wait for quota to reset or review the provider's limits and billing.",
        ),
        ("Harbor completed without a patch.", None),
    ],
)
def test_harbor_provider_failures_are_reported_clearly(logs, expected):
    assert _harbor_provider_failure(logs) == expected


def test_log_capture_retains_only_the_bounded_tail():
    output = bytearray()
    truncated = _append_bounded(output, b"a" * 20_000)

    assert truncated is True
    assert len(output) == 16_384
    assert output == b"a" * 16_384


@pytest.mark.parametrize(
    ("results", "expected"),
    [
        ([], "not_configured"),
        ([{"status": "passed"}, {"status": "passed"}], "passed"),
        ([{"status": "failed"}, {"status": "blocked"}], "failed"),
        ([{"status": "blocked"}], "blocked"),
    ],
)
def test_phase_status_does_not_treat_missing_or_blocked_commands_as_success(results, expected):
    assert _phase_status(results) == expected


def test_workspace_lookup_rejects_paths_outside_the_validation_root(tmp_path, monkeypatch):
    reference_id = "a579aa57-ea3a-42db-9285-fafaa0ea4aa2"
    repository_id = "repo-1"
    expected = tmp_path / "reference-workspaces" / reference_id / "repositories" / repository_id
    expected.mkdir(parents=True)
    monkeypatch.setattr("app.ARTIFACT_ROOT", tmp_path)

    assert _workspace_path(reference_id, repository_id) == expected
    with pytest.raises(HTTPException):
        _workspace_path(reference_id, "..")


def test_agent_workspace_lookup_is_scoped_to_execution_and_repository(tmp_path, monkeypatch):
    execution_id = "a579aa57-ea3a-42db-9285-fafaa0ea4aa2"
    repository_id = "repo-1"
    expected = tmp_path / "agent-workspaces" / execution_id / "repositories" / repository_id
    expected.mkdir(parents=True)
    monkeypatch.setattr("app.ARTIFACT_ROOT", tmp_path)

    assert _agent_workspace_path(execution_id, repository_id) == expected
    with pytest.raises(HTTPException):
        _agent_workspace_path(execution_id, "..")


def test_repository_plan_keeps_public_and_hidden_tests_separate():
    repository = RepositoryPlan(
        repository_id="repo-1",
        public_test_commands=[CommandSpec(args=["npm", "test"])],
        hidden_test_commands=[CommandSpec(args=["npm", "test", "--", "tests/hidden.spec.ts"])],
    )

    assert len(repository.public_test_commands) == 1
    assert len(repository.hidden_test_commands) == 1


def test_workspace_archive_rejects_symlinks(tmp_path):
    if not hasattr(os, "symlink"):
        pytest.skip("This platform does not support symbolic links.")
    root = tmp_path / "workspace"
    root.mkdir()
    target = tmp_path / "target.txt"
    target.write_text("outside workspace", encoding="utf-8")
    (root / "link.txt").symlink_to(target)

    with pytest.raises(HTTPException):
        _archive_workspace(root)
