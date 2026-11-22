#!/bin/bash
# Simulates a full Harbor trial locally using Docker
# Runs: build env -> apply oracle solution -> run verifier -> show reward
# No AI agent needed - great for testing your task structure!

set -e

TASK_DIR="$(cd "$(dirname "$0")/.." && pwd)/tasks/hello-python"
IMAGE_TAG="harbor-poc-hello-python:local"

echo "========================================"
echo "  Harbor Local Trial Simulator"
echo "  Task: hello-python"
echo "========================================"
echo ""

# Build the environment image
echo "Step 1: Building task environment..."
docker build -t "$IMAGE_TAG" "$TASK_DIR/environment"
echo "v Environment built"
echo ""

# Create a named volume for logs
docker volume create harbor-poc-logs 2>/dev/null || true

# Run the full simulation
echo "Step 2: Running trial simulation..."
docker run --rm \
    -v "$TASK_DIR/tests:/tests:ro" \
    -v "$TASK_DIR/solution:/solution:ro" \
    -v harbor-poc-logs:/logs \
    "$IMAGE_TAG" \
    bash -c '
        set -e
        echo "--- Initial state (buggy script) ---"
        python /workspace/buggy_sum.py || echo "(script failed as expected)"
        echo ""
        
        echo "--- Applying oracle solution ---"
        bash /solution/solve.sh
        echo ""
        
        echo "--- Running verifier ---"
        bash /tests/test.sh
        echo ""
        
        echo "--- Final Reward ---"
        cat /logs/verifier/reward.txt
        REWARD=$(cat /logs/verifier/reward.txt)
        if [ "$REWARD" = "1" ]; then
            echo "PASS (reward=1)"
        else
            echo "FAIL (reward=0)"
        fi
    '

# Cleanup
docker volume rm harbor-poc-logs 2>/dev/null || true

echo ""
echo "========================================"
echo "  Trial simulation complete!"
echo "========================================"