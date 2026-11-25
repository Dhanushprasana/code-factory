from __future__ import annotations

import base64
import json
from pathlib import PurePosixPath

from app.compiler.grounding import RepositoryGroundTruth
from app.compiler.ir import EnvironmentConfigIR, TaskPackageIR, TestCaseCategory


def _workspace_cd(working_dir: str) -> str:
    wd = working_dir.strip().strip("/")
    if not wd or wd == ".":
        return "[ -d /app ] && cd /app || true"
    return f"[ -d /app/{wd} ] && cd /app/{wd} || ([ -d {wd} ] && cd {wd} || true)"


def _rel_to_working_dir(file_path: str, working_dir: str) -> str:
    cleaned = file_path.strip().replace("\\", "/").lstrip("./")
    wd = working_dir.strip().strip("/")
    if wd and wd != "." and cleaned.startswith(f"{wd}/"):
        return cleaned[len(wd) + 1 :]
    return cleaned


def _src_import_path(file_path: str, working_dir: str) -> str:
    rel = _rel_to_working_dir(file_path, working_dir)
    if rel.startswith("src/"):
        rel = rel[len("src/") :]
    if rel.endswith(".ts"):
        rel = rel[:-3]
    return f"./{rel}"


def render_instruction_md(ir: TaskPackageIR) -> str:
    spec = ir.specification
    meta = ir.metadata
    env = ir.environment

    reqs = "\n".join(f"- {item}" for item in spec.requirements)
    criteria = "\n".join(f"- {item}" for item in spec.acceptance_criteria)
    happy = "\n".join(f"- {item}" for item in spec.happy_paths)
    negative = "\n".join(f"- {item}" for item in spec.negative_cases)
    edges = "\n".join(f"- {item}" for item in spec.edge_cases) if spec.edge_cases else "- Handle malformed or missing inputs cleanly."
    constraints = (
        "\n".join(f"- {item}" for item in spec.constraints)
        if spec.constraints
        else "- Preserve existing authentication guards, unrelated modules, and repository conventions."
    )
    setup_lines = (
        "\n".join(f"{idx + 1}. {step}" for idx, step in enumerate(spec.setup_instructions))
        if spec.setup_instructions
        else f"1. `cd {env.working_dir}`\n2. `{env.install_command}`\n3. Run `{env.build_command}` to verify compilation."
    )
    contracts = (
        "\n".join(f"- `{c}`" for c in ir.grounding.existing_api_contracts)
        if ir.grounding.existing_api_contracts
        else "- Follow the existing controller routes and DTO schemas in the repository."
    )

    return (
        f"# Task: {meta.title}\n\n"
        f"## Objective\n{spec.objective}\n\n"
        f"## Background\n{spec.background or meta.description}\n\n"
        f"## Existing Contracts & Grounding\n{contracts}\n\n"
        f"## Requirements\n{reqs}\n\n"
        f"## Acceptance Criteria\n{criteria}\n\n"
        f"### Expected Happy Paths\n{happy}\n\n"
        f"### Negative & Failure Cases\n{negative}\n\n"
        f"### Edge Cases\n{edges}\n\n"
        f"## Constraints\n{constraints}\n\n"
        f"## Setup\n{setup_lines}\n"
    )


def render_task_toml(ir: TaskPackageIR) -> str:
    meta = ir.metadata
    safe_desc = meta.title.replace('"', '\\"')
    return (
        'schema_version = "1.4"\n\n'
        "[task]\n"
        f'name = "forgebench/{meta.slug}"\n'
        f'description = "{safe_desc}"\n\n'
        "[verifier]\n"
        "timeout_sec = 600.0\n"
        'environment_mode = "separate"\n\n'
        "[agent]\n"
        "timeout_sec = 600.0\n\n"
        "[environment]\n"
        "cpus = 2\n"
        "memory_mb = 4096\n"
    )


def render_dockerfile(env: EnvironmentConfigIR) -> str:
    if env.ecosystem == "python":
        return (
            "FROM python:3.12-slim\n"
            "WORKDIR /app\n"
            "RUN apt-get update && apt-get install -y --no-install-recommends git bash curl && rm -rf /var/lib/apt/lists/*\n"
            "COPY . /app\n"
            "RUN pip install --no-cache-dir -e . || pip install --no-cache-dir -r requirements.txt || true\n"
        )
    wd = env.working_dir.strip().strip("/")
    workdir = f"/app/{wd}" if wd and wd != "." else "/app"
    return (
        "FROM node:22-bookworm-slim\n"
        "WORKDIR /app\n"
        "RUN apt-get update && apt-get install -y --no-install-recommends git bash curl python3 && rm -rf /var/lib/apt/lists/*\n"
        "COPY . /app\n"
        f"WORKDIR {workdir}\n"
        "RUN npm install --legacy-peer-deps || npm ci --legacy-peer-deps || true\n"
        "WORKDIR /app\n"
    )


