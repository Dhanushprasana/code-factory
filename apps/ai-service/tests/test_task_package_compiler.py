from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest
from pydantic import ValidationError

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.compiler.grounding import (
    inspect_repository_snapshot,
    validate_reference_solution,
    validate_task_design,
    validate_verification_spec,
)
from app.compiler.harbor_compiler import compile_harbor_package
from app.compiler.ir import (
    EnvironmentConfigIR,
    FileChangeIR,
    GroundedEvidenceRef,
    GroundedFact,
    GroundingStatus,
    PackageLifecycleStatus,
    ReferencePlanOutput,
    ReferenceSolutionIR,
    RepositoryGroundingIR,
    TaskDesignOutput,
    TaskMetadataIR,
    TaskPackageIR,
    TaskSpecificationIR,
    TestCaseCategory,
    TestCaseSpecIR,
    VerificationSpecIR,
)
from app.compiler.pipeline import compile_single_task_package
from app.compiler.validator import run_all_validation_gates


def _create_sample_nest_repo(root: Path) -> None:
    backend = root / "backend"
    (backend / "src" / "order" / "entities").mkdir(parents=True)
    (backend / "src" / "order" / "enums").mkdir(parents=True)
    (backend / "src" / "order" / "dto").mkdir(parents=True)
    (backend / "src" / "user" / "guards").mkdir(parents=True)

    (backend / "package.json").write_text(
        json.dumps(
            {
                "name": "nestjs",
                "scripts": {"build": "nest build", "test": "jest"},
                "dependencies": {"@nestjs/core": "^8.0.0", "typeorm": "^0.2.38"},
                "_moduleAliases": {"@app": "./dist"},
            }
        ),
        encoding="utf-8",
    )
    (backend / "src" / "order" / "enums" / "status.enum.ts").write_text(
        "export enum Status {\n  CANCELED = 'CANCELED',\n  IN_PROGRESS = 'IN_PROGRESS',\n  FINISHED = 'FINISHED',\n}\n",
        encoding="utf-8",
    )
    (backend / "src" / "order" / "entities" / "order.entity.ts").write_text(
        "export class OrderEntity {}\n", encoding="utf-8"
    )
    (backend / "src" / "order" / "entities" / "orders-products.entity.ts").write_text(
        "export class OrdersProductsEntity {}\n", encoding="utf-8"
    )
    (backend / "src" / "user" / "guards" / "auth.guard.ts").write_text(
        "export class AuthGuard {}\n", encoding="utf-8"
    )
    (backend / "src" / "order" / "order.service.ts").write_text(
        """import { InjectRepository } from '@nestjs/typeorm';
import { OrderEntity } from './entities/order.entity';
import { OrdersProductsEntity } from './entities/orders-products.entity';
import { ProductService } from '@app/product/product.service';

export class OrderService {
  constructor(
    @InjectRepository(OrderEntity) private readonly orderRepo: any,
    @InjectRepository(OrdersProductsEntity) private readonly opRepo: any,
    private readonly productService: ProductService,
  ) {}

  async findOne(id: string) {
    return this.orderRepo.findOne(id);
  }
}
""",
        encoding="utf-8",
    )
    (backend / "src" / "order" / "order.controller.ts").write_text(
        """import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@app/user/guards/auth.guard';
import { OrderService } from './order.service';

@Controller('order')
export class OrderController {
  constructor(private readonly orderService: OrderService) {}

  @Get(':id')
  @UseGuards(AuthGuard)
  async findOne(@Param('id') id: string) {
    return this.orderService.findOne(id);
  }
}
""",
        encoding="utf-8",
    )


