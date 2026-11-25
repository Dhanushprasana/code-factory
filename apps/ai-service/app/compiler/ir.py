from __future__ import annotations

from enum import Enum
from pathlib import PurePosixPath
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator


class GroundingStatus(str, Enum):
    DIRECTLY_OBSERVED = "directly_observed"
    INFERRED = "inferred"
    UNKNOWN = "unknown"


class PackageLifecycleStatus(str, Enum):
    GENERATING_TASK = "GENERATING_TASK"
    VALIDATING_TASK = "VALIDATING_TASK"
    PLANNING_SOLUTION = "PLANNING_SOLUTION"
    GENERATING_SOLUTION = "GENERATING_SOLUTION"
    VALIDATING_SOLUTION = "VALIDATING_SOLUTION"
    GENERATING_TESTS = "GENERATING_TESTS"
    COMPILING_PACKAGE = "COMPILING_PACKAGE"
    VALIDATING_PACKAGE = "VALIDATING_PACKAGE"
    REPAIRING = "REPAIRING"
    READY = "READY"
    FAILED = "FAILED"
    NEEDS_REVIEW = "NEEDS_REVIEW"


class TestCaseCategory(str, Enum):
    HAPPY_PATH = "happy_path"
    NEGATIVE_PATH = "negative_path"
    EDGE_CASE = "edge_case"
    REGRESSION = "regression"


def _validate_safe_rel_path(value: str) -> str:
    cleaned = value.strip().replace("\\", "/")
    while cleaned.startswith("./"):
        cleaned = cleaned[2:]
    if not cleaned:
        raise ValueError("Path must not be empty.")
    posix = PurePosixPath(cleaned)
    if posix.is_absolute() or ".." in posix.parts:
        raise ValueError(f"Unsafe or absolute repository path: {value}")
    if cleaned.endswith(".patch.ts") or cleaned.endswith(".patch.js"):
        raise ValueError(f"Standalone patch files are not allowed: {value}")
    return cleaned


class GroundedEvidenceRef(BaseModel):
    model_config = ConfigDict(extra="forbid")

    repository_id: str
    snapshot_id: str
    commit_sha: str
    file_path: str
    start_line: int = Field(ge=1)
    end_line: int = Field(ge=1)
    symbol: str | None = None
    grounding_status: GroundingStatus = GroundingStatus.DIRECTLY_OBSERVED


class GroundedFact(BaseModel):
    model_config = ConfigDict(extra="forbid")

    kind: Literal["file", "module", "controller", "service", "dto", "enum", "api_contract", "dependency"]
    name: str
    file_path: str | None = None
    detail: str = ""
    status: GroundingStatus = GroundingStatus.DIRECTLY_OBSERVED


class TaskMetadataIR(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=3, max_length=160)
    slug: str = Field(min_length=3, max_length=120)
    title: str = Field(min_length=8, max_length=160)
    description: str = Field(min_length=30, max_length=3000)
    objective: str = Field(min_length=10, max_length=1000)
    category: str
    difficulty: Literal["easy", "medium", "hard"]
    repository_id: str
    snapshot_id: str
    commit_sha: str
    package_version: str = "1.0.0"


class RepositoryGroundingIR(BaseModel):
    model_config = ConfigDict(extra="forbid")

    referenced_files: list[str] = Field(default_factory=list)
    existing_modules: list[str] = Field(default_factory=list)
    existing_controllers: list[str] = Field(default_factory=list)
    existing_services: list[str] = Field(default_factory=list)
    existing_dtos: list[str] = Field(default_factory=list)
    existing_enums: list[str] = Field(default_factory=list)
    existing_api_contracts: list[str] = Field(default_factory=list)
    relevant_dependencies: list[str] = Field(default_factory=list)
    facts: list[GroundedFact] = Field(default_factory=list)
    evidence: list[GroundedEvidenceRef] = Field(default_factory=list)
    uncertainties: list[str] = Field(default_factory=list)


class TaskSpecificationIR(BaseModel):
    model_config = ConfigDict(extra="forbid")

    objective: str = Field(min_length=10, max_length=1000)
    background: str = ""
    requirements: list[str] = Field(min_length=2, max_length=12)
    acceptance_criteria: list[str] = Field(min_length=2, max_length=12)
    happy_paths: list[str] = Field(min_length=1, max_length=10)
    negative_cases: list[str] = Field(min_length=1, max_length=10)
    edge_cases: list[str] = Field(default_factory=list, max_length=10)
    constraints: list[str] = Field(default_factory=list, max_length=10)
    setup_instructions: list[str] = Field(default_factory=list, max_length=10)
    observable_behavior: list[str] = Field(min_length=1, max_length=12)
    affected_modules: list[str] = Field(min_length=1, max_length=10)


class FileChangeIR(BaseModel):
    model_config = ConfigDict(extra="forbid")

    path: str
    operation: Literal["create", "modify", "delete"]
    purpose: str = Field(min_length=5, max_length=400)
    content: str = ""

    @field_validator("path")
    @classmethod
    def check_path(cls, value: str) -> str:
        return _validate_safe_rel_path(value)


