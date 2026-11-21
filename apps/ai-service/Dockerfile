FROM python:3.12-slim

WORKDIR /app
RUN pip install --no-cache-dir uv
COPY apps/ai-service/pyproject.toml apps/ai-service/uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project
COPY apps/ai-service/app ./app
ENV PATH="/app/.venv/bin:${PATH}"
ENV PYTHONPATH=/app
EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
