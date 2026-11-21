from fastapi.testclient import TestClient
from pathlib import Path
import tempfile

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