def _valid_design(prefix: str = "order") -> TaskDesignOutput:
    return TaskDesignOutput(
        title="Add GET /order/:id/status endpoint",
        description="Add a read-only GET /order/:id/status endpoint returning the current order status or 404 when missing.",
        category="feature",
        difficulty="easy",
        specification=TaskSpecificationIR(
            objective="Expose GET /order/:id/status returning { status } or 404.",
            background="Clients need a lightweight endpoint to poll order status.",
            requirements=[
                "Add GET /order/:id/status route on OrderController.",
                "Return HTTP 404 when order does not exist.",
            ],
            acceptance_criteria=[
                "GET /order/:id/status returns 200 with { status } for an existing order.",
                "GET /order/:id/status returns 404 for an unknown order id.",
            ],
            happy_paths=["Existing order returns 200 with { status }."],
            negative_cases=["Missing order returns 404."],
            edge_cases=["Empty or unknown UUID returns 404."],
            constraints=["Preserve existing AuthGuard and routes."],
            setup_instructions=["cd backend && npm run build"],
            observable_behavior=["HTTP 200 JSON { status } or 404 Not Found."],
            affected_modules=["backend/src/order"],
        ),
        grounding=RepositoryGroundingIR(
            referenced_files=["backend/src/order/order.controller.ts", "backend/src/order/order.service.ts"],
            existing_controllers=["OrderController"],
            existing_services=["OrderService"],
            existing_enums=["Status"],
            existing_api_contracts=[f"GET /{prefix}/:id"],
            facts=[
                GroundedFact(
                    kind="controller",
                    name="OrderController",
                    file_path="backend/src/order/order.controller.ts",
                    detail=f"@Controller('{prefix}')",
                    status=GroundingStatus.DIRECTLY_OBSERVED,
                )
            ],
            evidence=[
                GroundedEvidenceRef(
                    repository_id="repo-1",
                    snapshot_id="snap-1",
                    commit_sha="abc123",
                    file_path="backend/src/order/order.controller.ts",
                    start_line=1,
                    end_line=14,
                    symbol="OrderController",
                )
            ],
        ),
    )


def test_ir_rejects_invalid_paths_and_patch_files():
    with pytest.raises(ValidationError):
        FileChangeIR(path="../outside.ts", operation="modify", purpose="escape", content="x")
    with pytest.raises(ValidationError):
        FileChangeIR(path="src/order/order.patch.ts", operation="create", purpose="patch", content="x")
    with pytest.raises(ValidationError):
        TaskMetadataIR(
            name="x",
            slug="x",
            title="short",
            description="too short",
            objective="short",
            category="feature",
            difficulty="easy",
            repository_id="r",
            snapshot_id="s",
            commit_sha="c",
        )


def test_grounding_inspector_and_plural_route_rejection(tmp_path: Path):
    _create_sample_nest_repo(tmp_path)
    gt = inspect_repository_snapshot(tmp_path)

    assert "OrderController" in gt.controllers
    assert gt.controllers["OrderController"].prefix == "order"
    assert "OrderService" in gt.services
    assert gt.services["OrderService"].injected_repositories == ["OrderEntity", "OrdersProductsEntity"]
    assert gt.services["OrderService"].injected_services[0]["name"] == "ProductService"
    assert gt.enums["Status"] == ["CANCELED", "IN_PROGRESS", "FINISHED"]

    valid_res = validate_task_design(_valid_design("order"), gt)
    assert valid_res.passed, valid_res.errors

    bad_design = _valid_design("orders")
    bad_design.title = "Add GET /orders/:id/status endpoint"
    bad_design.description = "Expose GET /orders/:id/status returning status."
    bad_design.specification.requirements[0] = "Add GET /orders/:id/status."
    bad_res = validate_task_design(bad_design, gt)
    assert not bad_res.passed
    assert any("/orders" in err for err in bad_res.errors)


def test_verification_validator_rejects_typeorm03_and_patch_refs(tmp_path: Path):
    _create_sample_nest_repo(tmp_path)
    gt = inspect_repository_snapshot(tmp_path)
    design = _valid_design("order")
    bad_spec = VerificationSpecIR(
        test_cases=[
            TestCaseSpecIR(
                name="happy",
                scenario="uses findOneBy",
                category=TestCaseCategory.HAPPY_PATH,
                http_method="GET",
                route="/order/1/status",
                expected_status=200,
                expected_observable_behavior="returns status",
                mocking_requirements=["mock findOneBy"],
            ),
            TestCaseSpecIR(
                name="neg",
                scenario="checks order.patch.ts",
                category=TestCaseCategory.NEGATIVE_PATH,
                http_method="GET",
                route="/orders/999/status",
                expected_status=404,
                expected_observable_behavior="returns 404",
            ),
        ]
    )
    res = validate_verification_spec(bad_spec, design, None, gt)
    assert not res.passed
    assert any("findOneBy" in e for e in res.errors)
    assert any("*.patch.ts" in e for e in res.errors)
    assert any("/orders" in e for e in res.errors)


