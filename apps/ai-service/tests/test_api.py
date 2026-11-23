from fastapi.testclient import TestClient
from fastapi import HTTPException
from pathlib import Path
import json
import tempfile

import pytest

from app import task_factory
from app import reference_factory
from app.analyzers import repository_analyzer
from app.main import app


client = TestClient(app)


def test_health():
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json()["status"] == "ok"


def test_analysis_contract():
    with tempfile.TemporaryDirectory() as directory:
        root = Path(directory)
        (root / "src").mkdir()
        (root / "src" / "main.ts").write_text("export const start = true;", encoding="utf-8")
        response = client.post("/api/v1/analyze", json={
            "repository_id": "repo-1",
            "snapshot_id": "snapshot-1",
            "commit_sha": "abc123",
            "repository_path": directory,
            "ecosystem": "node-typescript",
        })
        assert response.status_code == 200
        assert response.json()["status"] == "completed"
        assert "TypeScript" in response.json()["summary"]["language"]


def test_analysis_scans_real_repository_files():
    with tempfile.TemporaryDirectory() as directory:
        root = Path(directory)
        (root / "src").mkdir()
        (root / "src" / "main.ts").write_text("export const start = true;", encoding="utf-8")
        (root / "package.json").write_text(
            '{"dependencies":{"react":"19","express":"5"},"scripts":{"test":"jest","build":"tsc"}}',
            encoding="utf-8",
        )
        response = client.post("/api/v1/analyze", json={
            "repository_id": "repo-real",
            "snapshot_id": "snapshot-real",
            "commit_sha": "abc1234",
            "repository_path": directory,
            "ecosystem": "node-typescript",
        })
        assert response.status_code == 200
        assert response.json()["status"] == "completed"
        assert "TypeScript" in response.json()["summary"]["language"]
        assert "npm run test" in response.json()["summary"]["test_commands"]
        assert "src/main.ts" in response.json()["summary"]["entry_points"]


def test_analysis_extracts_tree_structure_symbols_routes_and_entities():
    with tempfile.TemporaryDirectory() as directory:
        root = Path(directory)
        (root / "src").mkdir()
        (root / "src" / "users.ts").write_text(
            "\n".join([
                "@Entity()",
                "export class UserEntity {}",
                "@Controller('users')",
                "export class UsersController {",
                "  helper() { return true; }",
                "  @Get(':id')",
                "  findOne() { this.helper(); return new UserEntity(); }",
                "  @Query(() => UserEntity)",
                "  getUser() { return new UserEntity(); }",
                "}",
            ]),
            encoding="utf-8",
        )
        (root / ".env").write_text("PRIVATE_TOKEN=never-read", encoding="utf-8")
        (root / "node_modules").mkdir()
        (root / "node_modules" / "ignored.js").write_text("function ignored() {}", encoding="utf-8")
        response = client.post("/api/v1/analyze", json={
            "repository_id": "repo-analysis",
            "snapshot_id": "snapshot-analysis",
            "commit_sha": "abc1234",
            "repository_path": directory,
            "ecosystem": "node-typescript",
        })

        assert response.status_code == 200
        payload = response.json()
        assert {symbol["name"] for symbol in payload["report"]["symbols"]} >= {
            "UserEntity",
            "UsersController",
            "findOne",
        }
        assert payload["summary"]["api_routes"] == [
            {
                "method": "GET",
                "path": ":id",
                "file_path": "src/users.ts",
                "line": 6,
            },
            {
                "method": "GRAPHQL_QUERY",
                "path": "getUser",
                "file_path": "src/users.ts",
                "line": 8,
            },
        ]
        assert payload["summary"]["api_route_count"] == 2
        assert payload["summary"]["database_entities"] == [{
            "name": "UserEntity",
            "file_path": "src/users.ts",
            "line": 2,
        }]
        assert payload["summary"]["database_entity_count"] == 1
        paths = {entry["path"] for entry in payload["report"]["directory_tree"]}
        assert ".env" not in paths
        assert "node_modules/ignored.js" not in paths
        assert "PRIVATE_TOKEN" not in response.text
        assert any(edge["type"] == "contains" for edge in payload["report"]["graph"]["edges"])
        assert any(edge["type"] == "calls" for edge in payload["report"]["graph"]["edges"])


