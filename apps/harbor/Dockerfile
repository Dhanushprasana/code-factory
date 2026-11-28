FROM python:3.12-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
      bash \
      ca-certificates \
      curl \
      docker.io \
      git \
    && rm -rf /var/lib/apt/lists/*

RUN pip install --no-cache-dir harbor

WORKDIR /harbor
COPY apps/harbor/entrypoint.sh /harbor/entrypoint.sh
RUN chmod +x /harbor/entrypoint.sh

ENTRYPOINT ["/harbor/entrypoint.sh"]
