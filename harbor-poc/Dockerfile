FROM python:3.12-slim

# Install system dependencies
RUN apt-get update && apt-get install -y \
    docker.io \
    curl \
    git \
    && rm -rf /var/lib/apt/lists/*

# Install Harbor
RUN pip install --no-cache-dir harbor

WORKDIR /harbor-poc

COPY . .

CMD ["harbor", "--help"]
