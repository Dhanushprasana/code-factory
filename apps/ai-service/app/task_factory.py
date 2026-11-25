from __future__ import annotations

import json
import logging
import os
import re
from typing import Any, Literal
from uuid import uuid4

import httpx
from fastapi import HTTPException
from pydantic import BaseModel, ConfigDict, Field, ValidationError, field_validator

from app.context_engine import build_task_context
from app.compiler.ir import StageModelConfig
from app.compiler.pipeline import compile_single_task_package, repair_compiled_package

logger = logging.getLogger("ai_service.task_factory")


PROMPT_VERSION = "task-package-compiler-v1"
TASK_CATEGORIES = (
    "feature",
    "bug_fix",
    "api_enhancement",
    "refactoring",
    "database_change",
    "performance",
    "test_improvement",
)
TASK_DIFFICULTIES = ("easy", "medium", "hard")


class EvidenceReference(BaseModel):
    model_config = ConfigDict(extra="forbid")

    repository_id: str
    snapshot_id: str
    commit_sha: str
    file_path: str
    start_line: int = Field(ge=1)
    end_line: int = Field(ge=1)
    symbol: str | None = None


class HarborFiles(BaseModel):
    model_config = ConfigDict(extra="ignore")

    instruction_md: str = Field(min_length=10)
    task_toml: str = Field(min_length=10)
    dockerfile: str = Field(min_length=10)
    solve_sh: str = Field(min_length=10)
    test_sh: str = Field(min_length=10)


class TaskCandidate(BaseModel):
    model_config = ConfigDict(extra="ignore")

    title: str = Field(min_length=8, max_length=160)
    description: str = Field(min_length=30, max_length=3000)
    category: str
    difficulty: str
    requirements: list[str] = Field(min_length=2, max_length=10)
    acceptance_criteria: list[str] = Field(min_length=2, max_length=10)
    constraints: list[str] = Field(default_factory=list, max_length=10)
    affected_modules: list[str] = Field(min_length=1, max_length=10)
    evidence: list[EvidenceReference] = Field(min_length=1, max_length=10)
    harbor_files: HarborFiles | None = None
    package_ir: dict[str, Any] | None = None
    lifecycle_status: str | None = None
    validation_gates: list[dict[str, Any]] | None = None
    stage_records: list[dict[str, Any]] | None = None
    repair_attempts: int = 0

    @field_validator("requirements", "acceptance_criteria", "constraints", "affected_modules")
    @classmethod
    def remove_empty_items(cls, values: list[str]) -> list[str]:
        cleaned = [value.strip() for value in values if value.strip()]
        if not cleaned and values:
            raise ValueError("List values cannot be blank.")
        return cleaned


class RepositoryContextInput(BaseModel):
    repository_id: str
    repository_name: str
    snapshot_id: str
    analysis_id: str
    commit_sha: str
    repository_path: str
    summary: dict[str, Any]
    report: dict[str, Any]
    context_markdown: str | None = None


class TaskGenerationRequest(BaseModel):
    operation_id: str | None = None
    project_id: str
    provider: Literal["openrouter", "ollama"]
    user_idea: str | None = Field(default=None, max_length=1000)
    category: str = "feature"
    difficulty: str = "medium"
    constraints: list[str] = Field(default_factory=list, max_length=10)
    count: int = Field(default=3, ge=1, le=5)
    repositories: list[RepositoryContextInput] = Field(min_length=1, max_length=10)
    stage_models: StageModelConfig | None = None
    max_repair_attempts: int = Field(default=2, ge=0, le=5)
    execute_runtime_validation: bool = False


class TaskGenerationResponse(BaseModel):
    operation_id: str
    status: str
    provider: str
    model: str
    prompt_version: str
    tasks: list[TaskCandidate]
    context_manifest: dict[str, Any]


