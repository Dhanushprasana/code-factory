from __future__ import annotations

import json
import os
import re
from pathlib import Path
from typing import Any

from fastapi import HTTPException
import httpx


DEFAULT_NEMOTRON_MODEL = "nvidia/nemotron-3.5-super-vl:free"
DEFAULT_OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1"
MAX_MANIFEST_FILES = 8
MAX_README_CHARS = 4000


def _find_readmes(root: Path) -> str:
    candidates = ["README.md", "readme.md", "README", "ReadMe.md"]
    for name in candidates:
        candidate = root / name
        if candidate.is_file():
            try:
                content = candidate.read_text(encoding="utf-8", errors="replace")
                return content[:MAX_README_CHARS]
            except Exception:
                continue
    return ""


def _find_manifests(root: Path) -> dict[str, str]:
    manifest_names = {
        "package.json",
        "pnpm-workspace.yaml",
        "pyproject.toml",
        "Cargo.toml",
        "go.mod",
        "pom.xml",
        "build.gradle",
        "docker-compose.yml",
        "docker-compose.yaml",
        "Dockerfile",
    }
    found: dict[str, str] = {}
    
    # Check root first
    for name in manifest_names:
        file_path = root / name
        if file_path.is_file():
            try:
                found[name] = file_path.read_text(encoding="utf-8", errors="replace")[:1500]
            except Exception:
                pass

    # Check immediate subdirectories (e.g. apps/backend/package.json)
    if len(found) < MAX_MANIFEST_FILES:
        try:
            for sub_dir in sorted(root.iterdir()):
                if sub_dir.is_dir() and sub_dir.name not in {".git", "node_modules", "dist", "build", ".venv", "__pycache__"}:
                    for name in manifest_names:
                        sub_file = sub_dir / name
                        if sub_file.is_file():
                            rel_key = f"{sub_dir.name}/{name}"
                            try:
                                found[rel_key] = sub_file.read_text(encoding="utf-8", errors="replace")[:1200]
                            except Exception:
                                pass
                        if len(found) >= MAX_MANIFEST_FILES:
                            break
        except Exception:
            pass

    return found


def _clean_markdown_response(text: str) -> str:
    stripped = text.strip()
    # If the LLM wrapped the entire response in ```markdown ... ```, unwrap it cleanly
    if stripped.startswith("```markdown") and stripped.endswith("```"):
        stripped = stripped[len("```markdown"): -3].strip()
    elif stripped.startswith("```md") and stripped.endswith("```"):
        stripped = stripped[len("```md"): -3].strip()
    elif stripped.startswith("```") and stripped.endswith("```"):
        stripped = stripped[3:-3].strip()
    return stripped


