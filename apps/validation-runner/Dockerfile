FROM node:22-bookworm-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
      coreutils \
      git \
      python3 \
      python3-pip \
      python3-pytest \
      python3-venv \
      golang-go \
      cargo \
      rustc \
      maven \
      gradle \
      make \
    && rm -rf /var/lib/apt/lists/*

COPY apps/validation-runner/requirements.txt /tmp/runner-requirements.txt
RUN corepack enable \
    && corepack prepare pnpm@9.15.0 --activate \
    && corepack prepare yarn@1.22.22 --activate \
    && python3 -m venv /opt/runner-venv --system-site-packages \
    && /opt/runner-venv/bin/pip install --no-cache-dir -r /tmp/runner-requirements.txt

WORKDIR /runner
COPY apps/validation-runner/app.py ./app.py
COPY apps/validation-runner/test_app.py ./test_app.py
ENV PATH="/opt/runner-venv/bin:${PATH}"
EXPOSE 8010
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8010"]
