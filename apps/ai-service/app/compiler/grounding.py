from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from pathlib import Path, PurePosixPath
from typing import Any

from app.compiler.ir import (
    EnvironmentConfigIR,
    GroundingStatus,
    ReferencePlanOutput,
    ReferenceSolutionIR,
    TaskDesignOutput,
    ValidationGateResult,
    VerificationSpecIR,
)


@dataclass
class ControllerInfo:
    name: str
    file_path: str
    prefix: str
    routes: list[dict[str, str]] = field(default_factory=list)
    guards: list[str] = field(default_factory=list)


@dataclass
class ServiceInfo:
    name: str
    file_path: str
    injected_repositories: list[str] = field(default_factory=list)
    injected_services: list[dict[str, str]] = field(default_factory=list)


@dataclass
class RepositoryGroundTruth:
    root_path: Path | None
    working_dir: str = "backend"
    ecosystem: str = "node"
    framework: str = "nestjs"
    files: set[str] = field(default_factory=set)
    controllers: dict[str, ControllerInfo] = field(default_factory=dict)
    services: dict[str, ServiceInfo] = field(default_factory=dict)
    enums: dict[str, list[str]] = field(default_factory=dict)
    enum_files: dict[str, str] = field(default_factory=dict)
    dtos: dict[str, list[str]] = field(default_factory=dict)
    dto_files: dict[str, str] = field(default_factory=dict)
    entity_files: dict[str, str] = field(default_factory=dict)
    dependencies: set[str] = field(default_factory=set)
    environment: EnvironmentConfigIR = field(default_factory=EnvironmentConfigIR)

    def read_text(self, rel_path: str) -> str | None:
        if not self.root_path:
            return None
        cleaned = rel_path.strip().replace("\\", "/").lstrip("./")
        candidate = (self.root_path / cleaned).resolve()
        try:
            candidate.relative_to(self.root_path.resolve())
        except ValueError:
            return None
        if not candidate.is_file():
            return None
        try:
            return candidate.read_text(encoding="utf-8")
        except (OSError, UnicodeError):
            return None


_IGNORED_DIRS = {".git", "node_modules", "dist", "build", ".next", ".venv", "venv", "__pycache__"}


def _join_route(prefix: str, sub: str) -> str:
    p = prefix.strip("/")
    s = sub.strip("/")
    parts = [part for part in (p, s) if part]
    return "/" + "/".join(parts) if parts else "/"


