from fastapi.testclient import TestClient
from fastapi import HTTPException
from pathlib import Path
import json
import tempfile

import pytest

from app import task_factory
from app import reference_factory
from app.context_engine import build_task_context
from app.analyzers import repository_analyzer
from app.main import app


client = TestClient(app)


def test_health():
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json()["status"] == "ok"


def test_json_parser_error_is_not_task_specific():
    with pytest.raises(HTTPException) as error:
        task_factory._extract_json('{"incomplete":')

    assert error.value.detail == "The selected AI provider returned a response that was not valid JSON."


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


def test_task_context_includes_file_prologue_before_symbol_chunks(tmp_path):
    source = tmp_path / "backend" / "product.service.ts"
    source.parent.mkdir(parents=True)
    source.write_text(
        "import { StockEntity } from './enities/product-stock.entity';\n"
        "\n"
        "export class ProductService {\n"
        "  getStockLevels() { return this.stockRepository.find(); }\n"
        "}\n",
        encoding="utf-8",
    )
    repository = {
        "repository_id": "repo-prologue",
        "snapshot_id": "snapshot-prologue",
        "analysis_id": "analysis-prologue",
        "commit_sha": "abc123",
        "repository_name": "sample/store",
        "repository_path": str(tmp_path),
        "summary": {"modules": []},
        "report": {
            "directory_tree": [{"path": "backend/product.service.ts", "type": "file"}],
            "symbols": [{
                "name": "ProductService",
                "file_path": "backend/product.service.ts",
                "start_line": 3,
                "end_line": 5,
            }],
            "api_routes": [],
            "database_entities": [],
            "tests": {"files": []},
            "graph": {"nodes": [], "edges": []},
        },
    }

    context, manifest = build_task_context(
        [repository],
        "manage product stock",
        "feature",
        [],
        4096,
    )

    chunks = context["repositories"][0]["chunks"]
    prologue = next(chunk for chunk in chunks if chunk["symbol"] == "file prologue")
    assert prologue["start_line"] == 1
    assert "1: import { StockEntity } from './enities/product-stock.entity';" in prologue["content"]
    assert manifest["repositories"][0]["retrieved_chunks"][0]["symbol"] == "file prologue"


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
    assert "--env-file apps/backend/.env" in response.json()["detail"]


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
        assert response_schema["properties"]["tasks"]["maxItems"] == 1
        candidate_schema = response_schema["properties"]["tasks"]["items"]
        assert candidate_schema["properties"]["category"]["enum"]
        assert candidate_schema["properties"]["affected_modules"]["items"]["enum"]
        evidence_schema = candidate_schema["properties"]["evidence"]["items"]
        assert evidence_schema["type"] == "object"
        assert evidence_schema["additionalProperties"] is False
        assert evidence_schema["properties"]["file_path"]["enum"] == ["src/orders/service.py"]
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


def test_task_schema_errors_report_field_paths_without_echoing_values(tmp_path):
    source = tmp_path / "src" / "orders" / "service.py"
    source.parent.mkdir(parents=True)
    source.write_text("def cancel_order(order_id):\n    return order_id\n", encoding="utf-8")
    request = task_factory.TaskGenerationRequest.model_validate(
        _task_suggestion_request(str(tmp_path)),
    )
    context, _ = build_task_context(
        [repository.model_dump() for repository in request.repositories],
        request.user_idea,
        request.category,
        request.constraints,
        4096,
    )

    with pytest.raises(HTTPException) as error:
        task_factory._validate_candidates(
            [{"title": "private task title"}],
            request,
            context,
        )

    assert "Invalid fields:" in error.value.detail
    assert "description (missing)" in error.value.detail
    assert "private task title" not in error.value.detail


