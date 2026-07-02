#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../../.." && pwd)"
HARBOR_BIN="${HARBOR_BIN:-/tmp/cr-harbor-cli-venv/bin/harbor}"
HARBOR_OUTPUT_ROOT="${HARBOR_OUTPUT_ROOT:-/tmp}"
HARBOR_PYTHONPATH="${REPO_ROOT}${PYTHONPATH:+:${PYTHONPATH}}"
TASK_ID="dynamicmem-user001-cp00-02-memory-final-v1"
DEFAULT_MODES=(context-only markdown cr-mcp)
MODES=()
CODEX_SERVICE_TIER_AGENT_ARGS=()
CODEX_SERVICE_TIER_LABEL="standard"

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

is_truthy() {
  case "${1:-0}" in
    1|true|TRUE|yes|YES|on|ON) return 0 ;;
    *) return 1 ;;
  esac
}

configure_codex_service_tier() {
  local raw_tier="${HARBOR_CODEX_SERVICE_TIER:-}"

  case "${raw_tier}" in
    ""|standard|STANDARD|Standard)
      CODEX_SERVICE_TIER_LABEL="standard"
      ;;
    fast|FAST|Fast|priority|PRIORITY|Priority)
      CODEX_SERVICE_TIER_LABEL="priority"
      CODEX_SERVICE_TIER_AGENT_ARGS=(--agent-kwarg service_tier=priority)
      ;;
    *)
      echo "Invalid HARBOR_CODEX_SERVICE_TIER value: ${raw_tier}" >&2
      echo "Allowed values: standard, fast, priority" >&2
      exit 1
      ;;
  esac
}

parse_modes() {
  local raw_modes
  local raw_mode
  local mode

  if [[ -z "${HARBOR_MODES:-}" || "${HARBOR_MODES}" == "all" ]]; then
    MODES=("${DEFAULT_MODES[@]}")
    return
  fi

  IFS=',' read -r -a raw_modes <<< "${HARBOR_MODES}"
  for raw_mode in "${raw_modes[@]}"; do
    mode="${raw_mode//[[:space:]]/}"
    if [[ -z "${mode}" ]]; then
      continue
    fi
    case "${mode}" in
      context-only|markdown|cr-mcp)
        MODES+=("${mode}")
        ;;
      *)
        echo "Invalid HARBOR_MODES value: ${mode}" >&2
        echo "Allowed modes: context-only, markdown, cr-mcp" >&2
        exit 1
        ;;
    esac
  done

  if [[ "${#MODES[@]}" -eq 0 ]]; then
    echo "HARBOR_MODES did not contain any runnable modes." >&2
    exit 1
  fi
}

join_modes() {
  local separator="$1"
  shift
  local joined=""
  local item

  for item in "$@"; do
    if [[ -n "${joined}" ]]; then
      joined="${joined}${separator}"
    fi
    joined="${joined}${item}"
  done

  printf "%s" "${joined}"
}

job_name() {
  local mode="$1"
  printf "eval-harbor-%s-%s" "${TASK_ID}" "${mode}"
}

jobs_dir_for_mode() {
  local mode="$1"
  printf "%s/cr-harbor-%s-%s" "${HARBOR_OUTPUT_ROOT}" "${TASK_ID}" "${mode}"
}

result_path_for_mode() {
  local mode="$1"
  printf "%s/%s/result.json" "$(jobs_dir_for_mode "${mode}")" "$(job_name "${mode}")"
}

should_skip_mode() {
  local mode="$1"
  local result_path

  if is_truthy "${HARBOR_FORCE:-0}"; then
    return 1
  fi
  if ! is_truthy "${HARBOR_SKIP_EXISTING:-0}"; then
    return 1
  fi

  result_path="$(result_path_for_mode "${mode}")"
  if [[ -f "${result_path}" ]]; then
    echo "Skipping ${mode}; existing result found at ${result_path}"
    return 0
  fi

  return 1
}