def render_solve_sh(ir: TaskPackageIR) -> str:
    env = ir.environment
    lines = [
        "#!/bin/bash",
        "set -e",
        "",
        _workspace_cd(env.working_dir),
        "",
    ]

    for change in ir.reference_solution.changes:
        rel_path = _rel_to_working_dir(change.path, env.working_dir)
        if change.operation == "delete":
            lines.append(f'rm -f "{rel_path}"')
            continue

        encoded = base64.b64encode(change.content.encode("utf-8")).decode("ascii")
        parent = str(PurePosixPath(rel_path).parent)
        if parent and parent != ".":
            lines.append(f'mkdir -p "{parent}"')
        lines.append(
            f'node -e "const fs=require(\'fs\');fs.writeFileSync(\'{rel_path}\',Buffer.from(\'{encoded}\',\'base64\').toString(\'utf8\'),\'utf8\');"'
        )

    lines.extend([
        "",
        env.build_command,
        'echo "Reference solution applied and built successfully."',
    ])
    return "\n".join(lines) + "\n"


def compile_nestjs_spec_ts(ir: TaskPackageIR, ground_truth: RepositoryGroundTruth) -> str:
    env = ir.environment
    ver = ir.verification

    # Resolve controller & service from ground_truth or verification spec
    ctrl_name = ver.target_controller
    ctrl_path = ver.target_controller_path
    if (not ctrl_name or not ctrl_path) and ground_truth.controllers:
        # Pick controller matching affected_modules or first controller
        for cname, cinfo in ground_truth.controllers.items():
            if any(mod.lower() in cinfo.file_path.lower() for mod in ir.specification.affected_modules):
                ctrl_name = cname
                ctrl_path = cinfo.file_path
                break
        if not ctrl_name:
            first_ctrl = next(iter(ground_truth.controllers.values()))
            ctrl_name = first_ctrl.name
            ctrl_path = first_ctrl.file_path

    svc_name = ver.target_service
    svc_path = ver.target_service_path
    if (not svc_name or not svc_path) and ground_truth.services:
        for sname, sinfo in ground_truth.services.items():
            if any(mod.lower() in sinfo.file_path.lower() for mod in ir.specification.affected_modules):
                svc_name = sname
                svc_path = sinfo.file_path
                break
        if not svc_name:
            first_svc = next(iter(ground_truth.services.values()))
            svc_name = first_svc.name
            svc_path = first_svc.file_path

    imports: list[str] = [
        "import { Test, TestingModule } from '@nestjs/testing';",
        "import { INestApplication, ValidationPipe } from '@nestjs/common';",
        "import { getRepositoryToken } from '@nestjs/typeorm';",
        "import * as request from 'supertest';",
    ]
    if ctrl_name and ctrl_path:
        imports.append(f"import {{ {ctrl_name} }} from '{_src_import_path(ctrl_path, env.working_dir)}';")
    if svc_name and svc_path:
        imports.append(f"import {{ {svc_name} }} from '{_src_import_path(svc_path, env.working_dir)}';")

    # Collect all repository entities & sibling services needed by svc_name
    repo_entities: list[str] = []
    sibling_services: list[dict[str, str]] = []
    if svc_name and svc_name in ground_truth.services:
        sinfo = ground_truth.services[svc_name]
        repo_entities.extend(sinfo.injected_repositories)
        sibling_services.extend(sinfo.injected_services)

    for mr in ver.mocked_repositories:
        ename = mr.get("entity") or mr.get("name") or ""
        if ename and ename not in repo_entities:
            repo_entities.append(ename)
    for ms in ver.mocked_services:
        sname = ms.get("service") or ms.get("name") or ""
        if sname and not any(s["name"] == sname for s in sibling_services):
            sibling_services.append({"name": sname, "import_path": ms.get("import_path", "")})

    # Import entities
    for entity_name in repo_entities:
        epath = ground_truth.entity_files.get(entity_name)
        if epath:
            imports.append(f"import {{ {entity_name} }} from '{_src_import_path(epath, env.working_dir)}';")

    # Import sibling services
    for sdep in sibling_services:
        sname = sdep["name"]
        spath = ground_truth.services[sname].file_path if sname in ground_truth.services else sdep.get("import_path", "")
        if spath:
            imp_target = spath if spath.startswith("@") else _src_import_path(spath, env.working_dir)
            imports.append(f"import {{ {sname} }} from '{imp_target}';")

    # Guards to override
    guard_names: list[str] = []
    if ctrl_name and ctrl_name in ground_truth.controllers:
        for g_expr in ground_truth.controllers[ctrl_name].guards:
            for g in g_expr.split(","):
                g_clean = g.strip()
                if g_clean and g_clean not in guard_names:
                    guard_names.append(g_clean)
    for og in ver.overridden_guards:
        gname = og.get("guard") or og.get("name") or ""
        if gname and gname not in guard_names:
            guard_names.append(gname)

    for gname in guard_names:
        # Search for guard file in ground_truth.files
        for fp in sorted(ground_truth.files):
            if gname.lower().replace("guard", "") in fp.lower() and "guard" in fp.lower() and fp.endswith(".ts"):
                imports.append(f"import {{ {gname} }} from '{_src_import_path(fp, env.working_dir)}';")
                break

    # Providers list
    provider_entries: list[str] = []
    if svc_name:
        provider_entries.append(f"        {svc_name},")
    for idx, entity_name in enumerate(repo_entities):
        if entity_name in ground_truth.entity_files:
            var_name = "mockPrimaryRepo" if idx == 0 else f"mockRepo{idx}"
            provider_entries.append(f"        {{ provide: getRepositoryToken({entity_name}), useValue: {var_name} }},")
    for sdep in sibling_services:
        sname = sdep["name"]
        if any(sname in imp for imp in imports):
            provider_entries.append(
                f"        {{ provide: {sname}, useValue: {{ findOne: jest.fn(), find: jest.fn(), update: jest.fn(), save: jest.fn() }} }},"
            )

    repo_decls: list[str] = []
    for idx, entity_name in enumerate(repo_entities):
        if entity_name not in ground_truth.entity_files:
            continue
        var_name = "mockPrimaryRepo" if idx == 0 else f"mockRepo{idx}"
        repo_decls.append(
            f"""  const {var_name}: any = {{
    findOne: jest.fn(),
    find: jest.fn(),
    save: jest.fn(),
    create: jest.fn(),
    preload: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
    remove: jest.fn(),
  }};"""
        )

    override_chain = "\n".join(
        f"      .overrideGuard({g}).useValue({{ canActivate: () => true }})"
        for g in guard_names
        if any(g in imp for imp in imports)
    )

    # Known enum value for fixture status
    default_status = "IN_PROGRESS"
    if "Status" in ground_truth.enums and ground_truth.enums["Status"]:
        default_status = ground_truth.enums["Status"][0]

    # Compile test cases
    test_blocks: list[str] = []
    for tc in ver.test_cases:
        method = tc.http_method.lower() if tc.http_method != "NONE" else "get"
        route = tc.route or "/"
        if tc.request_query:
            qs = "&".join(f"{k}={v}" for k, v in tc.request_query.items())
            sep = "&" if "?" in route else "?"
            route = f"{route}{sep}{qs}"

        is_negative = tc.category == TestCaseCategory.NEGATIVE_PATH or (tc.expected_status is not None and tc.expected_status >= 400)
        setup_lines: list[str] = []
        if repo_entities and repo_entities[0] in ground_truth.entity_files:
            if is_negative and tc.expected_status == 404:
                setup_lines.append("    mockPrimaryRepo.findOne.mockResolvedValue(undefined);")
                setup_lines.append("    mockPrimaryRepo.find.mockResolvedValue([]);")
                setup_lines.append("    mockPrimaryRepo.preload.mockResolvedValue(undefined);")
            else:
                setup_lines.append(
                    f"    const sampleEntity: any = {{ id: '550e8400-e29b-41d4-a716-446655440000', status: '{default_status}', userId: 1, address: '123 Main St', price: 25, date: '2026-01-01', OrdersProducts: [] }};"
                )
                setup_lines.append("    mockPrimaryRepo.findOne.mockResolvedValue(sampleEntity);")
                setup_lines.append("    mockPrimaryRepo.find.mockResolvedValue([sampleEntity]);")
                setup_lines.append("    mockPrimaryRepo.preload.mockImplementation(async (dto: any) => ({ ...sampleEntity, ...dto }));")
                setup_lines.append("    mockPrimaryRepo.save.mockImplementation(async (entity: any) => entity);")
                setup_lines.append("    mockPrimaryRepo.create.mockImplementation((dto: any) => ({ ...sampleEntity, ...dto }));")

        req_call = f"    const res = await request(app.getHttpServer())\n      .{method}('{route}')"
        for hk, hv in tc.request_headers.items():
            req_call += f"\n      .set('{hk}', '{hv}')"
        if tc.request_body is not None and method in {"post", "patch", "put"}:
            req_call += f"\n      .send({json.dumps(tc.request_body)})"
        req_call += ";"

        assertions: list[str] = []
        if tc.expected_status is not None:
            assertions.append(f"    expect(res.status).toBe({tc.expected_status});")
        else:
            assertions.append("    expect(res.status).toBeLessThan(500);")

        for prop in tc.expected_response_properties:
            safe_prop = prop.strip()
            if safe_prop and re_identifier(safe_prop):
                assertions.append(
                    f"    expect(Array.isArray(res.body) ? res.body[0]?.{safe_prop} ?? res.body : res.body?.{safe_prop}).toBeDefined();"
                )

        test_name_safe = tc.name.replace("'", "\\'")
        block = (
            f"  it('{test_name_safe}', async () => {{\n"
            + "\n".join(setup_lines)
            + ("\n" if setup_lines else "")
            + req_call
            + "\n"
            + "\n".join(assertions)
            + "\n  });"
        )
        test_blocks.append(block)

    ctrl_token = f"[{ctrl_name}]" if ctrl_name else "[]"
    suite_title = ir.metadata.title.replace("'", "\\'")
    return (
        "\n".join(dict.fromkeys(imports))
        + "\n\n"
        + f"describe('{suite_title}', () => {{\n"
        + "  let app: INestApplication;\n"
        + "\n".join(repo_decls)
        + "\n\n"
        + "  beforeEach(async () => {\n"
        + "    jest.clearAllMocks();\n"
        + "    const moduleFixture: TestingModule = await Test.createTestingModule({\n"
        + f"      controllers: {ctrl_token},\n"
        + "      providers: [\n"
        + "\n".join(provider_entries)
        + "\n      ],\n"
        + "    })\n"
        + (override_chain + "\n" if override_chain else "")
        + "      .compile();\n\n"
        + "    app = moduleFixture.createNestApplication();\n"
        + "    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));\n"
        + "    await app.init();\n"
        + "  });\n\n"
        + "  afterEach(async () => {\n"
        + "    if (app) {\n"
        + "      await app.close();\n"
        + "    }\n"
        + "  });\n\n"
        + "\n\n".join(test_blocks)
        + "\n});\n"
    )


