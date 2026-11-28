from __future__ import annotations

import html
import json
import os
import re
import tomllib
from collections import Counter, deque
from pathlib import Path
from typing import Any

from tree_sitter_language_pack import get_parser


from app.embeddings import embed_texts_sync

ANALYZER_VERSION = "0.2.0"
MAX_FILES = 25_000
MAX_METADATA_SOURCE_FILES = 15_000
MAX_SOURCE_FILES = 5_000
MAX_FILE_BYTES = 512_000
MAX_TOTAL_SOURCE_BYTES = 100_000_000
MAX_TREE_ENTRIES = 2_000
MAX_GRAPH_NODES = 10_000
MAX_GRAPH_EDGES = 25_000
MAX_EMBEDDED_CHUNKS = 350

IGNORED_DIRECTORIES = {
    ".git",
    ".hg",
    ".svn",
    ".next",
    ".nuxt",
    ".turbo",
    ".venv",
    "__pycache__",
    "build",
    "coverage",
    "dist",
    "generated",
    "node_modules",
    "out",
    "target",
    "vendor",
    "venv",
}
IGNORED_SUFFIXES = {
    ".7z",
    ".dll",
    ".exe",
    ".gif",
    ".gz",
    ".ico",
    ".jpeg",
    ".jpg",
    ".mp3",
    ".mp4",
    ".pdf",
    ".png",
    ".pyc",
    ".so",
    ".svg",
    ".tar",
    ".webp",
    ".zip",
}
SECRET_NAME = re.compile(
    r"(^\.env(?:\.|$)|(^|[._-])(secret|secrets|credentials?)([._-]|$)|"
    r"(^|[._-])(id_rsa|id_ed25519)([._-]|$)|\.(pem|key|p12|pfx|keystore)$)",
    re.IGNORECASE,
)
SOURCE_EXTENSIONS = {
    ".c": "c",
    ".cc": "cpp",
    ".cjs": "javascript",
    ".cpp": "cpp",
    ".cxx": "cpp",
    ".h": "cpp",
    ".hh": "cpp",
    ".hpp": "cpp",
    ".hxx": "cpp",
    ".js": "javascript",
    ".jsx": "javascript",
    ".mjs": "javascript",
    ".py": "python",
    ".ts": "typescript",
    ".tsx": "tsx",
}
DECLARATION_TYPES = {
    "class_declaration",
    "class_definition",
    "class_specifier",
    "enum_declaration",
    "enum_specifier",
    "function_declaration",
    "function_definition",
    "interface_declaration",
    "method_definition",
    "namespace_definition",
    "struct_specifier",
    "type_alias_declaration",
    "type_definition",
}
IMPORT_PATTERN = re.compile(
    r"""(?:\bfrom\s*["']([^"']+)["']|\bimport\s*["']([^"']+)["']|"""
    r"""\bfrom\s+([A-Za-z0-9_][A-Za-z0-9_.]*)\s+import\b)"""
)
HTTP_DECORATOR_PATTERN = re.compile(
    r"@(?P<method>Get|Post|Put|Patch|Delete|Head|Options)\b",
    re.IGNORECASE,
)
GRAPHQL_DECORATOR_PATTERN = re.compile(r"@(?P<method>Query|Mutation|Subscription)\b", re.I)
ROUTE_CALL_PATTERN = re.compile(
    r"""(?:app|router|api)\.(?P<method>get|post|put|patch|delete|head|options)\s*"""
    r"""\(\s*["'`](?P<path>[^"'`]*)["'`]""",
    re.IGNORECASE,
)


def _is_ignored(path: Path) -> bool:
    lowered_name = path.name.lower()
    return (
        SECRET_NAME.search(path.name) is not None
        or path.suffix.lower() in IGNORED_SUFFIXES
        or lowered_name.endswith(".min.js")
        or lowered_name.endswith(".min.ts")
        or ".generated." in lowered_name
    )


def _directory_priority(name: str) -> int:
    lowered = name.lower()
    if lowered in {"app", "apps", "src"}:
        return 0
    if any(token in lowered for token in ("api", "backend", "server", "frontend", "web")):
        return 1
    if lowered in {"test", "tests", "__tests__", "fixtures", "mocks"}:
        return 10
    if any(token in lowered for token in ("docs", "website", "examples", "storybook", "playground")):
        return 20
    return 5


def _collect_files(root: Path) -> tuple[list[Path], int, bool]:
    files: list[Path] = []
    visited = 0
    truncated = False

    for current, directories, filenames in os.walk(root, followlinks=False):
        current_path = Path(current)
        relative_directory = current_path.relative_to(root)
        if len(relative_directory.parts) > 16:
            directories[:] = []
            continue

        directories[:] = sorted(
            (
                name
                for name in directories
                if name.lower() not in IGNORED_DIRECTORIES
                and not (current_path / name).is_symlink()
                and not _is_ignored(current_path / name)
            ),
            key=lambda name: (_directory_priority(name), name.lower()),
        )
        for filename in sorted(filenames):
            candidate = current_path / filename
            visited += 1
            if visited > MAX_FILES:
                truncated = True
                return files, visited - 1, truncated
            if candidate.is_symlink() or _is_ignored(candidate):
                continue
            try:
                if candidate.is_file():
                    files.append(candidate)
            except OSError:
                continue
    return files, visited, truncated


def _read_text(path: Path, warnings: list[str]) -> str | None:
    try:
        if path.stat().st_size > MAX_FILE_BYTES:
            return None
        return path.read_text(encoding="utf-8")
    except (OSError, UnicodeError):
        warnings.append(f"Could not read text file: {path.name}.")
        return None


def _relative(path: Path, root: Path) -> str:
    return path.relative_to(root).as_posix()


def _is_test_source(path: Path, root: Path) -> bool:
    relative = _relative(path, root)
    return bool(re.search(r"(^|/)(test|tests|__tests__)(/|$)|\.(test|spec)\.", relative, re.I))


def _directory_tree(paths: list[Path], root: Path) -> tuple[list[dict[str, str]], bool]:
    entries: list[dict[str, str]] = []
    included_directories: set[str] = set()
    all_directories: set[str] = set()
    included_files = 0
    grouped_paths: dict[str, deque[Path]] = {}
    for path in paths:
        parts = path.relative_to(root).parts
        group = "/".join(parts[:2]) if len(parts) > 2 else parts[0]
        grouped_paths.setdefault(group, deque()).append(path)
    balanced_paths: list[Path] = []
    while True:
        added_path = False
        for group in grouped_paths.values():
            if group:
                balanced_paths.append(group.popleft())
                added_path = True
        if not added_path:
            break
    for path in balanced_paths:
        relative = _relative(path, root)
        parent = Path(relative).parent
        ancestors: list[str] = []
        while str(parent) not in ("", "."):
            directory = parent.as_posix()
            ancestors.append(directory)
            all_directories.add(directory)
            parent = parent.parent
        missing_directories = [
            directory for directory in reversed(ancestors)
            if directory not in included_directories
        ]
        if len(entries) + len(missing_directories) + 1 > MAX_TREE_ENTRIES:
            continue
        for directory in missing_directories:
            included_directories.add(directory)
            entries.append({"path": directory, "type": "directory"})
        entries.append({"path": _relative(path, root), "type": "file"})
        included_files += 1
    truncated = included_files < len(paths) or included_directories != all_directories
    return entries, truncated


