from __future__ import annotations

import json
import os
from typing import Any, Callable, Awaitable, Literal

from pydantic import BaseModel

from app.compiler.grounding import RepositoryGroundTruth
from app.compiler.ir import (
    ReferencePlanOutput,
    ReferenceSolutionIR,
    StageModelConfig,
    TaskDesignOutput,
    VerificationSpecIR,
)


LLMCaller = Callable[[str, str, str, int, dict[str, Any]], Awaitable[str]]


def resolve_stage_model(
    stage: Literal["task_design", "reference_planning", "reference_solution", "test_generation", "repair"],
    default_model: str,
    stage_models: StageModelConfig | None = None,
) -> str:
    if stage_models is not None:
        override = getattr(stage_models, stage, None)
        if override and override.strip():
            return override.strip()
    env_map = {
        "task_design": "TASK_DESIGN_MODEL",
        "reference_planning": "REFERENCE_PLAN_MODEL",
        "reference_solution": "REFERENCE_SOLUTION_MODEL",
        "test_generation": "TEST_GENERATION_MODEL",
        "repair": "REPAIR_MODEL",
    }
    env_val = os.getenv(env_map[stage], "").strip()
    return env_val or default_model


def _strict_schema(model_cls: type[BaseModel]) -> dict[str, Any]:
    schema = model_cls.model_json_schema()
    schema["additionalProperties"] = False
    return schema


def _ground_truth_summary(ground_truth: RepositoryGroundTruth) -> dict[str, Any]:
    return {
        "working_dir": ground_truth.working_dir,
        "ecosystem": ground_truth.ecosystem,
        "framework": ground_truth.framework,
        "controllers": [
            {
                "name": c.name,
                "file_path": c.file_path,
                "prefix": c.prefix,
                "routes": c.routes,
                "guards": c.guards,
            }
            for c in ground_truth.controllers.values()
        ],
        "services": [
            {
                "name": s.name,
                "file_path": s.file_path,
                "injected_repositories": s.injected_repositories,
                "injected_services": [d["name"] for d in s.injected_services],
            }
            for s in ground_truth.services.values()
        ],
        "enums": ground_truth.enums,
        "dtos": ground_truth.dtos,
        "entities": ground_truth.entity_files,
        "existing_files": sorted(ground_truth.files)[:120],
    }


def _baseline_files_payload(
    file_paths: list[str],
    ground_truth: RepositoryGroundTruth,
    max_chars_per_file: int = 8000,
) -> list[dict[str, str]]:
    items: list[dict[str, str]] = []
    seen: set[str] = set()
    for fp in file_paths:
        cleaned = fp.strip().replace("\\", "/").lstrip("./")
        if cleaned in seen:
            continue
        content = ground_truth.read_text(cleaned)
        if content is None and ground_truth.working_dir != ".":
            prefixed = f"{ground_truth.working_dir}/{cleaned}"
            content = ground_truth.read_text(prefixed)
            if content is not None:
                cleaned = prefixed
        if content is not None:
            seen.add(cleaned)
            items.append({"file_path": cleaned, "content": content[:max_chars_per_file]})
    return items


async def run_stage_task_design(
    llm_call: LLMCaller,
    model: str,
    context: dict[str, Any],
    ground_truth: RepositoryGroundTruth,
    category: str,
    difficulty: str,
    user_idea: str | None,
    constraints: list[str],
    context_md_prompt: str = "",
) -> TaskDesignOutput:
    gt_summary = _ground_truth_summary(ground_truth)
    prompt = (
        "Stage A — Task Design Generation.\n"
        "You are designing ONE small, testable, repository-grounded coding benchmark task.\n"
        "Rules:\n"
        "1. ONLY propose features/changes grounded in the actual repository files and contracts below.\n"
        "2. NEVER propose features or validations that are already implemented in the repository.\n"
        "3. NEVER guess routes, controller prefixes, enum values, or DTO properties. Use exact values from Repository Ground Truth.\n"
        "4. Do NOT mention internal reference-solution method names or *.patch.ts files.\n"
        "5. Include concrete happy_paths, negative_cases, edge_cases, requirements, and observable acceptance_criteria.\n"
        f"Requested category: {category}. Difficulty: {difficulty}.\n"
        f"User idea: {user_idea or 'Propose a useful, narrowly scoped improvement from detected modules and test gaps.'}\n"
        f"Constraints: {json.dumps(constraints)}\n\n"
        f"{context_md_prompt}"
        f"Repository Ground Truth:\n{json.dumps(gt_summary, ensure_ascii=False)}\n\n"
        f"Context Chunks:\n{json.dumps(context, ensure_ascii=False)}"
    )
    raw = await llm_call(model, prompt, "task_design", 4000, _strict_schema(TaskDesignOutput))
    return TaskDesignOutput.model_validate_json(raw)


