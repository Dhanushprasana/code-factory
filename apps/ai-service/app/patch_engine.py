from __future__ import annotations

import difflib
import os
import re
import shutil
from pathlib import Path, PurePosixPath
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field


DEFAULT_MAX_SOURCE_FILE_CHARS = 100_000
DEFAULT_MAX_SOURCE_TOTAL_CHARS = 250_000
BUILD_ARTIFACT_DIRS = {
    ".git", ".hg", ".svn", ".next", ".nuxt", ".output", ".parcel-cache",
    ".svelte-kit", ".turbo", ".venv", ".cache", "__pycache__", "build",
    "coverage", "deno", "dist", "generated", "node_modules", "out",
    "target", "vendor", "venv",
}
BUILD_ARTIFACT_SUFFIXES = (".d.ts", ".min.js", ".min.css", ".bundle.js", ".map")


class FileModification(BaseModel):
    model_config = ConfigDict(extra="forbid")

    repository_id: str = Field(min_length=1, max_length=128)
    file_path: str = Field(min_length=1, max_length=500)
    operation: Literal["replace", "insert", "create", "delete"]
    description: str = Field(min_length=1, max_length=1000)
    search: str | None = Field(default=None, max_length=100_000)
    replace: str | None = Field(default=None, max_length=100_000)
    position: Literal["before", "after"] = "after"


def is_safe_relative_path(value: str) -> bool:
    if not value or "\\" in value or "\x00" in value or ":" in value:
        return False
    if value.startswith("/"):
        return False
    path = PurePosixPath(value)
    return (
        not path.is_absolute()
        and bool(path.parts)
        and all(part not in {"", ".", ".."} for part in path.parts)
    )


def is_build_artifact_path(path: str) -> bool:
    parts = PurePosixPath(path).parts
    if any(part in BUILD_ARTIFACT_DIRS for part in parts[:-1]):
        return True
    return path.lower().endswith(BUILD_ARTIFACT_SUFFIXES)


def is_sensitive_source_path(path: str) -> bool:
    name = PurePosixPath(path).name.casefold()
    return (
        (name.startswith(".env") and name not in {".env.example", ".env.sample", ".env.template"})
        or name in {"id_rsa", "id_ed25519", "credentials", "secrets"}
        or name.endswith((".pem", ".key", ".p12", ".pfx"))
    )


def resolve_repo_file(repository_path: str, relative_path: str) -> tuple[Path | None, str]:
    """Resolve a relative path inside repository_path without following symlinks outside root."""
    if not is_safe_relative_path(relative_path):
        return None, "unsafe_path"
    if is_sensitive_source_path(relative_path):
        return None, "sensitive_path"
    root = Path(repository_path).resolve()
    parts = PurePosixPath(relative_path).parts
    current = root
    for part in parts:
        current = current / part
        if current.is_symlink():
            return None, "symlink"
    resolved = current.resolve(strict=False)
    if not resolved.is_relative_to(root):
        return None, "outside_repository"
    return resolved, "ok"


def validate_target_files(
    target_files: list[str],
    repositories: list[dict[str, Any]],
) -> tuple[list[str], list[dict[str, str]]]:
    """Validate that every target_file is a safe relative path existing in at least one repository."""
    valid_paths: list[str] = []
    errors: list[dict[str, str]] = []
    seen: set[str] = set()

    for raw_path in target_files:
        file_path = raw_path.strip()
        if not file_path or file_path in seen:
            continue
        seen.add(file_path)

        if not is_safe_relative_path(file_path):
            errors.append({
                "file_path": file_path,
                "code": "unsafe_path",
                "message": f"Target path '{file_path}' is not a safe relative path inside the repository.",
            })
            continue
        if is_sensitive_source_path(file_path):
            errors.append({
                "file_path": file_path,
                "code": "sensitive_path",
                "message": f"Target path '{file_path}' is a sensitive file and cannot be accessed.",
            })
            continue
        if is_build_artifact_path(file_path):
            errors.append({
                "file_path": file_path,
                "code": "build_artifact_path",
                "message": f"Target path '{file_path}' is inside a build/generated directory and cannot be modified.",
            })
            continue

        found_in_repo = False
        for repo in repositories:
            repo_path = repo.get("repository_path")
            if not isinstance(repo_path, str):
                continue
            resolved, status = resolve_repo_file(repo_path, file_path)
            if status == "ok" and resolved is not None and resolved.is_file():
                found_in_repo = True
                break

        if not found_in_repo:
            errors.append({
                "file_path": file_path,
                "code": "not_found",
                "message": f"Target file '{file_path}' does not exist in the checked-out repository.",
            })
            continue
        valid_paths.append(file_path)

    return valid_paths, errors


