import json
import shutil
import subprocess
from pathlib import Path

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

from app import reference_factory, task_factory
from app.main import app
from app.patch_engine import (
    FileModification,
    apply_changes_to_isolated_workspace,
    load_target_sources,
    validate_and_apply_modifications,
    validate_target_files,
)
from app.solve_compiler import compile_solve_script

client = TestClient(app)


def _make_repo_payload(root: Path, files: list[str]) -> dict:
    return {
        "repository_id": "repo-1",
        "repository_name": "sample/orders",
        "snapshot_id": "snap-1",
        "analysis_id": "analysis-1",
        "commit_sha": "abc1234",
        "repository_path": str(root),
        "summary": {
            "modules": [{"name": "orders", "path": "src/orders"}],
            "frameworks": ["NestJS"],
            "language": ["TypeScript"],
        },
        "report": {
            "directory_tree": [{"path": f, "type": "file"} for f in files],
            "symbols": [{
                "name": "OrdersService",
                "kind": "class",
                "file_path": files[0],
                "start_line": 1,
                "end_line": 3,
            }],
            "api_routes": [],
            "database_entities": [],
            "tests": {"files": []},
            "graph": {"nodes": [], "edges": []},
        },
        "context_markdown": "# Orders Repo\nContains orders service.",
    }


def test_target_file_validation_accepts_existing_and_rejects_missing_and_traversal(tmp_path):
    (tmp_path / "src").mkdir()
    (tmp_path / "src" / "a.ts").write_text("export const a = 'hello';\n", encoding="utf-8")
    repos = [{"repository_id": "repo-1", "repository_path": str(tmp_path)}]

    valid, errors = validate_target_files(["src/a.ts"], repos)
    assert valid == ["src/a.ts"]
    assert errors == []

    valid_missing, err_missing = validate_target_files(["src/nonexistent.ts"], repos)
    assert valid_missing == []
    assert err_missing[0]["code"] == "not_found"

    for unsafe in ["../outside.ts", "/etc/passwd", "C:\\Windows\\system.ini", "src/../outside.ts"]:
        valid_bad, err_bad = validate_target_files([unsafe], repos)
        assert valid_bad == []
        assert err_bad[0]["code"] == "unsafe_path"

    (tmp_path / "deno" / "lib").mkdir(parents=True)
    (tmp_path / "deno" / "lib" / "mod.ts").write_text("export const built = true;\n", encoding="utf-8")
    (tmp_path / "dist").mkdir()
    (tmp_path / "dist" / "index.js").write_text("console.log(1);\n", encoding="utf-8")
    for build_path in ["deno/lib/mod.ts", "dist/index.js"]:
        valid_build, err_build = validate_target_files([build_path], repos)
        assert valid_build == []
        assert err_build[0]["code"] == "build_artifact_path"


def test_context_engine_excludes_build_directories(tmp_path):
    from app.context_engine import build_task_context

    (tmp_path / "src").mkdir()
    (tmp_path / "deno" / "lib").mkdir(parents=True)
    (tmp_path / "dist").mkdir()
    (tmp_path / "src" / "real.ts").write_text("export const real = 1;\n", encoding="utf-8")
    (tmp_path / "deno" / "lib" / "built.ts").write_text("export const built = 1;\n", encoding="utf-8")
    (tmp_path / "dist" / "bundle.js").write_text("var x = 1;\n", encoding="utf-8")

    repo = _make_repo_payload(
        tmp_path,
        ["src/real.ts", "deno/lib/built.ts", "dist/bundle.js"],
    )
    context, _ = build_task_context([repo], "real", "feature", [], 4096)
    chunk_paths = {c["file_path"] for c in context["repositories"][0]["chunks"]}
    assert "src/real.ts" in chunk_paths
    assert "deno/lib/built.ts" not in chunk_paths
    assert "dist/bundle.js" not in chunk_paths


