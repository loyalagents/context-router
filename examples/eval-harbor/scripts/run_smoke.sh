#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../../.." && pwd)"
HARBOR_BIN="${HARBOR_BIN:-/tmp/cr-harbor-cli-venv/bin/harbor}"
HARBOR_JOBS_DIR="${HARBOR_JOBS_DIR:-/tmp/cr-harbor-live-smoke-staged}"
HARBOR_PYTHONPATH="${REPO_ROOT}${PYTHONPATH:+:${PYTHONPATH}}"
CODEX_SERVICE_TIER_AGENT_ARGS=()

configure_codex_service_tier() {
  local raw_tier="${HARBOR_CODEX_SERVICE_TIER:-}"

  case "${raw_tier}" in
    ""|standard|STANDARD|Standard)
      return
      ;;
    fast|FAST|Fast|priority|PRIORITY|Priority)
      CODEX_SERVICE_TIER_AGENT_ARGS=(--agent-kwarg service_tier=priority)
      ;;
    *)
      echo "Invalid HARBOR_CODEX_SERVICE_TIER value: ${raw_tier}" >&2
      echo "Allowed values: standard, fast, priority" >&2
      exit 1
      ;;
  esac
}

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

cd "${REPO_ROOT}"

configure_codex_service_tier
resolve_harbor
check_docker

command=(
  env
  "PYTHONPATH=${HARBOR_PYTHONPATH}"
  "CODEX_FORCE_AUTH_JSON=${CODEX_FORCE_AUTH_JSON:-1}"
  "${HARBOR_BIN}" run
  -c examples/eval-harbor/jobs/smoke-staged-memory-v1-context-only.yaml
  --jobs-dir "${HARBOR_JOBS_DIR}"
  --agent-env CODEX_FORCE_AUTH_JSON=true
)
if [[ "${#CODEX_SERVICE_TIER_AGENT_ARGS[@]}" -gt 0 ]]; then
  command+=("${CODEX_SERVICE_TIER_AGENT_ARGS[@]}")
fi
command+=(--yes --n-concurrent 1)
"${command[@]}"