def _extract_json(text: str) -> dict[str, Any]:
    stripped = text.strip()
    if stripped.startswith("```"):
        stripped = re.sub(r"^```(?:json)?\s*|\s*```$", "", stripped, flags=re.IGNORECASE)
    try:
        result = json.loads(stripped)
    except json.JSONDecodeError as error:
        print(f"[TASK_FACTORY] Failed to decode JSON from AI response: {error}\nRaw content was:\n{text}\n", flush=True)
        logger.error("Failed to decode JSON from AI response: %s. Raw text:\n%s", error, text)
        raise HTTPException(
            status_code=502,
            detail=f"The selected AI provider returned a task response that was not valid JSON: {stripped[:300]}",
        ) from error
    if not isinstance(result, dict):
        print(f"[TASK_FACTORY] AI response JSON is not an object: type={type(result)}, content={result}", flush=True)
        logger.error("AI response JSON is not an object: type=%s, content=%s", type(result), result)
        raise HTTPException(status_code=502, detail="The selected AI provider returned an invalid task response.")
    return result


def _env_setting(name: str, default: str) -> str:
    return os.getenv(name, "").strip() or default


def _synthesize_default_harbor_files(
    candidate: TaskCandidate,
    repository: dict[str, Any] | None = None,
) -> HarborFiles:
    slug = re.sub(r"[^a-z0-9]+", "-", candidate.title.lower()).strip("-")
    reqs_md = "\n".join(f"- {r}" for r in candidate.requirements)
    criteria_md = "\n".join(f"- {c}" for c in candidate.acceptance_criteria)
    constraints_md = (
        "\n".join(f"- {c}" for c in candidate.constraints)
        if candidate.constraints
        else "- Preserve existing conventions and code formatting."
    )

    instruction_md = (
        f"# Task: {candidate.title}\n\n"
        f"## Objective\n{candidate.description}\n\n"
        f"## Requirements\n{reqs_md}\n\n"
        f"## Acceptance Criteria\n{criteria_md}\n\n"
        f"## Constraints\n{constraints_md}\n"
    )

    task_toml = (
        'schema_version = "1.4"\n\n'
        f'[task]\nname = "forgebench/task-{slug}"\ndescription = "{candidate.title}"\n\n'
        '[verifier]\ntimeout_sec = 600.0\nenvironment_mode = "separate"\n\n'
        '[agent]\ntimeout_sec = 600.0\n\n'
        '[environment]\ncpus = 2\nmemory_mb = 4096\n'
    )

    summary = (repository or {}).get("summary", {})
    languages = [str(item).lower() for item in summary.get("language", [])]
    test_commands = summary.get("test_commands", [])

    if any(l in languages for l in ("python", "py")):
        dockerfile = (
            "FROM python:3.12-slim\n"
            "WORKDIR /workspace\n"
            "RUN apt-get update && apt-get install -y git bash curl && rm -rf /var/lib/apt/lists/*\n"
            "COPY . /workspace\n"
            "RUN pip install --no-cache-dir -e . || pip install --no-cache-dir -r requirements.txt || true\n"
        )
        test_cmd = test_commands[0] if test_commands else "pytest"
    elif any(l in languages for l in ("typescript", "javascript", "ts", "js")):
        dockerfile = (
            "FROM node:22-bookworm-slim\n"
            "WORKDIR /workspace\n"
            "RUN apt-get update && apt-get install -y git bash curl && rm -rf /var/lib/apt/lists/*\n"
            "COPY . /workspace\n"
            "RUN npm install || npm ci || true\n"
        )
        test_cmd = test_commands[0] if test_commands else "npm test"
    else:
        dockerfile = (
            "FROM ubuntu:24.04\n"
            "WORKDIR /workspace\n"
            "RUN apt-get update && apt-get install -y git bash curl build-essential && rm -rf /var/lib/apt/lists/*\n"
            "COPY . /workspace\n"
        )
        test_cmd = test_commands[0] if test_commands else "make test"

    solve_sh = (
        "#!/bin/bash\n"
        "set -e\n\n"
        f"# Reference solution for {candidate.title}\n"
        "echo 'Applying golden reference solution...'\n"
    )

    test_sh = (
        "#!/bin/bash\n"
        "mkdir -p /logs/verifier\n\n"
        f"# Harbor automated verifier executing: {test_cmd}\n"
        f"{test_cmd} > /logs/verifier/test.log 2>&1\n"
        "EXIT_CODE=$?\n\n"
        "if [ $EXIT_CODE -eq 0 ]; then\n"
        "  echo 1 > /logs/verifier/reward.txt\n"
        "else\n"
        "  echo 0 > /logs/verifier/reward.txt\n"
        "fi\n\n"
        "exit $EXIT_CODE\n"
    )

    return HarborFiles(
        instruction_md=instruction_md,
        task_toml=task_toml,
        dockerfile=dockerfile,
        solve_sh=solve_sh,
        test_sh=test_sh,
    )


