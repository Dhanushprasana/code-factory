from __future__ import annotations

from collections import defaultdict
from pathlib import Path, PurePosixPath
import re
from typing import Any


MAX_SOURCE_FILE_BYTES = 512_000
SOURCE_EXTENSIONS = {
    ".c", ".cc", ".cpp", ".cs", ".go", ".java", ".js", ".jsx", ".kt",
    ".php", ".py", ".rb", ".rs", ".swift", ".ts", ".tsx", ".vue",
}
TEST_PATH_MARKERS = ("test", "spec", "__tests__")
STOP_WORDS = {
    "add", "and", "are", "based", "code", "create", "existing", "for", "from",
    "implement", "into", "make", "new", "not", "our", "repo", "repository",
    "should", "task", "that", "the", "this", "with",
}


def _tokens(text: str) -> set[str]:
    return {
        token for token in re.findall(r"[a-z0-9_]+", text.lower())
        if len(token) > 2 and token not in STOP_WORDS
    }


def _safe_repository_file(root: Path, relative_path: str) -> Path | None:
    relative = PurePosixPath(relative_path)
    if relative.is_absolute() or not relative.parts or any(part in {"..", "."} for part in relative.parts):
        return None
    candidate = (root / Path(*relative.parts)).resolve()
    try:
        candidate.relative_to(root)
    except ValueError:
        return None
    if candidate.suffix.lower() not in SOURCE_EXTENSIONS or not candidate.is_file():
        return None
    try:
        if candidate.stat().st_size > MAX_SOURCE_FILE_BYTES:
            return None
    except OSError:
        return None
    return candidate


def _file_metadata(report: dict[str, Any]) -> dict[str, dict[str, Any]]:
    metadata: dict[str, dict[str, Any]] = defaultdict(lambda: {"symbols": [], "routes": [], "entities": []})
    for symbol in report.get("symbols", []):
        if isinstance(symbol, dict) and isinstance(symbol.get("file_path"), str):
            metadata[symbol["file_path"]]["symbols"].append(symbol)
    for route in report.get("api_routes", []):
        if isinstance(route, dict) and isinstance(route.get("file_path"), str):
            metadata[route["file_path"]]["routes"].append(route)
    for entity in report.get("database_entities", []):
        if isinstance(entity, dict) and isinstance(entity.get("file_path"), str):
            metadata[entity["file_path"]]["entities"].append(entity)
    return metadata


def _rank_files(repository: dict[str, Any], query_tokens: set[str]) -> list[tuple[str, float, str]]:
    report = repository["report"]
    root = Path(repository["repository_path"]).resolve(strict=True)
    metadata = _file_metadata(report)
    candidates: set[str] = set(metadata)
    candidates.update(
        entry["path"]
        for entry in report.get("directory_tree", [])
        if isinstance(entry, dict) and entry.get("type") == "file"
        and isinstance(entry.get("path"), str)
        and PurePosixPath(entry["path"]).suffix.lower() in SOURCE_EXTENSIONS
    )
    candidates.update(
        path for path in report.get("tests", {}).get("files", [])
        if isinstance(path, str) and PurePosixPath(path).suffix.lower() in SOURCE_EXTENSIONS
    )

    ranked: list[tuple[str, float, str]] = []
    for file_path in candidates:
        if _safe_repository_file(root, file_path) is None:
            continue
        item = metadata[file_path]
        searchable = " ".join(
            [file_path]
            + [str(symbol.get("name", "")) + " " + str(symbol.get("kind", "")) for symbol in item["symbols"]]
            + [str(route.get("method", "")) + " " + str(route.get("path", "")) for route in item["routes"]]
            + [str(entity.get("name", "")) for entity in item["entities"]]
        )
        matched = _tokens(searchable) & query_tokens
        is_test = any(marker in file_path.lower() for marker in TEST_PATH_MARKERS)
        score = len(matched) / max(1, len(query_tokens))
        if is_test:
            score += 0.02
        if item["symbols"]:
            score += 0.04
        reason = "keyword and symbol match" if matched else "repository structure and test evidence"
        ranked.append((file_path, score, reason))
    return sorted(ranked, key=lambda item: (-item[1], item[0].lower()))


def _graph_neighbors(report: dict[str, Any]) -> dict[str, set[str]]:
    nodes = {
        node["id"]: node.get("file_path")
        for node in report.get("graph", {}).get("nodes", [])
        if isinstance(node, dict) and isinstance(node.get("id"), str)
    }
    neighbors: dict[str, set[str]] = defaultdict(set)
    for edge in report.get("graph", {}).get("edges", []):
        if not isinstance(edge, dict) or edge.get("type") not in {"calls", "imports", "extends"}:
            continue
        source = nodes.get(edge.get("source"))
        target = nodes.get(edge.get("target"))
        if source and target and source != target:
            neighbors[source].add(target)
            neighbors[target].add(source)
    return neighbors