@pytest.mark.parametrize(
    ("provider", "base_url", "model", "api_key"),
    [
        ("openrouter", "https://openrouter.test/api/v1", "test/router-model", "test-api-key"),
        ("ollama", "http://ollama.test:11434/v1", "test-local-model", None),
    ],
)
@pytest.mark.parametrize("repair_context", [False, True])
def test_reference_generation_uses_task_provider_and_pinned_context(
    monkeypatch,
    tmp_path,
    provider,
    base_url,
    model,
    api_key,
    repair_context,
):
    source = tmp_path / "src" / "orders" / "service.py"
    source.parent.mkdir(parents=True)
    source.write_text(
        "def create_order(order):\n    return order\n",
        encoding="utf-8",
    )
    if repair_context:
        (tmp_path / ".env").write_text("repair-source-secret", encoding="utf-8")
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
        if repair_context:
            assert "one bounded repair" in prompt
            assert "Do not return a unified diff" in prompt
            assert "corrupt patch at line 49" in prompt
            assert "diff --git a/src/orders/service.py b/src/orders/service.py" in prompt
            assert '"status": "available"' in prompt
            assert '"content": "def create_order(order):\\n    return order\\n"' in prompt
            assert '"status": "excluded-sensitive"' in prompt
            assert "repair-source-secret" not in prompt
        else:
            assert "diff --git a/<path> b/<path>" in prompt
            assert "must begin in column 1" in prompt
            assert "ordered and non-overlapping" in prompt
            assert "even a blank context line must contain its leading space" in prompt
            assert "Do not include placeholder changes" in prompt
        assert timeout_seconds == (1200.0 if provider == "ollama" else 180.0)
        if repair_context:
            assert response_schema == reference_factory._patch_repair_response_schema({
                "src/orders/service.py",
            })
        else:
            assert response_schema == reference_factory._reference_response_schema({"repository-task-test"})
            assert response_schema["properties"]["patches"]["items"]["properties"]["repository_id"]["enum"] == [
                "repository-task-test",
            ]
        if provider == "ollama":
            if not repair_context:
                assert response_schema["properties"]["tests"]["items"]["properties"]["test_type"]["enum"]
            assert "$defs" not in json.dumps(response_schema)
        if repair_context:
            return json.dumps({
                "files": [{
                    "file_path": "src/orders/service.py",
                    "action": "modify",
                    "content": (
                        "def create_order(order):\n"
                        "    if not order:\n"
                        "        raise ValueError('order is required')\n"
                        "    return order\n"
                    ),
                }],
            })
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
    request_body = {
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
    }
    if repair_context:
        request_body["patch_repair"] = {
            "repository_id": "repository-task-test",
            "patch_diff": (
                "diff --git a/src/orders/service.py b/src/orders/service.py\n"
                "--- a/src/orders/service.py\n+++ b/src/orders/service.py\n"
                "@@ -1 +1 @@\n-def create_order(order): return order\n"
                "+def create_order(order): return order\n"
                "diff --git a/.env b/.env\n"
                "--- a/.env\n+++ b/.env\n"
            ),
            "preflight_error": "corrupt patch at line 49",
        }
    response = client.post("/api/v1/references/generate", json=request_body)

    assert response.status_code == 200
    result = response.json()
    assert result["provider"] == provider
    assert result["model"] == model
    assert result["status"] == "pending_review"
    assert result["patches"][0]["repository_id"] == "repository-task-test"
    assert result["prompt_version"] == "reference-factory-v8"
    if repair_context:
        assert "diff --git a/src/orders/service.py b/src/orders/service.py" in result["patches"][0]["patch_diff"]
        assert "+    if not order:" in result["patches"][0]["patch_diff"]
        assert "implementation_plan" not in result
    else:
        assert result["implementation_plan"][0]["file_path"] == "src/orders/service.py"
        assert result["tests"][0]["test_type"] == "feature"
        assert result["validation"]["build"] == "not_run"


def test_reference_generation_schema_error_reports_fields_without_input_values():
    with pytest.raises(HTTPException) as error:
        reference_factory._validate_reference_output({
            "implementation_plan": [{
                "repository_id": "repository-task-test",
                "file_path": "src/orders/service.py",
                "rationale": "Change the order creation behavior.",
                "steps": ["Update validation."],
                "private_model_output": "do-not-echo",
            }],
            "patches": [{
                "repository_id": "repository-task-test",
                "patch_diff": "x" * 30,
            }],
            "tests": [{
                "repository_id": "repository-task-test",
                "file_path": "tests/test_order.py",
                "test_type": "feature",
                "purpose": "Verify the order behavior.",
                "content": "def test_order():\n    assert True\n",
            }],
        }, {"repository-task-test"})

    assert "implementation_plan.0.action (missing)" in error.value.detail
    assert "private_model_output" in error.value.detail
    assert "do-not-echo" not in error.value.detail