def test_directory_tree_keeps_file_entries_within_configured_limit(tmp_path, monkeypatch):
    paths = []
    for folder in ("group-a", "group-b", "group-c"):
        directory = tmp_path / "src" / folder
        directory.mkdir(parents=True)
        path = directory / "module.ts"
        path.write_text("export const value = true;", encoding="utf-8")
        paths.append(path)

    monkeypatch.setattr(repository_analyzer, "MAX_TREE_ENTRIES", 6)
    entries, truncated = repository_analyzer._directory_tree(paths, tmp_path)

    assert len(entries) <= 6
    assert any(entry["type"] == "file" for entry in entries)
    assert truncated


def test_analysis_reports_module_file_route_entity_and_test_counts():
    with tempfile.TemporaryDirectory() as directory:
        root = Path(directory)
        module = root / "packages" / "commerce"
        (module / "src").mkdir(parents=True)
        (module / "tests").mkdir()
        (module / "src" / "api.ts").write_text(
            "@Entity()\nexport class ProductEntity {}\n@Get('/products')\nexport function listProducts() {}",
            encoding="utf-8",
        )
        (module / "tests" / "api.test.ts").write_text("test('lists products', () => {});", encoding="utf-8")
        response = client.post("/api/v1/analyze", json={
            "repository_id": "repo-modules",
            "snapshot_id": "snapshot-modules",
            "commit_sha": "abc1234",
            "repository_path": directory,
            "ecosystem": "node-typescript",
        })

        assert response.status_code == 200
        module_summary = next(item for item in response.json()["summary"]["modules"] if item["path"] == "packages/commerce")
        assert module_summary["file_count"] == 2
        assert module_summary["api_route_count"] == 1
        assert module_summary["database_entity_count"] == 1
        assert module_summary["test_file_count"] == 1


def test_analysis_detects_modules_under_nested_backend_and_frontend_source_roots():
    with tempfile.TemporaryDirectory() as directory:
        root = Path(directory)
        backend_module = root / "backend" / "src" / "orders"
        frontend_module = root / "frontend" / "src" / "pages"
        backend_module.mkdir(parents=True)
        frontend_module.mkdir(parents=True)
        (backend_module / "orders.controller.ts").write_text(
            "@Controller('orders')\n@Get('/orders')\nexport function listOrders() { return []; }",
            encoding="utf-8",
        )
        (frontend_module / "OrdersPage.tsx").write_text(
            "export function OrdersPage() { return null; }",
            encoding="utf-8",
        )

        response = client.post("/api/v1/analyze", json={
            "repository_id": "repo-nested-modules",
            "snapshot_id": "snapshot-nested-modules",
            "commit_sha": "abc1234",
            "repository_path": directory,
            "ecosystem": "node-typescript",
        })

        assert response.status_code == 200
        payload = response.json()
        module_paths = {module["path"] for module in payload["summary"]["modules"]}
        assert module_paths == {"backend/src/orders", "frontend/src/pages"}
        assert {feature["source"] for feature in payload["summary"]["features"]} == module_paths
        backend_summary = next(
            module for module in payload["report"]["modules"]
            if module["path"] == "backend/src/orders"
        )
        assert backend_summary["file_count"] == 1
        assert backend_summary["api_route_count"] == 1


