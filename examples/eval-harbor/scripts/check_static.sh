#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../../.." && pwd)"
PYTHON_BIN="${PYTHON_BIN:-python3}"
export PYTHONPYCACHEPREFIX="${PYTHONPYCACHEPREFIX:-/tmp/context-router-pycache}"

cd "${REPO_ROOT}"

PYTHON_FILES=()
while IFS= read -r path; do
  PYTHON_FILES+=("${path}")
done < <(find examples/eval-harbor/scripts -maxdepth 1 -type f -name "*.py" | sort)
while IFS= read -r path; do
  PYTHON_FILES+=("${path}")
done < <(find examples/eval_harbor_agents -maxdepth 1 -type f -name "*.py" | sort)

echo "Compiling eval-harbor Python scripts..."
"${PYTHON_BIN}" -m py_compile "${PYTHON_FILES[@]}"

echo "Validating task soundness..."
"${PYTHON_BIN}" examples/eval-harbor/scripts/validate_task_soundness.py \
  examples/eval-harbor/tasks/*

echo "Parsing eval-harbor JSON files..."
"${PYTHON_BIN}" - <<'PY'
import json
from pathlib import Path

for path in Path("examples/eval-harbor").rglob("*.json"):
    json.loads(path.read_text())
print("JSON OK")
PY

if [[ "${HARBOR_CHECK_DIFF:-0}" == "1" ]]; then
  if git rev-parse --verify --quiet origin/main >/dev/null; then
    echo "Checking PR diff whitespace..."
    git diff --check origin/main...HEAD
  else
    echo "Skipping diff whitespace check: origin/main is not available."
  fi
else
  echo "Skipping diff whitespace check. Set HARBOR_CHECK_DIFF=1 to run it."
fi