@pytest.mark.parametrize(
    ("patches", "expected_error"),
    [
        (
            [{
                "repository_id": "unknown-repository",
                "patch_diff": (
                    "diff --git a/src/orders/service.py b/src/orders/service.py\n"
                    "--- a/src/orders/service.py\n+++ b/src/orders/service.py\n"
                    "@@ -1 +1 @@\n-old\n+new\n"
                ),
            }],
            "unknown repository",
        ),
        (
            [{
                "repository_id": "repository-task-test",
                "patch_diff": (
                    "diff --git a/src/orders/service.py b/src/orders/service.py\n"
                    "--- a/src/orders/service.py\n+++ b/src/orders/service.py\n"
                    "@@ -1 +1 @@\n-old\n+new\n"
                ),
            }] * 2,
            "multiple patch bundles",
        ),
    ],
)
def test_reference_generation_rejects_unknown_or_duplicate_patch_repositories(patches, expected_error):
    with pytest.raises(HTTPException, match=expected_error):
        reference_factory._validate_reference_output({
            "implementation_plan": [{
                "repository_id": "repository-task-test",
                "file_path": "src/orders/service.py",
                "action": "modify",
                "rationale": "Change order behavior.",
                "steps": ["Update validation."],
            }],
            "patches": patches,
            "tests": [{
                "repository_id": "repository-task-test",
                "file_path": "tests/test_order.py",
                "test_type": "feature",
                "purpose": "Verify the order behavior.",
                "content": "def test_order():\n    assert True\n",
            }],
        }, {"repository-task-test"})


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


def test_reference_generation_rejects_placeholder_patch_content():
    with pytest.raises(HTTPException, match="placeholder patch content"):
        reference_factory._validate_patch_paths(
            "diff --git a/src/file.ts b/src/file.ts\n"
            "--- a/src/file.ts\n+++ b/src/file.ts\n"
            "@@ -1 +1,2 @@\n-old line\n+new line\n",
        )


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("provider", "base_url", "api_key", "response_schema"),
    [
        ("openrouter", "https://openrouter.test/api/v1", "test-api-key", None),
        (
            "openrouter",
            "https://openrouter.test/api/v1",
            "test-api-key",
            {"type": "object", "properties": {"result": {"type": "string"}}},
        ),
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
                "name": "structured_response",
                "strict": True,
                "schema": response_schema,
            },
        }
    if provider == "openrouter" and response_schema is not None:
        assert captured["payload"]["provider"] == {"require_parameters": True}
    else:
        assert "provider" not in captured["payload"]
    assert captured["headers"].get("authorization") == (
        f"Bearer {api_key}" if api_key else None
    )


def test_embeddings_endpoint_returns_deterministic_vectors():
    client = TestClient(app)
    response = client.post(
        "/api/v1/embeddings",
        json={"texts": ["parse json value", "validate schema"]},
    )
    assert response.status_code == 200
    payload = response.json()
    assert payload["dimensions"] == 384
    assert len(payload["embeddings"]) == 2
    assert len(payload["embeddings"][0]) == 384


