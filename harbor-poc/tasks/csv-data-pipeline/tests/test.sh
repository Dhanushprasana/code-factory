#!/bin/bash
set -e

REWARD_FILE="/logs/verifier/reward.txt"
mkdir -p /logs/verifier

echo "Running verifier for csv-data-pipeline task..."

# Check if script exists
if [ ! -f /workspace/process_orders.py ]; then
    echo "FAIL: /workspace/process_orders.py missing"
    echo "0" > "$REWARD_FILE"
    exit 0
fi

# Run the user's script
python3 /workspace/process_orders.py > /logs/verifier/run.log 2>&1 || true

# Check if report.json was generated
if [ ! -f /workspace/report.json ]; then
    echo "FAIL: /workspace/report.json was not created"
    echo "0" > "$REWARD_FILE"
    exit 0
fi

# Check report.json validity using Python
python3 - << 'EOF'
import json
import sys

try:
    with open('/workspace/report.json', 'r') as f:
        data = json.load(f)
except Exception as e:
    print(f"FAIL: JSON parsing error: {e}")
    sys.exit(1)

# Expected values:
# ord_001: usr_101 = 50.00
# ord_002: usr_102 = 120.50
# ord_003: usr_101 = 89.50
# ord_006: usr_102 = 89.50
# Total = 50.00 + 120.50 + 89.50 + 89.50 = 349.50
# Count = 4
# usr_102 = 210.00, usr_101 = 139.50

expected_revenue = 349.50
expected_count = 4

if abs(data.get("total_revenue", 0) - expected_revenue) > 0.01:
    print(f"FAIL: Expected total_revenue {expected_revenue}, got {data.get('total_revenue')}")
    sys.exit(1)

if data.get("completed_order_count") != expected_count:
    print(f"FAIL: Expected completed_order_count {expected_count}, got {data.get('completed_order_count')}")
    sys.exit(1)

users = data.get("top_users", {})
if abs(users.get("usr_102", 0) - 210.00) > 0.01:
    print(f"FAIL: Expected usr_102 to have spent 210.00, got {users.get('usr_102')}")
    sys.exit(1)

if abs(users.get("usr_101", 0) - 139.50) > 0.01:
    print(f"FAIL: Expected usr_101 to have spent 139.50, got {users.get('usr_101')}")
    sys.exit(1)

print("PASS: All data pipeline assertions succeeded")
sys.exit(0)
EOF

if [ $? -eq 0 ]; then
    echo "1" > "$REWARD_FILE"
    echo "PASS: Verifier scored 1.0"
else
    echo "0" > "$REWARD_FILE"
    echo "FAIL: Verifier scored 0.0"
fi