def test_load_target_sources_preserves_exact_quotes_and_handles_large_files(tmp_path):
    (tmp_path / "src").mkdir()
    single_src = "import { Injectable } from '@nestjs/common';\r\nexport const q = 'single';\r\n"
    double_src = 'export const dq = "double";\n'
    large_src = "x" * 200
    (tmp_path / "src" / "single.ts").write_bytes(single_src.encode("utf-8"))
    (tmp_path / "src" / "double.ts").write_bytes(double_src.encode("utf-8"))
    (tmp_path / "src" / "large.ts").write_bytes(large_src.encode("utf-8"))

    repos = [{"repository_id": "repo-1", "repository_path": str(tmp_path)}]
    loaded, excluded = load_target_sources(
        repos,
        ["src/single.ts", "src/double.ts", "src/large.ts"],
        max_file_chars=150,
        max_total_chars=500,
    )
    assert [item["file_path"] for item in loaded] == ["src/single.ts", "src/double.ts"]
    assert loaded[0]["content"] == single_src
    assert loaded[1]["content"] == double_src
    assert excluded[0]["file_path"] == "src/large.ts"
    assert excluded[0]["status"] == "excluded_file_too_large"


def test_task_generation_returns_valid_target_files_and_rejects_invalid(monkeypatch, tmp_path):
    (tmp_path / "src" / "orders").mkdir(parents=True)
    (tmp_path / "src" / "orders" / "service.ts").write_text("export class OrdersService {}\n", encoding="utf-8")

    monkeypatch.setenv("OPENROUTER_API_KEY", "test-key")
    payload = {
        "operation_id": "op-1",
        "project_id": "proj-1",
        "provider": "openrouter",
        "user_idea": "Add status update",
        "category": "feature",
        "difficulty": "medium",
        "constraints": [],
        "count": 1,
        "repositories": [_make_repo_payload(tmp_path, ["src/orders/service.ts"])],
    }

    async def fake_valid(*args, **kwargs):
        return json.dumps({
            "tasks": [{
                "title": "Add order status transition",
                "description": "Allow orders to transition cleanly between valid states.",
                "category": "feature",
                "difficulty": "medium",
                "requirements": ["Validate transitions", "Persist updated status"],
                "acceptance_criteria": ["Valid transition succeeds", "Invalid transition fails"],
                "constraints": [],
                "affected_modules": ["orders"],
                "target_files": ["src/orders/service.ts"],
                "evidence": [{
                    "repository_id": "repo-1",
                    "snapshot_id": "snap-1",
                    "commit_sha": "abc1234",
                    "file_path": "src/orders/service.ts",
                    "start_line": 1,
                    "end_line": 1,
                    "symbol": "OrdersService",
                }],
            }],
        })

    monkeypatch.setattr(task_factory, "_request_chat_completions", fake_valid)
    resp = client.post("/api/v1/tasks/suggest", json=payload)
    assert resp.status_code == 200
    assert resp.json()["tasks"][0]["target_files"] == ["src/orders/service.ts"]

    async def fake_invalid_target(*args, **kwargs):
        data = json.loads(await fake_valid())
        data["tasks"][0]["target_files"] = ["../secret.ts"]
        return json.dumps(data)

    monkeypatch.setattr(task_factory, "_request_chat_completions", fake_invalid_target)
    resp_bad = client.post("/api/v1/tasks/suggest", json=payload)
    assert resp_bad.status_code == 502


