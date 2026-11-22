from fastapi import FastAPI
from fastapi import HTTPException
from pydantic import BaseModel, Field
from pathlib import Path
import os

from app.analyzers.repository_analyzer import (
    ANALYZER_VERSION,
    analyze_repository as scan_repository,
)
from app.task_factory import (
    TaskGenerationRequest,
    TaskGenerationResponse,
    generate_task_suggestions,
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
async def suggest_tasks(request: TaskGenerationRequest) -> TaskGenerationResponse:
    allowed_root = os.getenv("REPOSITORY_SCAN_ROOT")
    if allowed_root:
        try:
            scan_root = Path(allowed_root).resolve(strict=True)
        except OSError as error:
            raise HTTPException(
                status_code=400,
                detail="Configured repository scan root is unavailable.",
            ) from error
        for repository in request.repositories:
            try:
                root = Path(repository.repository_path).resolve(strict=True)
            except OSError as error:
                raise HTTPException(
                    status_code=400,
                    detail="A task context repository path is unavailable.",
                ) from error
            try:
                root.relative_to(scan_root)
            except ValueError as error:
                raise HTTPException(
                    status_code=400,
                    detail="A task context path is outside the configured repository scan root.",
                ) from error
    return await generate_task_suggestions(request)
