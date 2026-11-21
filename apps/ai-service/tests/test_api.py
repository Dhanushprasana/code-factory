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