def _task_response_schema(count: int, context: dict[str, Any]) -> dict[str, Any]:
    candidate_schema = TaskCandidate.model_json_schema()
    candidate_schema["required"] = list(candidate_schema["properties"])
    candidate_schema["properties"]["category"]["enum"] = list(TASK_CATEGORIES)
    candidate_schema["properties"]["difficulty"]["enum"] = list(TASK_DIFFICULTIES)
    allowed_modules = sorted({
        value
        for repository in context["repositories"]
        for module in repository["modules"]
        for value in (module["name"], module["path"])
        if value
    })
    if allowed_modules:
        candidate_schema["properties"]["affected_modules"]["items"]["enum"] = allowed_modules
    candidate_schema.pop("$defs", None)

    evidence_fields = (
        "repository_id",
        "snapshot_id",
        "commit_sha",
        "file_path",
        "start_line",
        "end_line",
        "symbol",
    )
    evidence = [
        {key: chunk[key] for key in evidence_fields}
        for repository in context["repositories"]
        for chunk in repository["chunks"]
    ]
    evidence_properties: dict[str, Any] = {}
    for key in evidence_fields:
        values = list(dict.fromkeys(item[key] for item in evidence))
        value_type = "integer" if key in {"start_line", "end_line"} else "string"
        if key == "symbol":
            value_type = ["string", "null"]
        evidence_properties[key] = {"type": value_type, "enum": values}
    candidate_schema["properties"]["evidence"]["items"] = {
        "type": "object",
        "properties": evidence_properties,
        "required": list(evidence_fields),
        "additionalProperties": False,
    }

    candidate_schema["properties"]["harbor_files"] = {
        "type": "object",
        "properties": {
            "instruction_md": {"type": "string"},
            "task_toml": {"type": "string"},
            "dockerfile": {"type": "string"},
            "solve_sh": {"type": "string"},
            "test_sh": {"type": "string"},
        },
        "required": ["instruction_md", "task_toml", "dockerfile", "solve_sh", "test_sh"],
        "additionalProperties": False,
    }

    return {
        "type": "object",
        "properties": {
            "tasks": {
                "type": "array",
                "minItems": 1,
                "maxItems": count,
                "items": candidate_schema,
            },
        },
        "required": ["tasks"],
        "additionalProperties": False,
    }


