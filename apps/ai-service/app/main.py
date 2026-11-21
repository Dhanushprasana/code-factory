from fastapi import FastAPI
from fastapi import HTTPException
from pydantic import BaseModel, Field
from pathlib import Path
import os

from app.analyzers.repository_analyzer import (
    ANALYZER_VERSION,
    analyze_repository as scan_repository,
)

app = FastAPI(title="ForgeBench AI Service", version="0.1.0")


class HealthResponse(BaseModel):
    status: str
    service: str


class AnalysisRequest(BaseModel):
    operation_id: str | None = None
    repository_id: str
    snapshot_id: str
    commit_sha: str
    repository_path: str
    ecosystem: str


class AnalysisResponse(BaseModel):
    operation_id: str
    status: str
    summary: dict
    report: dict = Field(default_factory=dict)
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
    allowed_root = os.getenv("REPOSITORY_SCAN_ROOT")
    if allowed_root:
        root = Path(request.repository_path).resolve()
        try:
            root.relative_to(Path(allowed_root).resolve(strict=True))
        except ValueError as error:
            raise HTTPException(
                status_code=400,
                detail="Repository snapshot path is outside the configured scan root.",
            ) from error
        except OSError as error:
            raise HTTPException(
                status_code=400,
                detail="Configured repository scan root is unavailable.",
            ) from error
    try:
        result = scan_repository(
            repository_path=request.repository_path,
            repository_id=request.repository_id,
            snapshot_id=request.snapshot_id,
            commit_sha=request.commit_sha,
            ecosystem=request.ecosystem,
        )
    except (FileNotFoundError, NotADirectoryError, ValueError) as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
    return AnalysisResponse(
        operation_id=request.operation_id or request.snapshot_id,
        status="completed",
        summary=result["summary"],
        report={"analyzer_version": ANALYZER_VERSION, **result["report"]},
        artifact_refs=[],
        warnings=result["warnings"],
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