def test_reference_solution_validator_rejects_typeorm03_findOneBy(tmp_path: Path):
    _create_sample_nest_repo(tmp_path)
    gt = inspect_repository_snapshot(tmp_path)
    plan = ReferencePlanOutput(
        files_to_modify=["backend/src/order/order.service.ts"],
        implementation_sequence=["Update findOne"],
    )
    bad_sol = ReferenceSolutionIR(
        changes=[
            FileChangeIR(
                path="backend/src/order/order.service.ts",
                operation="modify",
                purpose="Use findOneBy",
                content="export class OrderService { async x() { return this.orderRepo.findOneBy({ id: '1' }); } }",
            )
        ]
    )
    res = validate_reference_solution(bad_sol, plan, gt)
    assert not res.passed
    assert any("findOneBy" in e for e in res.errors)


def test_reference_solution_validator_rejects_dropped_methods_and_bad_imports(tmp_path: Path):
    _create_sample_nest_repo(tmp_path)
    gt = inspect_repository_snapshot(tmp_path)
    plan = ReferencePlanOutput(
        files_to_modify=["backend/src/order/order.service.ts"],
        implementation_sequence=["Modify OrderService"],
    )
    bad_sol = ReferenceSolutionIR(
        changes=[
            FileChangeIR(
                path="backend/src/order/order.service.ts",
                operation="modify",
                purpose="Rewrote service dropping findOne and using bad import",
                content=(
                    "import { AuthGuard } from '../auth/auth.guard';\n"
                    "export class OrderService { async newMethod() { return []; } }\n"
                ),
            )
        ]
    )
    res = validate_reference_solution(bad_sol, plan, gt)
    assert not res.passed
    assert any("../auth/auth.guard" in e for e in res.errors)
    assert any("findOne" in e for e in res.errors)


def test_deterministic_harbor_compiler_and_gates(tmp_path: Path):
    _create_sample_nest_repo(tmp_path)
    gt = inspect_repository_snapshot(tmp_path)
    design = _valid_design("order")
    plan = ReferencePlanOutput(
        files_to_modify=["backend/src/order/order.controller.ts"],
        implementation_sequence=["Add @Get(':id/status') to OrderController"],
    )
    sol = ReferenceSolutionIR(
        changes=[
            FileChangeIR(
                path="backend/src/order/order.controller.ts",
                operation="modify",
                purpose="Add status endpoint",
                content=(tmp_path / "backend/src/order/order.controller.ts").read_text(encoding="utf-8"),
            )
        ]
    )
    ver = VerificationSpecIR(
        target_controller="OrderController",
        target_controller_path="backend/src/order/order.controller.ts",
        target_service="OrderService",
        target_service_path="backend/src/order/order.service.ts",
        test_cases=[
            TestCaseSpecIR(
                name="returns 200 status",
                scenario="existing order",
                category=TestCaseCategory.HAPPY_PATH,
                http_method="GET",
                route="/order/550e8400-e29b-41d4-a716-446655440000/status",
                expected_status=200,
                expected_observable_behavior="returns { status }",
                expected_response_properties=["status"],
            ),
            TestCaseSpecIR(
                name="returns 404 when missing",
                scenario="missing order",
                category=TestCaseCategory.NEGATIVE_PATH,
                http_method="GET",
                route="/order/missing/status",
                expected_status=404,
                expected_observable_behavior="returns 404",
            ),
        ],
    )
    ir = TaskPackageIR(
        metadata=TaskMetadataIR(
            name="forgebench/order-status",
            slug="order-status",
            title=design.title,
            description=design.description,
            objective=design.specification.objective,
            category="feature",
            difficulty="easy",
            repository_id="repo-1",
            snapshot_id="snap-1",
            commit_sha="abc123",
        ),
        grounding=design.grounding,
        specification=design.specification,
        reference_solution=sol,
        verification=ver,
        environment=gt.environment,
    )

    pkg = compile_harbor_package(ir, gt)
    assert "[ -d /app/backend ] && cd /app/backend" in pkg.solve_sh
    assert "trap _harbor_cleanup EXIT" in pkg.test_sh
    assert pkg.test_sh.index("trap _harbor_cleanup EXIT") < pkg.test_sh.index("set -e")
    assert "[ -d node_modules ] || npm install --legacy-peer-deps" in pkg.test_sh
    assert '--moduleNameMapper \'{"^@app/(.*)$":"<rootDir>/$1"}\'' in pkg.test_sh
    assert 'schema_version = "1.4"' in pkg.task_toml
    assert "npm install --legacy-peer-deps" in pkg.dockerfile
    assert "verify-task.spec.ts" not in pkg.instruction_md

    status, gates = run_all_validation_gates(ir, design, plan, pkg, gt, execute_runtime=False)
    assert status == PackageLifecycleStatus.READY
    assert all(g.passed for g in gates)