class RegistrationIR(BaseModel):
    model_config = ConfigDict(extra="forbid")

    module_path: str
    kind: Literal["controller", "provider", "import", "export"]
    symbol: str = Field(min_length=1)
    from_path: str = ""

    @field_validator("module_path")
    @classmethod
    def check_module_path(cls, value: str) -> str:
        return _validate_safe_rel_path(value)


class DependencyChangeIR(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=1)
    version: str = "*"
    dev: bool = False
    action: Literal["add", "update", "remove"] = "add"


class ReferenceSolutionIR(BaseModel):
    model_config = ConfigDict(extra="forbid")

    changes: list[FileChangeIR] = Field(min_length=1)
    registrations: list[RegistrationIR] = Field(default_factory=list)
    dependencies: list[DependencyChangeIR] = Field(default_factory=list)
    environment_changes: list[dict[str, str]] = Field(default_factory=list)
    notes: list[str] = Field(default_factory=list)


class TestCaseSpecIR(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=3, max_length=200)
    scenario: str = Field(min_length=5, max_length=500)
    category: TestCaseCategory
    http_method: Literal["GET", "POST", "PUT", "PATCH", "DELETE", "NONE"] = "GET"
    route: str = ""
    request_body: dict[str, Any] | list[Any] | None = None
    request_query: dict[str, str] = Field(default_factory=dict)
    request_headers: dict[str, str] = Field(default_factory=dict)
    expected_status: int | None = Field(default=None, ge=100, le=599)
    expected_observable_behavior: str = Field(min_length=5, max_length=500)
    expected_response_properties: list[str] = Field(default_factory=list)
    preconditions: list[str] = Field(default_factory=list)
    mocking_requirements: list[str] = Field(default_factory=list)


class VerificationSpecIR(BaseModel):
    model_config = ConfigDict(extra="forbid")

    framework: Literal["nestjs_jest_supertest", "pytest", "generic"] = "nestjs_jest_supertest"
    target_controller: str | None = None
    target_controller_path: str | None = None
    target_service: str | None = None
    target_service_path: str | None = None
    test_cases: list[TestCaseSpecIR] = Field(min_length=2, max_length=15)
    mocked_repositories: list[dict[str, str]] = Field(default_factory=list)
    mocked_services: list[dict[str, str]] = Field(default_factory=list)
    overridden_guards: list[dict[str, str]] = Field(default_factory=list)
    setup_notes: list[str] = Field(default_factory=list)


class EnvironmentConfigIR(BaseModel):
    model_config = ConfigDict(extra="forbid")

    ecosystem: Literal["node", "python", "unknown"] = "node"
    framework: str = "nestjs"
    working_dir: str = "backend"
    build_command: str = "npm run build"
    install_command: str = "[ -d node_modules ] || npm install --legacy-peer-deps"
    test_command: str = (
        "npx jest src/verify-task.spec.ts "
        "--moduleNameMapper '{\"^@app/(.*)$\":\"<rootDir>/$1\"}' "
        "--passWithNoTests --forceExit"
    )
    runtime_requirements: list[str] = Field(default_factory=list)
    required_env_vars: list[str] = Field(default_factory=list)
    dependencies: list[str] = Field(default_factory=list)
    infrastructure_notes: list[str] = Field(default_factory=list)


class ValidationGateResult(BaseModel):
    model_config = ConfigDict(extra="forbid")

    gate: str
    passed: bool
    summary: str
    errors: list[str] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)
    details: dict[str, Any] = Field(default_factory=dict)


class StageExecutionRecord(BaseModel):
    model_config = ConfigDict(extra="forbid")

    stage: str
    status: Literal["completed", "failed", "repaired"]
    provider: str
    model: str
    attempts: int = 1
    error: str | None = None


class StageModelConfig(BaseModel):
    model_config = ConfigDict(extra="forbid")

    task_design: str | None = None
    reference_planning: str | None = None
    reference_solution: str | None = None
    test_generation: str | None = None
    repair: str | None = None


class TaskDesignOutput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    title: str = Field(min_length=8, max_length=160)
    description: str = Field(min_length=30, max_length=3000)
    category: str
    difficulty: Literal["easy", "medium", "hard"]
    specification: TaskSpecificationIR
    grounding: RepositoryGroundingIR


class ReferencePlanOutput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    files_to_modify: list[str] = Field(default_factory=list)
    new_files_required: list[str] = Field(default_factory=list)
    import_changes: list[str] = Field(default_factory=list)
    module_registrations: list[RegistrationIR] = Field(default_factory=list)
    dependency_changes: list[DependencyChangeIR] = Field(default_factory=list)
    implementation_sequence: list[str] = Field(min_length=1)
    risks: list[str] = Field(default_factory=list)


class TaskPackageIR(BaseModel):
    model_config = ConfigDict(extra="forbid")

    ir_version: str = "1.0.0"
    metadata: TaskMetadataIR
    grounding: RepositoryGroundingIR
    specification: TaskSpecificationIR
    reference_solution: ReferenceSolutionIR
    verification: VerificationSpecIR
    environment: EnvironmentConfigIR
    lifecycle_status: PackageLifecycleStatus = PackageLifecycleStatus.COMPILING_PACKAGE
    stage_records: list[StageExecutionRecord] = Field(default_factory=list)
    validation_gates: list[ValidationGateResult] = Field(default_factory=list)
    repair_attempts: int = 0
    model_routing: StageModelConfig = Field(default_factory=StageModelConfig)