def inspect_repository_snapshot(
    repository_path: str | Path | None,
    context_repo: dict[str, Any] | None = None,
) -> RepositoryGroundTruth:
    root = Path(repository_path).resolve() if repository_path and Path(repository_path).exists() else None
    gt = RepositoryGroundTruth(root_path=root)

    if root:
        for path in root.rglob("*"):
            if any(part in _IGNORED_DIRS for part in path.parts):
                continue
            if path.is_file():
                rel = path.relative_to(root).as_posix()
                gt.files.add(rel)

        # Detect working_dir & ecosystem
        if "backend/package.json" in gt.files:
            gt.working_dir = "backend"
            gt.ecosystem = "node"
        elif "package.json" in gt.files:
            gt.working_dir = "."
            gt.ecosystem = "node"
        elif "pyproject.toml" in gt.files or "requirements.txt" in gt.files:
            gt.working_dir = "."
            gt.ecosystem = "python"
            gt.framework = "python"

        pkg_rel = f"{gt.working_dir}/package.json" if gt.working_dir != "." else "package.json"
        pkg_raw = gt.read_text(pkg_rel)
        if pkg_raw:
            try:
                pkg = json.loads(pkg_raw)
                deps = {**pkg.get("dependencies", {}), **pkg.get("devDependencies", {})}
                gt.dependencies = set(deps.keys())
                scripts = pkg.get("scripts", {})
                has_typeorm_02 = str(deps.get("typeorm", "")).startswith("^0.2") or "0.2." in str(deps.get("typeorm", ""))
                has_app_alias = "@app" in pkg.get("_moduleAliases", {})
                jest_cmd = "npx jest src/verify-task.spec.ts"
                if has_app_alias:
                    jest_cmd += " --moduleNameMapper '{\"^@app/(.*)$\":\"<rootDir>/$1\"}'"
                jest_cmd += " --passWithNoTests --forceExit"
                gt.environment = EnvironmentConfigIR(
                    ecosystem="node",
                    framework="nestjs" if "@nestjs/core" in deps else "node",
                    working_dir=gt.working_dir,
                    build_command="npm run build" if "build" in scripts else "npx tsc --noEmit",
                    install_command="[ -d node_modules ] || npm install --legacy-peer-deps",
                    test_command=jest_cmd,
                    dependencies=sorted(gt.dependencies)[:80],
                    infrastructure_notes=(
                        ["TypeORM 0.2.x detected (use findOne/find/save, never findOneBy/findBy)."]
                        if has_typeorm_02
                        else []
                    ),
                )
            except json.JSONDecodeError:
                pass
        elif gt.ecosystem == "python":
            gt.environment = EnvironmentConfigIR(
                ecosystem="python",
                framework="python",
                working_dir=gt.working_dir,
                build_command="python3 -m compileall -q .",
                install_command="pip install -r requirements.txt || true",
                test_command="pytest",
            )

        # Parse TypeScript NestJS artifacts deterministically
        for rel in sorted(gt.files):
            if not rel.endswith(".ts") or rel.endswith(".spec.ts") or rel.endswith(".d.ts"):
                continue
            text = gt.read_text(rel)
            if not text:
                continue

            # Entities
            for m in re.finditer(r"export\s+class\s+(\w+Entity)\b", text):
                gt.entity_files[m.group(1)] = rel

            # Enums
            for m in re.finditer(r"export\s+enum\s+(\w+)\s*\{([^}]*)\}", text, re.S):
                enum_name = m.group(1)
                members = re.findall(r"^\s*([A-Za-z_][A-Za-z0-9_]*)\s*(?:=|,|$)", m.group(2), re.M)
                gt.enums[enum_name] = members
                gt.enum_files[enum_name] = rel

            # DTOs
            if ".dto.ts" in rel or "Dto" in text:
                for m in re.finditer(r"export\s+class\s+(\w+Dto)\b[^{]*\{([\s\S]*?)\n\}", text):
                    dto_name = m.group(1)
                    props = re.findall(r"(?:readonly\s+)?([a-zA-Z_][a-zA-Z0-9_]*)\??\s*:", m.group(2))
                    gt.dtos[dto_name] = props
                    gt.dto_files[dto_name] = rel

            # Controllers
            ctrl_match = re.search(r"@Controller\(([^)]*)\)\s*(?:@[\s\S]*?)?export\s+class\s+(\w+)", text)
            if ctrl_match:
                raw_prefix = ctrl_match.group(1).strip().strip("'\"")
                ctrl_name = ctrl_match.group(2)
                routes: list[dict[str, str]] = []
                for rm in re.finditer(r"@(Get|Post|Patch|Put|Delete)\(([^)]*)\)", text):
                    method = rm.group(1).upper()
                    sub = rm.group(2).strip().strip("'\"")
                    routes.append({
                        "method": method,
                        "sub_path": sub,
                        "full_route": _join_route(raw_prefix, sub),
                    })
                guards = sorted(set(re.findall(r"@UseGuards\(([^)]+)\)", text)))
                gt.controllers[ctrl_name] = ControllerInfo(
                    name=ctrl_name,
                    file_path=rel,
                    prefix=raw_prefix,
                    routes=routes,
                    guards=[g.strip() for g in guards],
                )

            # Services & constructor DI (use balanced parens because @InjectRepository(...) has inner parens)
            svc_match = re.search(r"export\s+class\s+(\w+Service)\b[\s\S]*?constructor\s*\(", text)
            if svc_match:
                svc_name = svc_match.group(1)
                idx = svc_match.end()
                depth = 1
                start_idx = idx
                while idx < len(text) and depth > 0:
                    if text[idx] == "(":
                        depth += 1
                    elif text[idx] == ")":
                        depth -= 1
                    idx += 1
                params_block = text[start_idx : max(start_idx, idx - 1)]
                repos = re.findall(r"@InjectRepository\((\w+)\)", params_block)
                # Match injected services like `private readonly productService: ProductService`
                injected_svcs: list[dict[str, str]] = []
                for sm in re.finditer(r":\s*([A-Z]\w+Service)\b", params_block):
                    dep_svc = sm.group(1)
                    imp_match = re.search(rf"import\s*\{{[^}}]*\b{dep_svc}\b[^}}]*\}}\s*from\s*['\"]([^'\"]+)['\"]", text)
                    injected_svcs.append({
                        "name": dep_svc,
                        "import_path": imp_match.group(1) if imp_match else "",
                    })
                gt.services[svc_name] = ServiceInfo(
                    name=svc_name,
                    file_path=rel,
                    injected_repositories=repos,
                    injected_services=injected_svcs,
                )

    elif context_repo:
        # Fallback when snapshot is not on local disk (e.g. unit tests)
        for chunk in context_repo.get("chunks", []):
            fp = chunk.get("file_path")
            if isinstance(fp, str):
                gt.files.add(fp)

    return gt


