FROM node:20-slim

WORKDIR /workspace

RUN apt-get update && apt-get install -y \
    git \
    curl \
    python3 \
    && rm -rf /var/lib/apt/lists/*

# Copy backend and install dependencies
COPY backend/package.json /workspace/backend/package.json
WORKDIR /workspace/backend
RUN npm install

# Copy frontend and install dependencies
COPY frontend/package.json /workspace/frontend/package.json
WORKDIR /workspace/frontend
RUN npm install

# Copy the actual sources
WORKDIR /workspace
COPY backend /workspace/backend
COPY frontend /workspace/frontend

RUN mkdir -p /logs/verifier

CMD ["/bin/bash"]
