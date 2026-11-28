from __future__ import annotations

import hashlib
import math
import os
import re
from typing import Iterable

import httpx

DEFAULT_LOCAL_DIM = 384
MAX_EMBED_TEXT_CHARS = 6000


def _env_setting(name: str, default: str = "") -> str:
    return os.getenv(name, "").strip() or default


def _subword_tokens(text: str) -> list[str]:
    raw_tokens = re.findall(r"[A-Za-z_][A-Za-z0-9_]*|[0-9]+", text)
    tokens: list[str] = []
    for token in raw_tokens:
        lowered = token.lower()
        tokens.append(lowered)
        # Split camelCase / PascalCase / snake_case into subwords for semantic matching
        parts = re.findall(r"[A-Z]?[a-z]+|[A-Z]+(?=[A-Z]|$)|[0-9]+", token)
        for part in parts:
            sub = part.lower()
            if len(sub) >= 2 and sub != lowered:
                tokens.append(sub)
        if "_" in lowered:
            for part in lowered.split("_"):
                if len(part) >= 2:
                    tokens.append(part)
    return tokens


def local_hash_embedding(text: str, dim: int = DEFAULT_LOCAL_DIM) -> list[float]:
    """Deterministic unit-normalized feature-hashed dense embedding for offline/fallback vector search."""
    vector = [0.0] * dim
    tokens = _subword_tokens(text[:MAX_EMBED_TEXT_CHARS])
    if not tokens:
        vector[0] = 1.0
        return vector

    # Weight unigrams + bigrams + character 4-grams of identifiers
    features: list[tuple[str, float]] = []
    for index, token in enumerate(tokens):
        weight = 1.4 if len(token) >= 4 else 0.9
        features.append((f"w:{token}", weight))
        if index + 1 < len(tokens):
            features.append((f"b:{token}_{tokens[index + 1]}", 0.8))
        if len(token) >= 5:
            for pos in range(0, min(len(token) - 3, 12)):
                features.append((f"c:{token[pos:pos + 4]}", 0.35))

    for feature, weight in features:
        digest = hashlib.blake2b(feature.encode("utf-8"), digest_size=8).digest()
        bucket = int.from_bytes(digest[:4], "little") % dim
        sign = 1.0 if (digest[4] & 1) == 0 else -1.0
        vector[bucket] += sign * weight

    norm = math.sqrt(sum(value * value for value in vector))
    if norm <= 0.0:
        vector[0] = 1.0
        return vector
    return [round(value / norm, 6) for value in vector]


async def _fetch_remote_embeddings(
    texts: list[str],
    provider: str,
) -> tuple[list[list[float]], str]:
    if provider == "openrouter":
        api_key = _env_setting("OPENROUTER_API_KEY")
        base_url = _env_setting("OPENROUTER_BASE_URL", "https://openrouter.ai/api/v1")
        model = _env_setting("EMBEDDING_MODEL", "openai/text-embedding-3-small")
    elif provider == "openai":
        api_key = _env_setting("EMBEDDING_API_KEY") or _env_setting("OPENAI_API_KEY")
        base_url = _env_setting("EMBEDDING_BASE_URL", "https://api.openai.com/v1")
        model = _env_setting("EMBEDDING_MODEL", "text-embedding-3-small")
    elif provider == "ollama":
        api_key = ""
        base_url = _env_setting("OLLAMA_BASE_URL", "http://host.docker.internal:11434/v1")
        model = _env_setting("EMBEDDING_MODEL", "nomic-embed-text")
    else:
        raise ValueError(f"Unsupported embedding provider: {provider}")

    headers = {"content-type": "application/json"}
    if api_key:
        headers["authorization"] = f"Bearer {api_key}"

    all_vectors: list[list[float]] = []
    batch_size = 32
    async with httpx.AsyncClient(timeout=httpx.Timeout(30.0, connect=5.0)) as client:
        for start in range(0, len(texts), batch_size):
            batch = [text[:MAX_EMBED_TEXT_CHARS] or " " for text in texts[start:start + batch_size]]
            response = await client.post(
                f"{base_url.rstrip('/')}/embeddings",
                headers=headers,
                json={"model": model, "input": batch},
            )
            response.raise_for_status()
            payload = response.json()
            items = sorted(payload["data"], key=lambda item: item.get("index", 0))
            for item in items:
                embedding = [float(value) for value in item["embedding"]]
                all_vectors.append(embedding)
    return all_vectors, f"{provider}:{model}"


