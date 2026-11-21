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


ANALYZER_VERSION = "0.1.1"
MAX_FILES = 25_000
MAX_METADATA_SOURCE_FILES = 15_000
MAX_SOURCE_FILES = 5_000
MAX_FILE_BYTES = 512_000
MAX_TOTAL_SOURCE_BYTES = 100_000_000
MAX_TREE_ENTRIES = 2_000
MAX_GRAPH_NODES = 2_000
MAX_GRAPH_EDGES = 5_000

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
    ".cjs": "javascript",
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
    "enum_declaration",
    "function_declaration",
    "function_definition",
    "interface_declaration",
    "method_definition",
    "type_alias_declaration",
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
    stack: list[tuple[Any, tuple[str, int] | None]] = [(tree.root_node, None)]
    while stack:
        node, owner = stack.pop()
        child_owner = owner
        if node.type in DECLARATION_TYPES:
            name_node = node.child_by_field_name("name")
            if name_node is None:
                name_node = next(
                    (child for child in node.children if child.type in ("identifier", "type_identifier")),
                    None,
                )
            if name_node is not None:
                name = source[name_node.start_byte:name_node.end_byte].decode(
                    "utf-8", errors="replace"
                )
                if name:
                    child_owner = (name, node.start_point.row + 1)
                    declaration = source[node.start_byte:node.end_byte].decode(
                        "utf-8", errors="replace"
                    )
                    symbols.append(
                        {
                            "name": name,
                            "kind": node.type.removesuffix("_declaration").removesuffix("_definition"),
                            "file_path": _relative(path, root),
                            "start_line": node.start_point.row + 1,
                            "end_line": node.end_point.row + 1,
                            "exported": bool(
                                re.search(r"(?m)^\s*export\b", declaration)
                            ),
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
    dependencies: dict[str, list[dict[str, str]]] = {"npm": [], "python": []}
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
            for command_name in ("build", "typecheck", "lint"):
                if isinstance(scripts.get(command_name), str):
                    build_commands.add(f"npm run {command_name}")
            if isinstance(scripts.get("test"), str):
                test_commands.add("npm run test")
            if isinstance(scripts.get("test:unit"), str):
                test_commands.add("npm run test:unit")
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
            if group.lower() in ("dev", "test", "testing") and isinstance(values, list):
                for dependency in values:
                    if isinstance(dependency, str) and dependency.lower().startswith(("pytest", "tox")):
                        test_commands.add("pytest")
        if "pytest" in text.lower():
            test_commands.add("pytest")
        if "hatchling" in text.lower() or "setuptools" in text.lower():
            build_commands.add("python -m build")
        package_managers.add("uv" if (pyproject_path.parent / "uv.lock").exists() else "pip")

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
        ".cs": "C#",
        ".css": "CSS",
        ".go": "Go",
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


def _source_directories(files: list[Path], root: Path) -> list[dict[str, Any]]:
    workspace_roots = {"apps", "packages"}
    source_roots = {"app", "src", "modules"}
    modules: Counter[tuple[str, str]] = Counter()
    for path in files:
        parts = path.relative_to(root).parts
        module_parts = None
        for index, part in enumerate(parts[:-1]):
            if part.lower() in workspace_roots and index + 1 < len(parts) - 1:
                module_parts = parts[:index + 2]
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


def _readme_features(root: Path, warnings: list[str]) -> list[dict[str, str]]:
    for readme in (root / "README.md", root / "readme.md"):
        if not readme.is_file():
            continue
        text = _read_text(readme, warnings)
        if text is None:
            return []
        headings: list[dict[str, str]] = []
        for match in re.finditer(r"(?m)^#{1,3}\s+(.+?)\s*$", text):
            name = html.unescape(match.group(1))
            name = re.sub(r"<[^>]*>", "", name)
            name = re.sub(r"\[([^\]]+)\]\([^)]+\)", r"\1", name)
            name = re.sub(r"`([^`]*)`", r"\1", name).strip()
            if name:
                headings.append({"name": name, "source": readme.name})
        return headings[:30]
    return []


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
    feature_headings = _readme_features(root, warnings)
    if not feature_headings:
        feature_headings = [
            {"name": module["name"], "source": module["path"]}
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
        "warnings": warnings,
    }
    summary = {
        "repository_id": repository_id,
        "snapshot_id": snapshot_id,
        "commit_sha": commit_sha,
        "language": list(language_counts),
        "language_file_counts": language_counts,
        "frameworks": manifests["frameworks"],
        "database": manifests["database"],
        "orm": manifests["orm"],
        "modules": modules,
        "features": feature_headings,
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
    return {"summary": summary, "report": report, "warnings": warnings}
