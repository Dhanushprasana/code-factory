from __future__ import annotations

import json
from typing import Any, Literal

from fastapi import HTTPException
from pydantic import BaseModel, ConfigDict, Field, ValidationError

from app.feature_extractor import _resolve_provider_config
from app.task_factory import (
    _extract_json,
    _request_chat_completions,
    _sanitize_strict_schema,
)


class GapItem(BaseModel):
    model_config = ConfigDict(extra="forbid")

    existing_feature: str = Field(min_length=3, max_length=140)
    category: str = Field(min_length=2, max_length=60)
    existing_capabilities: list[str] = Field(default_factory=list, max_length=12)
    potential_gaps: list[str] = Field(min_length=1, max_length=10)
    evidence_files: list[str] = Field(default_factory=list, max_length=10)
    target_scope: str = Field(default="core_library", max_length=40)


class GapAnalysisOutput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    gaps: list[GapItem] = Field(min_length=1, max_length=15)


class GapAnalysisRequest(BaseModel):
    repository_name: str
    provider: Literal["openrouter", "ollama"] = "openrouter"
    task_category: str = "feature"
    scope_filter: Literal["core_library", "all"] = "core_library"
    user_idea: str | None = Field(default=None, max_length=1000)
    feature_inventory: list[dict[str, Any]] = Field(default_factory=list)
    existing_features: list[dict[str, Any]] = Field(default_factory=list)
    modules: list[dict[str, Any]] = Field(default_factory=list)


def _gap_response_schema() -> dict[str, Any]:
    schema = _sanitize_strict_schema(GapAnalysisOutput.model_json_schema())
    schema.pop("$defs", None)
    return schema


async def analyze_gaps(request: GapAnalysisRequest) -> dict[str, Any]:
    """Identify concrete functional gaps from feature inventory and module scopes."""
    api_key, model, base_url = _resolve_provider_config(request.provider)

    filtered_modules = [
        m for m in request.modules
        if isinstance(m, dict)
        and (request.scope_filter == "all" or m.get("scope", "core_library") == "core_library")
    ][:40]

    payload_context = {
        "repository_name": request.repository_name,
        "task_category": request.task_category,
        "scope_filter": request.scope_filter,
        "user_idea": request.user_idea or "",
        "feature_inventory": request.feature_inventory[:25],
        "existing_features": request.existing_features[:20],
        "modules": filtered_modules,
    }

    prompt = (
        "You are a senior software architect performing Gap Analysis before generating coding tasks. "
        "Given the repository's feature inventory, existing features, and modules, identify genuine functional gaps "
        "or missing capabilities—NEVER propose capabilities that are already marked IMPLEMENTED.\n\n"
        "Rules:\n"
        "1. Only propose gaps within the allowed `scope_filter` (if `core_library`, ignore website/docs/benchmarks).\n"
        "2. Do not propose generic tasks like 'add error handling' or 'improve benchmarks' unless requested.\n"
        "3. Focus on concrete missing APIs, unsupported constraints, edge cases, or composable capabilities.\n"
        "4. Return ONLY a JSON object with a `gaps` array.\n\n"
        f"Context: {json.dumps(payload_context, ensure_ascii=False)}"
    )

    text = await _request_chat_completions(
        request.provider,
        base_url,
        model,
        prompt,
        2200,
        api_key,
        _gap_response_schema(),
    )
    raw = _extract_json(text)
    try:
        parsed = GapAnalysisOutput.model_validate(raw)
    except ValidationError as error:
        raise HTTPException(
            status_code=502,
            detail="The AI provider returned an invalid gap-analysis payload.",
        ) from error

    return {
        "status": "completed",
        "provider": request.provider,
        "model": model,
        "gap_analysis": [item.model_dump() for item in parsed.gaps],
    }
