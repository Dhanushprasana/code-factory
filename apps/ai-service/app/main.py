from fastapi import FastAPI
from pydantic import BaseModel, Field
from pathlib import Path
import json
import re

app = FastAPI(title="ForgeBench AI Service", version="0.1.0")


class HealthResponse(BaseModel):
    status: str
    service: str


class AnalysisRequest(BaseModel):
    repository_id: str
    snapshot_id: str
    commit_sha: str
    repository_path: str
    ecosystem: str


class AnalysisResponse(BaseModel):
    operation_id: str
    status: str
    summary: dict
    artifact_refs: list[str] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)


class TaskSuggestionRequest(BaseModel):
    operation_id: str
    project_id: str
    snapshot_ids: list[str]
    analysis_ids: list[str] = Field(default_factory=list)
    user_idea: str | None = None
    difficulty: str = "medium"


@app.get("/health", response_model=HealthResponse)
def health() -> HealthResponse:
    return HealthResponse(status="ok", service="forgebench-ai")


@app.post("/api/v1/analyze", response_model=AnalysisResponse)
def analyze_repository(request: AnalysisRequest) -> AnalysisResponse:
    repository_path = Path(request.repository_path)
    warnings: list[str] = []
    languages: list[str] = []
    frameworks: list[str] = []
    modules: list[str] = []
    test_commands: list[str] = []
    entry_points: list[str] = []
    dependencies: dict[str, object] = {}

    if not repository_path.exists():
        warnings.append("Repository snapshot path was not available; summary is incomplete.")
        return AnalysisResponse(
            operation_id=request.repository_id,
            status="failed",
            summary={"commit_sha": request.commit_sha},
            warnings=warnings,
        )

    files = [
        path for path in repository_path.rglob("*")
        if path.is_file()
        and not any(part in {".git", "node_modules", ".venv", "dist", "build"} for part in path.parts)
    ]
    if any(path.suffix == ".ts" or path.suffix == ".tsx" for path in files):
        languages.append("TypeScript")
    if any(path.suffix == ".js" or path.suffix == ".jsx" for path in files):
        languages.append("JavaScript")
    if any(path.suffix == ".py" for path in files):
        languages.append("Python")

    package_json = repository_path / "package.json"
    if package_json.exists():
        try:
            package = json.loads(package_json.read_text(encoding="utf-8"))
            dependencies.update({"dependencies": package.get("dependencies", {})})
            scripts = package.get("scripts", {})
            for name in ("test", "build", "lint", "typecheck"):
                if name in scripts:
                    test_commands.append(f"npm run {name}")
            frameworks.extend(
                name for name in ("React", "NestJS", "Next.js", "Express")
                if name.lower() in json.dumps(package).lower()
            )
        except (json.JSONDecodeError, OSError):
            warnings.append("package.json was present but could not be parsed.")

    pyproject = repository_path / "pyproject.toml"
    if pyproject.exists():
        try:
            text = pyproject.read_text(encoding="utf-8")
            dependencies.update({"python": re.findall(r'^\s*([A-Za-z0-9_.-]+)\s*[>=<~]', text, re.MULTILINE)})
            if "fastapi" in text.lower():
                frameworks.append("FastAPI")
            if "django" in text.lower():
                frameworks.append("Django")
            test_commands.append("pytest")
        except OSError:
            warnings.append("pyproject.toml was present but could not be parsed.")

    source_dirs = [repository_path / name for name in ("src", "app", "apps", "packages")]
    for source_dir in source_dirs:
        if source_dir.exists():
            for path in source_dir.iterdir():
                if path.is_dir():
                    modules.append(path.name)
    modules = sorted(set(modules))

    for filename in ("src/main.ts", "src/main.tsx", "app/main.py", "main.py"):
        if (repository_path / filename).exists():
            entry_points.append(filename)

    if not languages:
        warnings.append("No supported source language was detected.")
    if not test_commands:
        warnings.append("No standard test command was detected.")

    return AnalysisResponse(
        operation_id=request.repository_id,
        status="completed",
        summary={
            "language": sorted(set(languages)),
            "frameworks": sorted(set(frameworks)),
            "modules": modules,
            "test_commands": sorted(set(test_commands)),
            "entry_points": entry_points,
            "dependencies": dependencies,
            "file_count": len(files),
            "features": [],
            "commit_sha": request.commit_sha,
        },
        artifact_refs=[],
        warnings=warnings,
    )


@app.post("/api/v1/tasks/suggest")
def suggest_tasks(request: TaskSuggestionRequest) -> dict:
    idea = request.user_idea or "Implement a repository-grounded feature"
    return {
        "operation_id": request.operation_id,
        "status": "completed",
        "tasks": [
            {
                "title": idea,
                "description": f"{idea} with repository conventions and preservation of existing behavior.",
                "requirements": [
                    "Support valid and invalid inputs",
                    "Preserve existing behavior",
                ],
                "acceptance_criteria": [
                    "Valid inputs produce the requested observable result",
                    "Invalid inputs return a clear, testable response",
                ],
                "affected_modules": ["feature-module", "existing-tests"],
            }
        ],
    }