def test_analysis_extracts_cpp_cmake_project_and_chunks(tmp_path):
    (tmp_path / "CMakeLists.txt").write_text(
        "cmake_minimum_required(VERSION 3.16)\nproject(sample_cpp)\nenable_testing()\n",
        encoding="utf-8",
    )
    include_dir = tmp_path / "include" / "sample"
    include_dir.mkdir(parents=True)
    (include_dir / "value.h").write_text(
        "namespace sample {\nclass Value {\npublic:\n  int asInt() const;\n};\n}\n",
        encoding="utf-8",
    )
    src_dir = tmp_path / "src"
    src_dir.mkdir()
    (src_dir / "value.cpp").write_text(
        '#include "sample/value.h"\nnamespace sample {\nint Value::asInt() const {\n  return 42;\n}\n}\n',
        encoding="utf-8",
    )

    client = TestClient(app)
    response = client.post(
        "/api/v1/analyze",
        json={
            "repository_id": "repo-cpp-1",
            "snapshot_id": "snap-cpp-1",
            "commit_sha": "0123456789abcdef0123456789abcdef01234567",
            "repository_path": str(tmp_path),
            "ecosystem": "cpp",
        },
    )
    assert response.status_code == 200
    payload = response.json()
    assert payload["summary"]["language"] == ["C++", "C/C++ Header"] or "C++" in payload["summary"]["language"]
    assert len(payload["chunks"]) >= 2
    assert all(len(chunk["embedding"]) == 384 for chunk in payload["chunks"])
    assert payload["summary"]["repository_profile"]["repository_kind"]
    assert isinstance(payload["summary"]["existing_features"], list)
    assert payload["summary"]["niche_details"]["public_api_surface"]


@pytest.mark.asyncio
async def test_openrouter_falls_back_to_json_object_on_400(monkeypatch):
    calls = []

    class FakeResponse:
        def __init__(self, status_code, body):
            self.status_code = status_code
            self.is_success = 200 <= status_code < 300
            self._body = body

        def json(self):
            return self._body

    class FakeAsyncClient:
        def __init__(self, **kwargs):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            return None

        async def post(self, url, headers, json):
            calls.append(json)
            if len(calls) == 1:
                return FakeResponse(400, {"error": {"message": "strict schema unsupported"}})
            return FakeResponse(200, {"choices": [{"message": {"content": '{"tasks": []}'}}]})

    monkeypatch.setattr(task_factory.httpx, "AsyncClient", FakeAsyncClient)

    result = await task_factory._request_chat_completions(
        "openrouter",
        "https://openrouter.test/api/v1",
        "test-model",
        "Return JSON.",
        500,
        "test-key",
        {"type": "object", "properties": {}, "required": [], "additionalProperties": False},
    )

    assert result == '{"tasks": []}'
    assert len(calls) == 2
    assert calls[0]["response_format"]["type"] == "json_schema"
    assert calls[1]["response_format"] == {"type": "json_object"}
    assert "provider" not in calls[1]


@pytest.mark.asyncio
async def test_chat_completion_retries_malformed_json_with_json_object(monkeypatch):
    calls = []

    class FakeResponse:
        status_code = 200
        is_success = True

        def __init__(self, content):
            self.content = content

        def json(self):
            return {"choices": [{
                "message": {"content": self.content},
                "finish_reason": "stop",
            }]}

    class FakeAsyncClient:
        def __init__(self, **kwargs):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            return None

        async def post(self, url, headers, json):
            calls.append(json)
            return FakeResponse("not json" if len(calls) == 1 else '{"ok": true}')

    monkeypatch.setattr(task_factory.httpx, "AsyncClient", FakeAsyncClient)

    result = await task_factory._request_chat_completions(
        "openrouter",
        "https://openrouter.test/api/v1",
        "test-model",
        "Return a JSON object.",
        500,
        "test-key",
        {"type": "object", "properties": {}, "required": [], "additionalProperties": False},
    )

    assert result == '{"ok": true}'
    assert len(calls) == 2
    assert calls[0]["response_format"]["type"] == "json_schema"
    assert calls[1]["response_format"] == {"type": "json_object"}
    assert "previous response was not valid JSON" in calls[1]["messages"][0]["content"]


@pytest.mark.asyncio
async def test_chat_completion_reports_json_truncation(monkeypatch):
    class FakeResponse:
        status_code = 200
        is_success = True

        def json(self):
            return {"choices": [{
                "message": {"content": '{"partial":'},
                "finish_reason": "length",
            }]}

    class FakeAsyncClient:
        def __init__(self, **kwargs):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            return None

        async def post(self, url, headers, json):
            return FakeResponse()

    monkeypatch.setattr(task_factory.httpx, "AsyncClient", FakeAsyncClient)

    with pytest.raises(HTTPException, match="truncated at the 500-token output limit"):
        await task_factory._request_chat_completions(
            "openrouter",
            "https://openrouter.test/api/v1",
            "test-model",
            "Return a JSON object.",
            500,
            "test-key",
            {"type": "object", "properties": {}, "required": [], "additionalProperties": False},
        )