run_mode() {
  local mode="$1"
  local jobs_dir
  local name
  local env_name
  local command

  jobs_dir="$(jobs_dir_for_mode "${mode}")"
  name="$(job_name "${mode}")"
  echo "Running ${mode}: ${name}"

  command=(
    env
    "PYTHONPATH=${HARBOR_PYTHONPATH}"
    "CODEX_FORCE_AUTH_JSON=${CODEX_FORCE_AUTH_JSON:-1}"
    "${HARBOR_BIN}" run
    -c "examples/eval-harbor/jobs/${TASK_ID}-${mode}.yaml"
    --jobs-dir "${jobs_dir}"
    --agent-env CODEX_FORCE_AUTH_JSON=true
  )
  if [[ "${#CODEX_SERVICE_TIER_AGENT_ARGS[@]}" -gt 0 ]]; then
    command+=("${CODEX_SERVICE_TIER_AGENT_ARGS[@]}")
  fi
  for env_name in \
    DYNAMICMEM_LLM_JUDGE_API_KEY \
    DYNAMICMEM_LLM_JUDGE_BASE_URL \
    DYNAMICMEM_LLM_JUDGE_MODEL \
    DYNAMICMEM_JUDGE_MODE
  do
    if [[ -n "${!env_name:-}" ]]; then
      command+=(--verifier-env "${env_name}=${!env_name}")
    fi
  done
  command+=(--yes)
  "${command[@]}"
}

print_report_command() {
  local mode

  cat <<EOF

Create the comparison report with:

python3 examples/eval-harbor/scripts/report_results.py \\
EOF
  for mode in "${MODES[@]}"; do
    printf "  --run %s=%s/%s \\\\\n" \
      "${mode}" \
      "$(jobs_dir_for_mode "${mode}")" \
      "$(job_name "${mode}")"
  done
  cat <<EOF
  --output ${HARBOR_OUTPUT_ROOT}/cr-harbor-${TASK_ID}-report.md \\
  --json-output ${HARBOR_OUTPUT_ROOT}/cr-harbor-${TASK_ID}-report.json
EOF
}

run_selected_modes() {
  local mode
  local index
  local status=0
  local run_modes=()
  local pids=()
  local pid_modes=()

  echo "DynamicMem modes: $(join_modes ", " "${MODES[@]}")"
  echo "Parallel: ${HARBOR_PARALLEL:-0}; skip existing: ${HARBOR_SKIP_EXISTING:-0}; force: ${HARBOR_FORCE:-0}"
  echo "Codex service tier: ${CODEX_SERVICE_TIER_LABEL}"

  for mode in "${MODES[@]}"; do
    if should_skip_mode "${mode}"; then
      continue
    fi
    run_modes+=("${mode}")
  done

  if [[ "${#run_modes[@]}" -eq 0 ]]; then
    echo "All selected modes already have result.json; nothing to run."
    return
  fi

  resolve_harbor
  check_docker

  for mode in "${run_modes[@]}"; do
    if is_truthy "${HARBOR_PARALLEL:-0}"; then
      run_mode "${mode}" &
      pids+=("$!")
      pid_modes+=("${mode}")
    else
      run_mode "${mode}"
    fi
  done

  if is_truthy "${HARBOR_PARALLEL:-0}"; then
    index=0
    while [[ "${index}" -lt "${#pids[@]}" ]]; do
      if ! wait "${pids[${index}]}"; then
        echo "Mode failed: ${pid_modes[${index}]}" >&2
        status=1
      fi
      index=$((index + 1))
    done
  fi

  if [[ "${status}" -ne 0 ]]; then
    exit "${status}"
  fi
}

parse_modes
configure_codex_service_tier

cd "${REPO_ROOT}"

if [[ -z "${DYNAMICMEM_LLM_JUDGE_API_KEY:-}" ]]; then
  echo "DYNAMICMEM_LLM_JUDGE_API_KEY is not set; DynamicMem may use deterministic fallback scoring." >&2
fi

run_selected_modes
print_report_command
