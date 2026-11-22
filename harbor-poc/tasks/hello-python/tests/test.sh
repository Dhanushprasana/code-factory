#!/bin/bash
# Harbor verifier script for hello-python task
# Outputs reward to /logs/verifier/reward.txt

set -e

REWARD_FILE="/logs/verifier/reward.txt"
mkdir -p /logs/verifier

echo "Running verifier for hello-python task..."

# Run the script and capture output
OUTPUT=$(python /workspace/buggy_sum.py 2>&1)
EXIT_CODE=$?

echo "Script output: $OUTPUT"

# Check exit code
if [ $EXIT_CODE -ne 0 ]; then
    echo "FAIL: Script exited with code $EXIT_CODE"
    echo "0" > "$REWARD_FILE"
    exit 0
fi

# Check for correct output
if echo "$OUTPUT" | grep -q "Sum of \[1, 2, 3, 4, 5\] = 15"; then
    echo "PASS: Correct sum output detected"
    echo "1" > "$REWARD_FILE"
else
    echo "FAIL: Incorrect or missing output. Got: $OUTPUT"
    echo "0" > "$REWARD_FILE"
fi

echo "Reward written to $REWARD_FILE: $(cat $REWARD_FILE)"