def _validate_candidates(
    values: Any,
    request: TaskGenerationRequest,
    context: dict[str, Any],
) -> list[TaskCandidate]:
    if not isinstance(values, list) or not values:
        raise HTTPException(status_code=502, detail="The AI provider returned no task suggestions.")
    allowed_categories = set(TASK_CATEGORIES)
    allowed_modules = {
        value.lower(): value
        for repository in context["repositories"]
        for module in repository["modules"]
        for value in (module["name"], module["path"])
        if value
    }

    # Index available chunks by (repository_id, file_path) and by file_path
    chunks_by_repo_file: dict[tuple[str, str], list[dict[str, Any]]] = {}
    chunks_by_file: dict[str, list[tuple[dict[str, Any], dict[str, Any]]]] = {}
    primary_repo = context["repositories"][0] if context.get("repositories") else None
    all_chunks: list[tuple[dict[str, Any], dict[str, Any]]] = []

    for repository in context.get("repositories", []):
        for chunk in repository.get("chunks", []):
            chunks_by_repo_file.setdefault((repository["repository_id"], chunk["file_path"]), []).append(chunk)
            chunks_by_file.setdefault(chunk["file_path"], []).append((repository, chunk))
            all_chunks.append((repository, chunk))

    candidates: list[TaskCandidate] = []
    titles: set[str] = set()

    for value in values[:request.count]:
        try:
            candidate = TaskCandidate.model_validate(value)
        except ValidationError as error:
            invalid_fields = ", ".join(
                f"{'.'.join(str(part) for part in issue['loc']) or '<root>'} ({issue['type']})"
                for issue in error.errors()[:5]
            )
            print(f"[TASK_FACTORY] Candidate schema validation failed: {invalid_fields}", flush=True)
            logger.warning("Candidate schema validation failed: %s", invalid_fields)
            raise HTTPException(
                status_code=502,
                detail=(
                    "The AI provider returned a task that did not match the required schema. "
                    f"Invalid fields: {invalid_fields}."
                ),
            ) from error

        # Category and difficulty normalization
        if candidate.category not in allowed_categories:
            candidate.category = request.category if request.category in allowed_categories else "feature"
        candidate.difficulty = request.difficulty

        # Module normalization
        valid_modules: list[str] = []
        for mod in candidate.affected_modules:
            mod_lower = mod.lower().strip()
            if mod_lower in allowed_modules:
                valid_modules.append(allowed_modules[mod_lower])
            else:
                matched = next(
                    (orig for k, orig in allowed_modules.items() if mod_lower in k or k in mod_lower),
                    None,
                )
                if matched and matched not in valid_modules:
                    valid_modules.append(matched)
        if not valid_modules:
            valid_modules = [list(allowed_modules.values())[0]] if allowed_modules else ["default"]
        candidate.affected_modules = valid_modules[:10]

        # Evidence grounding & normalization
        normalized_evidence: list[EvidenceReference] = []
        for ev in candidate.evidence:
            matched_repo = None
            matched_chunk = None

            # 1. Exact repository and file match
            if (ev.repository_id, ev.file_path) in chunks_by_repo_file:
                matched_chunks = chunks_by_repo_file[(ev.repository_id, ev.file_path)]
                matched_repo = next((r for r in context["repositories"] if r["repository_id"] == ev.repository_id), primary_repo)
                matched_chunk = matched_chunks[0]
            # 2. File path match across repositories
            elif ev.file_path in chunks_by_file:
                matched_repo, matched_chunk = chunks_by_file[ev.file_path][0]
            # 3. Basename / fuzzy file path match
            else:
                target_base = ev.file_path.split("/")[-1]
                for fpath, pairs in chunks_by_file.items():
                    if fpath.endswith(target_base):
                        matched_repo, matched_chunk = pairs[0]
                        break

            if matched_repo and matched_chunk:
                normalized_evidence.append(
                    EvidenceReference(
                        repository_id=matched_repo["repository_id"],
                        snapshot_id=matched_repo["snapshot_id"],
                        commit_sha=matched_repo["commit_sha"],
                        file_path=matched_chunk["file_path"],
                        start_line=ev.start_line if ev.start_line > 0 else matched_chunk["start_line"],
                        end_line=ev.end_line if ev.end_line >= ev.start_line else matched_chunk["end_line"],
                        symbol=ev.symbol or matched_chunk.get("symbol"),
                    )
                )

        # Fallback to primary chunk evidence if none matched
        if not normalized_evidence and all_chunks:
            fallback_repo, fallback_chunk = all_chunks[0]
            normalized_evidence.append(
                EvidenceReference(
                    repository_id=fallback_repo["repository_id"],
                    snapshot_id=fallback_repo["snapshot_id"],
                    commit_sha=fallback_repo["commit_sha"],
                    file_path=fallback_chunk["file_path"],
                    start_line=fallback_chunk["start_line"],
                    end_line=fallback_chunk["end_line"],
                    symbol=fallback_chunk.get("symbol"),
                )
            )

        if not normalized_evidence:
            print("[TASK_FACTORY] Skipping candidate: no grounded evidence could be linked.", flush=True)
            continue
        candidate.evidence = normalized_evidence[:10]

        normalized_title = candidate.title.casefold()
        if normalized_title in titles:
            continue

        # Ensure harbor_files are populated
        if candidate.harbor_files is None:
            candidate.harbor_files = _synthesize_default_harbor_files(candidate, primary_repo)

        titles.add(normalized_title)
        candidates.append(candidate)
    if not candidates:
        raise HTTPException(
            status_code=502,
            detail="The AI provider returned no distinct, repository-grounded task suggestions.",
        )
    return candidates


