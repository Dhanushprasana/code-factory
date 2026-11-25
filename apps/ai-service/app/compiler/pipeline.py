from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any

from app.compiler.grounding import (
    RepositoryGroundTruth,
    inspect_repository_snapshot,
    validate_reference_solution,
    validate_task_design,
    validate_verification_spec,
)
from app.compiler.harbor_compiler import CompiledHarborPackage, compile_harbor_package
from app.compiler.ir import (
    PackageLifecycleStatus,
    ReferencePlanOutput,
    ReferenceSolutionIR,
    StageExecutionRecord,
    StageModelConfig,
    TaskDesignOutput,
    TaskMetadataIR,
    TaskPackageIR,
    VerificationSpecIR,
)
from app.compiler.stages import (
    LLMCaller,
    repair_reference_solution,
    repair_task_design,
    repair_test_specification,
    resolve_stage_model,
    run_stage_reference_planning,
    run_stage_reference_solution,
    run_stage_task_design,
    run_stage_test_specification,
)
from app.compiler.validator import run_all_validation_gates


@dataclass
class CompiledTaskResult:
    ir: TaskPackageIR
    harbor_package: CompiledHarborPackage


def _slugify(title: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", title.lower()).strip("-")
    return slug[:80] or "task"


async def compile_single_task_package(
    llm_call: LLMCaller,
    provider: str,
    default_model: str,
    context: dict[str, Any],
    repository_input: dict[str, Any],
    category: str,
    difficulty: str,
    user_idea: str | None,
    constraints: list[str],
    context_md_prompt: str = "",
    stage_models: StageModelConfig | None = None,
    max_repair_attempts: int = 2,
    execute_runtime_validation: bool = False,
) -> CompiledTaskResult:
    ground_truth: RepositoryGroundTruth = inspect_repository_snapshot(
        repository_input.get("repository_path"),
        context_repo=context.get("repositories", [None])[0],
    )

    stage_records: list[StageExecutionRecord] = []
    total_repairs = 0

    design_model = resolve_stage_model("task_design", default_model, stage_models)
    plan_model = resolve_stage_model("reference_planning", default_model, stage_models)
    solution_model = resolve_stage_model("reference_solution", default_model, stage_models)
    test_model = resolve_stage_model("test_generation", default_model, stage_models)
    repair_model = resolve_stage_model("repair", default_model, stage_models)

    # Stage A: Task Design Generation + Grounding Validation + Targeted Repair
    design: TaskDesignOutput = await run_stage_task_design(
        llm_call=llm_call,
        model=design_model,
        context=context,
        ground_truth=ground_truth,
        category=category,
        difficulty=difficulty,
        user_idea=user_idea,
        constraints=constraints,
        context_md_prompt=context_md_prompt,
    )
    design_attempts = 1
    design_gate = validate_task_design(design, ground_truth)
    while not design_gate.passed and design_attempts <= max_repair_attempts:
        design_attempts += 1
        total_repairs += 1
        design = await repair_task_design(llm_call, repair_model, design, design_gate.errors, ground_truth)
        design_gate = validate_task_design(design, ground_truth)

    stage_records.append(
        StageExecutionRecord(
            stage="task_design",
            status="repaired" if design_attempts > 1 and design_gate.passed else ("completed" if design_gate.passed else "failed"),
            provider=provider,
            model=design_model,
            attempts=design_attempts,
            error="; ".join(design_gate.errors) if design_gate.errors else None,
        )
    )

    # Stage B: Reference Implementation Planning
    plan: ReferencePlanOutput = await run_stage_reference_planning(
        llm_call=llm_call,
        model=plan_model,
        design=design,
        ground_truth=ground_truth,
    )
    stage_records.append(
        StageExecutionRecord(
            stage="reference_planning",
            status="completed",
            provider=provider,
            model=plan_model,
            attempts=1,
        )
    )

    # Stage C: Reference Solution Generation + Validation + Targeted Repair
    solution: ReferenceSolutionIR = await run_stage_reference_solution(
        llm_call=llm_call,
        model=solution_model,
        design=design,
        plan=plan,
        ground_truth=ground_truth,
    )
    sol_attempts = 1
    sol_gate = validate_reference_solution(solution, plan, ground_truth)
    while not sol_gate.passed and sol_attempts <= max_repair_attempts:
        sol_attempts += 1
        total_repairs += 1
        solution = await repair_reference_solution(llm_call, repair_model, design, solution, sol_gate.errors, ground_truth)
        sol_gate = validate_reference_solution(solution, plan, ground_truth)

    stage_records.append(
        StageExecutionRecord(
            stage="reference_solution",
            status="repaired" if sol_attempts > 1 and sol_gate.passed else ("completed" if sol_gate.passed else "failed"),
            provider=provider,
            model=solution_model,
            attempts=sol_attempts,
            error="; ".join(sol_gate.errors) if sol_gate.errors else None,
        )
    )

    # Stage D: Independent Test Specification Generation (NO ReferenceSolutionIR passed!)
    verification: VerificationSpecIR = await run_stage_test_specification(
        llm_call=llm_call,
        model=test_model,
        design=design,
        ground_truth=ground_truth,
    )
    test_attempts = 1
    test_gate = validate_verification_spec(verification, design, None, ground_truth)
    while not test_gate.passed and test_attempts <= max_repair_attempts:
        test_attempts += 1
        total_repairs += 1
        verification = await repair_test_specification(llm_call, repair_model, design, verification, test_gate.errors, ground_truth)
        test_gate = validate_verification_spec(verification, design, None, ground_truth)

    stage_records.append(
        StageExecutionRecord(
            stage="test_generation",
            status="repaired" if test_attempts > 1 and test_gate.passed else ("completed" if test_gate.passed else "failed"),
            provider=provider,
            model=test_model,
            attempts=test_attempts,
            error="; ".join(test_gate.errors) if test_gate.errors else None,
        )
    )

    slug = _slugify(design.title)
    ir = TaskPackageIR(
        metadata=TaskMetadataIR(
            name=f"forgebench/{slug}",
            slug=slug,
            title=design.title,
            description=design.description,
            objective=design.specification.objective,
            category=design.category,
            difficulty=design.difficulty,
            repository_id=str(repository_input["repository_id"]),
            snapshot_id=str(repository_input["snapshot_id"]),
            commit_sha=str(repository_input["commit_sha"]),
            package_version="1.0.0",
        ),
        grounding=design.grounding,
        specification=design.specification,
        reference_solution=solution,
        verification=verification,
        environment=ground_truth.environment,
        lifecycle_status=PackageLifecycleStatus.COMPILING_PACKAGE,
        stage_records=stage_records,
        repair_attempts=total_repairs,
        model_routing=StageModelConfig(
            task_design=design_model,
            reference_planning=plan_model,
            reference_solution=solution_model,
            test_generation=test_model,
            repair=repair_model,
        ),
    )

    # Stage E + Deterministic Harbor Package Compiler
    harbor_pkg = compile_harbor_package(ir, ground_truth)

    # Automated Validation Gates 1-7
    lifecycle_status, gates = run_all_validation_gates(
        ir=ir,
        design=design,
        plan=plan,
        pkg=harbor_pkg,
        ground_truth=ground_truth,
        execute_runtime=execute_runtime_validation,
    )

    # Targeted runtime repair if execution gate 4 or 5 failed
    exec_repairs = 0
    while lifecycle_status != PackageLifecycleStatus.READY and exec_repairs < max_repair_attempts:
        failed_g4 = next((g for g in gates if g.gate == "gate_4_reference_build" and not g.passed), None)
        failed_g5 = next((g for g in gates if g.gate == "gate_5_verifier_against_reference" and not g.passed), None)
        if failed_g4:
            exec_repairs += 1
            total_repairs += 1
            solution = await repair_reference_solution(llm_call, repair_model, design, solution, failed_g4.errors, ground_truth)
            ir.reference_solution = solution
        elif failed_g5:
            exec_repairs += 1
            total_repairs += 1
            verification = await repair_test_specification(llm_call, repair_model, design, verification, failed_g5.errors, ground_truth)
            ir.verification = verification
        else:
            break

        harbor_pkg = compile_harbor_package(ir, ground_truth)
        lifecycle_status, gates = run_all_validation_gates(
            ir=ir,
            design=design,
            plan=plan,
            pkg=harbor_pkg,
            ground_truth=ground_truth,
            execute_runtime=execute_runtime_validation,
        )

    ir.lifecycle_status = lifecycle_status
    ir.validation_gates = gates
    ir.repair_attempts = total_repairs
    return CompiledTaskResult(ir=ir, harbor_package=harbor_pkg)


async def repair_compiled_package(
    llm_call: LLMCaller,
    provider: str,
    default_model: str,
    package_ir_dict: dict[str, Any],
    repository_input: dict[str, Any],
    failing_stage: str,
    errors: list[str],
    stage_models: StageModelConfig | None = None,
) -> CompiledTaskResult:
    ir = TaskPackageIR.model_validate(package_ir_dict)
    ground_truth: RepositoryGroundTruth = inspect_repository_snapshot(
        repository_input.get("repository_path"),
        context_repo=None,
    )
    repair_model = resolve_stage_model("repair", default_model, stage_models)
    design = TaskDesignOutput(
        title=ir.metadata.title,
        description=ir.metadata.description,
        category=ir.metadata.category,
        difficulty=ir.metadata.difficulty,
        specification=ir.specification,
        grounding=ir.grounding,
    )
    plan = ReferencePlanOutput(
        files_to_modify=[c.path for c in ir.reference_solution.changes if c.operation == "modify"],
        new_files_required=[c.path for c in ir.reference_solution.changes if c.operation == "create"],
        implementation_sequence=["Repair failing component without altering approved task contract."],
    )

    if failing_stage == "reference_solution":
        ir.reference_solution = await repair_reference_solution(
            llm_call=llm_call,
            model=repair_model,
            design=design,
            previous=ir.reference_solution,
            errors=errors,
            ground_truth=ground_truth,
        )
    elif failing_stage == "test_generation":
        ir.verification = await repair_test_specification(
            llm_call=llm_call,
            model=repair_model,
            design=design,
            previous=ir.verification,
            errors=errors,
            ground_truth=ground_truth,
        )

    ir.repair_attempts += 1
    harbor_pkg = compile_harbor_package(ir, ground_truth)
    lifecycle_status, gates = run_all_validation_gates(
        ir=ir,
        design=design,
        plan=plan,
        pkg=harbor_pkg,
        ground_truth=ground_truth,
        execute_runtime=False,
    )
    ir.lifecycle_status = lifecycle_status
    ir.validation_gates = gates
    return CompiledTaskResult(ir=ir, harbor_package=harbor_pkg)
