from __future__ import annotations

import shutil
import subprocess
import tempfile
import tomllib
from pathlib import Path

from app.compiler.grounding import (
    RepositoryGroundTruth,
    validate_reference_solution,
    validate_task_design,
    validate_verification_spec,
)
from app.compiler.harbor_compiler import CompiledHarborPackage
from app.compiler.ir import (
    PackageLifecycleStatus,
    ReferencePlanOutput,
    TaskDesignOutput,
    TaskPackageIR,
    ValidationGateResult,
)


def validate_gate_1_ir_schema(ir: TaskPackageIR) -> ValidationGateResult:
    try:
        TaskPackageIR.model_validate(ir.model_dump())
        return ValidationGateResult(
            gate="gate_1_ir_schema",
            passed=True,
            summary="TaskPackageIR schema is valid.",
        )
    except Exception as exc:
        return ValidationGateResult(
            gate="gate_1_ir_schema",
            passed=False,
            summary="TaskPackageIR schema validation failed.",
            errors=[str(exc)],
        )


def validate_gate_2_package_structure(pkg: CompiledHarborPackage) -> ValidationGateResult:
    errors: list[str] = []
    warnings: list[str] = []

    files = pkg.to_harbor_files_dict()
    for name, content in files.items():
        if not content or not content.strip():
            errors.append(f"Compiled artifact '{name}' is empty.")

    if not pkg.solve_sh.startswith("#!/bin/bash"):
        errors.append("solve.sh must start with #!/bin/bash.")
    if "set -e" not in pkg.solve_sh:
        errors.append("solve.sh must enable set -e.")
    if "trap _harbor_cleanup EXIT" not in pkg.test_sh:
        errors.append("test.sh must register _harbor_cleanup EXIT trap.")
    if "echo 1 > /logs/verifier/reward.txt" not in pkg.test_sh:
        errors.append("test.sh must write 1 to /logs/verifier/reward.txt on success.")

    bash_bin = shutil.which("bash")
    if bash_bin:
        for script_name, script_body in (("solve.sh", pkg.solve_sh), ("test.sh", pkg.test_sh)):
            with tempfile.NamedTemporaryFile("w", suffix=".sh", delete=False, encoding="utf-8") as tmp:
                tmp.write(script_body)
                tmp_path = Path(tmp.name)
            try:
                proc = subprocess.run([bash_bin, "-n", str(tmp_path)], capture_output=True, text=True, timeout=10)
                if proc.returncode != 0:
                    errors.append(f"{script_name} failed bash syntax check: {proc.stderr.strip()}")
            finally:
                tmp_path.unlink(missing_ok=True)
    else:
        warnings.append("bash binary not available in current environment; skipped bash -n syntax check.")

    return ValidationGateResult(
        gate="gate_2_package_structure",
        passed=len(errors) == 0,
        summary="Compiled Harbor package structure and shell syntax valid." if not errors else f"{len(errors)} structure error(s).",
        errors=errors,
        warnings=warnings,
    )


def validate_gate_3_grounding(
    ir: TaskPackageIR,
    design: TaskDesignOutput,
    plan: ReferencePlanOutput,
    ground_truth: RepositoryGroundTruth,
) -> ValidationGateResult:
    g_design = validate_task_design(design, ground_truth)
    g_sol = validate_reference_solution(ir.reference_solution, plan, ground_truth)
    g_ver = validate_verification_spec(ir.verification, design, ir.reference_solution, ground_truth)
    errors = [*g_design.errors, *g_sol.errors, *g_ver.errors]
    warnings = [*g_design.warnings, *g_sol.warnings, *g_ver.warnings]
    return ValidationGateResult(
        gate="gate_3_repository_grounding",
        passed=len(errors) == 0,
        summary="Repository grounding & independence checks passed." if not errors else f"{len(errors)} grounding error(s).",
        errors=errors,
        warnings=warnings,
    )


