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