async def repair_task_design(
    llm_call: LLMCaller,
    model: str,
    previous: TaskDesignOutput,
    errors: list[str],
    ground_truth: RepositoryGroundTruth,
) -> TaskDesignOutput:
    prompt = (
        "Targeted Repair — Stage A (Task Design).\n"
        "Fix ONLY the grounding/quality errors listed below without changing the core intent unless invalid.\n"
        f"Validation errors:\n{json.dumps(errors)}\n\n"
        f"Repository Ground Truth:\n{json.dumps(_ground_truth_summary(ground_truth), ensure_ascii=False)}\n\n"
        f"Previous Task Design:\n{previous.model_dump_json()}"
    )
    raw = await llm_call(model, prompt, "repair_task_design", 4000, _strict_schema(TaskDesignOutput))
    return TaskDesignOutput.model_validate_json(raw)


async def run_stage_reference_planning(
    llm_call: LLMCaller,
    model: str,
    design: TaskDesignOutput,
    ground_truth: RepositoryGroundTruth,
) -> ReferencePlanOutput:
    candidate_files = list(design.grounding.referenced_files)
    for c in ground_truth.controllers.values():
        if any(m.lower() in c.file_path.lower() for m in design.specification.affected_modules):
            candidate_files.append(c.file_path)
    for s in ground_truth.services.values():
        if any(m.lower() in s.file_path.lower() for m in design.specification.affected_modules):
            candidate_files.append(s.file_path)

    files_payload = _baseline_files_payload(candidate_files, ground_truth)
    prompt = (
        "Stage B — Reference Implementation Planning.\n"
        "Inspect the validated task specification and the actual source files below, then produce a concrete implementation plan.\n"
        "Do NOT guess file paths or module registrations.\n\n"
        f"Validated Task Specification:\n{design.model_dump_json()}\n\n"
        f"Baseline Source Files:\n{json.dumps(files_payload, ensure_ascii=False)}"
    )
    raw = await llm_call(model, prompt, "reference_planning", 2500, _strict_schema(ReferencePlanOutput))
    return ReferencePlanOutput.model_validate_json(raw)


async def run_stage_reference_solution(
    llm_call: LLMCaller,
    model: str,
    design: TaskDesignOutput,
    plan: ReferencePlanOutput,
    ground_truth: RepositoryGroundTruth,
) -> ReferenceSolutionIR:
    target_files = list(dict.fromkeys([*plan.files_to_modify, *design.grounding.referenced_files]))
    files_payload = _baseline_files_payload(target_files, ground_truth, max_chars_per_file=14000)
    prompt = (
        "Stage C — Reference Solution Generation.\n"
        "Produce structured file changes implementing the approved task contract and plan.\n"
        "Rules:\n"
        "1. For operation='modify', copy the EXACT baseline file content from Baseline Source Files and ONLY insert/update the minimal lines required — NEVER rewrite the file from memory, NEVER change existing import paths (e.g. keep '@app/user/guards/auth.guard' and './enities/product-stock.entity'), and NEVER delete any existing methods (like findManyByIds) or decorators!\n"
        "2. For operation='create', provide the complete new file content and add module registrations if creating a controller/service.\n"
        "3. NEVER invent *.patch.ts files or alter the task's acceptance criteria.\n"
        "4. If TypeORM 0.2.x is used, NEVER call findOneBy() or findBy() — use findOne() or find().\n"
        "5. Do NOT generate solve.sh or bash scripts — only structured file changes.\n\n"
        f"Validated Task Design:\n{design.model_dump_json()}\n\n"
        f"Approved Implementation Plan:\n{plan.model_dump_json()}\n\n"
        f"Baseline Source Files:\n{json.dumps(files_payload, ensure_ascii=False)}"
    )
    raw = await llm_call(model, prompt, "reference_solution", 8000, _strict_schema(ReferenceSolutionIR))
    return ReferenceSolutionIR.model_validate_json(raw)


