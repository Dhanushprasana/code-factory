FROM docker:27-cli AS docker-cli
FROM python:3.12-slim

COPY --from=docker-cli /usr/local/bin/docker /usr/local/bin/docker
COPY --from=docker-cli /usr/local/libexec/docker/cli-plugins /usr/local/libexec/docker/cli-plugins

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
      bash \
      ca-certificates \
      curl \
      git \
    && rm -rf /var/lib/apt/lists/*

RUN pip install --no-cache-dir harbor

WORKDIR /harbor
COPY apps/harbor/server.py /harbor/server.py
COPY apps/harbor/entrypoint.sh /harbor/entrypoint.sh
RUN chmod +x /harbor/entrypoint.sh

EXPOSE 8020
ENTRYPOINT ["/harbor/entrypoint.sh"]