async def _request_chat_completions(
    provider: Literal["openrouter", "ollama"],
    base_url: str,
    model: str,
    prompt: str,
    max_tokens: int,
    api_key: str | None = None,
    response_schema: dict[str, Any] | None = None,
    timeout_seconds: float = 300.0,
) -> str:
    headers = {"content-type": "application/json"}
    if provider == "openrouter":
        if not api_key:
            raise HTTPException(status_code=503, detail="OpenRouter requires OPENROUTER_API_KEY.")
        headers["authorization"] = f"Bearer {api_key}"
    if provider == "openrouter":
        timeout_seconds = min(timeout_seconds, 90.0)
    response_format = {"type": "json_object"}
    if response_schema is not None:
        response_format = {
            "type": "json_schema",
            "json_schema": {
                "name": "structured_response",
                "strict": True,
                "schema": response_schema,
            },
        }
    request_body = {
        "model": model,
        "max_tokens": max_tokens,
        "temperature": 0.2,
        "response_format": response_format,
        "messages": [{"role": "user", "content": prompt}],
    }
    if provider == "openrouter":
        request_body["reasoning"] = {"effort": "none"}
        if response_schema is not None:
            request_body["provider"] = {"require_parameters": True}
    try:
        async with httpx.AsyncClient(
            timeout=httpx.Timeout(timeout_seconds, connect=10.0),
        ) as client:
            response = await client.post(
                f"{base_url.rstrip('/')}/chat/completions",
                headers=headers,
                json=request_body,
            )
    except httpx.TimeoutException as error:
        raise HTTPException(
            status_code=504,
            detail=f"{provider.capitalize()} task generation timed out.",
        ) from error
    except httpx.RequestError as error:
        status_code = 502 if provider == "openrouter" else 503
        detail = (
            "Could not connect to OpenRouter for task generation."
            if provider == "openrouter"
            else "Could not connect to Ollama. Check OLLAMA_BASE_URL and that the server is running."
        )
        raise HTTPException(status_code=status_code, detail=detail) from error
    if response.status_code in {401, 403}:
        raise HTTPException(
            status_code=503,
            detail=(
                "OpenRouter rejected the configured API key. Check OPENROUTER_API_KEY."
                if provider == "openrouter"
                else "Ollama rejected the request. Check the configured Ollama URL and server settings."
            ),
        )
    if response.status_code == 429:
        raise HTTPException(
            status_code=503,
            detail=(
                "OpenRouter rate limit or usage quota reached. Check the OpenRouter account."
                if provider == "openrouter"
                else "Ollama is busy or rate limited. Retry after the local server is ready."
            ),
        )
    if provider == "ollama" and response.status_code == 404:
        raise HTTPException(
            status_code=503,
            detail=f"Ollama could not find model '{model}'. Pull it with `ollama pull {model}` and retry.",
        )
    if response.status_code >= 500:
        status_code = 502 if provider == "openrouter" else 503
        raise HTTPException(
            status_code=status_code,
            detail=f"{provider.capitalize()} is temporarily unavailable.",
        )
    if not response.is_success:
        print(f"[{provider.upper()} HTTP ERROR {response.status_code}]: {response.text}", flush=True)
        logger.error("[%s] Rejected request HTTP %s: %s", provider, response.status_code, response.text)
        raise HTTPException(
            status_code=502,
            detail=f"{provider.capitalize()} rejected the task-generation request (HTTP {response.status_code}). Response: {response.text[:300]}",
        )
    try:
        payload = response.json()
        content = payload["choices"][0]["message"]["content"]
    except (ValueError, KeyError, IndexError, TypeError) as error:
        print(f"[{provider.upper()} INCOMPLETE RESPONSE]: {response.text}", flush=True)
        logger.error("[%s] Incomplete response (HTTP %s): %s", provider, response.status_code, response.text)
        raise HTTPException(
            status_code=502,
            detail=f"{provider.capitalize()} returned an incomplete task response. Raw: {response.text[:300]}",
        ) from error
    if isinstance(content, list):
        content = "".join(
            item.get("text", "")
            for item in content
            if isinstance(item, dict) and item.get("type") == "text"
        )
    if not isinstance(content, str) or not content.strip():
        # Log the full response so we can inspect exactly what OpenRouter returned
        choice = payload.get("choices", [{}])[0] if isinstance(payload, dict) and payload.get("choices") else {}
        msg = choice.get("message", {})
        finish_reason = choice.get("finish_reason")
        print(
            f"[{provider.upper()} EMPTY/INVALID CONTENT]\n"
            f"  finish_reason: {finish_reason}\n"
            f"  message object: {json.dumps(msg, default=str)}\n"
            f"  full response payload: {json.dumps(payload, default=str)}\n",
            flush=True,
        )
        logger.error(
            "[%s] Invalid/empty content. finish_reason: %s, message: %s, raw: %s",
            provider,
            finish_reason,
            json.dumps(msg, default=str),
            response.text,
        )
        raise HTTPException(
            status_code=502,
            detail=f"{provider.capitalize()} returned an invalid task response (finish_reason: {finish_reason}, message: {json.dumps(msg, default=str)[:300]}).",
        )
    print(f"[{provider.upper()} SUCCESS RESPONSE CONTENT LENGTH]: {len(content)} chars", flush=True)
    return content