async def repair_reference_solution(
    llm_call: LLMCaller,
    model: str,
    design: TaskDesignOutput,
    previous: ReferenceSolutionIR,
    errors: list[str],
    ground_truth: RepositoryGroundTruth,
) -> ReferenceSolutionIR:
    target_files = [c.path for c in previous.changes]
    files_payload = _baseline_files_payload(target_files, ground_truth, max_chars_per_file=14000)
    prompt = (
        "Targeted Repair — Stage C (Reference Solution).\n"
        "Fix ONLY the validation/build errors below without changing the approved task contract.\n"
        f"Errors:\n{json.dumps(errors)}\n\n"
        f"Previous Reference Solution:\n{previous.model_dump_json()}\n\n"
        f"Baseline Source Files:\n{json.dumps(files_payload, ensure_ascii=False)}\n\n"
        f"Task Specification:\n{design.specification.model_dump_json()}"
    )
    raw = await llm_call(model, prompt, "repair_reference_solution", 8000, _strict_schema(ReferenceSolutionIR))
    return ReferenceSolutionIR.model_validate_json(raw)


async def run_stage_test_specification(
    llm_call: LLMCaller,
    model: str,
    design: TaskDesignOutput,
    ground_truth: RepositoryGroundTruth,
) -> VerificationSpecIR:
    # IMPORTANT: Never pass ReferenceSolutionIR to Stage D!
    baseline_files = _baseline_files_payload(design.grounding.referenced_files, ground_truth, max_chars_per_file=8000)
    prompt = (
        "Stage D — Independent Behavioural Test Specification Generation.\n"
        "Design test cases that verify ONLY the public observable contract in the Task Specification.\n"
        "You are intentionally NOT shown any reference implementation.\n"
        "Rules:\n"
        "1. Include happy_path, negative_path, and edge_case test cases.\n"
        "2. Use exact controller route prefixes from Repository Ground Truth (e.g. /order/... not /orders/...).\n"
        "3. Do NOT depend on internal method names, private fields, or specific filenames.\n"
        "4. Populate target_controller, target_controller_path, target_service, target_service_path, mocked_repositories, and mocked_services from Repository Ground Truth.\n\n"
        f"Validated Task Design:\n{design.model_dump_json()}\n\n"
        f"Repository Ground Truth:\n{json.dumps(_ground_truth_summary(ground_truth), ensure_ascii=False)}\n\n"
        f"Baseline Public Files:\n{json.dumps(baseline_files, ensure_ascii=False)}"
    )
    raw = await llm_call(model, prompt, "test_generation", 4500, _strict_schema(VerificationSpecIR))
    return VerificationSpecIR.model_validate_json(raw)


async def repair_test_specification(
    llm_call: LLMCaller,
    model: str,
    design: TaskDesignOutput,
    previous: VerificationSpecIR,
    errors: list[str],
    ground_truth: RepositoryGroundTruth,
) -> VerificationSpecIR:
    prompt = (
        "Targeted Repair — Stage D (Test Specification).\n"
        "Fix ONLY the test specification errors listed below. Do NOT depend on reference implementation internals.\n"
        f"Errors:\n{json.dumps(errors)}\n\n"
        f"Previous Verification Spec:\n{previous.model_dump_json()}\n\n"
        f"Repository Ground Truth:\n{json.dumps(_ground_truth_summary(ground_truth), ensure_ascii=False)}\n\n"
        f"Task Specification:\n{design.specification.model_dump_json()}"
    )
    raw = await llm_call(model, prompt, "repair_test_specification", 4500, _strict_schema(VerificationSpecIR))
    return VerificationSpecIR.model_validate_json(raw)