def test_analysis_features_endpoint_uses_vector_chunks(monkeypatch):
    from app import feature_extractor

    monkeypatch.setenv("OPENROUTER_API_KEY", "test-key")

    async def fake_chat(provider, base_url, model, prompt, max_tokens, api_key, response_schema):
        assert provider == "openrouter"
        assert "Vector-retrieved code chunks" in prompt
        assert "parse_value" in prompt
        return json.dumps({
            "repository_overview": "A lightweight parser library for structured configuration values.",
            "features": [
                {
                    "name": "Value Parsing",
                    "category": "Validation & Parsing",
                    "description": "Parses raw text inputs into typed Value objects with line-accurate error reporting.",
                    "evidence_files": ["src/parser.py"],
                    "key_symbols": ["parse_value"],
                }
            ],
        })

    monkeypatch.setattr(feature_extractor, "_request_chat_completions", fake_chat)

    response = client.post(
        "/api/v1/analysis/features",
        json={
            "repository_id": "repo-1",
            "snapshot_id": "snap-1",
            "commit_sha": "abc123",
            "repository_name": "org/sample",
            "provider": "openrouter",
            "summary": {"language": ["Python"], "modules": [{"name": "src", "path": "src", "file_count": 1}]},
            "vector_chunks": [
                {
                    "file_path": "src/parser.py",
                    "symbol": "parse_value",
                    "chunk_kind": "symbol",
                    "module_path": "src",
                    "content": "def parse_value(raw: str) -> dict:\n    return {'raw': raw}\n",
                }
            ],
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["status"] == "completed"
    assert payload["features"][0]["name"] == "Value Parsing"
    assert "Parses raw text inputs" in payload["features"][0]["description"]


@pytest.mark.anyio
async def test_request_chat_completions_retries_without_schema_on_empty_content(monkeypatch):
    from app import task_factory

    calls: list[dict] = []

    class FakeResponse:
        def __init__(self, status_code: int, payload: dict):
            self.status_code = status_code
            self._payload = payload
            self.is_success = 200 <= status_code < 300

        def json(self):
            return self._payload

    class FakeAsyncClient:
        def __init__(self, *args, **kwargs):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, exc_type, exc, tb):
            return False

        async def post(self, url, headers, json):
            calls.append(json)
            if len(calls) == 1:
                return FakeResponse(200, {"choices": [{"message": {"content": ""}, "finish_reason": "stop"}]})
            return FakeResponse(200, {"choices": [{"message": {"content": '{"ok": true}'}, "finish_reason": "stop"}]})

    monkeypatch.setattr(task_factory.httpx, "AsyncClient", FakeAsyncClient)

    result = await task_factory._request_chat_completions(
        "openrouter",
        "https://openrouter.test/api/v1",
        "test-model",
        "Return JSON.",
        500,
        "test-key",
        {"type": "object", "properties": {}, "required": [], "additionalProperties": False},
    )

    assert result == '{"ok": true}'
    assert len(calls) == 2
    assert calls[0]["response_format"]["type"] == "json_schema"
    assert calls[1]["response_format"] == {"type": "json_object"}


def test_reference_generation_orders_vector_context_before_requirements(monkeypatch, tmp_path):
    source = tmp_path / "src" / "validator.py"
    source.parent.mkdir(parents=True)
    source.write_text("def validate(value):\n    return True\n", encoding="utf-8")
    monkeypatch.setenv("OPENROUTER_API_KEY", "test-key")

    captured_prompt: dict[str, str] = {}

    async def fake_provider(
        provider,
        base_url,
        model,
        prompt,
        max_tokens,
        api_key,
        response_schema,
        timeout_seconds,
    ):
        captured_prompt["text"] = prompt
        return json.dumps({
            "implementation_plan": [{
                "repository_id": "repo-vec-1",
                "file_path": "src/validator.py",
                "action": "modify",
                "rationale": "Add length check to validator.",
                "steps": ["Update validate function."],
            }],
            "patches": [{
                "repository_id": "repo-vec-1",
                "patch_diff": (
                    "diff --git a/src/validator.py b/src/validator.py\n"
                    "--- a/src/validator.py\n+++ b/src/validator.py\n"
                    "@@ -1,2 +1,3 @@\n def validate(value):\n+    if not value: return False\n     return True\n"
                ),
            }],
            "tests": [{
                "repository_id": "repo-vec-1",
                "file_path": "tests/test_validator.py",
                "test_type": "feature",
                "purpose": "Verify empty values fail validation.",
                "content": "def test_empty():\n    assert validate('') is False\n",
            }],
        })

    monkeypatch.setattr(reference_factory, "_request_chat_completions", fake_provider)

    response = client.post("/api/v1/references/generate", json={
        "operation_id": "ref-vec-1",
        "project_id": "proj-1",
        "provider": "openrouter",
        "task": {
            "title": "Reject empty values",
            "description": "Ensure validate rejects empty strings.",
            "category": "new_feature",
            "difficulty": "easy",
            "requirements": ["Reject empty string"],
            "acceptance_criteria": ["validate('') returns False"],
            "constraints": [],
            "affected_modules": ["src"],
            "task_version": 1,
        },
        "repositories": [{
            "repository_id": "repo-vec-1",
            "repository_name": "org/validator",
            "snapshot_id": "snap-1",
            "analysis_id": "analysis-1",
            "commit_sha": "deadbeef",
            "repository_path": str(tmp_path),
            "summary": {"modules": [{"name": "src", "path": "src"}], "language": ["Python"]},
            "report": {
                "directory_tree": [{"path": "src/validator.py", "type": "file"}],
                "symbols": [{"name": "validate", "kind": "function", "file_path": "src/validator.py", "start_line": 1, "end_line": 2}],
                "api_routes": [],
                "database_entities": [],
                "tests": {"files": []},
                "graph": {"nodes": [], "edges": []},
            },
            "vector_chunks": [{
                "file_path": "src/validator.py",
                "symbol_name": "validate",
                "start_line": 1,
                "end_line": 2,
                "similarity": 0.92,
                "content": "def validate(value):\n    return True",
            }],
        }],
    })

    assert response.status_code == 200
    prompt = captured_prompt["text"]
    step1_idx = prompt.index("STEP 1 — CODEBASE VECTOR & PINNED SOURCE CONTEXT")
    vec_idx = prompt.index("Codebase vector context")
    step2_idx = prompt.index("STEP 2 — NEW FEATURE REQUIREMENT")
    step3_idx = prompt.index("STEP 3 — GENERATE REFERENCE SOLUTION AND TESTS")
    assert step1_idx < vec_idx < step2_idx < step3_idx


@pytest.mark.anyio
async def test_request_chat_completions_disables_reasoning_when_reasoning_exhausts_tokens(monkeypatch):
    from app import task_factory

    calls: list[dict] = []

    class FakeResponse:
        def __init__(self, status_code: int, payload: dict):
            self.status_code = status_code
            self._payload = payload
            self.is_success = 200 <= status_code < 300

        def json(self):
            return self._payload

    class FakeAsyncClient:
        def __init__(self, *args, **kwargs):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, exc_type, exc, tb):
            return False

        async def post(self, url, headers, json):
            calls.append(json)
            if len(calls) == 1:
                return FakeResponse(200, {
                    "choices": [{
                        "message": {"content": "", "reasoning": "thinking..."},
                        "finish_reason": "length",
                    }],
                })
            return FakeResponse(200, {
                "choices": [{
                    "message": {"content": '{"ok": true}'},
                    "finish_reason": "stop",
                }],
            })

    monkeypatch.setattr(task_factory.httpx, "AsyncClient", FakeAsyncClient)

    result = await task_factory._request_chat_completions(
        "openrouter",
        "https://openrouter.test/api/v1",
        "baidu/ernie-5.5-flash-preview:free",
        "Return JSON.",
        16000,
        "test-key",
        {"type": "object", "properties": {}, "required": [], "additionalProperties": False},
    )

    assert result == '{"ok": true}'
    assert len(calls) == 2
    assert calls[1]["reasoning"] == {"enabled": False}
    assert calls[1]["response_format"] == {"type": "json_object"}


