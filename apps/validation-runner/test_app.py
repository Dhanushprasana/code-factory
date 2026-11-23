import os

import pytest
from fastapi import HTTPException

from app import CommandSpec, _append_bounded, _archive_workspace, _phase_status, _validate_command, _workspace_path


def test_command_validation_rejects_shells_and_empty_arguments():
    with pytest.raises(HTTPException):
        _validate_command(CommandSpec(args=["sh", "-c", "npm test"]))
    with pytest.raises(HTTPException):
        _validate_command(CommandSpec(args=["npm", ""]))


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