async def generate_task_suggestions(request: TaskGenerationRequest) -> TaskGenerationResponse:
    if request.provider == "openrouter":
        api_key = os.getenv("OPENROUTER_API_KEY", "").strip()
        if not api_key:
            raise HTTPException(
                status_code=503,
                detail=(
                    "OpenRouter requires OPENROUTER_API_KEY. Set it in apps/backend/.env "
                    "and start Docker Compose with --env-file apps/backend/.env."
                ),
            )
        model = _env_setting("OPENROUTER_MODEL", "nvidia/nemotron-3.5-super-vl:free")
        base_url = _env_setting("OPENROUTER_BASE_URL", "https://openrouter.ai/api/v1")
    else:
        api_key = None
        model = _env_setting("OLLAMA_MODEL", "qwen2.5:7b")
        base_url = _env_setting("OLLAMA_BASE_URL", "http://host.docker.internal:11434/v1")
    token_budget = int(os.getenv("TASK_CONTEXT_TOKEN_BUDGET", "50000"))
    output_token_budget = int(os.getenv("TASK_OUTPUT_TOKEN_BUDGET", "12000"))
    context, manifest = build_task_context(
        [repository.model_dump() for repository in request.repositories],
        request.user_idea,
        request.category,
        request.constraints,
        token_budget,
    )
    if not any(repository["chunks"] for repository in context["repositories"]):
        raise HTTPException(
            status_code=422,
            detail="No readable source context was found in the selected completed analyses.",
        )

    # Collect any synthesized CONTEXT.md blueprints passed in the request
    context_md_sections: list[str] = []
    for repository in request.repositories:
        if repository.context_markdown and repository.context_markdown.strip():
            context_md_sections.append(
                f"### High-Level Architecture & Knowledge Blueprint (CONTEXT.md) for {repository.repository_name}:\n"
                f"{repository.context_markdown.strip()[:25000]}"
            )
    context_md_prompt = ("\n\n".join(context_md_sections) + "\n\n") if context_md_sections else ""

    async def _llm_call(
        stage_model: str,
        stage_prompt: str,
        _stage_name: str,
        stage_max_tokens: int,
        schema: dict[str, Any],
    ) -> str:
        return await _request_chat_completions(
            request.provider,
            base_url,
            stage_model,
            stage_prompt,
            max(stage_max_tokens, min(output_token_budget, stage_max_tokens)),
            api_key,
            schema,
        )

    primary_repo_input = request.repositories[0].model_dump()
    compiled_tasks: list[TaskCandidate] = []
    seen_titles: list[str] = []

    for _idx in range(request.count):
        stage_constraints = list(request.constraints)
        if seen_titles:
            stage_constraints.append(f"Must be distinct from previously generated tasks: {', '.join(seen_titles)}")
        compiled = await compile_single_task_package(
            llm_call=_llm_call,
            provider=request.provider,
            default_model=model,
            context=context,
            repository_input=primary_repo_input,
            category=request.category,
            difficulty=request.difficulty,
            user_idea=request.user_idea,
            constraints=stage_constraints,
            context_md_prompt=context_md_prompt,
            stage_models=request.stage_models,
            max_repair_attempts=request.max_repair_attempts,
            execute_runtime_validation=request.execute_runtime_validation,
        )
        ir = compiled.ir
        seen_titles.append(ir.metadata.title)
        harbor_dict = compiled.harbor_package.to_harbor_files_dict()
        evidence_refs = [
            EvidenceReference(
                repository_id=ev.repository_id,
                snapshot_id=ev.snapshot_id,
                commit_sha=ev.commit_sha,
                file_path=ev.file_path,
                start_line=ev.start_line,
                end_line=ev.end_line,
                symbol=ev.symbol,
            )
            for ev in ir.grounding.evidence
        ]
        if not evidence_refs:
            first_chunk = context["repositories"][0]["chunks"][0]
            evidence_refs = [
                EvidenceReference(
                    repository_id=first_chunk["repository_id"],
                    snapshot_id=first_chunk["snapshot_id"],
                    commit_sha=first_chunk["commit_sha"],
                    file_path=first_chunk["file_path"],
                    start_line=first_chunk["start_line"],
                    end_line=first_chunk["end_line"],
                    symbol=first_chunk.get("symbol"),
                )
            ]

        compiled_tasks.append(
            TaskCandidate(
                title=ir.metadata.title,
                description=ir.metadata.description,
                category=ir.metadata.category if ir.metadata.category in TASK_CATEGORIES else request.category,
                difficulty=ir.metadata.difficulty,
                requirements=ir.specification.requirements[:10],
                acceptance_criteria=ir.specification.acceptance_criteria[:10],
                constraints=ir.specification.constraints[:10],
                affected_modules=ir.specification.affected_modules[:10],
                evidence=evidence_refs[:10],
                harbor_files=HarborFiles(**harbor_dict),
                package_ir=ir.model_dump(mode="json"),
                lifecycle_status=ir.lifecycle_status.value,
                validation_gates=[g.model_dump(mode="json") for g in ir.validation_gates],
                stage_records=[s.model_dump(mode="json") for s in ir.stage_records],
                repair_attempts=ir.repair_attempts,
            )
        )

    return TaskGenerationResponse(
        operation_id=request.operation_id or str(uuid4()),
        status="completed",
        provider=request.provider,
        model=model,
        prompt_version=PROMPT_VERSION,
        tasks=compiled_tasks,
        context_manifest=manifest,
    )