def test_analysis_detects_python_stack_routes_and_models():
    with tempfile.TemporaryDirectory() as directory:
        root = Path(directory)
        (root / "app").mkdir()
        (root / "app" / "main.py").write_text(
            "\n".join([
                "from fastapi import FastAPI",
                "app = FastAPI()",
                '@app.get("/health")',
                "def health():",
                '    return {"status": "ok"}',
                "class Item(Base):",
                '    __tablename__ = "items"',
            ]),
            encoding="utf-8",
        )
        (root / "pyproject.toml").write_text(
            '[project]\ndependencies = ["fastapi>=0.1", "sqlalchemy>=2"]\n'
            '[dependency-groups]\ndev = ["pytest>=8"]\n',
            encoding="utf-8",
        )
        response = client.post("/api/v1/analyze", json={
            "repository_id": "repo-python",
            "snapshot_id": "snapshot-python",
            "commit_sha": "abc1234",
            "repository_path": directory,
            "ecosystem": "python",
        })

        assert response.status_code == 200
        payload = response.json()
        assert "Python" in payload["summary"]["language"]
        assert "FastAPI" in payload["summary"]["frameworks"]
        assert "SQLAlchemy" in payload["summary"]["orm"]
        assert "pytest" in payload["summary"]["test_commands"]
        assert payload["summary"]["api_routes"][0]["path"] == "/health"
        assert payload["summary"]["database_entities"][0]["name"] == "Item"


def _task_suggestion_request(repository_path: str, provider: str = "openrouter") -> dict:
    return {
        "operation_id": "task-generation-test",
        "project_id": "project-task-test",
        "provider": provider,
        "user_idea": "Add order cancellation",
        "category": "feature",
        "difficulty": "medium",
        "constraints": ["Keep cancellation idempotent"],
        "count": 1,
        "repositories": [{
            "repository_id": "repository-task-test",
            "repository_name": "sample/orders",
            "snapshot_id": "snapshot-task-test",
            "analysis_id": "analysis-task-test",
            "commit_sha": "abc1234",
            "repository_path": repository_path,
            "summary": {
                "modules": [{"name": "orders", "path": "src/orders"}],
                "frameworks": ["FastAPI"],
                "language": ["Python"],
            },
            "report": {
                "directory_tree": [{"path": "src/orders/service.py", "type": "file"}],
                "symbols": [{
                    "name": "cancel_order",
                    "kind": "function",
                    "file_path": "src/orders/service.py",
                    "start_line": 1,
                    "end_line": 3,
                }],
                "api_routes": [],
                "database_entities": [],
                "tests": {"files": []},
                "graph": {"nodes": [], "edges": []},
            },
        }],
    }


def test_openrouter_suggestions_require_api_key(monkeypatch, tmp_path):
    source = tmp_path / "src" / "orders" / "service.py"
    source.parent.mkdir(parents=True)
    source.write_text("def cancel_order(order_id):\n    return order_id\n", encoding="utf-8")
    monkeypatch.delenv("OPENROUTER_API_KEY", raising=False)

    response = client.post("/api/v1/tasks/suggest", json=_task_suggestion_request(str(tmp_path)))

    assert response.status_code == 503
    assert "OPENROUTER_API_KEY" in response.json()["detail"]