def load_target_sources(
    repositories: list[dict[str, Any]],
    target_files: list[str],
    max_file_chars: int | None = None,
    max_total_chars: int | None = None,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """
    Retrieve exact, unmodified UTF-8 contents of target_files from the repository checkouts.
    Never normalizes quotes, whitespace, or line endings, and never silently truncates.
    """
    file_limit = max_file_chars or int(os.getenv("REFERENCE_SOURCE_FILE_LIMIT", str(DEFAULT_MAX_SOURCE_FILE_CHARS)))
    total_limit = max_total_chars or int(os.getenv("REFERENCE_SOURCE_TOTAL_LIMIT", str(DEFAULT_MAX_SOURCE_TOTAL_CHARS)))

    loaded: list[dict[str, Any]] = []
    excluded: list[dict[str, Any]] = []
    total_chars = 0
    seen_pairs: set[tuple[str, str]] = set()

    for file_path in target_files:
        for repo in repositories:
            repo_id = str(repo.get("repository_id", ""))
            repo_path = repo.get("repository_path")
            if not repo_id or not isinstance(repo_path, str):
                continue
            if (repo_id, file_path) in seen_pairs:
                continue
            resolved, status = resolve_repo_file(repo_path, file_path)
            if status != "ok" or resolved is None:
                excluded.append({
                    "repository_id": repo_id,
                    "file_path": file_path,
                    "status": status,
                })
                continue
            if not resolved.is_file():
                continue
            seen_pairs.add((repo_id, file_path))

            try:
                raw_bytes = resolved.read_bytes()
                content = raw_bytes.decode("utf-8")
            except (OSError, UnicodeDecodeError):
                excluded.append({
                    "repository_id": repo_id,
                    "file_path": file_path,
                    "status": "excluded_binary_or_unreadable",
                })
                continue

            if len(content) > file_limit:
                excluded.append({
                    "repository_id": repo_id,
                    "file_path": file_path,
                    "status": "excluded_file_too_large",
                    "char_count": len(content),
                    "limit": file_limit,
                })
                continue
            if total_chars + len(content) > total_limit:
                excluded.append({
                    "repository_id": repo_id,
                    "file_path": file_path,
                    "status": "excluded_context_budget",
                    "char_count": len(content),
                    "limit": total_limit,
                })
                continue

            total_chars += len(content)
            loaded.append({
                "repository_id": repo_id,
                "file_path": file_path,
                "content": content,
                "char_count": len(content),
                "line_count": len(content.splitlines()),
                "status": "complete",
            })

    return loaded, excluded


def _build_unified_diff(
    file_path: str,
    old_content: str,
    new_content: str,
    operation: str,
) -> str:
    if old_content == new_content and operation not in {"create", "delete"}:
        return ""
    old_lines = old_content.splitlines(keepends=True)
    new_lines = new_content.splitlines(keepends=True)
    if old_content and old_lines and not old_lines[-1].endswith(("\n", "\r")):
        old_lines[-1] += "\n"
    if new_content and new_lines and not new_lines[-1].endswith(("\n", "\r")):
        new_lines[-1] += "\n"
    from_path = "/dev/null" if operation == "create" else f"a/{file_path}"
    to_path = "/dev/null" if operation == "delete" else f"b/{file_path}"
    diff_lines = list(difflib.unified_diff(
        old_lines,
        new_lines,
        fromfile=from_path,
        tofile=to_path,
        n=3,
    ))
    if not diff_lines:
        return ""
    header = f"diff --git a/{file_path} b/{file_path}\n"
    if operation == "create":
        header += "new file mode 100644\n"
    elif operation == "delete":
        header += "deleted file mode 100644\n"
    return header + "".join(diff_lines)


def _spans_overlap(a_start: int, a_end: int, b_start: int, b_end: int) -> bool:
    return a_start < b_end and b_start < a_end


def _adapt_line_endings(text: str, target_content: str) -> str:
    if "\r\n" in target_content:
        return text.replace("\r\n", "\n").replace("\n", "\r\n")
    return text.replace("\r\n", "\n")


def _normalize_quotes_and_ws_with_map(text: str) -> tuple[str, list[int]]:
    """
    Collapse whitespace runs to a single space and unify ' / " to " while
    recording each normalized character's original index in `text`.
    """
    norm_chars: list[str] = []
    orig_indices: list[int] = []
    in_ws = False
    for idx, ch in enumerate(text):
        if ch.isspace():
            if norm_chars and not in_ws:
                norm_chars.append(" ")
                orig_indices.append(idx)
            in_ws = True
        else:
            in_ws = False
            norm_chars.append('"' if ch == "'" else ch)
            orig_indices.append(idx)
    if norm_chars and norm_chars[-1] == " ":
        norm_chars.pop()
        orig_indices.pop()
    return "".join(norm_chars), orig_indices


def _resolve_unique_search_span(
    content: str,
    search: str,
) -> tuple[int, int, str] | tuple[None, None, str]:
    """
    Resolve `search` to a unique (start, end) span in `content`.
    1. Exact match (count == 1).
    2. Deterministic line-ending adaptation (\r\n <-> \n) if unique.
    3. Deterministic quote/whitespace-normalized match ONLY if it maps to a single unique span.
    Returns (start, end, mode) or (None, None, error_code).
    """
    exact_count = content.count(search)
    if exact_count == 1:
        idx = content.index(search)
        return idx, idx + len(search), "exact"
    if exact_count > 1:
        return None, None, "ambiguous_search_match"

    adapted = _adapt_line_endings(search, content)
    if adapted != search:
        adapted_count = content.count(adapted)
        if adapted_count == 1:
            idx = content.index(adapted)
            return idx, idx + len(adapted), "line_endings"
        if adapted_count > 1:
            return None, None, "ambiguous_search_match"

    norm_search = re.sub(r"\s+", " ", search.strip()).replace("'", '"')
    if not norm_search:
        return None, None, "search_not_found"
    norm_content, orig_indices = _normalize_quotes_and_ws_with_map(content)
    norm_count = norm_content.count(norm_search)
    if norm_count == 1:
        n_start = norm_content.index(norm_search)
        n_end = n_start + len(norm_search) - 1
        return orig_indices[n_start], orig_indices[n_end] + 1, "canonical_quotes_ws"
    if norm_count > 1:
        return None, None, "ambiguous_search_match"
    return None, None, "search_not_found"


def validate_and_apply_modifications(
    repositories: list[dict[str, Any]],
    modifications: list[FileModification],
) -> dict[str, Any]:
    """
    Deterministically validate modifications against actual repository files in memory
    (never mutating the original checkout) and compute resulting file contents + unified diffs.
    """
    repo_map = {
        str(repo["repository_id"]): str(repo["repository_path"])
        for repo in repositories
        if isinstance(repo.get("repository_id"), str) and isinstance(repo.get("repository_path"), str)
    }

    errors: list[dict[str, Any]] = []
    # Track in-memory file states: (repo_id, file_path) -> str | None (None means deleted or non-existent)
    original_files: dict[tuple[str, str], str | None] = {}
    working_files: dict[tuple[str, str], str | None] = {}
    # Track original-content spans touched per file to detect overlapping modifications
    touched_original_spans: dict[tuple[str, str], list[tuple[int, int, int]]] = {}
    file_operations: dict[tuple[str, str], str] = {}
    resolved_modifications: list[dict[str, Any]] = []

    def _ensure_loaded(repo_id: str, file_path: str) -> tuple[bool, str | None]:
        key = (repo_id, file_path)
        if key in working_files:
            return True, None
        repo_path = repo_map.get(repo_id)
        if not repo_path:
            return False, "unknown_repository"
        resolved, status = resolve_repo_file(repo_path, file_path)
        if status != "ok" or resolved is None:
            return False, status
        if resolved.is_file():
            try:
                content = resolved.read_bytes().decode("utf-8")
            except (OSError, UnicodeDecodeError):
                return False, "unreadable_file"
            original_files[key] = content
            working_files[key] = content
        else:
            original_files[key] = None
            working_files[key] = None
        return True, None

    for index, mod in enumerate(modifications):
        if mod.repository_id not in repo_map:
            errors.append({
                "index": index,
                "repository_id": mod.repository_id,
                "file_path": mod.file_path,
                "operation": mod.operation,
                "code": "unknown_repository",
                "message": f"Unknown repository_id '{mod.repository_id}'.",
            })
            continue

        loaded_ok, load_err = _ensure_loaded(mod.repository_id, mod.file_path)
        if not loaded_ok:
            errors.append({
                "index": index,
                "repository_id": mod.repository_id,
                "file_path": mod.file_path,
                "operation": mod.operation,
                "code": load_err or "invalid_path",
                "message": f"File '{mod.file_path}' failed path validation ({load_err}).",
            })
            continue

        key = (mod.repository_id, mod.file_path)
        current = working_files[key]
        original = original_files[key]

        if mod.operation == "create":
            if current is not None:
                errors.append({
                    "index": index,
                    "repository_id": mod.repository_id,
                    "file_path": mod.file_path,
                    "operation": mod.operation,
                    "code": "file_already_exists",
                    "message": f"Cannot create '{mod.file_path}' because it already exists.",
                })
                continue
            if mod.replace is None:
                errors.append({
                    "index": index,
                    "repository_id": mod.repository_id,
                    "file_path": mod.file_path,
                    "operation": mod.operation,
                    "code": "missing_content",
                    "message": f"Create operation for '{mod.file_path}' requires 'replace' content.",
                })
                continue
            working_files[key] = mod.replace
            file_operations[key] = "create"
            resolved_modifications.append(mod.model_dump())
            continue

        if mod.operation == "delete":
            if current is None:
                errors.append({
                    "index": index,
                    "repository_id": mod.repository_id,
                    "file_path": mod.file_path,
                    "operation": mod.operation,
                    "code": "file_not_found",
                    "message": f"Cannot delete '{mod.file_path}' because it does not exist.",
                })
                continue
            working_files[key] = None
            file_operations[key] = "delete"
            resolved_modifications.append(mod.model_dump())
            continue

        # replace or insert
        if current is None:
            errors.append({
                "index": index,
                "repository_id": mod.repository_id,
                "file_path": mod.file_path,
                "operation": mod.operation,
                "code": "file_not_found",
                "message": f"Target file '{mod.file_path}' does not exist.",
            })
            continue

        if not mod.search:
            errors.append({
                "index": index,
                "repository_id": mod.repository_id,
                "file_path": mod.file_path,
                "operation": mod.operation,
                "code": "missing_search",
                "message": f"Operation '{mod.operation}' on '{mod.file_path}' requires a non-empty 'search' block.",
            })
            continue

        if mod.replace is None:
            errors.append({
                "index": index,
                "repository_id": mod.repository_id,
                "file_path": mod.file_path,
                "operation": mod.operation,
                "code": "missing_replace",
                "message": f"Operation '{mod.operation}' on '{mod.file_path}' requires 'replace' content.",
            })
            continue

        # Check overlap against original content if the file existed originally
        if original is not None:
            orig_start, orig_end, _ = _resolve_unique_search_span(original, mod.search)
            if orig_start is not None and orig_end is not None:
                spans = touched_original_spans.setdefault(key, [])
                overlapping = next(
                    (prev_idx for prev_start, prev_end, prev_idx in spans if _spans_overlap(orig_start, orig_end, prev_start, prev_end)),
                    None,
                )
                if overlapping is not None:
                    errors.append({
                        "index": index,
                        "repository_id": mod.repository_id,
                        "file_path": mod.file_path,
                        "operation": mod.operation,
                        "description": mod.description,
                        "code": "overlapping_modification",
                        "message": (
                            f"Modification {index} on '{mod.file_path}' overlaps with "
                            f"earlier modification {overlapping}."
                        ),
                        "search": mod.search,
                        "replace": mod.replace,
                        "actual_content": current,
                    })
                    continue
                spans.append((orig_start, orig_end, index))

        idx, end_idx, match_mode = _resolve_unique_search_span(current, mod.search)
        if idx is None or end_idx is None:
            if match_mode == "ambiguous_search_match":
                errors.append({
                    "index": index,
                    "repository_id": mod.repository_id,
                    "file_path": mod.file_path,
                    "operation": mod.operation,
                    "description": mod.description,
                    "code": "ambiguous_search_match",
                    "message": (
                        f"Search block in '{mod.file_path}' matched multiple locations; "
                        "include more surrounding context so it matches exactly once."
                    ),
                    "search": mod.search,
                    "replace": mod.replace,
                    "actual_content": current,
                })
            else:
                errors.append({
                    "index": index,
                    "repository_id": mod.repository_id,
                    "file_path": mod.file_path,
                    "operation": mod.operation,
                    "description": mod.description,
                    "code": "search_not_found",
                    "message": (
                        f"Exact search block not found in '{mod.file_path}'. "
                        "Ensure quotes, indentation, and line endings match the actual source."
                    ),
                    "search": mod.search,
                    "replace": mod.replace,
                    "actual_content": current,
                })
            continue

        actual_search = current[idx:end_idx]
        adapted_replace = _adapt_line_endings(mod.replace, current)
        if mod.operation == "replace":
            updated = current[:idx] + adapted_replace + current[end_idx:]
        else:
            if mod.position == "before":
                updated = current[:idx] + adapted_replace + current[idx:]
            else:
                updated = current[:end_idx] + adapted_replace + current[end_idx:]

        working_files[key] = updated
        if key not in file_operations:
            file_operations[key] = mod.operation
        mod_dict = mod.model_dump()
        mod_dict["search"] = actual_search
        mod_dict["replace"] = adapted_replace
        if match_mode != "exact":
            mod_dict["canonicalized_from"] = match_mode
        resolved_modifications.append(mod_dict)

    if errors:
        return {
            "valid": False,
            "errors": errors,
            "file_changes": [],
            "patches": [],
        }

    file_changes: list[dict[str, Any]] = []
    diffs_by_repo: dict[str, list[str]] = {}
    for key in working_files:
        repo_id, file_path = key
        orig_text = original_files[key] or ""
        new_text = working_files[key] or ""
        op = file_operations.get(key, "replace")
        if original_files[key] is None and working_files[key] is not None:
            op = "create"
        elif original_files[key] is not None and working_files[key] is None:
            op = "delete"
        diff = _build_unified_diff(file_path, orig_text, new_text, op)
        if not diff and op not in {"create", "delete"}:
            continue
        file_changes.append({
            "repository_id": repo_id,
            "file_path": file_path,
            "operation": op,
            "original_content": orig_text,
            "modified_content": new_text,
        })
        if diff:
            diffs_by_repo.setdefault(repo_id, []).append(diff)

    patches = [
        {"repository_id": repo_id, "patch_diff": "".join(diffs)}
        for repo_id, diffs in diffs_by_repo.items()
        if diffs
    ]
    return {
        "valid": True,
        "errors": [],
        "modifications": resolved_modifications,
        "file_changes": file_changes,
        "patches": patches,
    }


def apply_changes_to_isolated_workspace(
    repository_path: str,
    workspace_dir: str,
    file_changes: list[dict[str, Any]],
    repository_id: str | None = None,
) -> Path:
    """Copy repository_path to an isolated workspace_dir and apply validated file_changes."""
    src = Path(repository_path).resolve()
    dst = Path(workspace_dir).resolve()
    if dst.exists():
        shutil.rmtree(dst)
    shutil.copytree(
        src,
        dst,
        ignore=shutil.ignore_patterns(".git", "node_modules", ".venv", "venv", "__pycache__", "dist", "build"),
        symlinks=False,
    )
    for change in file_changes:
        if repository_id and change.get("repository_id") != repository_id:
            continue
        rel_path = change["file_path"]
        if not is_safe_relative_path(rel_path):
            raise ValueError(f"Unsafe file path: {rel_path}")
        target = (dst / PurePosixPath(rel_path)).resolve()
        if not target.is_relative_to(dst):
            raise ValueError(f"Path escapes workspace: {rel_path}")
        op = change["operation"]
        if op == "delete":
            if target.exists():
                target.unlink()
        else:
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(change["modified_content"].encode("utf-8"))
    return dst
