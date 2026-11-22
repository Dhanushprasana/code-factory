#!/bin/bash
# Validates that a Harbor task directory has all required files
# Usage: bash scripts/verify_task.sh tasks/hello-python

TASK_DIR="${1:-tasks/hello-python}"

echo "Validating Harbor task: $TASK_DIR"
echo "=================================="

PASS=0
FAIL=0

check_file() {
    if [ -f "$1" ]; then
        echo "v $1"
        PASS=$((PASS + 1))
    else
        echo "x MISSING: $1"
        FAIL=$((FAIL + 1))
    fi
}

check_file "$TASK_DIR/instruction.md"
check_file "$TASK_DIR/task.toml"
check_file "$TASK_DIR/environment/Dockerfile"
check_file "$TASK_DIR/solution/solve.sh"
check_file "$TASK_DIR/tests/test.sh"

echo ""
echo "Result: $PASS passed, $FAIL missing"
if [ $FAIL -eq 0 ]; then
    echo "v Task structure is valid!"
    exit 0
else
    echo "x Fix missing files before submitting."
    exit 1
fi