from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
import tempfile
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

app = FastAPI(title="ForgeBench Harbor Runner", version="0.1.0")
JOBS_ROOT = Path(os.getenv("HARBOR_JOBS_ROOT", "/workspace/storage/harbor-jobs"))


class RunJobRequest(BaseModel):
    job_id: str = Field(min_length=1, max_length=128)
    job_yaml: str = Field(min_length=1, max_length=100_000)
    env: dict[str, str] = Field(default_factory=dict)


def _safe_job_dir(job_id: str) -> Path:
    if not re.fullmatch(r"[a-zA-Z0-9_-]+", job_id):
        raise HTTPException(status_code=400, detail="Invalid job_id.")
    return JOBS_ROOT / job_id


def _resolve_package_repo(job_dir: Path) -> Path | None:
    meta_path = job_dir / "meta.json"
    package_id: str | None = None
    if meta_path.is_file():
        try:
            meta = json.loads(meta_path.read_text(encoding="utf-8", errors="replace"))
            if isinstance(meta.get("packageId"), str) and meta["packageId"].strip():
                package_id = meta["packageId"].strip()
        except Exception:
            pass
    if not package_id:
        yaml_path = job_dir / "job.yaml"
        if yaml_path.is_file():
            match = re.search(r"harbor-packages/([^\s]+)", yaml_path.read_text(encoding="utf-8", errors="replace"))
            if match:
                package_id = match.group(1).strip()
    if not package_id:
        return None
    repo_dir = Path(f"/workspace/storage/harbor-packages/{package_id}/environment/repo")
    return repo_dir if repo_dir.is_dir() else None


def _find_trial_container(trial_name: str) -> str | None:
    try:
        proc = subprocess.run(
            ["docker", "ps", "-a", "--format", "{{.Names}}"],
            capture_output=True,
            text=True,
            timeout=10,
        )
        if proc.returncode != 0:
            return None
        needle = trial_name.lower()
        for line in proc.stdout.splitlines():
            name = line.strip()
            if name and needle in name.lower():
                return name
    except Exception:
        return None
    return None


def _capture_trial_git_diff(job_dir: Path) -> str:
    diff_path = job_dir / "agent_diff.patch"
    if diff_path.is_file():
        existing = diff_path.read_text(encoding="utf-8", errors="replace")
        if existing.strip():
            return existing

    runs_dir = job_dir / "runs"
    if not runs_dir.is_dir():
        return ""

    baseline_repo = _resolve_package_repo(job_dir)

    for run_dir in runs_dir.iterdir():
        if not run_dir.is_dir():
            continue
        for trial_dir in run_dir.iterdir():
            if not trial_dir.is_dir():
                continue
            container_name = _find_trial_container(trial_dir.name) or f"{trial_dir.name.lower()}__env-main-1"
            try:
                proc = subprocess.run(
                    [
                        "docker", "exec", container_name, "sh", "-c",
                        (
                            "if [ -d /workspace/.git ]; then "
                            "FIRST=$(git -C /workspace rev-list --max-parents=0 HEAD 2>/dev/null | head -n 1); "
                            "if [ -n \"$FIRST\" ]; then git -C /workspace diff \"$FIRST\"; else git -C /workspace diff; fi; "
                            "fi"
                        ),
                    ],
                    capture_output=True,
                    text=True,
                    timeout=15,
                )
                if proc.returncode == 0 and proc.stdout.strip():
                    diff_path.write_text(proc.stdout, encoding="utf-8")
                    return proc.stdout
            except Exception:
                pass

            if baseline_repo is not None:
                tmp_dir = Path(tempfile.mkdtemp(prefix="harbor-diff-"))
                try:
                    ws_copy = tmp_dir / "workspace"
                    cp_proc = subprocess.run(
                        ["docker", "cp", f"{container_name}:/workspace", str(ws_copy)],
                        capture_output=True,
                        text=True,
                        timeout=30,
                    )
                    if cp_proc.returncode == 0 and ws_copy.is_dir():
                        diff_proc = subprocess.run(
                            [
                                "diff", "-ruN",
                                "--exclude=node_modules",
                                "--exclude=.git",
                                "--exclude=dist",
                                "--exclude=build",
                                "--exclude=__pycache__",
                                "--exclude=.venv",
                                "--exclude=.next",
                                "--exclude=coverage",
                                str(baseline_repo),
                                str(ws_copy),
                            ],
                            capture_output=True,
                            text=True,
                            timeout=30,
                        )
                        if diff_proc.returncode in (0, 1) and diff_proc.stdout.strip():
                            normalized = diff_proc.stdout.replace(f"{baseline_repo}/", "a/").replace(f"{ws_copy}/", "b/")
                            diff_path.write_text(normalized, encoding="utf-8")
                            return normalized
                except Exception:
                    pass
                finally:
                    shutil.rmtree(tmp_dir, ignore_errors=True)
    return ""


def _execute_harbor(job_id: str, job_dir: Path, yaml_path: Path, extra_env: dict[str, str]) -> None:
    status_path = job_dir / "status.json"
    started_at = datetime.now(timezone.utc).isoformat()
    status_path.write_text(
        json.dumps({"job_id": job_id, "status": "running", "started_at": started_at}),
        encoding="utf-8",
    )

    proc_env = {**os.environ, **{k: v for k, v in extra_env.items() if isinstance(k, str) and isinstance(v, str)}}
    log_path = job_dir / "runner.log"
    try:
        with log_path.open("w", encoding="utf-8") as log_file:
            proc = subprocess.run(
                ["harbor", "run", "--config", str(yaml_path)],
                cwd=str(job_dir),
                env=proc_env,
                stdout=log_file,
                stderr=subprocess.STDOUT,
                text=True,
            )
        finished_at = datetime.now(timezone.utc).isoformat()
        _capture_trial_git_diff(job_dir)
        status_path.write_text(
            json.dumps({
                "job_id": job_id,
                "status": "completed" if proc.returncode == 0 else "failed",
                "exit_code": proc.returncode,
                "started_at": started_at,
                "finished_at": finished_at,
            }),
            encoding="utf-8",
        )
    except Exception as exc:
        finished_at = datetime.now(timezone.utc).isoformat()
        _capture_trial_git_diff(job_dir)
        status_path.write_text(
            json.dumps({
                "job_id": job_id,
                "status": "failed",
                "error": str(exc),
                "started_at": started_at,
                "finished_at": finished_at,
            }),
            encoding="utf-8",
        )


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "service": "forgebench-harbor"}


@app.post("/run")
def start_run(request: RunJobRequest) -> dict[str, Any]:
    job_dir = _safe_job_dir(request.job_id)
    job_dir.mkdir(parents=True, exist_ok=True)
    yaml_path = job_dir / "job.yaml"
    yaml_path.write_text(request.job_yaml, encoding="utf-8")

    thread = threading.Thread(
        target=_execute_harbor,
        args=(request.job_id, job_dir, yaml_path, request.env),
        daemon=True,
    )
    thread.start()
    return {"job_id": request.job_id, "status": "running"}


@app.get("/runs/{job_id}/diff")
def get_run_diff(job_id: str) -> dict[str, str]:
    job_dir = _safe_job_dir(job_id)
    if not job_dir.is_dir():
        raise HTTPException(status_code=404, detail="Harbor job not found.")
    return {"job_id": job_id, "git_diff": _capture_trial_git_diff(job_dir)}
