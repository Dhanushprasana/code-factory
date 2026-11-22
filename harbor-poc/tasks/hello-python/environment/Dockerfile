FROM python:3.12-slim

WORKDIR /workspace

# Pre-install common tools an agent might need
RUN apt-get update && apt-get install -y \
    git \
    curl \
    vim \
    && rm -rf /var/lib/apt/lists/*

# Place the buggy script into the workspace
COPY buggy_sum.py /workspace/buggy_sum.py

# Create the logs directory expected by Harbor verifier
RUN mkdir -p /logs/verifier

CMD ["/bin/bash"]
