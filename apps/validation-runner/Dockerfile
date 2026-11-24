FROM python:3.12-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
      coreutils \
      golang-go \
      cargo \
      rustc \
      maven \
      gradle \
      make \
    && rm -rf /var/lib/apt/lists/*

COPY --from=node:22-bookworm-slim /usr/local/bin/node /usr/local/bin/node
COPY --from=node:22-bookworm-slim /usr/local/lib/node_modules /usr/local/lib/node_modules
COPY --from=docker:cli /usr/local/bin/docker /usr/local/bin/docker
COPY --from=docker/compose-bin:v2.30.2 /docker-compose /usr/local/lib/docker/cli-plugins/docker-compose
COPY --from=docker/compose-bin:v2.30.2 /docker-compose /usr/local/bin/docker-compose
RUN ln -s /usr/local/lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm \
    && ln -s /usr/local/lib/node_modules/npm/bin/npx-cli.js /usr/local/bin/npx \
    && ln -s /usr/local/lib/node_modules/corepack/dist/corepack.js /usr/local/bin/corepack \
    && corepack enable \
    && corepack prepare pnpm@9.15.0 --activate \
    && corepack prepare yarn@1.22.22 --activate

COPY apps/validation-runner/requirements.txt /tmp/runner-requirements.txt
RUN pip install --no-cache-dir -r /tmp/runner-requirements.txt

WORKDIR /runner
COPY apps/validation-runner/app.py ./app.py
COPY apps/validation-runner/test_app.py ./test_app.py

EXPOSE 8010
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8010"]
