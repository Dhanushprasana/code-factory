#!/usr/bin/env bash
set -euo pipefail

echo "=========================================="
echo "ForgeBench Harbor Container Startup"
echo "=========================================="

if command -v harbor >/dev/null 2>&1; then
  HARBOR_BIN="$(command -v harbor)"
  HARBOR_VERSION="$(harbor --version 2>&1 || python3 -c "import importlib.metadata; print(importlib.metadata.version('harbor'))")"
  echo "Harbor installation status: INSTALLED"
  echo "Harbor binary: ${HARBOR_BIN}"
  echo "Harbor version: ${HARBOR_VERSION}"
else
  echo "Harbor installation status: FAILED (harbor binary not found)" >&2
  exit 1
fi

if [ -S /var/run/docker.sock ]; then
  echo "Docker socket: AVAILABLE (/var/run/docker.sock)"
else
  echo "Docker socket: NOT MOUNTED"
fi

echo "Harbor container ready. Starting HTTP runner on :8020..."
echo "=========================================="

exec uvicorn server:app --host 0.0.0.0 --port 8020
