#!/bin/bash

echo "Testing GraphQL API..."
echo ""

TOKEN="${1:-${CONTEXT_ROUTER_BEARER_TOKEN:-}}"
if [ -z "$TOKEN" ]; then
  echo "Error: provide a bearer token as the first argument or CONTEXT_ROUTER_BEARER_TOKEN."
  echo "Usage: ./test-graphql.sh <BEARER_TOKEN>"
  exit 1
fi

echo "1. Testing health endpoint:"
echo "$ curl -s http://localhost:3000/health"
curl -s http://localhost:3000/health | jq '.'
echo ""

echo "2. Query current user:"
echo "$ curl -s http://localhost:3000/graphql \\"
echo "  -H \"Content-Type: application/json\" \\"
echo "  -H \"Authorization: Bearer \$TOKEN\" \\"
echo "  -d '{\"query\":\"{ me { userId email createdAt updatedAt } }\"}'"
ME_RESPONSE=$(curl -s http://localhost:3000/graphql \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"query":"{ me { userId email createdAt updatedAt } }"}')
echo "$ME_RESPONSE" | jq '.'
echo ""

USER_ID=$(echo "$ME_RESPONSE" | jq -r '.data.me.userId')

echo "3. Query current user by ID:"
echo "$ curl -s http://localhost:3000/graphql \\"
echo "  -H \"Content-Type: application/json\" \\"
echo "  -H \"Authorization: Bearer \$TOKEN\" \\"
echo "  -d '{\"query\":\"{ user(id: \\\"$USER_ID\\\") { userId email createdAt updatedAt } }\"}'"
curl -s http://localhost:3000/graphql \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $TOKEN" \
  -d "{\"query\":\"{ user(id: \\\"$USER_ID\\\") { userId email createdAt updatedAt } }\"}" | jq '.'
echo ""

echo "4. Query active preferences:"
echo "$ curl -s http://localhost:3000/graphql \\"
echo "  -H \"Content-Type: application/json\" \\"
echo "  -H \"Authorization: Bearer \$TOKEN\" \\"
echo "  -d '{\"query\":\"{ activePreferences { id slug value } }\"}'"
curl -s http://localhost:3000/graphql \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"query":"{ activePreferences { id slug value } }"}' | jq '.'