def test_deterministic_patch_validation_rules(tmp_path):
    (tmp_path / "src").mkdir()
    single_file = tmp_path / "src" / "single.ts"
    double_file = tmp_path / "src" / "double.ts"
    dup_file = tmp_path / "src" / "dup.ts"

    single_orig = "const mode = 'draft';\nconst count = 1;\n"
    double_orig = 'const label = "initial";\n'
    dup_orig = "const x = 1;\nconst x = 1;\n"

    single_file.write_bytes(single_orig.encode("utf-8"))
    double_file.write_bytes(double_orig.encode("utf-8"))
    dup_file.write_bytes(dup_orig.encode("utf-8"))

    repos = [{"repository_id": "repo-1", "repository_path": str(tmp_path)}]

    # 1. Single & double quotes + insert + create + delete
    ok = validate_and_apply_modifications(repos, [
        FileModification(
            repository_id="repo-1",
            file_path="src/single.ts",
            operation="replace",
            description="Update single-quoted mode",
            search="const mode = 'draft';",
            replace="const mode = 'active';",
        ),
        FileModification(
            repository_id="repo-1",
            file_path="src/double.ts",
            operation="replace",
            description="Update double-quoted label",
            search='const label = "initial";',
            replace='const label = "updated";',
        ),
        FileModification(
            repository_id="repo-1",
            file_path="src/single.ts",
            operation="insert",
            description="Insert status helper",
            search="const count = 1;",
            replace="\nconst ready = true;",
            position="after",
        ),
        FileModification(
            repository_id="repo-1",
            file_path="src/new.ts",
            operation="create",
            description="Create new helper",
            replace="export const created = true;\n",
        ),
        FileModification(
            repository_id="repo-1",
            file_path="src/dup.ts",
            operation="delete",
            description="Delete unused file",
        ),
    ])
    assert ok["valid"] is True
    assert len(ok["file_changes"]) == 4
    # Original checkout untouched
    assert single_file.read_text(encoding="utf-8") == single_orig
    assert double_file.read_text(encoding="utf-8") == double_orig
    assert dup_file.exists()

    # 2. Missing search block rejected
    missing = validate_and_apply_modifications(repos, [
        FileModification(
            repository_id="repo-1",
            file_path="src/single.ts",
            operation="replace",
            description="Missing block",
            search="const mode = 'nonexistent';",
            replace="const mode = 'active';",
        ),
    ])
    assert missing["valid"] is False
    assert missing["errors"][0]["code"] == "search_not_found"

    # 2b. Unique quote-style + collapsed-whitespace mismatch resolves deterministically to actual source span
    double_multiline = tmp_path / "src" / "enum.test.ts"
    double_multiline.write_bytes((
        'test("error params", () => {\n'
        '  const result = z\n'
        '    .enum(["test"], { required_error: "REQUIRED" })\n'
        '    .safeParse(undefined);\n'
        '});\n'
    ).encode("utf-8"))
    canon = validate_and_apply_modifications(repos, [
        FileModification(
            repository_id="repo-1",
            file_path="src/enum.test.ts",
            operation="insert",
            description="Add test after existing block",
            search="test('error params', () => {   const result = z   .enum(['test'], { required_error: 'REQUIRED' })   .safeParse(undefined); });",
            replace='\ntest("new test", () => {});',
            position="after",
        ),
    ])
    assert canon["valid"] is True
    assert canon["modifications"][0]["canonicalized_from"] == "canonical_quotes_ws"
    assert '"error params"' in canon["modifications"][0]["search"]
    assert '\ntest("new test", () => {});' in canon["file_changes"][0]["modified_content"]

    # 3. Ambiguous multiple match rejected
    ambiguous = validate_and_apply_modifications(repos, [
        FileModification(
            repository_id="repo-1",
            file_path="src/dup.ts",
            operation="replace",
            description="Ambiguous match",
            search="const x = 1;",
            replace="const x = 2;",
        ),
    ])
    assert ambiguous["valid"] is False
    assert ambiguous["errors"][0]["code"] == "ambiguous_search_match"

    # 4. Overlapping modifications rejected
    overlapping = validate_and_apply_modifications(repos, [
        FileModification(
            repository_id="repo-1",
            file_path="src/single.ts",
            operation="replace",
            description="First edit",
            search="const mode = 'draft';\nconst count = 1;",
            replace="const mode = 'active';\nconst count = 2;",
        ),
        FileModification(
            repository_id="repo-1",
            file_path="src/single.ts",
            operation="replace",
            description="Overlapping edit",
            search="const count = 1;",
            replace="const count = 3;",
        ),
    ])
    assert overlapping["valid"] is False
    assert overlapping["errors"][0]["code"] == "overlapping_modification"
    assert single_file.read_text(encoding="utf-8") == single_orig


