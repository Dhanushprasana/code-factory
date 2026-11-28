from fastapi import FastAPI
from fastapi import HTTPException
from pydantic import BaseModel, Field
from pathlib import Path
import os

from app.analyzers.repository_analyzer import (
    ANALYZER_VERSION,
    analyze_repository as scan_repository,
)
from app.embeddings import embed_texts
from app.feature_extractor import (
    FeatureExtractionRequest,
    extract_feature_inventory,
    extract_features_from_chunks,
)
from app.gap_analyzer import GapAnalysisRequest, analyze_gaps
from app.task_verifier import TaskVerificationRequest, verify_task_candidate
from app.task_factory import (
    TaskGenerationRequest,
    TaskGenerationResponse,
    generate_task_suggestions,
)
from app.reference_factory import (
    ReferenceGenerationRequest,
    generate_reference_solution,
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
    chunks: list[dict] = Field(default_factory=list)
    artifact_refs: list[str] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)


class EmbeddingRequest(BaseModel):
    texts: list[str] = Field(min_length=1, max_length=64)


class EmbeddingResponse(BaseModel):
    model: str
    dimensions: int
    embeddings: list[list[float]]


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
        chunks=result.get("chunks", []),
        artifact_refs=[],
        warnings=result["warnings"],
    )


@app.post("/api/v1/embeddings", response_model=EmbeddingResponse)
async def create_embeddings(request: EmbeddingRequest) -> EmbeddingResponse:
    vectors, model, dim = await embed_texts(request.texts)
    return EmbeddingResponse(model=model, dimensions=dim, embeddings=vectors)


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


@app.post("/api/v1/references/generate")
async def generate_reference(request: ReferenceGenerationRequest) -> dict:
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
                    detail="A reference repository path is unavailable.",
                ) from error
            try:
                root.relative_to(scan_root)
            except ValueError as error:
                raise HTTPException(
                    status_code=400,
                    detail="A reference repository path is outside the configured scan root.",
                ) from error
    return await generate_reference_solution(request)


@app.post("/api/v1/analysis/features")
async def extract_analysis_features(request: FeatureExtractionRequest) -> dict:
    return await extract_features_from_chunks(request)


@app.post("/api/v1/analysis/inventory")
async def extract_analysis_inventory(request: FeatureExtractionRequest) -> dict:
    return await extract_feature_inventory(request)


@app.post("/api/v1/tasks/gaps")
async def analyze_task_gaps(request: GapAnalysisRequest) -> dict:
    return await analyze_gaps(request)


@app.post("/api/v1/tasks/verify")
async def verify_task(request: TaskVerificationRequest) -> dict:
    return await verify_task_candidate(request)
