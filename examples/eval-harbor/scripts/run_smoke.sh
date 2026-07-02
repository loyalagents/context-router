#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../../.." && pwd)"
HARBOR_BIN="${HARBOR_BIN:-/tmp/cr-harbor-cli-venv/bin/harbor}"
HARBOR_JOBS_DIR="${HARBOR_JOBS_DIR:-/tmp/cr-harbor-live-smoke-staged}"

resolve_harbor() {
  if [[ "${HARBOR_BIN}" == */* ]]; then
    if [[ ! -x "${HARBOR_BIN}" ]]; then
      echo "Harbor CLI not found. Run: pnpm eval-harbor:bootstrap" >&2
      exit 1
    fi
  elif ! command -v "${HARBOR_BIN}" >/dev/null 2>&1; then
    echo "Harbor CLI not found. Run: pnpm eval-harbor:bootstrap" >&2
    exit 1
  else
    HARBOR_BIN="$(command -v "${HARBOR_BIN}")"
  fi
}

check_docker() {
  if ! command -v docker >/dev/null 2>&1; then
    echo "Docker CLI not found. Install Docker and start it before running Harbor jobs." >&2
    exit 1
  fi
  if ! docker info >/dev/null 2>&1; then
    echo "Docker is not running or is not reachable. Start Docker and retry." >&2
    exit 1
  fi
}

resolve_harbor
check_docker

cd "${REPO_ROOT}"

CODEX_FORCE_AUTH_JSON="${CODEX_FORCE_AUTH_JSON:-1}" "${HARBOR_BIN}" run \
  -c examples/eval-harbor/jobs/smoke-staged-memory-v1-context-only.yaml \
  --jobs-dir "${HARBOR_JOBS_DIR}" \
  --agent-env CODEX_FORCE_AUTH_JSON=true \
  --yes \
  --n-concurrent 1