def test_reference_generation_repair_and_e2e_solve_script(monkeypatch, tmp_path):
    repo_root = tmp_path / "repo"
    (repo_root / "src").mkdir(parents=True)
    single_file = repo_root / "src" / "single.py"
    double_file = repo_root / "src" / "double.py"
    single_orig = "STATUS = 'pending'\n"
    double_orig = 'GREETING = "hello"\n'
    single_file.write_text(single_orig, encoding="utf-8")
    double_file.write_text(double_orig, encoding="utf-8")
    (repo_root / "pyproject.toml").write_text('[project]\nname = "fixture"\n', encoding="utf-8")

    monkeypatch.setenv("OPENROUTER_API_KEY", "test-key")
    calls = {"count": 0}

    async def fake_llm(provider, base_url, model, prompt, max_tokens, api_key, response_schema, timeout_seconds):
        calls["count"] += 1
        if calls["count"] == 1:
            # Verify actual file contents were supplied to the LLM
            assert "STATUS = 'pending'" in prompt
            assert 'GREETING = \\"hello\\"' in prompt or 'GREETING = "hello"' in prompt
            # Intentionally return a missing block on attempt 1 to trigger repair
            return json.dumps({
                "implementation_plan": [{
                    "repository_id": "repo-1",
                    "file_path": "src/single.py",
                    "action": "modify",
                    "rationale": "Update status and greeting.",
                    "steps": ["Update constants."],
                }],
                "modifications": [{
                    "repository_id": "repo-1",
                    "file_path": "src/single.py",
                    "operation": "replace",
                    "description": "Missing block",
                    "search": "STATUS = 'nonexistent'",
                    "replace": "STATUS = 'done'",
                    "position": "after",
                }],
                "tests": [{
                    "repository_id": "repo-1",
                    "file_path": "tests/test_status.py",
                    "test_type": "feature",
                    "purpose": "Verify status constant.",
                    "content": "def test_status():\n    assert True\n",
                }],
            })
        # Repair attempt receives validation error and actual source
        assert "search_not_found" in prompt
        assert "STATUS = 'pending'" in prompt
        return json.dumps({
            "modifications": [
                {
                    "repository_id": "repo-1",
                    "file_path": "src/single.py",
                    "operation": "replace",
                    "description": "Update single-quoted status",
                    "search": "STATUS = 'pending'",
                    "replace": "STATUS = 'done'",
                    "position": "after",
                },
                {
                    "repository_id": "repo-1",
                    "file_path": "src/double.py",
                    "operation": "replace",
                    "description": "Update double-quoted greeting",
                    "search": 'GREETING = "hello"',
                    "replace": 'GREETING = "world"',
                    "position": "after",
                },
            ],
        })

    monkeypatch.setattr(reference_factory, "_request_chat_completions", fake_llm)
    response = client.post("/api/v1/references/generate", json={
        "operation_id": "ref-1",
        "project_id": "proj-1",
        "provider": "openrouter",
        "max_repair_attempts": 2,
        "task": {
            "title": "Update status and greeting",
            "description": "Update both single-quoted and double-quoted files.",
            "category": "feature",
            "difficulty": "medium",
            "requirements": ["Update STATUS", "Update GREETING"],
            "acceptance_criteria": ["STATUS is done", "GREETING is world"],
            "constraints": [],
            "affected_modules": ["orders"],
            "target_files": ["src/single.py", "src/double.py"],
            "task_version": 1,
        },
        "repositories": [_make_repo_payload(repo_root, ["src/single.py", "src/double.py"])],
    })

    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "pending_review"
    assert data["validation"]["patch_validation"] == "passed"
    assert data["validation"]["patch_repair_attempts"] == 1
    assert len(data["file_changes"]) == 2
    assert "solve_script" in data
    assert "apply_replace 'src/single.py'" in data["solve_script"]
    assert "python3 -m compileall -q ." in data["solve_script"]

    # Original checkout remains untouched
    assert single_file.read_text(encoding="utf-8") == single_orig
    assert double_file.read_text(encoding="utf-8") == double_orig

    # Apply to isolated workspace and verify solve.sh execution if bash is available
    isolated = tmp_path / "isolated"
    apply_changes_to_isolated_workspace(str(repo_root), str(isolated), data["file_changes"])
    assert (isolated / "src" / "single.py").read_text(encoding="utf-8") == "STATUS = 'done'\n"
    assert (isolated / "src" / "double.py").read_text(encoding="utf-8") == 'GREETING = "world"\n'

    bash_bin = shutil.which("bash")
    if bash_bin and subprocess.run([bash_bin, "-c", "exit 0"], capture_output=True).returncode == 0:
        bash_repo = tmp_path / "bash_repo"
        shutil.copytree(repo_root, bash_repo)
        script_path = bash_repo / "solve.sh"
        script_path.write_text(data["solve_script"], encoding="utf-8")
        proc = subprocess.run([bash_bin, str(script_path)], cwd=str(bash_repo), capture_output=True, text=True)
        assert proc.returncode == 0, proc.stderr
        assert (bash_repo / "src" / "single.py").read_text(encoding="utf-8") == "STATUS = 'done'\n"
        assert (bash_repo / "src" / "double.py").read_text(encoding="utf-8") == 'GREETING = "world"\n'