def _add_graph_node(
    nodes: list[dict[str, Any]],
    node_ids: set[str],
    node: dict[str, Any],
) -> bool:
    if node["id"] in node_ids:
        return True
    if len(nodes) >= MAX_GRAPH_NODES:
        return False
    node_ids.add(node["id"])
    nodes.append(node)
    return True


def _cpp_declarator_name(node: Any, source: bytes) -> str:
    """Extract symbol name from C/C++ declarator AST nodes."""
    current = node
    for _ in range(8):
        if current is None:
            return ""
        if current.type in {"identifier", "field_identifier", "type_identifier", "namespace_identifier", "destructor_name"}:
            return source[current.start_byte:current.end_byte].decode("utf-8", errors="replace").strip()
        if current.type == "qualified_identifier":
            return source[current.start_byte:current.end_byte].decode("utf-8", errors="replace").strip()
        next_node = current.child_by_field_name("declarator") or current.child_by_field_name("name")
        if next_node is None:
            next_node = next(
                (
                    child for child in current.children
                    if child.type in {
                        "function_declarator", "pointer_declarator", "reference_declarator",
                        "qualified_identifier", "identifier", "field_identifier", "destructor_name",
                    }
                ),
                None,
            )
        current = next_node
    return ""


def _parse_symbols(
    path: Path,
    root: Path,
    source: bytes,
    language: str,
    warnings: list[str],
) -> tuple[list[dict[str, Any]], list[str], list[tuple[str, int, str]]]:
    try:
        parser = get_parser(language)
        tree = parser.parse(source)
    except Exception as error:
        warnings.append(
            f"Tree-sitter could not parse {_relative(path, root)}: "
            f"{type(error).__name__}."
        )
        return [], [], []

    symbols: list[dict[str, Any]] = []
    imports: list[str] = []
    calls: list[tuple[str, int, str]] = []
    seen_symbol_keys: set[tuple[str, int]] = set()
    stack: list[tuple[Any, tuple[str, int] | None]] = [(tree.root_node, None)]
    while stack:
        node, owner = stack.pop()
        child_owner = owner
        if node.type in DECLARATION_TYPES:
            name = ""
            name_node = node.child_by_field_name("name")
            if name_node is None:
                declarator = node.child_by_field_name("declarator")
                if declarator is not None:
                    name = _cpp_declarator_name(declarator, source)
            if not name and name_node is None:
                name_node = next(
                    (
                        child for child in node.children
                        if child.type in ("identifier", "type_identifier", "namespace_identifier")
                    ),
                    None,
                )
            if not name and name_node is not None:
                name = source[name_node.start_byte:name_node.end_byte].decode(
                    "utf-8", errors="replace"
                ).strip()
            if name:
                start_line = node.start_point.row + 1
                child_owner = (name, start_line)
                if (name, start_line) not in seen_symbol_keys:
                    seen_symbol_keys.add((name, start_line))
                    declaration = source[node.start_byte:node.end_byte].decode(
                        "utf-8", errors="replace"
                    )
                    symbols.append(
                        {
                            "name": name,
                            "kind": (
                                node.type.removesuffix("_declaration")
                                .removesuffix("_definition")
                                .removesuffix("_specifier")
                            ),
                            "file_path": _relative(path, root),
                            "start_line": start_line,
                            "end_line": node.end_point.row + 1,
                            "exported": bool(
                                re.search(r"(?m)^\s*export\b", declaration)
                            ),
                        }
                    )
        elif node.type in {"lexical_declaration", "variable_declaration"} and owner is None:
            # Capture top-level TypeScript/JavaScript exported functions/consts (e.g. `export const z = ...`)
            parent = node.parent
            is_exported = parent is not None and parent.type == "export_statement"
            for child in node.children:
                if child.type != "variable_declarator":
                    continue
                var_name_node = child.child_by_field_name("name")
                value_node = child.child_by_field_name("value")
                if var_name_node is None:
                    continue
                var_name = source[var_name_node.start_byte:var_name_node.end_byte].decode(
                    "utf-8", errors="replace"
                ).strip()
                if not var_name:
                    continue
                is_callable = value_node is not None and value_node.type in {
                    "arrow_function", "function_expression", "function", "call_expression",
                }
                if is_exported or is_callable:
                    start_line = node.start_point.row + 1
                    child_owner = (var_name, start_line)
                    if (var_name, start_line) not in seen_symbol_keys:
                        seen_symbol_keys.add((var_name, start_line))
                        symbols.append(
                            {
                                "name": var_name,
                                "kind": "function" if value_node is not None and value_node.type in {"arrow_function", "function_expression", "function"} else "variable",
                                "file_path": _relative(path, root),
                                "start_line": start_line,
                                "end_line": node.end_point.row + 1,
                                "exported": is_exported,
                            }
                        )
        if node.type in {
            "import_statement",
            "import_from_statement",
            "import_declaration",
        }:
            snippet = source[node.start_byte:node.end_byte].decode("utf-8", errors="replace")
            for match in IMPORT_PATTERN.finditer(snippet):
                imported = next((value for value in match.groups() if value), "")
                if imported:
                    imports.append(imported)
        elif node.type == "preproc_include":
            snippet = source[node.start_byte:node.end_byte].decode("utf-8", errors="replace")
            include_match = re.search(r'#include\s*[<"]([^>"]+)[>"]', snippet)
            if include_match:
                imports.append(include_match.group(1))
        if node.type in {"call", "call_expression"} and owner:
            function_node = node.child_by_field_name("function")
            if function_node is not None:
                function_text = source[
                    function_node.start_byte:function_node.end_byte
                ].decode("utf-8", errors="replace")
                target_match = re.search(r"([A-Za-z_$][\w$]*)\s*$", function_text)
                if target_match:
                    calls.append((owner[0], owner[1], target_match.group(1)))
        stack.extend((child, child_owner) for child in reversed(node.children))

    return symbols, imports, calls