def validate_task_design(
    design: TaskDesignOutput,
    ground_truth: RepositoryGroundTruth,
) -> ValidationGateResult:
    errors: list[str] = []
    warnings: list[str] = []

    if not design.specification.objective.strip():
        errors.append("Task specification objective is empty.")
    if len(design.specification.requirements) < 2:
        errors.append("Task specification must include at least 2 measurable requirements.")
    if len(design.specification.acceptance_criteria) < 2:
        errors.append("Task specification must include at least 2 acceptance criteria.")
    if not design.specification.happy_paths:
        errors.append("Task specification must include at least 1 happy path.")
    if not design.specification.negative_cases:
        errors.append("Task specification must include at least 1 negative/failure case.")

    # Verify referenced files exist when repository snapshot is available
    if ground_truth.files:
        for ref_file in design.grounding.referenced_files:
            cleaned = ref_file.strip().replace("\\", "/").lstrip("./")
            if cleaned not in ground_truth.files:
                errors.append(f"Referenced existing file does not exist in snapshot: {cleaned}")

        for ev in design.grounding.evidence:
            cleaned = ev.file_path.strip().replace("\\", "/").lstrip("./")
            if cleaned not in ground_truth.files:
                errors.append(f"Evidence file does not exist in snapshot: {cleaned}")

        # Verify directly observed controller prefixes / enum facts
        for fact in design.grounding.facts:
            if fact.status == GroundingStatus.DIRECTLY_OBSERVED and fact.file_path:
                cleaned = fact.file_path.strip().replace("\\", "/").lstrip("./")
                if cleaned not in ground_truth.files:
                    errors.append(f"Directly observed fact references missing file: {cleaned}")
            if fact.kind == "enum" and fact.name in ground_truth.enums and fact.detail:
                # Check if any quoted member in detail is unknown
                real_members = set(ground_truth.enums[fact.name])
                if real_members:
                    mentioned = set(re.findall(r"\b([A-Z][A-Z0-9_]{2,})\b", fact.detail))
                    unknown = mentioned - real_members
                    if unknown and fact.status == GroundingStatus.DIRECTLY_OBSERVED:
                        warnings.append(
                            f"Enum {fact.name} detail mentions {sorted(unknown)}; real members are {sorted(real_members)}."
                        )

        # Catch common route prefix hallucination: /orders when controller is @Controller('order')
        all_ctrl_prefixes = {info.prefix for info in ground_truth.controllers.values() if info.prefix}
        text_blob = " ".join([design.title, design.description, design.specification.objective, *design.specification.requirements])
        for prefix in all_ctrl_prefixes:
            plural = prefix + "s"
            has_plural = bool(re.search(rf"(?:^|[\s`'\"(])/{re.escape(plural)}(?:/|\s|$|`|\?)", text_blob))
            if has_plural and plural not in all_ctrl_prefixes:
                errors.append(
                    f"Task references '/{plural}' but the real controller prefix in the codebase is '@Controller(\"{prefix}\")' (/{prefix})."
                )

    # Ensure instruction-facing spec does not leak internal solve.sh-style patch files
    spec_blob = " ".join([design.description, *design.specification.requirements, *design.specification.acceptance_criteria])
    if ".patch.ts" in spec_blob:
        errors.append("Task specification must not reference standalone *.patch.ts files.")

    return ValidationGateResult(
        gate="task_design_and_grounding",
        passed=len(errors) == 0,
        summary="Task design and repository grounding passed." if not errors else f"{len(errors)} grounding/quality error(s).",
        errors=errors,
        warnings=warnings,
    )