def re_identifier(name: str) -> bool:
    return name.isidentifier()


def render_test_sh(ir: TaskPackageIR, ground_truth: RepositoryGroundTruth) -> str:
    env = ir.environment
    lines = [
        "#!/bin/bash",
        "",
        "mkdir -p /logs/verifier",
        "",
        "_harbor_cleanup() {",
        "  [ -f /logs/verifier/reward.txt ] || echo 0 > /logs/verifier/reward.txt",
        "}",
        "",
        "trap _harbor_cleanup EXIT",
        "",
        "set -e",
        "",
        _workspace_cd(env.working_dir),
        "",
        env.install_command,
        env.build_command,
        "",
    ]

    if env.ecosystem == "node" and env.framework == "nestjs":
        spec_source = compile_nestjs_spec_ts(ir, ground_truth)
        encoded = base64.b64encode(spec_source.encode("utf-8")).decode("ascii")
        lines.extend([
            f'node -e "const fs=require(\'fs\');fs.writeFileSync(\'src/verify-task.spec.ts\',Buffer.from(\'{encoded}\',\'base64\').toString(\'utf8\'),\'utf8\');"',
            env.test_command,
            "rm -f src/verify-task.spec.ts",
        ])
    else:
        lines.append(env.test_command or "pytest")

    lines.extend([
        "",
        "echo 1 > /logs/verifier/reward.txt",
        "",
    ])
    return "\n".join(lines)