def _read_manifests(
    root: Path,
    files: list[Path],
    warnings: list[str],
) -> dict[str, Any]:
    frameworks: set[str] = set()
    database: set[str] = set()
    orm: set[str] = set()
    dependencies: dict[str, list[dict[str, str]]] = {"npm": [], "python": [], "cpp": []}
    build_commands: set[str] = set()
    test_commands: set[str] = set()
    package_managers: set[str] = set()
    paths_by_name: dict[str, list[Path]] = {}
    for path in files:
        paths_by_name.setdefault(path.name.lower(), []).append(path)

    for package_path in paths_by_name.get("package.json", []):
        text = _read_text(package_path, warnings)
        if text is None:
            continue
        try:
            package = json.loads(text)
        except json.JSONDecodeError:
            warnings.append(f"Invalid JSON in {_relative(package_path, root)}.")
            continue
        if not isinstance(package, dict):
            continue
        all_dependencies: dict[str, str] = {}
        for group in ("dependencies", "devDependencies", "peerDependencies", "optionalDependencies"):
            values = package.get(group, {})
            if isinstance(values, dict):
                for name, version in values.items():
                    if isinstance(name, str) and isinstance(version, str):
                        all_dependencies[name] = version
                        dependencies["npm"].append(
                            {"name": name, "version": version, "group": group}
                        )
        package_map = {
            "next": "Next.js",
            "react": "React",
            "react-native": "React Native",
            "vue": "Vue",
            "@nestjs/core": "NestJS",
            "express": "Express",
            "fastify": "Fastify",
            "angular": "Angular",
            "svelte": "Svelte",
            "vite": "Vite",
            "vitest": "Vitest",
            "jest": "Jest",
        }
        frameworks.update(
            package_map[name] for name in all_dependencies if name in package_map
        )
        database_map = {
            "pg": "PostgreSQL",
            "pg-promise": "PostgreSQL",
            "mysql": "MySQL",
            "mysql2": "MySQL",
            "sqlite3": "SQLite",
            "better-sqlite3": "SQLite",
            "mongoose": "MongoDB",
            "mongodb": "MongoDB",
            "redis": "Redis",
            "@supabase/supabase-js": "PostgreSQL",
        }
        database.update(
            database_map[name] for name in all_dependencies if name in database_map
        )
        orm_map = {
            "typeorm": "TypeORM",
            "prisma": "Prisma",
            "@prisma/client": "Prisma",
            "sequelize": "Sequelize",
            "mongoose": "Mongoose",
            "drizzle-orm": "Drizzle",
        }
        orm.update(orm_map[name] for name in all_dependencies if name in orm_map)
        scripts = package.get("scripts", {})
        if isinstance(scripts, dict):
            for command_name in ("build", "compile", "typecheck", "lint"):
                if isinstance(scripts.get(command_name), str):
                    build_commands.add(f"npm run {command_name}")
            if isinstance(scripts.get("test"), str):
                test_commands.add("npm run test")
            if isinstance(scripts.get("test:unit"), str):
                test_commands.add("npm run test:unit")
        if "vitest" in all_dependencies or (package_path.parent / "vitest.config.ts").exists() or (package_path.parent / "vitest.config.js").exists():
            test_commands.add("vitest run")
    for name in paths_by_name:
        if name == "pnpm-lock.yaml":
            package_managers.add("pnpm")
        elif name == "yarn.lock":
            package_managers.add("yarn")
        elif name in ("bun.lock", "bun.lockb"):
            package_managers.add("bun")
        elif name == "package-lock.json":
            package_managers.add("npm")
    if paths_by_name.get("package.json") and not package_managers.intersection(
        {"npm", "pnpm", "yarn", "bun"}
    ):
        package_managers.add("npm")

    for pyproject_path in paths_by_name.get("pyproject.toml", []):
        text = _read_text(pyproject_path, warnings)
        if text is None:
            continue
        try:
            project = tomllib.loads(text)
        except tomllib.TOMLDecodeError:
            warnings.append(f"Invalid TOML in {_relative(pyproject_path, root)}.")
            continue
        project_section = project.get("project", {})
        python_dependencies = project_section.get("dependencies", [])
        if isinstance(python_dependencies, list):
            for dependency in python_dependencies:
                if isinstance(dependency, str):
                    name = re.split(r"[<>=!~;\[]", dependency, maxsplit=1)[0].strip()
                    if name:
                        dependencies["python"].append(
                            {"name": name, "version": dependency[len(name):].strip() or "*", "group": "project"}
                        )
                        normalized = name.lower().replace("_", "-")
                        if normalized in ("fastapi", "django", "flask"):
                            frameworks.add({"fastapi": "FastAPI", "django": "Django", "flask": "Flask"}[normalized])
                        if normalized in ("sqlalchemy", "sqlmodel"):
                            orm.add("SQLAlchemy")
                        if normalized == "django":
                            orm.add("Django ORM")

        optional_groups = project.get("dependency-groups", {})
        for group, values in optional_groups.items() if isinstance(optional_groups, dict) else []:
            if group.lower() in ("dev", "test", "tests", "testing") and isinstance(values, list):
                for dependency in values:
                    if isinstance(dependency, str):
                        name = re.split(r"[<>=!~;\[]", dependency, maxsplit=1)[0].strip()
                        if name:
                            dependencies["python"].append(
                                {"name": name, "version": dependency[len(name):].strip() or "*", "group": group}
                            )
                        if dependency.lower().startswith(("pytest", "tox")):
                            test_commands.add("pytest")
        optional_deps = project_section.get("optional-dependencies", {})
        for group, values in optional_deps.items() if isinstance(optional_deps, dict) else []:
            if group.lower() in ("dev", "test", "tests", "testing") and isinstance(values, list):
                for dependency in values:
                    if isinstance(dependency, str):
                        name = re.split(r"[<>=!~;\[]", dependency, maxsplit=1)[0].strip()
                        if name:
                            dependencies["python"].append(
                                {"name": name, "version": dependency[len(name):].strip() or "*", "group": f"extra:{group}"}
                            )
                        if dependency.lower().startswith(("pytest", "tox")):
                            test_commands.add("pytest")
        if "pytest" in text.lower() or "pytest" in (project.get("tool", {}) if isinstance(project.get("tool"), dict) else {}):
            test_commands.add("pytest")
        if any(backend in text.lower() for backend in ("hatchling", "setuptools", "flit_core", "poetry-core")):
            build_commands.add("python -m build")
        package_managers.add("uv" if (pyproject_path.parent / "uv.lock").exists() else "pip")

    for cmake_path in paths_by_name.get("cmakelists.txt", []):
        if cmake_path.parent != root:
            continue
        text = _read_text(cmake_path, warnings)
        if text is None:
            continue
        package_managers.add("cmake")
        frameworks.add("CMake")
        build_commands.add("cmake -S . -B build -DCMAKE_BUILD_TYPE=Release")
        build_commands.add("cmake --build build -j2")
        stripped_cmake = "\n".join(
            line.split("#", 1)[0] for line in text.splitlines()
        )
        if re.search(r"\b(enable_testing|add_test|BUILD_TESTING)\b", stripped_cmake, re.I):
            test_commands.add("ctest --test-dir build --output-on-failure")
        for pkg_match in re.finditer(r"\bfind_package\s*\(\s*([A-Za-z0-9_+-]+)", stripped_cmake, re.I):
            dependencies["cpp"].append(
                {"name": pkg_match.group(1), "version": "*", "group": "cmake"}
            )

    for meson_path in paths_by_name.get("meson.build", []):
        if meson_path.parent != root:
            continue
        text = _read_text(meson_path, warnings)
        if text is None:
            continue
        package_managers.add("meson")
        frameworks.add("Meson")
        build_commands.add("meson setup build")
        build_commands.add("meson compile -C build")
        if re.search(r"\btest\s*\(", text):
            test_commands.add("meson test -C build")

    for vcpkg_path in paths_by_name.get("vcpkg.json", []):
        text = _read_text(vcpkg_path, warnings)
        if text is None:
            continue
        try:
            vcpkg = json.loads(text)
        except json.JSONDecodeError:
            continue
        for dep in vcpkg.get("dependencies", []) if isinstance(vcpkg, dict) else []:
            dep_name = dep if isinstance(dep, str) else dep.get("name") if isinstance(dep, dict) else None
            if isinstance(dep_name, str) and dep_name:
                dependencies["cpp"].append({"name": dep_name, "version": "*", "group": "vcpkg"})

    for requirements_path in paths_by_name.get("requirements.txt", []):
        text = _read_text(requirements_path, warnings)
        if text is None:
            continue
        for line in text.splitlines():
            dependency = line.strip()
            if not dependency or dependency.startswith(("#", "-")):
                continue
            name = re.split(r"[<>=!~;\[]", dependency, maxsplit=1)[0].strip()
            if name:
                dependencies["python"].append(
                    {"name": name, "version": dependency[len(name):].strip() or "*", "group": "requirements"}
                )
        package_managers.add("pip")

    python_database_map = {
        "asyncpg": "PostgreSQL",
        "psycopg": "PostgreSQL",
        "psycopg2": "PostgreSQL",
        "mysqlclient": "MySQL",
        "pymysql": "MySQL",
        "pymongo": "MongoDB",
    }
    database.update(
        python_database_map[dependency["name"].lower().replace("_", "-")]
        for dependency in dependencies["python"]
        if dependency["name"].lower().replace("_", "-") in python_database_map
    )
    if orm and not database:
        database.add("Database integration")

    if any(len(package_group) > 300 for package_group in dependencies.values()):
        warnings.append("Dependency list was truncated to 300 entries per ecosystem.")
    for package_group in dependencies.values():
        package_group.sort(key=lambda item: item["name"].lower())
        del package_group[300:]
    return {
        "frameworks": sorted(frameworks),
        "database": sorted(database),
        "orm": sorted(orm),
        "dependencies": dependencies,
        "build_commands": sorted(build_commands),
        "test_commands": sorted(test_commands),
        "package_managers": sorted(package_managers),
    }


