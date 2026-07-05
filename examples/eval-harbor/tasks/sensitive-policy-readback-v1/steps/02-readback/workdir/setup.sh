#!/usr/bin/env bash
set -euo pipefail

mode="${EVAL_MEMORY_MODE:-unknown}"
tmp_memory="/tmp/cr-preserved-memory.md"

if [ "$mode" = "markdown" ] && [ -f /app/memory.md ]; then
  cp /app/memory.md "$tmp_memory"
fi

rm -rf /app/docs /app/documents.json /app/current_stage /app/stage-log.jsonl
find /app -mindepth 1 -maxdepth 1 \
  ! -name _step_permissions-task.json \
  ! -name setup.sh \
  -exec rm -rf {} +

mkdir -p /app/outputs

if [ "$mode" = "markdown" ] && [ -f "$tmp_memory" ]; then
  cp "$tmp_memory" /app/memory.md
else
  rm -f /app/memory.md
fi

if [ -f /app/_step_permissions-task.json ]; then
  mv /app/_step_permissions-task.json /app/permissions-task.json
fi

rm -f /app/setup.sh "$tmp_memory"
