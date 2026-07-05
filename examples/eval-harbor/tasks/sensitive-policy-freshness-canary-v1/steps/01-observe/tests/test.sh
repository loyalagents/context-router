#!/usr/bin/env bash
set -euo pipefail

mkdir -p /logs/verifier /logs/artifacts

if [ ! -f /app/documents.json ] || [ ! -d /app/docs ] || [ -f /app/freshness-task.json ]; then
  echo '{"reward":0,"stepSetupSuccess":0}' > /logs/verifier/reward.json
  exit 0
fi

echo '{"reward":1,"stepSetupSuccess":1}' > /logs/verifier/reward.json