async def generate_repository_context_markdown(
    repository_path: str,
    summary: dict[str, Any] | None = None,
    report: dict[str, Any] | None = None,
    model: str = DEFAULT_NEMOTRON_MODEL,
    api_key: str | None = None,
    base_url: str = DEFAULT_OPENROUTER_BASE_URL,
) -> dict[str, Any]:
    summary = summary or {}
    report = report or {}
    root = Path(repository_path).resolve()

    if not api_key:
        api_key = os.getenv("OPENROUTER_API_KEY", "").strip()
    if not api_key:
        raise HTTPException(
            status_code=503,
            detail="OpenRouter requires OPENROUTER_API_KEY. Configure it in apps/backend/.env.",
        )

    # 1. Harvest grounded repository evidence
    readme_snippet = _find_readmes(root)
    manifests = _find_manifests(root)

    # 2. Extract structured analysis facts
    frameworks = summary.get("frameworks", [])
    databases = summary.get("database", [])
    orms = summary.get("orm", [])
    languages = summary.get("languages", [])
    api_routes = summary.get("api_routes", []) or report.get("api_routes", [])
    database_entities = summary.get("database_entities", []) or report.get("database_entities", [])
    features = report.get("features", []) or []
    dependencies = report.get("dependencies", []) or []
    tests_summary = report.get("tests", {})

    # Compact lists for prompt
    routes_sample = [
        f"{r.get('method', 'GET')} {r.get('path', '')} (in {r.get('file_path', '')})"
        for r in api_routes[:35]
        if isinstance(r, dict)
    ]
    entities_sample = [
        f"{e.get('name', '')} (in {e.get('file_path', '')})"
        for e in database_entities[:30]
        if isinstance(e, dict)
    ]
    features_sample = [
        f"- {f.get('name', 'Feature')}: {f.get('description', '')} (paths: {', '.join(f.get('paths', [])[:3])})"
        for f in features[:15]
        if isinstance(f, dict)
    ]
    deps_sample = [
        f"{d.get('name', '')}@{d.get('version', '')}"
        for d in dependencies[:40]
        if isinstance(d, dict)
    ]

    manifest_snippets = "\n\n".join(
        f"--- File: {fname} ---\n{content}" for fname, content in manifests.items()
    )

    # 3. Formulate the Principal Software Architect prompt
    prompt = f"""You are a Principal Software Architect and Technical Writer analyzing a repository.
Your task is to synthesize all grounded static analysis signals, manifests, and documentation into a comprehensive, production-grade `REPO_CONTEXT.md` markdown file.

The target document must be rich, concrete, well-structured, and provide an immediate, deep understanding of the repository for engineers and AI coding agents.

### GROUNDED REPOSITORY EVIDENCE:
- Root directory: {root.name}
- Total files scanned: {summary.get('file_count', 'unknown')} (source files parsed: {summary.get('analyzed_source_file_count', 'unknown')})
- Detected languages: {', '.join(languages) if languages else 'Not detected'}
- Detected frameworks: {', '.join(frameworks) if frameworks else 'None detected'}
- Detected databases: {', '.join(databases) if databases else 'None'}
- Detected ORM: {', '.join(orms) if orms else 'None'}
- Key dependencies sample: {', '.join(deps_sample[:25])}
- Test framework info: {json.dumps(tests_summary)}

### DETECTED ROUTES / ENDPOINTS ({len(api_routes)} total):
{chr(10).join(routes_sample) if routes_sample else "No HTTP routes detected."}

### DETECTED DATA MODELS & ENTITIES ({len(database_entities)} total):
{chr(10).join(entities_sample) if entities_sample else "No database entities detected."}

### DETECTED CODE FEATURE AREAS:
{chr(10).join(features_sample) if features_sample else "None detected explicitly."}

### MANIFEST SAMPLES:
{manifest_snippets if manifest_snippets else "No manifest files found."}

### EXISTING README CONTENT (EXCERPT):
{readme_snippet if readme_snippet else "No existing README found."}

---

### INSTRUCTIONS FOR THE MARKDOWN OUTPUT:
Produce an exhaustive markdown document with the following specific sections:

# Repository Context: {root.name}

## 1. Executive Summary & Purpose
Explain clearly what this repository does, who it is for, and the primary business/domain problem it solves.

## 2. Tech Stack & Ecosystem Matrix
Present a clear Markdown table detailing the Tech Stack:
- Core Languages & Runtime
- Web & API Frameworks
- Database & Persistence
- Asynchronous Queues / Background Jobs
- AI / LLM Integrations
- Testing & Tooling

## 3. High-Level Architecture & System Design
- Describe the architectural style (e.g. Monorepo, Clean Architecture, Layered, Microservices).
- Provide a clear Mermaid graph diagram (`flowchart TD` or `graph TD`) depicting the core services, data stores, external APIs, and client interfaces.

## 4. Feature Inventory & Functional Breakdown
Group all capabilities into coherent functional modules (e.g., Ingestion, Analysis Engine, Task Generation, Storage, Web UI).
For EACH feature, include:
- **Capabilities & Purpose**: What it does.
- **Key Modules & Source Files**: Point to specific file paths detected above.
- **Interfaces**: Endpoints, events, or CLI commands.

## 5. Core Data Models & Schemas
Detail the data entities and schemas discovered, their relationships, and how persistence is structured.

## 6. Key Entry Points & Execution Flows
- HTTP API Controllers & Routes
- Background Worker Jobs & Queues
- CLI Scripts & Development Commands

## 7. Environment, Setup & Development Commands
List environment variables required and shell commands to install, build, test, and run the service.

Ensure the markdown is crisp, formatted with standard GitHub-flavored Markdown, with no placeholders or generic filler text.
Write the Markdown directly now:"""

    headers = {
        "content-type": "application/json",
        "authorization": f"Bearer {api_key}",
    }

    try:
        async with httpx.AsyncClient(
            timeout=httpx.Timeout(180.0, connect=15.0),
        ) as client:
            response = await client.post(
                f"{base_url.rstrip('/')}/chat/completions",
                headers=headers,
                json={
                    "model": model,
                    "max_tokens": 6144,
                    "temperature": 0.2,
                    "messages": [{"role": "user", "content": prompt}],
                },
            )
    except httpx.TimeoutException as error:
        raise HTTPException(
            status_code=504,
            detail=f"OpenRouter context generation timed out ({model}).",
        ) from error
    except httpx.RequestError as error:
        raise HTTPException(
            status_code=502,
            detail="Could not connect to OpenRouter for context generation.",
        ) from error

    if response.status_code in {401, 403}:
        raise HTTPException(
            status_code=503,
            detail="OpenRouter rejected the configured API key. Check OPENROUTER_API_KEY in apps/backend/.env.",
        )
    if response.status_code == 429:
        raise HTTPException(
            status_code=503,
            detail="OpenRouter rate limit or usage quota reached. Check OpenRouter account.",
        )
    if not response.is_success:
        detail = response.text[:300]
        raise HTTPException(
            status_code=502,
            detail=f"OpenRouter returned HTTP {response.status_code}: {detail}",
        )

    data = response.json()
    choices = data.get("choices", [])
    if not choices:
        raise HTTPException(
            status_code=502,
            detail="OpenRouter returned an empty choices array.",
        )

    raw_content = choices[0].get("message", {}).get("content", "")
    if not raw_content:
        raise HTTPException(
            status_code=502,
            detail="OpenRouter returned empty message content.",
        )

    cleaned_markdown = _clean_markdown_response(raw_content)
    usage = data.get("usage", {})

    return {
        "context_markdown": cleaned_markdown,
        "model": model,
        "tokens_used": usage.get("total_tokens", None),
    }