def validate_reference_solution(
    solution: ReferenceSolutionIR,
    plan: ReferencePlanOutput,
    ground_truth: RepositoryGroundTruth,
) -> ValidationGateResult:
    errors: list[str] = []
    warnings: list[str] = []

    if not solution.changes:
        errors.append("Reference solution has no file changes.")

    for change in solution.changes:
        if change.operation == "modify" and ground_truth.files:
            if change.path not in ground_truth.files:
                # Check if relative to working_dir
                prefixed = f"{ground_truth.working_dir}/{change.path}" if ground_truth.working_dir != "." else change.path
                if prefixed not in ground_truth.files:
                    errors.append(f"Cannot modify non-existent file: {change.path}")
        if change.operation in {"create", "modify"} and not change.content.strip():
            errors.append(f"File change '{change.path}' ({change.operation}) has empty content.")
        if change.path.endswith(".ts"):
            # Basic sanity checks for truncated/broken TS edits
            if change.content.count("{") != change.content.count("}"):
                warnings.append(f"Unbalanced braces detected in {change.path} ({change.content.count('{')} vs {change.content.count('}')}).")
            is_typeorm_02 = any("TypeORM 0.2" in note for note in ground_truth.environment.infrastructure_notes)
            if is_typeorm_02 and ("findOneBy" in change.content or ".findBy(" in change.content):
                errors.append(
                    f"{change.path} uses TypeORM 0.3 findOneBy/findBy, which does not exist in TypeORM 0.2.x (use findOne/find instead)."
                )

            # Verify every relative or @app/ import resolves to a real file in snapshot or created files
            created_paths = {
                (f"{ground_truth.working_dir}/{c.path}" if ground_truth.working_dir != "." and not c.path.startswith(f"{ground_truth.working_dir}/") else c.path)
                for c in solution.changes
            }
            full_change_path = (
                f"{ground_truth.working_dir}/{change.path}"
                if ground_truth.working_dir != "." and not change.path.startswith(f"{ground_truth.working_dir}/")
                else change.path
            )
            change_dir = PurePosixPath(full_change_path).parent
            for imp_m in re.finditer(r"from\s+['\"]([^'\"]+)['\"]", change.content):
                imp_target = imp_m.group(1)
                resolved_base: str | None = None
                if imp_target.startswith("@app/"):
                    sub = imp_target[len("@app/") :]
                    prefix = f"{ground_truth.working_dir}/src/" if ground_truth.working_dir != "." else "src/"
                    resolved_base = f"{prefix}{sub}"
                elif imp_target.startswith("."):
                    parts = list(change_dir.parts)
                    for seg in PurePosixPath(imp_target).parts:
                        if seg == ".":
                            continue
                        elif seg == "..":
                            if parts:
                                parts.pop()
                        else:
                            parts.append(seg)
                    resolved_base = "/".join(parts)
                if resolved_base and ground_truth.files:
                    candidates = (
                        resolved_base,
                        f"{resolved_base}.ts",
                        f"{resolved_base}.tsx",
                        f"{resolved_base}/index.ts",
                    )
                    if not any(cand in ground_truth.files or cand in created_paths for cand in candidates):
                        errors.append(
                            f"{change.path} imports '{imp_target}' (resolved '{resolved_base}.ts'), which does not exist in the repository."
                        )

            # For modify operations, ensure existing baseline methods & imports are not accidentally dropped
            if change.operation == "modify":
                baseline_text = ground_truth.read_text(full_change_path)
                if baseline_text:
                    baseline_methods = set(
                        re.findall(r"^\s*(?:async\s+)?([a-zA-Z_][a-zA-Z0-9_]*)\s*\(", baseline_text, re.M)
                    ) - {"if", "for", "while", "switch", "catch", "constructor"}
                    missing_methods = [m for m in sorted(baseline_methods) if not re.search(rf"\b{re.escape(m)}\s*\(", change.content)]
                    if missing_methods:
                        errors.append(
                            f"{change.path} dropped existing baseline method(s): {', '.join(missing_methods)}. Preserve all existing methods."
                        )

    # Check if new controllers/services are registered when created
    created_ts = [c.path for c in solution.changes if c.operation == "create" and c.path.endswith(".ts")]
    for new_file in created_ts:
        if new_file.endswith(".controller.ts") or new_file.endswith(".service.ts"):
            base = PurePosixPath(new_file).stem
            if not any(base in reg.from_path or reg.symbol.lower() in new_file.lower() for reg in solution.registrations):
                warnings.append(f"Created {new_file} without an explicit module registration entry.")

    for reg in solution.registrations:
        if ground_truth.files and reg.module_path not in ground_truth.files:
            prefixed = f"{ground_truth.working_dir}/{reg.module_path}" if ground_truth.working_dir != "." else reg.module_path
            if prefixed not in ground_truth.files:
                errors.append(f"Registration target module does not exist: {reg.module_path}")

    return ValidationGateResult(
        gate="reference_solution_structure",
        passed=len(errors) == 0,
        summary="Reference solution structure validated." if not errors else f"{len(errors)} solution structural error(s).",
        errors=errors,
        warnings=warnings,
    )


