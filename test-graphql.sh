#!/bin/bash

echo "Testing GraphQL API..."
echo ""

# Get auth token first
source .env

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

echo "2. Query all users:"
echo "$ curl -s http://localhost:3000/graphql \\"
echo "  -H \"Content-Type: application/json\" \\"
echo "  -H \"Authorization: Bearer \$TOKEN\" \\"
echo "  -d '{\"query\":\"{ users { userId email firstName lastName createdAt updatedAt } }\"}'"
curl -s http://localhost:3000/graphql \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"query":"{ users { userId email firstName lastName createdAt updatedAt } }"}' | jq '.'
echo ""

echo "3. Create a new user:"
echo "$ curl -s http://localhost:3000/graphql \\"
echo "  -H \"Content-Type: application/json\" \\"
echo "  -H \"Authorization: Bearer \$TOKEN\" \\"
echo "  -d '{\"query\":\"mutation { createUser(createUserInput: { email: \\\"test@example.com\\\", firstName: \\\"Test\\\", lastName: \\\"User\\\" }) { userId email firstName lastName } }\"}'"
curl -s http://localhost:3000/graphql \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"query":"mutation { createUser(createUserInput: { email: \"test@example.com\", firstName: \"Test\", lastName: \"User\" }) { userId email firstName lastName } }"}' | jq '.'
echo ""

echo "4. Query all users again (should show 3 users):"
echo "$ curl -s http://localhost:3000/graphql \\"
echo "  -H \"Content-Type: application/json\" \\"
echo "  -H \"Authorization: Bearer \$TOKEN\" \\"
echo "  -d '{\"query\":\"{ users { userId email firstName lastName } }\"}'"
curl -s http://localhost:3000/graphql \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"query":"{ users { userId email firstName lastName } }"}' | jq '.'