def test_normalize_reference_output_maps_common_llm_field_aliases():
    normalized = reference_factory._normalize_reference_output(
        {
            "implementation_plan": [{
                "file_path": "src/orders/service.py",
                "action": "update",
                "description": "Add validation for empty orders before persistence.",
            }],
            "patches": [{
                "diff": (
                    "diff --git a/src/orders/service.py b/src/orders/service.py\n"
                    "--- a/src/orders/service.py\n+++ b/src/orders/service.py\n"
                    "@@ -1,2 +1,3 @@\n def create_order(order):\n+    if not order: raise ValueError('empty')\n     return order\n"
                ),
                "patch_diff_note": "extra commentary field should be stripped",
            }],
            "tests": [{
                "file_path": "tests/test_orders.py",
                "type": "unit",
                "description": "Verify empty order raises ValueError.",
                "code": "def test_empty():\n    assert True\n",
            }],
        },
        {"repo-1"},
    )
    validated = reference_factory._validate_reference_output(normalized, {"repo-1"})
    assert validated.implementation_plan[0].repository_id == "repo-1"
    assert validated.implementation_plan[0].action == "modify"
    assert validated.implementation_plan[0].rationale.startswith("Add validation")
    assert validated.implementation_plan[0].steps
    assert validated.tests[0].test_type == "feature"
    assert validated.tests[0].purpose.startswith("Verify empty order")


