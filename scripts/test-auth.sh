#!/usr/bin/env bash
set -euo pipefail

API_KEY="${1:-}"
USER_ID="${2:-}"
BASE_URL="${3:-http://localhost:3000}"

if [[ -z "$API_KEY" || -z "$USER_ID" ]]; then
  echo "Usage: ./scripts/test-auth.sh <api-key> <user-id> [base-url]"
  echo "  base-url defaults to http://localhost:3000"
  exit 1
fi

QUERY='{"query": "{ me { userId email firstName lastName } }"}'

echo "=== Path 1: X-User-Id header ==="
curl -s -X POST "$BASE_URL/graphql" \
  -H "Authorization: Bearer $API_KEY" \
  -H "X-User-Id: $USER_ID" \
  -H "Content-Type: application/json" \
  -d "$QUERY" | python3 -m json.tool 2>/dev/null || echo "(raw output above)"

echo ""
echo "=== Path 2: ?asUser= query param ==="
curl -s -X POST "$BASE_URL/graphql?asUser=$USER_ID" \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d "$QUERY" | python3 -m json.tool 2>/dev/null || echo "(raw output above)"

echo ""
echo "=== Path 3: Compound token (key.userId) ==="
curl -s -X POST "$BASE_URL/graphql" \
  -H "Authorization: Bearer $API_KEY.$USER_ID" \
  -H "Content-Type: application/json" \
  -d "$QUERY" | python3 -m json.tool 2>/dev/null || echo "(raw output above)"

echo ""
echo "=== Negative: Wrong API key ==="
curl -s -X POST "$BASE_URL/graphql" \
  -H "Authorization: Bearer bad-key" \
  -H "X-User-Id: $USER_ID" \
  -H "Content-Type: application/json" \
  -d "$QUERY" | python3 -m json.tool 2>/dev/null || echo "(raw output above)"

echo ""
echo "=== Negative: No userId ==="
curl -s -X POST "$BASE_URL/graphql" \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d "$QUERY" | python3 -m json.tool 2>/dev/null || echo "(raw output above)"

echo ""
echo "=== Health check (no auth needed) ==="
curl -s "$BASE_URL/health" | python3 -m json.tool 2>/dev/null || echo "(raw output above)"
