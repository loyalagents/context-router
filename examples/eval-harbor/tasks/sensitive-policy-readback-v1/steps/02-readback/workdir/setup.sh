#!/usr/bin/env bash
set -euo pipefail

mode="${EVAL_MEMORY_MODE:-unknown}"
preserved_memory="/app/.cr-preserved-memory.md"

if [ "$mode" = "markdown" ] && [ -f /app/memory.md ]; then
  cp /app/memory.md "$preserved_memory"
fi

rm -rf /app/docs /app/documents.json /app/current_stage /app/stage-log.jsonl
find /app -mindepth 1 -maxdepth 1 \
  ! -name .cr-preserved-memory.md \
  ! -name _step_permissions-task.json \
  ! -name setup.sh \
  -exec rm -rf {} +

find /tmp -mindepth 1 -maxdepth 1 -exec rm -rf {} + 2>/dev/null || true
find "$HOME" -mindepth 1 -maxdepth 1 \
  \( -name ".cr-*" -o -name "cr-*" -o -name "scratch*" -o -name "notes*" -o -name "memory*" \) \
  -exec rm -rf {} + 2>/dev/null || true

mkdir -p /app/outputs

if [ "$mode" = "markdown" ] && [ -f "$preserved_memory" ]; then
  cp "$preserved_memory" /app/memory.md
else
  rm -f /app/memory.md
fi

if [ -f /app/_step_permissions-task.json ]; then
  mv /app/_step_permissions-task.json /app/permissions-task.json
fi

rm -f /app/setup.sh "$preserved_memory"