def _source_chunks(
    repository: dict[str, Any],
    ranked_files: list[tuple[str, float, str]],
    token_budget: int,
) -> tuple[list[dict[str, Any]], int]:
    root = Path(repository["repository_path"]).resolve(strict=True)
    report = repository["report"]
    metadata = _file_metadata(report)
    neighbors = _graph_neighbors(report)
    max_ranked = 24 if token_budget >= 20000 else 8
    max_selected = 40 if token_budget >= 20000 else 12
    max_symbols_per_file = 6 if token_budget >= 20000 else 3
    selected = list(ranked_files[:max_ranked])
    selected_paths = {path for path, _, _ in selected}
    for file_path, _, _ in selected[:8]:
        for neighbor in sorted(neighbors.get(file_path, set())):
            if neighbor not in selected_paths:
                selected.append((neighbor, 0.0, f"related by static dependency to {file_path}"))
                selected_paths.add(neighbor)
                if len(selected) >= max_selected:
                    break
        if len(selected) >= max_selected:
            break

    # Include same-module sibling controllers/services/modules/enums so the LLM sees exact routes and DI
    if token_budget >= 20000 and len(selected) < max_selected:
        selected_dirs = {
            str(PurePosixPath(path).parent)
            for path, _, _ in selected[:8]
        }
        module_roots = set()
        for d in selected_dirs:
            parts = PurePosixPath(d).parts
            if parts and parts[-1] in {"dto", "entities", "enums", "guards", "decorators"} and len(parts) > 1:
                module_roots.add("/".join(parts[:-1]))
            else:
                module_roots.add(d)
        for file_path, _, _ in ranked_files:
            if len(selected) >= max_selected:
                break
            if file_path in selected_paths:
                continue
            if any(file_path.startswith(root_dir + "/") for root_dir in module_roots):
                lower = file_path.lower()
                if any(k in lower for k in ("controller", "service", "module", "enum", "dto", "entity")):
                    selected.append((file_path, 0.0, "same-module sibling for complete route/DI context"))
                    selected_paths.add(file_path)

    chunks: list[dict[str, Any]] = []
    remaining = token_budget
    for file_path, _, reason in selected:
        source_file = _safe_repository_file(root, file_path)
        if source_file is None:
            continue
        try:
            lines = source_file.read_text(encoding="utf-8").splitlines()
        except (OSError, UnicodeError):
            continue

        symbols = sorted(
            metadata[file_path]["symbols"],
            key=lambda symbol: (symbol.get("start_line", 1), symbol.get("name", "")),
        )
        ranges: list[tuple[int, int, str]] = []
        if symbols:
            first_symbol_start = max(1, int(symbols[0].get("start_line", 1)))
            if first_symbol_start > 1:
                ranges.append((1, min(first_symbol_start - 1, 40), "file prologue"))
            for symbol in symbols[:max_symbols_per_file]:
                start = max(1, int(symbol.get("start_line", 1)))
                end = min(len(lines), int(symbol.get("end_line", start)), start + 159)
                ranges.append((start, end, str(symbol.get("name", ""))))
        else:
            ranges.append((1, min(len(lines), 80), ""))

        for start, end, symbol_name in ranges:
            content = "\n".join(f"{number}: {lines[number - 1]}" for number in range(start, end + 1))
            estimated_tokens = max(1, len(content) // 4)
            if estimated_tokens > remaining:
                available_chars = remaining * 4
                if available_chars < 400:
                    return chunks, token_budget - remaining
                content = content[:available_chars]
                last_newline = content.rfind("\n")
                if last_newline > 0:
                    content = content[:last_newline]
                end = start + content.count("\n")
                estimated_tokens = max(1, len(content) // 4)
            if not content:
                continue
            chunks.append({
                "repository_id": repository["repository_id"],
                "snapshot_id": repository["snapshot_id"],
                "commit_sha": repository["commit_sha"],
                "file_path": file_path,
                "symbol": symbol_name or None,
                "start_line": start,
                "end_line": end,
                "reason": reason,
                "content": content,
                "estimated_tokens": estimated_tokens,
            })
            remaining -= estimated_tokens
            if remaining <= 0:
                return chunks, token_budget
    return chunks, token_budget - remaining


def build_task_context(
    repositories: list[dict[str, Any]],
    user_idea: str | None,
    category: str,
    constraints: list[str],
    token_budget: int,
) -> tuple[dict[str, Any], dict[str, Any]]:
    query = " ".join([user_idea or "", category, *constraints])
    query_tokens = _tokens(query)
    remaining = token_budget
    context_repositories: list[dict[str, Any]] = []
    manifest_repositories: list[dict[str, Any]] = []

    for repository in repositories:
        report = repository["report"]
        summary = repository["summary"]
        ranked_files = _rank_files(repository, query_tokens)
        chunks, used_tokens = _source_chunks(repository, ranked_files, remaining)
        remaining = max(0, remaining - used_tokens)
        modules = summary.get("modules", report.get("modules", []))
        context_repositories.append({
            "repository": repository.get("repository_name", ""),
            "repository_id": repository["repository_id"],
            "snapshot_id": repository["snapshot_id"],
            "analysis_id": repository["analysis_id"],
            "commit_sha": repository["commit_sha"],
            "summary": {
                key: summary.get(key)
                for key in ("language", "frameworks", "database", "orm", "build_commands", "test_commands")
                if summary.get(key) is not None
            },
            "modules": [
                {"name": module.get("name"), "path": module.get("path")}
                for module in modules if isinstance(module, dict)
            ][:100],
            "chunks": chunks,
        })
        manifest_repositories.append({
            "repository_id": repository["repository_id"],
            "snapshot_id": repository["snapshot_id"],
            "analysis_id": repository["analysis_id"],
            "commit_sha": repository["commit_sha"],
            "retrieved_chunks": [
                {
                    key: chunk[key]
                    for key in ("file_path", "symbol", "start_line", "end_line", "reason")
                }
                for chunk in chunks
            ],
        })
    estimated_tokens = sum(
        chunk["estimated_tokens"]
        for repository in context_repositories for chunk in repository["chunks"]
    )
    context_package = {
        "repositories": context_repositories,
        "estimated_tokens": estimated_tokens,
    }
    manifest = {
        "repositories": manifest_repositories,
        "retrieval_strategies": ["keyword", "structure", "static_graph"],
        "estimated_tokens": estimated_tokens,
        "token_budget": token_budget,
    }
    return context_package, manifest
