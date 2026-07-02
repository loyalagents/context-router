#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../../.." && pwd)"
HARBOR_VENV="${HARBOR_VENV:-/tmp/cr-harbor-cli-venv}"
PYTHON_BIN="${PYTHON_BIN:-python3}"
REQUIREMENTS="${REPO_ROOT}/examples/eval-harbor/requirements-runner.txt"

if ! "${PYTHON_BIN}" - <<'PY'
import sys
raise SystemExit(0 if sys.version_info >= (3, 12) else 1)
PY
then
  echo "Python 3.12+ is required. Set PYTHON_BIN=/path/to/python3.12 and retry." >&2
  exit 1
fi

"${PYTHON_BIN}" -m venv "${HARBOR_VENV}"
"${HARBOR_VENV}/bin/python" -m pip install --upgrade pip
"${HARBOR_VENV}/bin/python" -m pip install -r "${REQUIREMENTS}"

HARBOR_BIN="${HARBOR_VENV}/bin/harbor"
if [[ ! -x "${HARBOR_BIN}" ]]; then
  echo "Harbor install completed but ${HARBOR_BIN} is not executable." >&2
  exit 1
fi

"${HARBOR_BIN}" --help >/dev/null

echo "Harbor CLI installed:"
echo "${HARBOR_BIN}"
