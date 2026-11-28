from __future__ import annotations

import json
import logging
from typing import Any, Literal

from fastapi import HTTPException
from pydantic import BaseModel, ConfigDict, Field, ValidationError

from app.feature_extractor import _resolve_provider_config
from app.task_factory import (
    _extract_json,
    _request_chat_completions,
    _sanitize_strict_schema,
)

logger = logging.getLogger("ai-service.task_verifier")


class TaskVerificationResult(BaseModel):
    model_config = ConfigDict(extra="forbid")

    feature_already_exists: bool
    within_scope: bool
    is_testable: bool
    is_specific: bool
    decision: Literal["APPROVED", "REJECTED", "NEEDS_REVISION"]
    reason: str = Field(min_length=5, max_length=600)
    source_evidence: list[str] = Field(default_factory=list, max_length=10)


class TaskVerificationRequest(BaseModel):
    provider: Literal["openrouter", "ollama"] = "openrouter"
    task: dict[str, Any]
    scope_filter: Literal["core_library", "all"] = "core_library"
    task_categories: list[str] = Field(default_factory=list)
    feature_inventory: list[dict[str, Any]] = Field(default_factory=list)
    core_public_apis: list[str] = Field(default_factory=list)
    vector_chunks: list[dict[str, Any]] = Field(default_factory=list)


def _verification_response_schema() -> dict[str, Any]:
    schema = _sanitize_strict_schema(TaskVerificationResult.model_json_schema())
    schema.pop("$defs", None)
    return schema


async def verify_task_candidate(request: TaskVerificationRequest) -> dict[str, Any]:
    """Verify a generated task against source evidence, feature inventory, and scope rules."""
    api_key, model, base_url = _resolve_provider_config(request.provider)

    bounded_chunks = [
        {
            "file_path": c.get("file_path"),
            "symbol": c.get("symbol"),
            "start_line": c.get("start_line"),
            "end_line": c.get("end_line"),
            "content": str(c.get("content") or "")[:900],
        }
        for c in request.vector_chunks[:20]
        if isinstance(c, dict) and c.get("content")
    ]

    verification_context = {
        "task": request.task,
        "scope_filter": request.scope_filter,
        "allowed_categories": request.task_categories,
        "feature_inventory": request.feature_inventory[:25],
        "core_public_apis": request.core_public_apis[:250],
        "source_chunks": bounded_chunks,
    }

    prompt = (
        "You are a strict Code Factory Task Verifier. Evaluate whether the proposed coding task is valid, "
        "genuinely new (not already implemented), within scope, specific, and testable.\n\n"
        "Reject (`decision`: 'REJECTED') if ANY of these hold:\n"
        "1. `feature_already_exists`: The proposed behavior or public API is already implemented in the repository or feature inventory.\n"
        "2. Out of scope: `scope_filter` is 'core_library' and the task targets website, docs, benchmarks, or test-only files.\n"
        "3. Vague/untestable: No concrete API, observable behavior, or measurable acceptance criteria.\n\n"
        "Set `decision` to 'NEEDS_REVISION' if the gap is real but the specification needs tighter API/edge-case details, "
        "or 'APPROVED' if it is a genuinely new, well-specified, testable task.\n"
        "Return ONLY JSON matching the schema.\n\n"
        f"Verification context: {json.dumps(verification_context, ensure_ascii=False)}"
    )

    text = await _request_chat_completions(
        request.provider,
        base_url,
        model,
        prompt,
        900,
        api_key,
        _verification_response_schema(),
    )
    raw = _extract_json(text)
    try:
        parsed = TaskVerificationResult.model_validate(raw)
    except ValidationError as error:
        raise HTTPException(
            status_code=502,
            detail="The AI provider returned an invalid task-verification payload.",
        ) from error

    return {
        "status": "completed",
        "provider": request.provider,
        "model": model,
        **parsed.model_dump(),
    }