@pytest.mark.parametrize(
    ("provider", "base_url", "model", "api_key"),
    [
        ("openrouter", "https://openrouter.test/api/v1", "test/router-model", "test-api-key"),
        ("ollama", "http://ollama.test:11434/v1", "test-local-model", None),
    ],
)
def test_task_suggestion_uses_selected_provider_and_returns_provenance(
    monkeypatch,
    tmp_path,
    provider,
    base_url,
    model,
    api_key,
):
    source = tmp_path / "src" / "orders" / "service.py"
    source.parent.mkdir(parents=True)
    source.write_text(
        "def cancel_order(order_id):\n    return order_id\n\n"
        "def find_order(order_id):\n    return None\n",
        encoding="utf-8",
    )
    monkeypatch.setenv("OPENROUTER_BASE_URL", "https://openrouter.test/api/v1")
    monkeypatch.setenv("OPENROUTER_MODEL", "test/router-model")
    monkeypatch.setenv("OLLAMA_BASE_URL", "http://ollama.test:11434/v1")
    monkeypatch.setenv("OLLAMA_MODEL", "test-local-model")
    if api_key:
        monkeypatch.setenv("OPENROUTER_API_KEY", api_key)
    else:
        monkeypatch.delenv("OPENROUTER_API_KEY", raising=False)

    async def fake_provider(
        selected_provider,
        selected_base_url,
        selected_model,
        prompt,
        max_tokens,
        selected_api_key,
        response_schema,
    ):
        assert selected_provider == provider
        assert selected_base_url == base_url
        assert selected_model == model
        assert selected_api_key == api_key
        if provider == "ollama":
            assert response_schema["properties"]["tasks"]["maxItems"] == 1
            candidate_schema = response_schema["properties"]["tasks"]["items"]
            assert candidate_schema["properties"]["category"]["enum"]
            assert candidate_schema["properties"]["affected_modules"]["items"]["enum"]
            assert candidate_schema["properties"]["evidence"]["items"]["enum"]
        else:
            assert response_schema is None
        assert "cancel_order" in prompt
        assert "order_id" in prompt
        return json.dumps({
            "tasks": [{
                "title": "Make order cancellation idempotent",
                "description": "Ensure repeated cancellation requests do not change an order more than once.",
                "category": "feature",
                "difficulty": "medium",
                "requirements": [
                    "Cancel an eligible order once.",
                    "Reject or safely ignore repeated cancellation requests.",
                ],
                "acceptance_criteria": [
                    "The first cancellation changes the order state.",
                    "A repeated cancellation leaves the final order state unchanged.",
                ],
                "constraints": ["Keep cancellation idempotent"],
                "affected_modules": ["orders"],
                "evidence": [{
                    "repository_id": "repository-task-test",
                    "snapshot_id": "snapshot-task-test",
                    "commit_sha": "abc1234",
                    "file_path": "src/orders/service.py",
                    "start_line": 1,
                    "end_line": 3,
                    "symbol": "cancel_order",
                }],
            }],
        })

    monkeypatch.setattr(task_factory, "_request_chat_completions", fake_provider)
    response = client.post(
        "/api/v1/tasks/suggest",
        json=_task_suggestion_request(str(tmp_path), provider),
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["provider"] == provider
    assert payload["model"] == model
    assert payload["tasks"][0]["affected_modules"] == ["orders"]
    assert payload["tasks"][0]["evidence"][0]["commit_sha"] == "abc1234"
    assert payload["context_manifest"]["retrieval_strategies"] == [
        "keyword",
        "structure",
        "static_graph",
    ]


@pytest.mark.parametrize(
    ("provider", "base_url", "model", "api_key"),
    [
        ("openrouter", "https://openrouter.test/api/v1", "test/router-model", "test-api-key"),
        ("ollama", "http://ollama.test:11434/v1", "test-local-model", None),
    ],
)
def test_reference_generation_uses_task_provider_and_pinned_context(
    monkeypatch,
    tmp_path,
    provider,
    base_url,
    model,
    api_key,
):
    source = tmp_path / "src" / "orders" / "service.py"
    source.parent.mkdir(parents=True)
    source.write_text(
        "def create_order(order):\n    return order\n",
        encoding="utf-8",
    )
    monkeypatch.setenv("OPENROUTER_BASE_URL", "https://openrouter.test/api/v1")
    monkeypatch.setenv("OPENROUTER_MODEL", "test/router-model")
    monkeypatch.setenv("OLLAMA_BASE_URL", "http://ollama.test:11434/v1")
    monkeypatch.setenv("OLLAMA_MODEL", "test-local-model")
    if api_key:
        monkeypatch.setenv("OPENROUTER_API_KEY", api_key)
    else:
        monkeypatch.delenv("OPENROUTER_API_KEY", raising=False)

    async def fake_provider(
        selected_provider,
        selected_base_url,
        selected_model,
        prompt,
        max_tokens,
        selected_api_key,
        response_schema,
        timeout_seconds,
    ):
        assert selected_provider == provider
        assert selected_base_url == base_url
        assert selected_model == model
        assert selected_api_key == api_key
        assert "Task version 2" in prompt
        assert "create_order" in prompt
        assert "diff --git a/src/example.py b/src/example.py" in prompt
        assert timeout_seconds == (600.0 if provider == "ollama" else 90.0)
        if provider == "ollama":
            assert response_schema["properties"]["tests"]["items"]["properties"]["test_type"]["enum"]
            assert "$defs" not in json.dumps(response_schema)
        else:
            assert response_schema is None
        return json.dumps({
            "implementation_plan": [{
                "repository_id": "repository-task-test",
                "file_path": "src/orders/service.py",
                "action": "modify",
                "rationale": "Add explicit validation for order creation.",
                "steps": ["Validate required fields before storing."],
            }],
            "patches": [{
                "repository_id": "repository-task-test",
                "patch_diff": (
                    "diff --git a/src/orders/service.py b/src/orders/service.py\n"
                    "--- a/src/orders/service.py\n+++ b/src/orders/service.py\n"
                    "@@ -1,2 +1,3 @@\n def create_order(order):\n+    if not order: raise ValueError('order is required')\n     return order\n"
                ),
            }],
            "tests": [{
                "repository_id": "repository-task-test",
                "file_path": "tests/test_order_service.py",
                "test_type": "feature",
                "purpose": "Verify invalid order input is rejected.",
                "content": "def test_rejects_empty_order():\n    ...\n",
            }],
        })

    monkeypatch.setattr(reference_factory, "_request_chat_completions", fake_provider)
    response = client.post("/api/v1/references/generate", json={
        "operation_id": "reference-run-1",
        "project_id": "project-task-test",
        "provider": provider,
        "task": {
            "title": "Validate order creation",
            "description": "Reject missing order data and preserve valid order creation.",
            "category": "feature",
            "difficulty": "medium",
            "requirements": ["Reject empty order data", "Accept valid order data"],
            "acceptance_criteria": ["Invalid input returns an error", "Valid input creates an order"],
            "constraints": [],
            "affected_modules": ["orders"],
            "task_version": 2,
        },
        "repositories": [{
            "repository_id": "repository-task-test",
            "repository_name": "sample/orders",
            "snapshot_id": "snapshot-task-test",
            "analysis_id": "analysis-task-test",
            "commit_sha": "abc1234",
            "repository_path": str(tmp_path),
            "summary": {
                "modules": [{"name": "orders", "path": "src/orders"}],
                "frameworks": ["FastAPI"],
                "language": ["Python"],
            },
            "report": {
                "directory_tree": [{"path": "src/orders/service.py", "type": "file"}],
                "symbols": [{
                    "name": "create_order",
                    "kind": "function",
                    "file_path": "src/orders/service.py",
                    "start_line": 1,
                    "end_line": 2,
                }],
                "api_routes": [],
                "database_entities": [],
                "tests": {"files": []},
                "graph": {"nodes": [], "edges": []},
            },
        }],
    })

    assert response.status_code == 200
    result = response.json()
    assert result["provider"] == provider
    assert result["model"] == model
    assert result["status"] == "pending_review"
    assert result["implementation_plan"][0]["file_path"] == "src/orders/service.py"
    assert result["patches"][0]["repository_id"] == "repository-task-test"
    assert result["tests"][0]["test_type"] == "feature"
    assert result["validation"]["build"] == "not_run"


def test_reference_generation_rejects_patch_path_traversal():
    with pytest.raises(HTTPException, match="unsafe file path"):
        reference_factory._validate_reference_output({
            "implementation_plan": [{
                "repository_id": "repository-task-test",
                "file_path": "src/orders/service.py",
                "action": "modify",
                "rationale": "Change a file.",
                "steps": ["Update behavior."],
            }],
            "patches": [{
                "repository_id": "repository-task-test",
                "patch_diff": (
                    "diff --git a/../outside.py b/../outside.py\n"
                    "--- a/../outside.py\n+++ b/../outside.py\n@@ -1 +1 @@\n-old\n+new\n"
                ),
            }],
            "tests": [{
                "repository_id": "repository-task-test",
                "file_path": "tests/test_safe.py",
                "test_type": "feature",
                "purpose": "Verify generated behavior.",
                "content": "def test_behavior():\n    assert True\n",
            }],
        }, {"repository-task-test"})


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("provider", "base_url", "api_key", "response_schema"),
    [
        ("openrouter", "https://openrouter.test/api/v1", "test-api-key", None),
        (
            "ollama",
            "http://ollama.test:11434/v1",
            None,
            {
                "type": "object",
                "properties": {"tasks": {"type": "array", "maxItems": 1}},
            },
        ),
    ],
)
async def test_chat_completions_request_uses_provider_endpoint_and_auth(
    monkeypatch,
    provider,
    base_url,
    api_key,
    response_schema,
):
    captured = {}

    class FakeResponse:
        status_code = 200
        is_success = True

        @staticmethod
        def json():
            return {"choices": [{"message": {"content": '{"tasks": []}'}}]}

    class FakeAsyncClient:
        def __init__(self, **kwargs):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            return None

        async def post(self, url, headers, json):
            captured.update(url=url, headers=headers, payload=json)
            return FakeResponse()

    monkeypatch.setattr(task_factory.httpx, "AsyncClient", FakeAsyncClient)

    result = await task_factory._request_chat_completions(
        provider,
        base_url,
        "test-model",
        "Return a JSON object.",
        500,
        api_key,
        response_schema,
    )

    assert result == '{"tasks": []}'
    assert captured["url"] == f"{base_url}/chat/completions"
    assert captured["payload"]["model"] == "test-model"
    assert captured["payload"]["max_tokens"] == 500
    if response_schema is None:
        assert captured["payload"]["response_format"] == {"type": "json_object"}
    else:
        assert captured["payload"]["response_format"] == {
            "type": "json_schema",
            "json_schema": {
                "name": "task_suggestions",
                "strict": True,
                "schema": response_schema,
            },
        }
    assert captured["headers"].get("authorization") == (
        f"Bearer {api_key}" if api_key else None
    )


