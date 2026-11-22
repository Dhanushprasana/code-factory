FROM python:3.12-slim

WORKDIR /workspace

RUN apt-get update && apt-get install -y \
    git \
    curl \
    && rm -rf /var/lib/apt/lists/*

COPY raw_orders.csv /workspace/raw_orders.csv
COPY process_orders.py /workspace/process_orders.py

RUN mkdir -p /logs/verifier

CMD ["/bin/bash"]