def _detect_language_counts(files: list[Path]) -> dict[str, int]:
    counts: Counter[str] = Counter()
    extensions = {
        ".c": "C",
        ".cc": "C++",
        ".cpp": "C++",
        ".cxx": "C++",
        ".cs": "C#",
        ".css": "CSS",
        ".go": "Go",
        ".h": "C/C++ Header",
        ".hh": "C++",
        ".hpp": "C++",
        ".hxx": "C++",
        ".html": "HTML",
        ".java": "Java",
        ".js": "JavaScript",
        ".jsx": "JavaScript",
        ".kt": "Kotlin",
        ".md": "Markdown",
        ".php": "PHP",
        ".py": "Python",
        ".rb": "Ruby",
        ".rs": "Rust",
        ".scss": "SCSS",
        ".sh": "Shell",
        ".sql": "SQL",
        ".swift": "Swift",
        ".ts": "TypeScript",
        ".tsx": "TypeScript",
        ".vue": "Vue",
        ".yaml": "YAML",
        ".yml": "YAML",
    }
    for path in files:
        language = extensions.get(path.suffix.lower())
        if language:
            counts[language] += 1
    return dict(sorted(counts.items(), key=lambda item: (-item[1], item[0])))


def _classify_module_scope(module_path: str) -> str:
    lowered = module_path.replace("\\", "/").lower().strip("/")
    parts = set(lowered.split("/"))
    if any(marker in lowered for marker in ("/bench", "benchmarks", "typia-case")) or "bench" in parts or "perf" in parts:
        return "benchmarks"
    if any(marker in lowered for marker in ("apps/docs", "website", "landing", "showcase")) or "www" in parts or "blog" in parts:
        return "website"
    if any(marker in parts for marker in ("docs", "doc", "examples", "fixtures")):
        return "documentation"
    if any(marker in parts for marker in ("__tests__", "tests", "test", "e2e", "integration")):
        return "tests"
    if any(marker in parts for marker in ("scripts", "tooling", "tools", ".github", "ci", "build")):
        return "tooling"
    return "core_library"


def _source_directories(files: list[Path], root: Path) -> list[dict[str, Any]]:
    workspace_roots = {"apps", "packages"}
    source_roots = {"app", "src", "modules", "include", "lib"}
    modules: Counter[tuple[str, str]] = Counter()
    for path in files:
        parts = path.relative_to(root).parts
        module_parts = None
        for index, part in enumerate(parts[:-1]):
            if part.lower() in workspace_roots and index + 1 < len(parts) - 1:
                # If a workspace package has a nested `src/<submodule>` directory, surface `<submodule>`
                # so monorepo libraries like `packages/zod/src/v4/...` get granular modules,
                # while keeping shallow `packages/commerce/src/api.ts` at `packages/commerce`.
                pkg_end = index + 2
                if (
                    pkg_end < len(parts) - 2
                    and parts[pkg_end].lower() in source_roots
                ):
                    module_parts = parts[:pkg_end + 2]
                else:
                    module_parts = parts[:pkg_end]
                break
        if module_parts is None:
            for index in range(len(parts) - 2, -1, -1):
                if parts[index].lower() not in source_roots:
                    continue
                child_index = index + 1
                if child_index < len(parts) - 1:
                    module_parts = parts[:child_index + 1]
                elif index > 0:
                    module_parts = parts[:index]
                else:
                    module_parts = parts[:index + 1]
                break
        if module_parts:
            module_path = Path(*module_parts)
            if (root / module_path).is_dir():
                modules[(module_path.name, module_path.as_posix())] += 1
    return [
        {"name": name, "path": module_path, "file_count": count}
        for (name, module_path), count in sorted(modules.items(), key=lambda value: value[0][1].lower())
    ]


