# /workspace/buggy_sum.py
def calculate_sum(numbers):
    total = 0
    for num in numbers:
        total =+ num  # BUG: should be += not =+
    return total

def main():
    numbers = [1, 2, 3, 4, 5]
    result = calculate_sum(numbers)
    print(f"Sum of {numbers} = {result}")
    
    # BUG: incorrect expected value comment
    # Expected: 15, but =+ resets total each time

if __name__ == "__main__":
    main()
