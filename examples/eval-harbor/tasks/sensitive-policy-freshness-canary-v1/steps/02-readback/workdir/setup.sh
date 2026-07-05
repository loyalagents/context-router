#!/usr/bin/env bash
set -euo pipefail

mode="${EVAL_MEMORY_MODE:-unknown}"
preserved_memory="/app/.cr-preserved-memory.md"
app_probe="/app/freshness-app-carryover-probe.txt"
tmp_probe="/tmp/cr-freshness-canary-probe.txt"
home_probe="$HOME/.cr-freshness-canary-probe"

pre_app_carryover=false
pre_tmp_carryover=false
pre_home_carryover=false

if [ -f "$app_probe" ]; then
  pre_app_carryover=true
fi
if [ -f "$tmp_probe" ]; then
  pre_tmp_carryover=true
fi
if [ -f "$home_probe" ]; then
  pre_home_carryover=true
fi

if [ "$mode" = "markdown" ] && [ -f /app/memory.md ]; then
  cp /app/memory.md "$preserved_memory"
fi

rm -rf /app/docs /app/documents.json /app/current_stage /app/stage-log.jsonl
find /app -mindepth 1 -maxdepth 1 \
  ! -name .cr-preserved-memory.md \
  ! -name _step_freshness-task.json \
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

if [ -f /app/_step_freshness-task.json ]; then
  mv /app/_step_freshness-task.json /app/freshness-task.json
fi

post_app_carryover=false
post_tmp_carryover=false
post_home_carryover=false
if [ -f "$app_probe" ]; then
  post_app_carryover=true
fi
if [ -f "$tmp_probe" ]; then
  post_tmp_carryover=true
fi
if [ -f "$home_probe" ]; then
  post_home_carryover=true
fi

cat > /app/freshness-probe-runtime.json <<EOF
{
  "conversationCarryover": null,
  "appCarryover": ${post_app_carryover},
  "tmpCarryover": ${post_tmp_carryover},
  "homeCarryover": ${post_home_carryover},
  "preCleanup": {
    "appCarryover": ${pre_app_carryover},
    "tmpCarryover": ${pre_tmp_carryover},
    "homeCarryover": ${pre_home_carryover}
  },
  "postCleanup": {
    "appCarryover": ${post_app_carryover},
    "tmpCarryover": ${post_tmp_carryover},
    "homeCarryover": ${post_home_carryover}
  },
  "checkedPaths": {
    "app": "${app_probe}",
    "tmp": "${tmp_probe}",
    "home": "${home_probe}"
  }
}
EOF

rm -f "$tmp_probe" "$home_probe" /app/setup.sh "$preserved_memory"
