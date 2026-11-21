from fastapi.testclient import TestClient
from pathlib import Path
import tempfile

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