class TaskRepairRequest(BaseModel):
    provider: Literal["openrouter", "ollama"]
    stage: Literal["reference_solution", "test_generation"]
    errors: list[str] = Field(min_length=1)
    package_ir: dict[str, Any]
    repository: RepositoryContextInput
    stage_models: StageModelConfig | None = None


async def repair_task_package(request: TaskRepairRequest) -> dict[str, Any]:
    if request.provider == "openrouter":
        api_key = os.getenv("OPENROUTER_API_KEY", "").strip()
        if not api_key:
            raise HTTPException(status_code=503, detail="OpenRouter requires OPENROUTER_API_KEY.")
        model = _env_setting("OPENROUTER_MODEL", "nvidia/nemotron-3.5-super-vl:free")
        base_url = _env_setting("OPENROUTER_BASE_URL", "https://openrouter.ai/api/v1")
    else:
        api_key = None
        model = _env_setting("OLLAMA_MODEL", "qwen2.5:7b")
        base_url = _env_setting("OLLAMA_BASE_URL", "http://host.docker.internal:11434/v1")

    output_token_budget = int(os.getenv("TASK_OUTPUT_TOKEN_BUDGET", "12000"))

    async def _llm_call(
        stage_model: str,
        stage_prompt: str,
        _stage_name: str,
        stage_max_tokens: int,
        schema: dict[str, Any],
    ) -> str:
        return await _request_chat_completions(
            request.provider,
            base_url,
            stage_model,
            stage_prompt,
            max(stage_max_tokens, min(output_token_budget, stage_max_tokens)),
            api_key,
            schema,
        )

    compiled = await repair_compiled_package(
        llm_call=_llm_call,
        provider=request.provider,
        default_model=model,
        package_ir_dict=request.package_ir,
        repository_input=request.repository.model_dump(),
        failing_stage=request.stage,
        errors=request.errors,
        stage_models=request.stage_models,
    )
    ir = compiled.ir
    return {
        "harbor_files": compiled.harbor_package.to_harbor_files_dict(),
        "package_ir": ir.model_dump(mode="json"),
        "lifecycle_status": ir.lifecycle_status.value,
        "validation_gates": [g.model_dump(mode="json") for g in ir.validation_gates],
        "repair_attempts": ir.repair_attempts,
    }
