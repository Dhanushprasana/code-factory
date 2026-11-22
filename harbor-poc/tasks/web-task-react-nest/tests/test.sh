#!/bin/bash
set -e

REWARD_FILE="/logs/verifier/reward.txt"
REWARD_JSON="/logs/verifier/reward.json"
mkdir -p /logs/verifier

echo "=========================================="
echo " Running Fullstack Automation Tests"
echo "=========================================="

BACKEND_SCORE=0.0
FRONTEND_SCORE=0.0

# 1. Run Backend Supertest + Jest Automation
echo "--> Running Backend NestJS Tests..."
if npm --prefix /workspace/backend test > /logs/verifier/backend-test.log 2>&1; then
    echo "PASS: Backend NestJS tests succeeded"
    BACKEND_SCORE=0.5
else
    echo "FAIL: Backend NestJS tests failed"
    cat /logs/verifier/backend-test.log | tail -n 20
fi

# 2. Run Frontend Testing Library + Vitest Automation
echo "--> Running Frontend React Tests..."
if npm --prefix /workspace/frontend test > /logs/verifier/frontend-test.log 2>&1; then
    echo "PASS: Frontend React tests succeeded"
    FRONTEND_SCORE=0.5
else
    echo "FAIL: Frontend React tests failed"
    cat /logs/verifier/frontend-test.log | tail -n 20
fi

# Total Score (Partial rewards supported!)
TOTAL_SCORE=$(python3 -c "print($BACKEND_SCORE + $FRONTEND_SCORE)")
echo "$TOTAL_SCORE" > "$REWARD_FILE"

# Structured multidimensional reward JSON
cat << EOF > "$REWARD_JSON"
{
  "backend_score": $BACKEND_SCORE,
  "frontend_score": $FRONTEND_SCORE,
  "total_score": $TOTAL_SCORE
}
EOF

echo "Final Reward Score: $TOTAL_SCORE"