def _extract_routes_and_entities(
    relative: str,
    text: str,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    routes: list[dict[str, Any]] = []
    entities: list[dict[str, Any]] = []
    lines = text.splitlines()
    for line_number, line in enumerate(lines, start=1):
        http_decorator = HTTP_DECORATOR_PATTERN.search(line)
        route_call = ROUTE_CALL_PATTERN.search(line)
        graphql_decorator = GRAPHQL_DECORATOR_PATTERN.search(line)
        if http_decorator:
            http_path = re.search(r"\(\s*['\"`]([^'\"`]*)['\"`]", line)
            routes.append(
                {
                    "method": http_decorator.group("method").upper(),
                    "path": http_path.group(1) if http_path else "",
                    "file_path": relative,
                    "line": line_number,
                }
            )
        elif route_call:
            routes.append(
                {
                    "method": route_call.group("method").upper(),
                    "path": route_call.group("path"),
                    "file_path": relative,
                    "line": line_number,
                }
            )
        elif graphql_decorator:
            operation_name = None
            explicit_name = re.search(r"\bname\s*:\s*['\"]([^'\"]+)['\"]", line)
            for next_line in lines[line_number:line_number + 6]:
                operation = re.search(
                    r"\b(?:async\s+)?([A-Za-z_$][\w$]*)\s*\(", next_line
                )
                if operation:
                    operation_name = operation.group(1)
                    break
            routes.append(
                {
                    "method": f"GRAPHQL_{graphql_decorator.group('method').upper()}",
                    "path": explicit_name.group(1) if explicit_name else operation_name or "unknown",
                    "file_path": relative,
                    "line": line_number,
                }
            )
        if re.search(r"@Entity\b|@entity\b|__tablename__\s*=", line):
            class_match = re.search(r"\bclass\s+([A-Za-z_]\w*)", line)
            if "__tablename__" in line:
                previous_classes = [
                    (index + 1, re.search(r"\bclass\s+([A-Za-z_]\w*)", previous))
                    for index, previous in enumerate(lines[:line_number - 1])
                    if re.search(r"\bclass\s+([A-Za-z_]\w*)", previous)
                ]
                if previous_classes:
                    class_match = previous_classes[-1][1]
                    entities.append(
                        {
                            "name": class_match.group(1),
                            "file_path": relative,
                            "line": previous_classes[-1][0],
                        }
                    )
                continue
            if class_match:
                entities.append(
                    {"name": class_match.group(1), "file_path": relative, "line": line_number}
                )
            else:
                next_class = next(
                    (
                        (index + 1, re.search(r"\bclass\s+([A-Za-z_]\w*)", following))
                        for index, following in enumerate(lines[line_number:])
                        if re.search(r"\bclass\s+([A-Za-z_]\w*)", following)
                    ),
                    None,
                )
                if next_class:
                    entities.append(
                        {
                            "name": next_class[1].group(1),
                            "file_path": relative,
                            "line": line_number + next_class[0],
                        }
                    )
    return routes, entities


def _clean_markdown_line(text: str) -> str:
    cleaned = html.unescape(text)
    cleaned = re.sub(r"!\[[^\]]*\]\([^)]+\)", "", cleaned)
    cleaned = re.sub(r"<[^>]*>", "", cleaned)
    cleaned = re.sub(r"\[([^\]]+)\]\([^)]+\)", r"\1", cleaned)
    cleaned = re.sub(r"`([^`]*)`", r"\1", cleaned)
    return re.sub(r"\s+", " ", cleaned).strip()


def _readme_sections(root: Path, warnings: list[str]) -> tuple[str, list[dict[str, str]]]:
    for name in ("README.md", "readme.md", "README.rst", "README.txt"):
        readme = root / name
        if not readme.is_file():
            continue
        text = _read_text(readme, warnings)
        if text is None:
            return "", []
        lines = text.splitlines()
        intro_lines: list[str] = []
        sections: list[dict[str, str]] = []
        current_heading: str | None = None
        current_body: list[str] = []
        in_code_block = False

        def _flush_section() -> None:
            if current_heading:
                body_text = _clean_markdown_line(" ".join(current_body))
                sections.append({
                    "name": current_heading,
                    "source": readme.name,
                    "summary": body_text[:320] + ("..." if len(body_text) > 320 else ""),
                })

        for raw_line in lines:
            stripped = raw_line.strip()
            if stripped.startswith("```"):
                in_code_block = not in_code_block
                continue
            if in_code_block:
                continue
            heading_match = re.match(r"^#{1,3}\s+(.+?)\s*$", stripped)
            if heading_match:
                _flush_section()
                current_heading = _clean_markdown_line(heading_match.group(1))
                current_body = []
                continue
            if not stripped or stripped.startswith("[![") or stripped.startswith("<img"):
                continue
            cleaned = _clean_markdown_line(stripped)
            if not cleaned:
                continue
            if current_heading is None or (len(sections) == 0 and len(intro_lines) < 4):
                if len(intro_lines) < 4:
                    intro_lines.append(cleaned)
            if current_heading is not None and len(current_body) < 5:
                current_body.append(cleaned)
        _flush_section()
        about = " ".join(intro_lines)[:500]
        return about, [item for item in sections if item["name"]][:30]
    return "", []


def _readme_features(root: Path, warnings: list[str]) -> list[dict[str, str]]:
    _, sections = _readme_sections(root, warnings)
    return sections


def _extract_repository_profile(
    root: Path,
    readme_about: str,
    manifests: dict[str, Any],
    language_counts: dict[str, int],
    routes: list[dict[str, Any]],
    entry_points: list[str],
    files: list[Path],
) -> dict[str, Any]:
    description = ""
    license_name = ""
    keywords: list[str] = []

    pkg_path = root / "package.json"
    if pkg_path.is_file():
        try:
            pkg = json.loads(pkg_path.read_text(encoding="utf-8", errors="replace"))
            if isinstance(pkg, dict):
                description = str(pkg.get("description") or "").strip()
                license_name = str(pkg.get("license") or "").strip()
                if isinstance(pkg.get("keywords"), list):
                    keywords = [str(item).strip() for item in pkg["keywords"] if str(item).strip()][:12]
        except ValueError:
            pass

    if not description:
        pyproject_path = root / "pyproject.toml"
        if pyproject_path.is_file():
            py_text = pyproject_path.read_text(encoding="utf-8", errors="replace")
            desc_match = re.search(r'(?m)^\s*description\s*=\s*["\']([^"\']+)["\']', py_text)
            if desc_match:
                description = desc_match.group(1).strip()

    frameworks = manifests.get("frameworks", [])
    if routes:
        repo_kind = "Web API / Service"
    elif any(f in frameworks for f in ("React", "Next.js", "Vue", "Angular", "Svelte")):
        repo_kind = "Frontend / Web Application"
    elif any("cli" in str(ep).lower() for ep in entry_points) or "click" in str(manifests.get("dependencies", {})).lower():
        repo_kind = "CLI Tool / Library"
    elif any(path.suffix.lower() in {".h", ".hpp", ".hh", ".hxx"} for path in files):
        repo_kind = "C/C++ Library / System Package"
    else:
        repo_kind = "Software Library / Package"

    primary_language = next(iter(language_counts), "Unknown")
    about = description or readme_about or f"{primary_language} repository with {len(files)} discovered files."
    if readme_about and description and readme_about.lower() not in description.lower():
        about = f"{description} — {readme_about}" if len(description) < 160 else description

    return {
        "about": about[:650],
        "description": description or None,
        "readme_overview": readme_about or None,
        "repository_kind": repo_kind,
        "primary_language": primary_language,
        "license": license_name or None,
        "keywords": keywords,
    }


def _extract_existing_features(
    modules: list[dict[str, Any]],
    symbols: list[dict[str, Any]],
    routes: list[dict[str, Any]],
    database_entities: list[dict[str, Any]],
    test_files: list[str],
    readme_sections: list[dict[str, str]],
) -> list[dict[str, Any]]:
    features: list[dict[str, Any]] = []
    symbols_by_file: dict[str, list[dict[str, Any]]] = {}
    for sym in symbols:
        fp = sym.get("file_path")
        if isinstance(fp, str):
            symbols_by_file.setdefault(fp, []).append(sym)

    for module in modules[:24]:
        mod_path = str(module.get("path", ""))
        mod_name = str(module.get("name", mod_path))
        prefix = f"{mod_path}/"
        mod_symbols = [
            sym for fp, syms in symbols_by_file.items()
            if fp == mod_path or fp.startswith(prefix)
            for sym in syms
        ]
        mod_routes = [r for r in routes if str(r.get("file_path", "")).startswith(prefix)]
        mod_entities = [e for e in database_entities if str(e.get("file_path", "")).startswith(prefix)]
        mod_tests = [t for t in test_files if t.startswith(prefix)]

        if mod_routes:
            category = "API & Endpoints"
        elif mod_entities:
            category = "Data & Models"
        elif mod_tests and not mod_symbols:
            category = "Testing & Quality"
        else:
            category = "Core Module"

        top_symbol_names = list(dict.fromkeys(str(s["name"]) for s in mod_symbols))[:6]
        parts = [f"Contains {module.get('file_count', 0)} source files"]
        if top_symbol_names:
            parts.append(f"defining {', '.join(top_symbol_names)}")
        if mod_routes:
            parts.append(f"exposing {len(mod_routes)} API route(s)")
        if mod_entities:
            parts.append(f"and {len(mod_entities)} data model(s)")
        features.append({
            "name": mod_name,
            "category": category,
            "source": "code",
            "module_path": mod_path,
            "summary": "; ".join(parts) + ".",
            "file_count": int(module.get("file_count", 0)),
            "test_file_count": len(mod_tests),
            "key_symbols": [
                {
                    "name": s["name"],
                    "kind": s["kind"],
                    "file_path": s["file_path"],
                    "start_line": s["start_line"],
                }
                for s in mod_symbols[:8]
            ],
            "api_routes": mod_routes[:6],
            "database_entities": mod_entities[:6],
        })

    generic_headings = {
        "table of contents", "contents", "installation", "install", "license",
        "contributing", "acknowledgements", "changelog", "sponsors", "authors",
    }
    for section in readme_sections:
        heading = str(section.get("name", "")).strip()
        if not heading or heading.lower() in generic_headings:
            continue
        features.append({
            "name": heading,
            "category": "Documented Capability",
            "source": str(section.get("source", "README.md")),
            "module_path": None,
            "summary": section.get("summary") or f"Documented in {section.get('source', 'README')}.",
            "file_count": 0,
            "test_file_count": 0,
            "key_symbols": [],
            "api_routes": [],
            "database_entities": [],
        })
    return features[:40]


def _extract_niche_details(
    root: Path,
    files: list[Path],
    symbols: list[dict[str, Any]],
    graph_edges: list[dict[str, Any]],
    routes: list[dict[str, Any]],
    database_entities: list[dict[str, Any]],
    manifests: dict[str, Any],
) -> dict[str, Any]:
    public_symbols = [
        {
            "name": s["name"],
            "kind": s["kind"],
            "file_path": s["file_path"],
            "start_line": s["start_line"],
            "end_line": s["end_line"],
        }
        for s in symbols
        if not str(s.get("name", "")).startswith("_")
    ][:40]

    import_counts: dict[str, int] = {}
    for edge in graph_edges:
        if edge.get("type") == "imports":
            target = str(edge.get("target", "")).removeprefix("module:")
            if target:
                import_counts[target] = import_counts.get(target, 0) + 1
    top_imports = [
        {"module": mod, "count": cnt}
        for mod, cnt in sorted(import_counts.items(), key=lambda item: (-item[1], item[0]))[:20]
    ]

    rel_files = [_relative(p, root) for p in files]
    config_markers = (
        "tsconfig.json", "pyproject.toml", "setup.cfg", "CMakeLists.txt",
        "meson.build", "vitest.config", "jest.config", "Dockerfile",
        "docker-compose", ".github/workflows/", "tox.ini", "Makefile",
    )
    config_files = [
        rel for rel in rel_files
        if any(marker.lower() in rel.lower() for marker in config_markers)
    ][:25]

    patterns: list[str] = []
    if any(p.suffix.lower() in {".h", ".hpp", ".hh"} for p in files) and any(p.suffix.lower() in {".cpp", ".cc", ".cxx"} for p in files):
        patterns.append("C/C++ Header & Implementation Split")
    if (root / "pnpm-workspace.yaml").is_file() or len(manifests.get("package_managers", [])) > 1:
        patterns.append("Multi-Package / Workspace Layout")
    if routes:
        patterns.append("Route / Controller Endpoints")
    if database_entities:
        patterns.append("Schema / ORM Entity Modeling")
    if any(s["kind"] in {"class", "interface", "struct_specifier"} for s in symbols):
        patterns.append("Object-Oriented / Typed Contracts")
    if any(".github/workflows/" in rel for rel in rel_files):
        patterns.append("GitHub Actions CI")

    return {
        "public_api_surface": public_symbols,
        "top_imported_modules": top_imports,
        "config_and_tooling": config_files,
        "architecture_patterns": patterns,
    }


def _build_code_chunks(
    root: Path,
    source_paths: list[Path],
    symbols: list[dict[str, Any]],
    modules: list[dict[str, Any]],
    readme_features: list[dict[str, str]],
    language_counts: dict[str, int],
    frameworks: list[str],
) -> list[dict[str, Any]]:
    symbols_by_file: dict[str, list[dict[str, Any]]] = {}
    for symbol in symbols:
        file_path = symbol.get("file_path")
        if isinstance(file_path, str):
            symbols_by_file.setdefault(file_path, []).append(symbol)

    def module_for_file(relative_path: str) -> str | None:
        matches = [
            str(module["path"])
            for module in modules
            if isinstance(module.get("path"), str)
            and (relative_path == module["path"] or relative_path.startswith(f"{module['path']}/"))
        ]
        if not matches:
            return None
        return max(matches, key=len)

    chunks: list[dict[str, Any]] = []
    # 1. Include README / architecture overview chunk for high-level repo context
    for readme_name in ("README.md", "readme.md", "README.rst"):
        readme_path = root / readme_name
        if readme_path.is_file():
            try:
                readme_lines = readme_path.read_text(encoding="utf-8", errors="replace").splitlines()
            except OSError:
                readme_lines = []
            if readme_lines:
                excerpt = "\n".join(readme_lines[:140])
                overview_header = (
                    f"Languages: {', '.join(language_counts.keys())}\n"
                    f"Frameworks: {', '.join(frameworks)}\n"
                    f"Modules: {', '.join(m['path'] for m in modules[:30])}\n"
                    f"Sections: {', '.join(f['name'] for f in readme_features[:20])}\n\n"
                )
                chunks.append({
                    "file_path": readme_name,
                    "symbol_name": "README_OVERVIEW",
                    "chunk_type": "doc",
                    "language": "Markdown",
                    "module_name": None,
                    "start_line": 1,
                    "end_line": min(len(readme_lines), 140),
                    "content": (overview_header + excerpt)[:4500],
                    "metadata": {"source": "readme"},
                })
                break

    # 2. Partition source files: production source first, representative tests second
    non_test_paths = [p for p in source_paths if not _is_test_source(p, root)]
    test_paths = [p for p in source_paths if _is_test_source(p, root)]
    ordered_paths = non_test_paths[:200] + test_paths[:50]

    for path in ordered_paths:
        if len(chunks) >= MAX_EMBEDDED_CHUNKS:
            break
        try:
            if path.stat().st_size > MAX_FILE_BYTES:
                continue
            lines = path.read_text(encoding="utf-8", errors="replace").splitlines()
        except OSError:
            continue
        if not lines:
            continue
        relative = _relative(path, root)
        language = SOURCE_EXTENSIONS.get(path.suffix.lower())
        module_name = module_for_file(relative)
        is_test = _is_test_source(path, root)
        file_symbols = sorted(
            symbols_by_file.get(relative, []),
            key=lambda sym: (int(sym.get("start_line", 1)), str(sym.get("name", ""))),
        )

        # Group top-level / major symbols into bounded chunks (<= 100 lines each)
        covered_until = 0
        if file_symbols:
            # Capture file prologue / exports / imports header if meaningful
            first_start = max(1, int(file_symbols[0].get("start_line", 1)))
            if first_start > 2:
                end_prologue = min(first_start - 1, 50)
                prologue_text = "\n".join(lines[:end_prologue]).strip()
                if prologue_text:
                    chunks.append({
                        "file_path": relative,
                        "symbol_name": "__prologue__",
                        "chunk_type": "test" if is_test else "file",
                        "language": language,
                        "module_name": module_name,
                        "start_line": 1,
                        "end_line": end_prologue,
                        "content": f"// File: {relative} (lines 1-{end_prologue})\n" + prologue_text[:3500],
                        "metadata": {"is_test": is_test},
                    })
                    covered_until = end_prologue

            for symbol in file_symbols:
                if len(chunks) >= MAX_EMBEDDED_CHUNKS:
                    break
                start = max(1, int(symbol.get("start_line", 1)))
                end = min(len(lines), int(symbol.get("end_line", start)))
                if start <= covered_until and end <= covered_until:
                    continue
                bounded_end = min(end, start + 99)
                body = "\n".join(lines[start - 1:bounded_end]).strip()
                if not body:
                    continue
                chunks.append({
                    "file_path": relative,
                    "symbol_name": str(symbol.get("name", ""))[:255] or None,
                    "chunk_type": "test" if is_test else str(symbol.get("kind", "symbol"))[:64],
                    "language": language,
                    "module_name": module_name,
                    "start_line": start,
                    "end_line": bounded_end,
                    "content": (
                        f"// File: {relative} | Symbol: {symbol.get('name')} ({symbol.get('kind')})\n"
                        + body[:3500]
                    ),
                    "metadata": {"is_test": is_test, "exported": bool(symbol.get("exported"))},
                })
                covered_until = max(covered_until, bounded_end)
        else:
            # Fallback window for files without parsed symbols (headers, barrel exports, configs)
            end = min(len(lines), 100)
            body = "\n".join(lines[:end]).strip()
            if body:
                chunks.append({
                    "file_path": relative,
                    "symbol_name": None,
                    "chunk_type": "test" if is_test else "file",
                    "language": language,
                    "module_name": module_name,
                    "start_line": 1,
                    "end_line": end,
                    "content": f"// File: {relative}\n" + body[:3500],
                    "metadata": {"is_test": is_test},
                })

    if chunks:
        vectors, model_id, dim = embed_texts_sync(chunk["content"] for chunk in chunks)
        for chunk, vector in zip(chunks, vectors):
            chunk["embedding"] = vector
            chunk["embedding_model"] = model_id
            chunk["embedding_dim"] = dim
    return chunks


def analyze_repository(
    repository_path: str,
    repository_id: str,
    snapshot_id: str,
    commit_sha: str,
    ecosystem: str,
) -> dict[str, Any]:
    root = Path(repository_path).resolve(strict=True)
    if not root.is_dir():
        raise ValueError("Repository snapshot path must be a directory.")

    warnings: list[str] = []
    files, visited_files, file_scan_truncated = _collect_files(root)
    manifests = _read_manifests(root, files, warnings)
    language_counts = _detect_language_counts(files)
    source_paths = [
        path for path in files
        if path.suffix.lower() in SOURCE_EXTENSIONS
    ]
    source_paths.sort(
        key=lambda path: (_is_test_source(path, root), _relative(path, root).lower())
    )
    if len(source_paths) > MAX_SOURCE_FILES:
        warnings.append(f"Source parsing limited to the first {MAX_SOURCE_FILES} files.")
    if len(source_paths) > MAX_METADATA_SOURCE_FILES:
        warnings.append(
            f"Route and entity scanning limited to the first {MAX_METADATA_SOURCE_FILES} source files."
        )
    if file_scan_truncated:
        warnings.append(f"File listing limited to the first {MAX_FILES} filesystem entries.")

    symbols: list[dict[str, Any]] = []
    graph_nodes: list[dict[str, Any]] = []
    graph_edges: list[dict[str, str]] = []
    graph_node_ids: set[str] = set()
    graph_edge_ids: set[tuple[str, str, str]] = set()
    imported_modules: set[str] = set()
    call_references: list[tuple[str, int, str]] = []
    routes: list[dict[str, Any]] = []
    database_entities: list[dict[str, Any]] = []
    test_files = {
        _relative(path, root) for path in source_paths if _is_test_source(path, root)
    }
    metadata_files_scanned = 0
    metadata_bytes_scanned = 0
    for path in source_paths[:MAX_METADATA_SOURCE_FILES]:
        if _is_test_source(path, root):
            continue
        try:
            size = path.stat().st_size
            if size > MAX_FILE_BYTES or metadata_bytes_scanned + size > MAX_TOTAL_SOURCE_BYTES:
                continue
            text = path.read_text(encoding="utf-8")
        except (OSError, UnicodeError) as error:
            if len(warnings) < 100:
                warnings.append(
                    f"Could not scan metadata in {_relative(path, root)}: "
                    f"{type(error).__name__}."
                )
            continue
        metadata_files_scanned += 1
        metadata_bytes_scanned += size
        found_routes, found_entities = _extract_routes_and_entities(
            _relative(path, root), text
        )
        routes.extend(found_routes)
        database_entities.extend(found_entities)
    total_source_bytes = 0
    analyzed_source_files = 0
    graph_truncated = False

    for path in source_paths[:MAX_SOURCE_FILES]:
        try:
            size = path.stat().st_size
        except OSError:
            continue
        if size > MAX_FILE_BYTES or total_source_bytes + size > MAX_TOTAL_SOURCE_BYTES:
            continue
        try:
            source = path.read_bytes()
        except OSError:
            warnings.append(f"Could not read source file: {_relative(path, root)}.")
            continue
        total_source_bytes += len(source)
        analyzed_source_files += 1
        relative = _relative(path, root)
        text = source.decode("utf-8", errors="replace")
        language = SOURCE_EXTENSIONS[path.suffix.lower()]
        file_node_id = f"file:{relative}"
        if not _add_graph_node(
            graph_nodes,
            graph_node_ids,
            {"id": file_node_id, "type": "file", "name": path.name, "file_path": relative},
        ):
            graph_truncated = True
            continue

        file_symbols, imports, calls = _parse_symbols(path, root, source, language, warnings)
        imported_modules.update(imports)
        call_references.extend(calls)
        for symbol in file_symbols:
            symbol_id = f"symbol:{relative}:{symbol['start_line']}:{symbol['name']}"
            symbol["id"] = symbol_id
            symbols.append(symbol)
            if not _add_graph_node(
                graph_nodes,
                graph_node_ids,
                {
                    "id": symbol_id,
                    "type": symbol["kind"],
                    "name": symbol["name"],
                    "file_path": relative,
                    "start_line": symbol["start_line"],
                    "end_line": symbol["end_line"],
                },
            ):
                graph_truncated = True
                break
            edge = (file_node_id, symbol_id, "contains")
            if edge not in graph_edge_ids and len(graph_edges) < MAX_GRAPH_EDGES:
                graph_edge_ids.add(edge)
                graph_edges.append({"source": edge[0], "target": edge[1], "type": edge[2]})
        for imported in imports:
            imported_node_id = f"module:{imported}"
            if not _add_graph_node(
                graph_nodes,
                graph_node_ids,
                {"id": imported_node_id, "type": "module", "name": imported},
            ):
                graph_truncated = True
                break
            edge = (file_node_id, imported_node_id, "imports")
            if edge not in graph_edge_ids and len(graph_edges) < MAX_GRAPH_EDGES:
                graph_edge_ids.add(edge)
                graph_edges.append({"source": edge[0], "target": edge[1], "type": edge[2]})

        source_lines = text.splitlines()
        for symbol in file_symbols:
            declaration_text = "\n".join(
                source_lines[symbol["start_line"] - 1:symbol["end_line"]]
            )
            base_match = re.search(
                r"\bclass\s+\w+\s*(?:\(([^)]*)\)|extends\s+([A-Za-z_$][\w.$]*))",
                declaration_text,
            )
            base_name = next((value for value in base_match.groups() if value), "") if base_match else ""
            if base_name:
                base_name = base_name.split(",")[0].strip().split(".")[-1]
                target_matches = [
                    candidate for candidate in file_symbols if candidate["name"] == base_name
                ]
                if len(target_matches) == 1:
                    edge = (symbol["id"], target_matches[0]["id"], "extends")
                    if edge not in graph_edge_ids and len(graph_edges) < MAX_GRAPH_EDGES:
                        graph_edge_ids.add(edge)
                        graph_edges.append({"source": edge[0], "target": edge[1], "type": edge[2]})

    if total_source_bytes >= MAX_TOTAL_SOURCE_BYTES:
        warnings.append("Source scanning stopped at the configured total byte limit.")
    if graph_truncated or len(graph_edges) >= MAX_GRAPH_EDGES:
        warnings.append("Dependency graph was truncated at its configured size limit.")
    symbol_ids_by_name: dict[str, list[str]] = {}
    symbol_ids_by_location: dict[tuple[str, int], str] = {}
    for symbol in symbols:
        symbol_ids_by_name.setdefault(symbol["name"], []).append(symbol["id"])
        symbol_ids_by_location[(symbol["name"], symbol["start_line"])] = symbol["id"]
    for owner_name, owner_line, target_name in call_references:
        owner_id = symbol_ids_by_location.get((owner_name, owner_line))
        target_ids = symbol_ids_by_name.get(target_name, [])
        if owner_id and len(target_ids) == 1:
            edge = (owner_id, target_ids[0], "calls")
            if edge not in graph_edge_ids and len(graph_edges) < MAX_GRAPH_EDGES:
                graph_edge_ids.add(edge)
                graph_edges.append({"source": edge[0], "target": edge[1], "type": edge[2]})

    tree, tree_truncated = _directory_tree(files, root)
    if tree_truncated:
        warnings.append("Directory tree was truncated at its configured size limit.")
    if not language_counts:
        warnings.append("No source languages were detected from supported file extensions.")
    if len(routes) > 500:
        warnings.append("API route report was truncated to 500 entries.")
    if len(database_entities) > 500:
        warnings.append("Database entity report was truncated to 500 entries.")
    if len(test_files) > 500:
        warnings.append("Test-file list was truncated to 500 entries.")

    entry_points = [
        _relative(path, root)
        for path in files
        if path.name.lower() in {
            "main.py",
            "main.ts",
            "main.tsx",
            "index.js",
            "index.ts",
            "index.tsx",
            "app.py",
            "manage.py",
        }
    ][:100]
    modules = _source_directories(files, root)
    scope_breakdown: dict[str, int] = {}
    for module in modules:
        prefix = f"{module['path']}/"
        module["api_route_count"] = sum(
            route["file_path"].startswith(prefix) for route in routes
        )
        module["database_entity_count"] = sum(
            entity["file_path"].startswith(prefix) for entity in database_entities
        )
        module["test_file_count"] = sum(
            test_file.startswith(prefix) for test_file in test_files
        )
        scope = _classify_module_scope(module["path"])
        module["scope"] = scope
        scope_breakdown[scope] = scope_breakdown.get(scope, 0) + 1
    readme_about, feature_headings = _readme_sections(root, warnings)
    repository_profile = _extract_repository_profile(
        root=root,
        readme_about=readme_about,
        manifests=manifests,
        language_counts=language_counts,
        routes=routes,
        entry_points=entry_points,
        files=files,
    )
    existing_features = _extract_existing_features(
        modules=modules,
        symbols=symbols,
        routes=routes,
        database_entities=database_entities,
        test_files=test_files,
        readme_sections=feature_headings,
    )
    niche_details = _extract_niche_details(
        root=root,
        files=files,
        symbols=symbols,
        graph_edges=graph_edges,
        routes=routes,
        database_entities=database_entities,
        manifests=manifests,
    )
    if not feature_headings:
        feature_headings = [
            {"name": module["name"], "source": module["path"], "summary": ""}
            for module in modules[:30]
        ]
    build_commands = manifests["build_commands"]
    test_commands = manifests["test_commands"]
    if test_files and not test_commands:
        warnings.append("Test files were found, but no configured test command was detected.")

    report = {
        "repository": {
            "repository_id": repository_id,
            "snapshot_id": snapshot_id,
            "commit_sha": commit_sha,
            "ecosystem": ecosystem,
            "analyzer_version": ANALYZER_VERSION,
        },
        "file_statistics": {
            "files_discovered": len(files),
            "filesystem_entries_visited": visited_files,
            "source_files_analyzed": analyzed_source_files,
            "source_bytes_analyzed": total_source_bytes,
            "metadata_source_files_scanned": metadata_files_scanned,
            "api_routes_discovered": len(routes),
            "database_entities_discovered": len(database_entities),
            "source_files_with_symbols": len({symbol["file_path"] for symbol in symbols}),
            "directory_tree_truncated": tree_truncated,
            "graph_truncated": graph_truncated or len(graph_edges) >= MAX_GRAPH_EDGES,
        },
        "directory_tree": tree,
        "modules": modules,
        "entry_points": entry_points,
        "api_routes": routes[:500],
        "api_route_count": len(routes),
        "database_entities": database_entities[:500],
        "database_entity_count": len(database_entities),
        "symbols": symbols[:MAX_GRAPH_NODES],
        "graph": {"nodes": graph_nodes, "edges": graph_edges},
        "tests": {
            "files": sorted(test_files)[:500],
            "declared_test_symbols": [
                symbol for symbol in symbols
                if re.search(r"(^test_|^it$|^describe$|test)", symbol["name"], re.I)
            ][:500],
            "coverage_available": False,
        },
        "potential_development_areas": [
            "Review test coverage and add tests where source modules lack nearby tests."
        ] if test_files else ["Add or identify test suites for the detected source modules."],
        "repository_profile": repository_profile,
        "existing_features": existing_features,
        "niche_details": niche_details,
        "scope_breakdown": scope_breakdown,
        "warnings": warnings,
    }
    summary = {
        "repository_id": repository_id,
        "snapshot_id": snapshot_id,
        "commit_sha": commit_sha,
        "scope_breakdown": scope_breakdown,
        "language": list(language_counts),
        "language_file_counts": language_counts,
        "frameworks": manifests["frameworks"],
        "database": manifests["database"],
        "orm": manifests["orm"],
        "modules": modules,
        "features": feature_headings,
        "repository_profile": repository_profile,
        "existing_features": existing_features,
        "niche_details": niche_details,
        "dependencies": manifests["dependencies"],
        "package_managers": manifests["package_managers"],
        "build_commands": build_commands,
        "test_commands": test_commands,
        "entry_points": entry_points,
        "api_routes": routes[:500],
        "api_route_count": len(routes),
        "database_entities": database_entities[:500],
        "database_entity_count": len(database_entities),
        "file_count": len(files),
        "analyzed_source_file_count": analyzed_source_files,
        "imported_modules": sorted(imported_modules)[:500],
    }
    chunks = _build_code_chunks(
        root=root,
        source_paths=source_paths,
        symbols=symbols,
        modules=modules,
        readme_features=feature_headings,
        language_counts=language_counts,
        frameworks=manifests["frameworks"],
    )
    return {"summary": summary, "report": report, "chunks": chunks, "warnings": warnings}