async def embed_texts(texts: Iterable[str]) -> tuple[list[list[float]], str, int]:
    text_list = list(texts)
    if not text_list:
        return [], "local-hash-v1", DEFAULT_LOCAL_DIM

    provider = _env_setting("EMBEDDING_PROVIDER", "").lower()
    if provider in {"openrouter", "openai", "ollama"}:
        has_credentials = (
            provider == "ollama"
            or (provider == "openrouter" and bool(_env_setting("OPENROUTER_API_KEY")))
            or (provider == "openai" and bool(_env_setting("EMBEDDING_API_KEY") or _env_setting("OPENAI_API_KEY")))
        )
        if has_credentials:
            try:
                vectors, model_id = await _fetch_remote_embeddings(text_list, provider)
                if len(vectors) == len(text_list) and vectors and vectors[0]:
                    return vectors, model_id, len(vectors[0])
            except Exception:
                pass

    vectors = [local_hash_embedding(text) for text in text_list]
    return vectors, "local-hash-v1", DEFAULT_LOCAL_DIM


def embed_texts_sync(texts: Iterable[str]) -> tuple[list[list[float]], str, int]:
    text_list = list(texts)
    if not text_list:
        return [], "local-hash-v1", DEFAULT_LOCAL_DIM
    provider = _env_setting("EMBEDDING_PROVIDER", "").lower()
    if provider in {"openrouter", "openai", "ollama"}:
        has_credentials = (
            provider == "ollama"
            or (provider == "openrouter" and bool(_env_setting("OPENROUTER_API_KEY")))
            or (provider == "openai" and bool(_env_setting("EMBEDDING_API_KEY") or _env_setting("OPENAI_API_KEY")))
        )
        if has_credentials:
            try:
                if provider == "openrouter":
                    api_key = _env_setting("OPENROUTER_API_KEY")
                    base_url = _env_setting("OPENROUTER_BASE_URL", "https://openrouter.ai/api/v1")
                    model = _env_setting("EMBEDDING_MODEL", "openai/text-embedding-3-small")
                elif provider == "openai":
                    api_key = _env_setting("EMBEDDING_API_KEY") or _env_setting("OPENAI_API_KEY")
                    base_url = _env_setting("EMBEDDING_BASE_URL", "https://api.openai.com/v1")
                    model = _env_setting("EMBEDDING_MODEL", "text-embedding-3-small")
                else:
                    api_key = ""
                    base_url = _env_setting("OLLAMA_BASE_URL", "http://host.docker.internal:11434/v1")
                    model = _env_setting("EMBEDDING_MODEL", "nomic-embed-text")
                headers = {"content-type": "application/json"}
                if api_key:
                    headers["authorization"] = f"Bearer {api_key}"
                all_vectors: list[list[float]] = []
                with httpx.Client(timeout=httpx.Timeout(30.0, connect=5.0)) as client:
                    for start in range(0, len(text_list), 32):
                        batch = [text[:MAX_EMBED_TEXT_CHARS] or " " for text in text_list[start:start + 32]]
                        response = client.post(
                            f"{base_url.rstrip('/')}/embeddings",
                            headers=headers,
                            json={"model": model, "input": batch},
                        )
                        response.raise_for_status()
                        payload = response.json()
                        items = sorted(payload["data"], key=lambda item: item.get("index", 0))
                        for item in items:
                            all_vectors.append([float(value) for value in item["embedding"]])
                if len(all_vectors) == len(text_list) and all_vectors and all_vectors[0]:
                    return all_vectors, f"{provider}:{model}", len(all_vectors[0])
            except Exception:
                pass
    vectors = [local_hash_embedding(text) for text in text_list]
    return vectors, "local-hash-v1", DEFAULT_LOCAL_DIM
