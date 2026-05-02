#!/bin/bash

echo "Testing GraphQL API..."
echo ""

# Get auth token first
source apps/backend/.env

echo "Getting auth token..."
RESPONSE=$(curl -s --request POST \
  --url "https://${AUTH0_DOMAIN}/oauth/token" \
  --header 'content-type: application/json' \
  --data "{
    \"client_id\":\"${AUTH0_CLIENT_ID}\",
    \"client_secret\":\"${AUTH0_CLIENT_SECRET}\",
    \"audience\":\"${AUTH0_AUDIENCE}\",
    \"grant_type\":\"client_credentials\"
  }")

TOKEN=$(echo "$RESPONSE" | jq -r '.access_token')

if [ "$TOKEN" == "null" ] || [ -z "$TOKEN" ]; then
  echo "Failed to get token!"
  echo "Response:"
  echo "$RESPONSE" | jq '.'
  exit 1
fi

echo "✓ Token retrieved successfully!"
echo ""

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