@pytest.mark.asyncio
async def test_pipeline_repairs_bad_design_and_isolates_test_stage(tmp_path: Path):
    _create_sample_nest_repo(tmp_path)
    calls: list[tuple[str, str]] = []

    async def fake_llm(model: str, prompt: str, stage: str, max_tokens: int, schema: dict) -> str:
        calls.append((stage, prompt))
        if stage == "task_design":
            bad = _valid_design("orders")
            bad.title = "Add GET /orders/:id/status endpoint"
            bad.description = "Add GET /orders/:id/status endpoint for status."
            bad.specification.objective = "Expose GET /orders/:id/status returning { status } or 404."
            bad.specification.requirements[0] = "Add GET /orders/:id/status."
            return bad.model_dump_json()
        if stage == "repair_task_design":
            return _valid_design("order").model_dump_json()
        if stage == "reference_planning":
            return ReferencePlanOutput(
                files_to_modify=["backend/src/order/order.controller.ts"],
                implementation_sequence=["Add @Get(':id/status')"],
            ).model_dump_json()
        if stage == "reference_solution":
            return ReferenceSolutionIR(
                changes=[
                    FileChangeIR(
                        path="backend/src/order/order.controller.ts",
                        operation="modify",
                        purpose="Add status route",
                        content=(tmp_path / "backend/src/order/order.controller.ts").read_text(encoding="utf-8")
                        + "\n// UNIQUE_INTERNAL_MARKER_DO_NOT_LEAK\n",
                    )
                ]
            ).model_dump_json()
        if stage == "test_generation":
            assert "UNIQUE_INTERNAL_MARKER_DO_NOT_LEAK" not in prompt
            return VerificationSpecIR(
                target_controller="OrderController",
                target_controller_path="backend/src/order/order.controller.ts",
                target_service="OrderService",
                target_service_path="backend/src/order/order.service.ts",
                test_cases=[
                    TestCaseSpecIR(
                        name="gets status",
                        scenario="existing",
                        category=TestCaseCategory.HAPPY_PATH,
                        http_method="GET",
                        route="/order/1/status",
                        expected_status=200,
                        expected_observable_behavior="returns status",
                        expected_response_properties=["status"],
                    ),
                    TestCaseSpecIR(
                        name="404 on missing",
                        scenario="missing",
                        category=TestCaseCategory.NEGATIVE_PATH,
                        http_method="GET",
                        route="/order/999/status",
                        expected_status=404,
                        expected_observable_behavior="returns 404",
                    ),
                ],
            ).model_dump_json()
        raise AssertionError(f"Unexpected stage: {stage}")

    res = await compile_single_task_package(
        llm_call=fake_llm,
        provider="openrouter",
        default_model="openai/gpt-4o-mini",
        context={"repositories": [{"chunks": []}]},
        repository_input={
            "repository_id": "repo-1",
            "snapshot_id": "snap-1",
            "commit_sha": "abc123",
            "repository_path": str(tmp_path),
        },
        category="feature",
        difficulty="easy",
        user_idea=None,
        constraints=[],
        max_repair_attempts=2,
        execute_runtime_validation=False,
    )

    assert res.ir.lifecycle_status == PackageLifecycleStatus.READY
    assert res.ir.repair_attempts == 1
    assert any(stage == "repair_task_design" for stage, _ in calls)
    assert all(g.passed for g in res.ir.validation_gates)