def test_reference_generation_marks_failed_when_repairs_exhausted(monkeypatch, tmp_path):
    (tmp_path / "src").mkdir()
    (tmp_path / "src" / "a.py").write_text("x = 1\n", encoding="utf-8")
    monkeypatch.setenv("OPENROUTER_API_KEY", "test-key")
    call_idx = {"n": 0}

    async def always_bad(*args, **kwargs):
        call_idx["n"] += 1
        bad_mod = [{
            "repository_id": "repo-1",
            "file_path": "src/a.py",
            "operation": "replace",
            "description": "Missing block",
            "search": "x = 999",
            "replace": "x = 2",
            "position": "after",
        }]
        if call_idx["n"] > 1:
            return json.dumps({"modifications": bad_mod})
        return json.dumps({
            "implementation_plan": [{
                "repository_id": "repo-1",
                "file_path": "src/a.py",
                "action": "modify",
                "rationale": "Update x value.",
                "steps": ["Replace x."],
            }],
            "modifications": bad_mod,
            "tests": [{
                "repository_id": "repo-1",
                "file_path": "tests/test_a.py",
                "test_type": "feature",
                "purpose": "Verify x value is updated.",
                "content": "def test_x():\n    assert True\n",
            }],
        })

    monkeypatch.setattr(reference_factory, "_request_chat_completions", always_bad)
    response = client.post("/api/v1/references/generate", json={
        "operation_id": "ref-fail",
        "project_id": "proj-1",
        "provider": "openrouter",
        "max_repair_attempts": 1,
        "task": {
            "title": "Update x",
            "description": "Update x in src/a.py.",
            "category": "feature",
            "difficulty": "easy",
            "requirements": ["Update x", "Keep file valid"],
            "acceptance_criteria": ["x is 2", "File compiles"],
            "constraints": [],
            "affected_modules": ["src"],
            "target_files": ["src/a.py"],
            "task_version": 1,
        },
        "repositories": [_make_repo_payload(tmp_path, ["src/a.py"])],
    })
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "failed"
    assert data["validation"]["patch_validation"] == "failed"
    assert data["validation"]["patch_repair_attempts"] == 1
    assert data["validation"]["patch_errors"][0]["code"] == "search_not_found"
    assert data["validation"]["patch_errors"][0]["search"] == "x = 999"
    assert data["validation"]["patch_errors"][0]["replace"] == "x = 2"
    assert data["validation"]["patch_errors"][0]["actual_content"].replace("\r\n", "\n") == "x = 1\n"