def test_normalize_patch_repair_output_handles_dict_and_single_file():
    normalized = reference_factory._normalize_patch_repair_output(
        {"file_path": "src/orders/service.py", "action": "modify", "content": "def create_order(o):\n    return o\n"},
        {"src/orders/service.py"},
    )
    validated = reference_factory._validate_patch_repair_output(normalized, {"src/orders/service.py"})
    assert validated.files[0].file_path == "src/orders/service.py"
    assert validated.files[0].action == "modify"


def test_normalize_patch_repair_strips_diff_prefixes_and_accepts_subset():
    normalized = reference_factory._normalize_patch_repair_output(
        {"files": [{"file_path": "b/src/orders/service.py", "action": "modify", "content": "def create_order(o):\n    return o\n"}]},
        {"src/orders/service.py", "src/orders/types.py"},
    )
    validated = reference_factory._validate_patch_repair_output(
        normalized,
        {"src/orders/service.py", "src/orders/types.py"},
    )
    assert validated.files[0].file_path == "src/orders/service.py"


def test_normalize_reference_output_merges_multiple_patches_for_same_repository():
    normalized = reference_factory._normalize_reference_output(
        {
            "implementation_plan": [{
                "file_path": "src/a.py",
                "action": "modify",
                "rationale": "Update both modules consistently.",
                "steps": ["Update a.py and b.py."],
            }],
            "patches": [
                {
                    "repository_id": "repo-1",
                    "patch_diff": "diff --git a/src/a.py b/src/a.py\n--- a/src/a.py\n+++ b/src/a.py\n@@ -1 +1 @@\n-a = 1\n+a = 2\n",
                },
                {
                    "repository_id": "repo-1",
                    "patch_diff": "diff --git a/src/b.py b/src/b.py\n--- a/src/b.py\n+++ b/src/b.py\n@@ -1 +1 @@\n-b = 1\n+b = 2\n",
                },
            ],
            "tests": [{
                "file_path": "tests/test_ab.py",
                "test_type": "feature",
                "purpose": "Verify updated values.",
                "content": "def test_ab():\n    assert True\n",
            }],
        },
        {"repo-1"},
    )
    validated = reference_factory._validate_reference_output(normalized, {"repo-1"})
    assert len(validated.patches) == 1
    assert "diff --git a/src/a.py b/src/a.py" in validated.patches[0].patch_diff
    assert "diff --git a/src/b.py b/src/b.py" in validated.patches[0].patch_diff