def validate_gate_4_and_5_execution(
    pkg: CompiledHarborPackage,
    ground_truth: RepositoryGroundTruth,
    execute_runtime: bool = False,
) -> tuple[ValidationGateResult, ValidationGateResult]:
    if not execute_runtime or not ground_truth.root_path or not ground_truth.root_path.exists():
        msg = "Execution deferred to backend Verify Reference Solution / Harbor runner."
        return (
            ValidationGateResult(gate="gate_4_reference_build", passed=True, summary=msg, warnings=[msg]),
            ValidationGateResult(gate="gate_5_verifier_against_reference", passed=True, summary=msg, warnings=[msg]),
        )

    bash_bin = shutil.which("bash")
    if not bash_bin:
        msg = "bash not installed in ai-service container; runtime execution skipped."
        return (
            ValidationGateResult(gate="gate_4_reference_build", passed=True, summary=msg, warnings=[msg]),
            ValidationGateResult(gate="gate_5_verifier_against_reference", passed=True, summary=msg, warnings=[msg]),
        )

    with tempfile.TemporaryDirectory(prefix="task_compiler_exec_") as tmp_dir:
        ws = Path(tmp_dir) / "workspace"
        shutil.copytree(
            ground_truth.root_path,
            ws,
            ignore=shutil.ignore_patterns(".git", "dist", "build", ".next"),
        )
        solve_path = ws / "__solve.sh"
        test_path = ws / "__test.sh"
        solve_path.write_text(pkg.solve_sh, encoding="utf-8")
        test_path.write_text(pkg.test_sh, encoding="utf-8")

        solve_proc = subprocess.run([bash_bin, str(solve_path)], cwd=str(ws), capture_output=True, text=True, timeout=180)
        if solve_proc.returncode != 0:
            g4 = ValidationGateResult(
                gate="gate_4_reference_build",
                passed=False,
                summary=f"solve.sh failed with exit code {solve_proc.returncode}.",
                errors=[solve_proc.stderr[-1500:] or solve_proc.stdout[-1500:]],
            )
            g5 = ValidationGateResult(
                gate="gate_5_verifier_against_reference",
                passed=False,
                summary="Skipped because solve.sh failed.",
                errors=["Reference solution failed before verifier ran."],
            )
            return g4, g5

        g4 = ValidationGateResult(gate="gate_4_reference_build", passed=True, summary="solve.sh applied and built cleanly.")
        test_proc = subprocess.run([bash_bin, str(test_path)], cwd=str(ws), capture_output=True, text=True, timeout=180)
        if test_proc.returncode != 0:
            g5 = ValidationGateResult(
                gate="gate_5_verifier_against_reference",
                passed=False,
                summary=f"test.sh failed with exit code {test_proc.returncode}.",
                errors=[test_proc.stderr[-1500:] or test_proc.stdout[-1500:]],
            )
        else:
            g5 = ValidationGateResult(gate="gate_5_verifier_against_reference", passed=True, summary="test.sh passed against reference solution.")
        return g4, g5


def validate_gate_6_negative_control(ir: TaskPackageIR, ground_truth: RepositoryGroundTruth) -> ValidationGateResult:
    errors: list[str] = []
    warnings: list[str] = []

    # Ensure at least one test targets new behavior not identically present in baseline controllers
    baseline_routes = {
        (r["method"], r["full_route"])
        for c in ground_truth.controllers.values()
        for r in c.routes
    }
    targets_new_behavior = False
    for tc in ir.verification.test_cases:
        if tc.http_method != "NONE" and tc.route:
            if (tc.http_method, tc.route.split("?")[0]) not in baseline_routes:
                targets_new_behavior = True
                break
        if tc.category in {"negative_path", "edge_case"}:
            targets_new_behavior = True
            break

    if not targets_new_behavior:
        errors.append("Verification spec does not include any test case targeting new or negative/edge behavior beyond baseline.")

    return ValidationGateResult(
        gate="gate_6_negative_control",
        passed=len(errors) == 0,
        summary="Negative control coverage check passed." if not errors else "; ".join(errors),
        errors=errors,
        warnings=warnings,
    )


def validate_gate_7_harbor_package(pkg: CompiledHarborPackage) -> ValidationGateResult:
    errors: list[str] = []
    try:
        parsed_toml = tomllib.loads(pkg.task_toml)
        if parsed_toml.get("schema_version") != "1.4":
            errors.append(f"task.toml schema_version must be '1.4', got {parsed_toml.get('schema_version')!r}.")
        for section in ("task", "verifier", "agent", "environment"):
            if section not in parsed_toml:
                errors.append(f"task.toml missing [{section}] section.")
    except tomllib.TOMLDecodeError as exc:
        errors.append(f"task.toml invalid TOML: {exc}")

    if "FROM " not in pkg.dockerfile:
        errors.append("Dockerfile missing FROM instruction.")
    if "sk-or-" in pkg.dockerfile or "OPENROUTER_API_KEY=" in pkg.dockerfile:
        errors.append("Dockerfile must not embed API credentials.")

    if "verify-task.spec.ts" in pkg.instruction_md or "solve.sh" in pkg.instruction_md:
        errors.append("instruction.md must not leak verifier or reference solution internals.")

    return ValidationGateResult(
        gate="gate_7_harbor_package",
        passed=len(errors) == 0,
        summary="Harbor package format & leak checks passed." if not errors else f"{len(errors)} Harbor package error(s).",
        errors=errors,
    )


def run_all_validation_gates(
    ir: TaskPackageIR,
    design: TaskDesignOutput,
    plan: ReferencePlanOutput,
    pkg: CompiledHarborPackage,
    ground_truth: RepositoryGroundTruth,
    execute_runtime: bool = False,
) -> tuple[PackageLifecycleStatus, list[ValidationGateResult]]:
    gates: list[ValidationGateResult] = [
        validate_gate_1_ir_schema(ir),
        validate_gate_2_package_structure(pkg),
        validate_gate_3_grounding(ir, design, plan, ground_truth),
    ]
    g4, g5 = validate_gate_4_and_5_execution(pkg, ground_truth, execute_runtime=execute_runtime)
    gates.extend([
        g4,
        g5,
        validate_gate_6_negative_control(ir, ground_truth),
        validate_gate_7_harbor_package(pkg),
    ])
    all_passed = all(g.passed for g in gates)
    status = PackageLifecycleStatus.READY if all_passed else PackageLifecycleStatus.NEEDS_REVIEW
    return status, gates
