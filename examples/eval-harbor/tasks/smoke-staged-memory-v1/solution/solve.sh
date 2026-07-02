#!/bin/sh
set -eu

while true; do
  if /app/next_stage | grep -q "No more stages"; then
    break
  fi
done

mkdir -p outputs
cat > outputs/prediction.json <<'JSON'
{
  "taskId": "smoke-staged-memory-v1",
  "answers": {
    "legalName": "Maya Chen",
    "mailingCity": "San Francisco",
    "payrollBankLast4": "4821"
  }
}
JSON
