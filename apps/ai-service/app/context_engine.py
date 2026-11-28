from __future__ import annotations

from collections import defaultdict
from pathlib import Path, PurePosixPath
import re
from typing import Any

from rank_bm25 import BM25Okapi
import tiktoken


MAX_SOURCE_FILE_BYTES = 512_000
SOURCE_EXTENSIONS = {
    ".c", ".cc", ".cpp", ".cs", ".cxx", ".go", ".h", ".hh", ".hpp", ".hxx",
    ".java", ".js", ".jsx", ".kt", ".mjs", ".cjs", ".php", ".py", ".rb",
    ".rs", ".swift", ".ts", ".tsx", ".vue",
}
TEST_PATH_MARKERS = ("test", "spec", "__tests__")
STOP_WORDS = {
    "add", "and", "are", "based", "code", "create", "existing", "for", "from",
    "implement", "into", "make", "new", "not", "our", "repo", "repository",
    "should", "task", "that", "the", "this", "with",
}

try:
    _ENCODING = tiktoken.get_encoding("cl100k_base")
except Exception:
    _ENCODING = None


def _estimate_tokens(text: str) -> int:
    if not text:
        return 0
    if _ENCODING is not None:
        try:
            return max(1, len(_ENCODING.encode(text, disallowed_special=())))
        except Exception:
            pass
    return max(1, len(text) // 4)


def _tokens(text: str) -> set[str]:
    return set(_token_list(text))


def _token_list(text: str) -> list[str]:
    raw = re.findall(r"[A-Za-z_][A-Za-z0-9_]*|[0-9]+", text)
    tokens: list[str] = []
    for item in raw:
        lowered = item.lower()
        if len(lowered) > 2 and lowered not in STOP_WORDS:
            tokens.append(lowered)
        for sub in re.findall(r"[A-Z]?[a-z]+|[A-Z]+(?=[A-Z]|$)", item):
            sub_lower = sub.lower()
            if len(sub_lower) > 2 and sub_lower not in STOP_WORDS and sub_lower != lowered:
                tokens.append(sub_lower)
    return tokens


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


def _is_non_core_path(file_path: str) -> bool:
    lowered = file_path.replace("\\", "/").lower()
    parts = set(lowered.split("/"))
    return bool(
        any(marker in lowered for marker in ("/bench", "benchmarks", "typia-case", "apps/docs", "website"))
        or parts & {"bench", "benchmarks", "docs", "doc", "website", "www", "examples", "fixtures"}
    )


def _rank_files(
    repository: dict[str, Any],
    query_tokens: list[str],
    vector_scores_by_file: dict[str, float],
    scope_filter: str = "all",
) -> list[tuple[str, float, str]]:
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
    candidates.update(vector_scores_by_file.keys())

    valid_files: list[str] = []
    corpus_tokens: list[list[str]] = []
    searchable_texts: dict[str, str] = {}
    for file_path in sorted(candidates):
        if _safe_repository_file(root, file_path) is None:
            continue
        item = metadata[file_path]
        searchable = " ".join(
            [file_path]
            + [str(symbol.get("name", "")) + " " + str(symbol.get("kind", "")) for symbol in item["symbols"]]
            + [str(route.get("method", "")) + " " + str(route.get("path", "")) for route in item["routes"]]
            + [str(entity.get("name", "")) for entity in item["entities"]]
        )
        valid_files.append(file_path)
        searchable_texts[file_path] = searchable
        corpus_tokens.append(_token_list(searchable) or [file_path.lower()])

    bm25_scores: list[float] = [0.0] * len(valid_files)
    if valid_files and query_tokens:
        try:
            bm25 = BM25Okapi(corpus_tokens)
            raw_scores = bm25.get_scores(query_tokens)
            max_bm25 = max(raw_scores) if len(raw_scores) else 0.0
            if max_bm25 > 0:
                bm25_scores = [float(score) / float(max_bm25) for score in raw_scores]
        except Exception:
            pass

    query_set = set(query_tokens)
    ranked: list[tuple[str, float, str]] = []
    for index, file_path in enumerate(valid_files):
        item = metadata[file_path]
        matched = _tokens(searchable_texts[file_path]) & query_set
        is_test = any(marker in file_path.lower() for marker in TEST_PATH_MARKERS)
        keyword_score = len(matched) / max(1, len(query_set))
        bm25_score = bm25_scores[index]
        vector_score = max(0.0, vector_scores_by_file.get(file_path, 0.0))

        # Prioritize production source files on pure semantic/keyword matches, while keeping test boost
        score = (vector_score * 0.55) + (bm25_score * 0.30) + (keyword_score * 0.25)
        if scope_filter == "core_library" and _is_non_core_path(file_path):
            score -= 0.45
        if is_test:
            score += 0.02
        if item["symbols"]:
            score += 0.04
        if any(bool(symbol.get("exported")) for symbol in item["symbols"]):
            score += 0.03

        reasons: list[str] = []
        if vector_score > 0:
            reasons.append("pgvector semantic match")
        if matched or bm25_score > 0.15:
            reasons.append("keyword and BM25 symbol match")
        if not reasons:
            reasons.append("repository structure and test evidence")
        ranked.append((file_path, score, " + ".join(reasons)))
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


def _readme_overview_chunk(repository: dict[str, Any], root: Path) -> dict[str, Any] | None:
    report = repository["report"]
    summary = repository["summary"]
    readme_file = None
    readme_lines: list[str] = []
    for candidate in ("README.md", "readme.md", "README.rst"):
        path = root / candidate
        if path.is_file():
            try:
                readme_lines = path.read_text(encoding="utf-8", errors="replace").splitlines()
                readme_file = candidate
                break
            except OSError:
                continue
    if not readme_file or not readme_lines:
        return None
    top_symbols = [
        f"{sym.get('file_path')}:{sym.get('name')}"
        for sym in report.get("symbols", [])[:40]
        if isinstance(sym, dict)
    ]
    excerpt_lines = readme_lines[:80]
    overview = (
        f"Repository Overview ({repository.get('repository_name', '')}):\n"
        f"Languages: {', '.join(summary.get('language', []))}\n"
        f"Frameworks: {', '.join(summary.get('frameworks', []))}\n"
        f"Key Modules: {', '.join(m.get('path', '') for m in summary.get('modules', [])[:25] if isinstance(m, dict))}\n"
        f"Sample Symbols: {', '.join(top_symbols[:25])}\n\n"
        + "\n".join(f"{idx + 1}: {line}" for idx, line in enumerate(excerpt_lines))
    )
    return {
        "repository_id": repository["repository_id"],
        "snapshot_id": repository["snapshot_id"],
        "commit_sha": repository["commit_sha"],
        "file_path": readme_file,
        "symbol": "README_OVERVIEW",
        "start_line": 1,
        "end_line": len(excerpt_lines),
        "reason": "repository architecture and feature overview",
        "content": overview,
        "estimated_tokens": _estimate_tokens(overview),
    }


def _source_chunks(
    repository: dict[str, Any],
    ranked_files: list[tuple[str, float, str]],
    token_budget: int,
    max_files: int = 14,
    max_symbols_per_file: int = 8,
    max_lines_per_symbol: int = 180,
) -> tuple[list[dict[str, Any]], int]:
    root = Path(repository["repository_path"]).resolve(strict=True)
    report = repository["report"]
    metadata = _file_metadata(report)
    neighbors = _graph_neighbors(report)

    chunks: list[dict[str, Any]] = []
    remaining = token_budget

    # Include architectural README overview if space allows
    overview_chunk = _readme_overview_chunk(repository, root)
    if overview_chunk is not None and overview_chunk["estimated_tokens"] <= max(500, remaining // 4):
        chunks.append(overview_chunk)
        remaining -= overview_chunk["estimated_tokens"]

    # Seed top ranked production files + ensure at least 2 test files are represented
    selected: list[tuple[str, float, str]] = []
    selected_paths: set[str] = set()

    for file_path, score, reason in ranked_files:
        if len(selected) >= max_files - 4:
            break
        if not any(marker in file_path.lower() for marker in TEST_PATH_MARKERS):
            selected.append((file_path, score, reason))
            selected_paths.add(file_path)

    for file_path, score, reason in ranked_files:
        if len(selected) >= max_files - 2:
            break
        if file_path not in selected_paths and any(marker in file_path.lower() for marker in TEST_PATH_MARKERS):
            selected.append((file_path, score, f"{reason} (test pattern)"))
            selected_paths.add(file_path)

    for file_path, _, _ in list(selected[:5]):
        for neighbor in sorted(neighbors.get(file_path, set())):
            if neighbor not in selected_paths:
                selected.append((neighbor, 0.0, f"related by static dependency to {file_path}"))
                selected_paths.add(neighbor)
                if len(selected) >= max_files:
                    break
        if len(selected) >= max_files:
            break

    # Include any remaining top ranked files if slots remain
    for file_path, score, reason in ranked_files:
        if len(selected) >= max_files:
            break
        if file_path not in selected_paths:
            selected.append((file_path, score, reason))
            selected_paths.add(file_path)

    # Track vector chunk line ranges per file so high-similarity semantic chunks are prioritized
    vector_chunks_by_file: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for vc in repository.get("vector_chunks", []) or []:
        if isinstance(vc, dict) and isinstance(vc.get("file_path"), str):
            vector_chunks_by_file[vc["file_path"]].append(vc)

    for file_path, _, reason in selected:
        source_file = _safe_repository_file(root, file_path)
        if source_file is None:
            continue
        try:
            lines = source_file.read_text(encoding="utf-8").splitlines()
        except (OSError, UnicodeError):
            continue
        if not lines:
            continue

        symbols = sorted(
            metadata[file_path]["symbols"],
            key=lambda symbol: (symbol.get("start_line", 1), symbol.get("name", "")),
        )
        ranges: list[tuple[int, int, str]] = []
        seen_ranges: set[tuple[int, int]] = set()

        # Prioritize symbol ranges referenced by pgvector top hits first
        vc_hits = vector_chunks_by_file.get(file_path, [])
        if vc_hits:
            for vc in vc_hits[:4]:
                start = max(1, int(vc.get("start_line", 1)))
                end = min(len(lines), int(vc.get("end_line", start)), start + max_lines_per_symbol - 1)
                if end >= start and (start, end) not in seen_ranges:
                    seen_ranges.add((start, end))
                    ranges.append((start, end, str(vc.get("symbol_name") or "")))

        if symbols:
            first_symbol_start = max(1, int(symbols[0].get("start_line", 1)))
            if first_symbol_start > 1:
                prologue_end = min(first_symbol_start - 1, 50)
                if (1, prologue_end) not in seen_ranges:
                    seen_ranges.add((1, prologue_end))
                    ranges.insert(0, (1, prologue_end, "file prologue"))
            for symbol in symbols[:max_symbols_per_file]:
                start = max(1, int(symbol.get("start_line", 1)))
                end = min(len(lines), int(symbol.get("end_line", start)), start + max_lines_per_symbol - 1)
                if end >= start and (start, end) not in seen_ranges:
                    seen_ranges.add((start, end))
                    ranges.append((start, end, str(symbol.get("name", ""))))
        elif not ranges:
            ranges.append((1, min(len(lines), 140), ""))

        for start, end, symbol_name in ranges:
            content = "\n".join(f"{number}: {lines[number - 1]}" for number in range(start, end + 1))
            estimated_tokens = _estimate_tokens(content)
            if estimated_tokens > remaining:
                if remaining < 120:
                    return chunks, token_budget - remaining
                # Trim cleanly on line boundary
                kept_lines: list[str] = []
                running_tokens = 0
                for line in content.splitlines():
                    line_tokens = _estimate_tokens(line + "\n")
                    if running_tokens + line_tokens > remaining:
                        break
                    kept_lines.append(line)
                    running_tokens += line_tokens
                if not kept_lines:
                    return chunks, token_budget - remaining
                content = "\n".join(kept_lines)
                end = start + len(kept_lines) - 1
                estimated_tokens = max(1, running_tokens)
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
    max_files: int = 14,
    scope_filter: str = "all",
) -> tuple[dict[str, Any], dict[str, Any]]:
    query = " ".join([user_idea or "", category, *constraints])
    query_tokens = _token_list(query)
    remaining = token_budget
    context_repositories: list[dict[str, Any]] = []
    manifest_repositories: list[dict[str, Any]] = []
    used_vector_search = False

    for repository in repositories:
        report = repository["report"]
        summary = repository["summary"]
        vector_scores_by_file: dict[str, float] = {}
        for vc in repository.get("vector_chunks", []) or []:
            if isinstance(vc, dict) and isinstance(vc.get("file_path"), str):
                used_vector_search = True
                sim = float(vc.get("similarity", 0.0) or 0.0)
                vector_scores_by_file[vc["file_path"]] = max(
                    vector_scores_by_file.get(vc["file_path"], 0.0),
                    sim,
                )

        ranked_files = _rank_files(repository, query_tokens, vector_scores_by_file, scope_filter=scope_filter)
        if scope_filter == "core_library":
            core_ranked = [item for item in ranked_files if not _is_non_core_path(item[0])]
            if core_ranked:
                ranked_files = core_ranked
        chunks, used_tokens = _source_chunks(
            repository,
            ranked_files,
            remaining,
            max_files=max_files,
        )
        remaining = max(0, remaining - used_tokens)
        modules = summary.get("modules", report.get("modules", []))
        if scope_filter == "core_library":
            core_modules = [
                m for m in modules
                if isinstance(m, dict) and m.get("scope", "core_library") == "core_library"
                and not _is_non_core_path(str(m.get("path", "")))
            ]
            if core_modules:
                modules = core_modules
        core_public_apis = list(dict.fromkeys(
            str(sym.get("name", "")).strip()
            for sym in sorted(
                (s for s in report.get("symbols", []) if isinstance(s, dict)),
                key=lambda s: not bool(s.get("exported")),
            )
            if isinstance(sym.get("file_path"), str)
            and (scope_filter != "core_library" or not _is_non_core_path(sym["file_path"]))
            and str(sym.get("name", "")).strip()
        ))[:250]
        context_repositories.append({
            "repository": repository.get("repository_name", ""),
            "repository_id": repository["repository_id"],
            "snapshot_id": repository["snapshot_id"],
            "analysis_id": repository["analysis_id"],
            "commit_sha": repository["commit_sha"],
            "summary": {
                **{
                    key: summary.get(key)
                    for key in (
                        "language",
                        "frameworks",
                        "database",
                        "orm",
                        "build_commands",
                        "test_commands",
                        "features",
                        "ai_repository_overview",
                        "ai_architecture_highlights",
                        "scope_breakdown",
                    )
                    if summary.get(key) is not None
                },
                **({"core_public_apis": core_public_apis} if core_public_apis else {}),
                **(
                    {
                        "ai_existing_features": [
                            {
                                "name": f.get("name"),
                                "category": f.get("category"),
                                "description": f.get("description"),
                                "evidence_files": f.get("evidence_files", []),
                            }
                            for f in (summary.get("ai_existing_features") or [])[:18]
                            if isinstance(f, dict)
                        ]
                    }
                    if summary.get("ai_existing_features")
                    else {}
                ),
                **(
                    {
                        "ai_feature_inventory": [
                            {
                                "feature": item.get("feature"),
                                "category": item.get("category"),
                                "status": item.get("status"),
                                "public_apis": item.get("public_apis", []),
                                "capabilities": item.get("capabilities", []),
                                "limitations": item.get("limitations", []),
                            }
                            for item in (summary.get("ai_feature_inventory") or [])[:25]
                            if isinstance(item, dict)
                        ]
                    }
                    if summary.get("ai_feature_inventory")
                    else {}
                ),
            },
            "modules": [
                {"name": module.get("name"), "path": module.get("path"), "scope": module.get("scope", "core_library")}
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
    strategies = ["keyword", "structure", "static_graph"]
    if used_vector_search:
        strategies.insert(0, "pgvector")
    context_package = {
        "repositories": context_repositories,
        "estimated_tokens": estimated_tokens,
    }
    manifest = {
        "repositories": manifest_repositories,
        "retrieval_strategies": strategies,
        "estimated_tokens": estimated_tokens,
        "token_budget": token_budget,
    }
    return context_package, manifest
