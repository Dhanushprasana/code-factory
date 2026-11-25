from __future__ import annotations

from dataclasses import dataclass

from app.compiler.grounding import RepositoryGroundTruth
from app.compiler.ir import TaskPackageIR
from app.compiler.templates import (
    render_dockerfile,
    render_instruction_md,
    render_solve_sh,
    render_task_toml,
    render_test_sh,
)


@dataclass
class CompiledHarborPackage:
    instruction_md: str
    task_toml: str
    dockerfile: str
    solve_sh: str
    test_sh: str

    def to_harbor_files_dict(self) -> dict[str, str]:
        return {
            "instruction_md": self.instruction_md,
            "task_toml": self.task_toml,
            "dockerfile": self.dockerfile,
            "solve_sh": self.solve_sh,
            "test_sh": self.test_sh,
        }


def compile_harbor_package(
    ir: TaskPackageIR,
    ground_truth: RepositoryGroundTruth,
) -> CompiledHarborPackage:
    """Deterministically compile a validated TaskPackageIR into Harbor artifacts."""
    return CompiledHarborPackage(
        instruction_md=render_instruction_md(ir),
        task_toml=render_task_toml(ir),
        dockerfile=render_dockerfile(ir.environment),
        solve_sh=render_solve_sh(ir),
        test_sh=render_test_sh(ir, ground_truth),
    )
