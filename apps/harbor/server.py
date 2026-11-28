from __future__ import annotations

import json
import os
import re
import subprocess
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
