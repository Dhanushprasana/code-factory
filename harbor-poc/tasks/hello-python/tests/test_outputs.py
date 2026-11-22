"""
pytest-based verifier for hello-python Harbor task.
Checks that buggy_sum.py produces the correct output.
"""
import subprocess
import sys


def test_script_runs_successfully():
    """The script must exit with code 0."""
    result = subprocess.run(
        [sys.executable, "/workspace/buggy_sum.py"],
        capture_output=True,
        text=True,
        timeout=10,
    )
    assert result.returncode == 0, f"Script failed with stderr: {result.stderr}"


def test_correct_sum_output():
    """The script must print the correct sum: 15."""
    result = subprocess.run(
        [sys.executable, "/workspace/buggy_sum.py"],
        capture_output=True,
        text=True,
        timeout=10,
    )
    assert "= 15" in result.stdout, (
        f"Expected '= 15' in output, got: {result.stdout!r}"
    )


def test_exact_output_format():
    """The script must print the expected exact string."""
    result = subprocess.run(
        [sys.executable, "/workspace/buggy_sum.py"],
        capture_output=True,
        text=True,
        timeout=10,
    )
    expected = "Sum of [1, 2, 3, 4, 5] = 15"
    assert expected in result.stdout, (
        f"Expected '{expected}' in output, got: {result.stdout!r}"
    )
