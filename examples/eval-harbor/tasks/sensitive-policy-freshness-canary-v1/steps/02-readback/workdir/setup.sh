#!/usr/bin/env bash
set -euo pipefail

mode="${EVAL_MEMORY_MODE:-unknown}"
tmp_memory="/tmp/cr-preserved-memory.md"
app_probe="/app/freshness-app-carryover-probe.txt"
tmp_probe="/tmp/cr-freshness-canary-probe.txt"
home_probe="$HOME/.cr-freshness-canary-probe"

app_carryover=false
tmp_carryover=false
home_carryover=false

if [ -f "$app_probe" ]; then
  app_carryover=true
fi
if [ -f "$tmp_probe" ]; then
  tmp_carryover=true
fi
if [ -f "$home_probe" ]; then
  home_carryover=true
fi

if [ "$mode" = "markdown" ] && [ -f /app/memory.md ]; then
  cp /app/memory.md "$tmp_memory"
fi

rm -rf /app/docs /app/documents.json /app/current_stage /app/stage-log.jsonl
find /app -mindepth 1 -maxdepth 1 \
  ! -name _step_freshness-task.json \
  ! -name setup.sh \
  -exec rm -rf {} +

mkdir -p /app/outputs

if [ "$mode" = "markdown" ] && [ -f "$tmp_memory" ]; then
  cp "$tmp_memory" /app/memory.md
else
  rm -f /app/memory.md
fi

if [ -f /app/_step_freshness-task.json ]; then
  mv /app/_step_freshness-task.json /app/freshness-task.json
fi

cat > /app/freshness-probe-runtime.json <<EOF
{
  "conversationCarryover": null,
  "appCarryover": ${app_carryover},
  "tmpCarryover": ${tmp_carryover},
  "homeCarryover": ${home_carryover},
  "checkedPaths": {
    "app": "${app_probe}",
    "tmp": "${tmp_probe}",
    "home": "${home_probe}"
  }
}
EOF

rm -f "$tmp_probe" "$home_probe" /app/setup.sh "$tmp_memory"
