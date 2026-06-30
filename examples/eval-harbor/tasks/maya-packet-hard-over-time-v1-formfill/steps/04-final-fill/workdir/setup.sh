#!/usr/bin/env bash
set -euo pipefail

mode="${EVAL_MEMORY_MODE:-unknown}"
tmp_memory="/tmp/cr-preserved-memory.md"

if [ "$mode" = "markdown" ] && [ -f /app/memory.md ]; then
  cp /app/memory.md "$tmp_memory"
fi

find /app -mindepth 1 -maxdepth 1 \
  ! -name _step_docs \
  ! -name _step_documents.json \
  ! -name _step_forms \
  ! -name setup.sh \
  -exec rm -rf {} +

mkdir -p /app/outputs/forms

if [ "$mode" = "markdown" ] && [ -f "$tmp_memory" ]; then
  cp "$tmp_memory" /app/memory.md
  if [ -n "${MARKDOWN_MEMORY_BUDGET_BYTES:-}" ]; then
    python3 - <<'PY'
import os
from pathlib import Path

path = Path("/app/memory.md")
budget = int(os.environ["MARKDOWN_MEMORY_BUDGET_BYTES"])
data = path.read_bytes()
if len(data) > budget:
    data = data[-budget:]
    newline = data.find(b"\n")
    if newline != -1:
        data = data[newline + 1 :]
    path.write_bytes(data)
PY
  fi
else
  rm -f /app/memory.md
fi

if [ -d /app/_step_docs ]; then
  mv /app/_step_docs /app/docs
fi
if [ -f /app/_step_documents.json ]; then
  mv /app/_step_documents.json /app/documents.json
fi
if [ -d /app/_step_forms ]; then
  mv /app/_step_forms /app/forms
fi

rm -f /app/setup.sh "$tmp_memory"
