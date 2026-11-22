#!/bin/bash
# Oracle/reference solution: fixes the bug in buggy_sum.py

set -e

cat > /workspace/buggy_sum.py << 'EOF'
def calculate_sum(numbers):
    total = 0
    for num in numbers:
        total += num  # FIXED: was =+ (which resets to +num), now correctly +=
    return total

def main():
    numbers = [1, 2, 3, 4, 5]
    result = calculate_sum(numbers)
    print(f"Sum of {numbers} = {result}")

if __name__ == "__main__":
    main()
EOF

echo "Solution applied: fixed =+ to += in buggy_sum.py"
python /workspace/buggy_sum.py