def validate_verification_spec(
    spec: VerificationSpecIR,
    design: TaskDesignOutput,
    solution: ReferenceSolutionIR | None,
    ground_truth: RepositoryGroundTruth,
) -> ValidationGateResult:
    errors: list[str] = []
    warnings: list[str] = []

    if len(spec.test_cases) < 2:
        errors.append("Verification spec must contain at least 2 test cases.")

    has_negative = any(tc.category in {"negative_path", "edge_case"} for tc in spec.test_cases)
    if not has_negative:
        warnings.append("Verification spec has no negative_path or edge_case test cases.")

    # Check route prefix grounding
    all_ctrl_prefixes = {info.prefix for info in ground_truth.controllers.values() if info.prefix}
    for tc in spec.test_cases:
        if tc.http_method != "NONE" and tc.route:
            if not tc.route.startswith("/"):
                errors.append(f"Test case '{tc.name}' route must start with '/': {tc.route}")
            first_seg = tc.route.strip("/").split("/")[0]
            if first_seg.endswith("s") and first_seg[:-1] in all_ctrl_prefixes and first_seg not in all_ctrl_prefixes:
                errors.append(
                    f"Test case '{tc.name}' uses plural route '/{first_seg}/...' but controller prefix is '/{first_seg[:-1]}'."
                )
        blob = " ".join([tc.name, tc.scenario, tc.expected_observable_behavior, *tc.mocking_requirements])
        if ".patch.ts" in blob:
            errors.append(f"Test case '{tc.name}' references banned *.patch.ts artifact.")
        if "findOneBy" in blob or "findBy(" in blob:
            errors.append(f"Test case '{tc.name}' references TypeORM 0.3 findOneBy/findBy on a TypeORM 0.2 repository.")

    return ValidationGateResult(
        gate="verification_spec_quality",
        passed=len(errors) == 0,
        summary="Verification spec passed quality & independence checks." if not errors else f"{len(errors)} verification spec error(s).",
        errors=errors,
        warnings=warnings,
    )