def test_generate_context_endpoint(monkeypatch, tmp_path):
    import httpx
    from app import context_generator

    (tmp_path / "README.md").write_text("# Test Repo\nDemo app.", encoding="utf-8")
    (tmp_path / "package.json").write_text('{"name": "demo-app"}', encoding="utf-8")

    class FakeResponse:
        status_code = 200
        is_success = True

        def json(self):
            return {
                "choices": [{
                    "message": {
                        "content": "# Repository Context: Test Repo\n\n## 1. Executive Summary\nA demo app."
                    }
                }],
                "usage": {"total_tokens": 150}
            }

    class FakeAsyncClient:
        def __init__(self, *args, **kwargs):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            return None

        async def post(self, url, headers, json):
            return FakeResponse()

    monkeypatch.setattr(context_generator.httpx, "AsyncClient", FakeAsyncClient)
    monkeypatch.setenv("OPENROUTER_API_KEY", "test-key")

    response = client.post("/api/v1/context/generate", json={
        "repository_path": str(tmp_path),
        "summary": {"file_count": 2, "frameworks": ["FastAPI"]},
        "report": {},
    })

    assert response.status_code == 200
    data = response.json()
    assert "Repository Context: Test Repo" in data["context_markdown"]
    assert data["model"] == "nvidia/nemotron-3.5-super-vl:free"
    assert data["tokens_used"] == 150

