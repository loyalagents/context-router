#!/bin/bash

# Get a JWT token for testing
# This uses your M2M credentials to get a token

source .env

echo "Getting test token from Auth0..."
echo ""

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
echo "Token (copy this):"
echo "=================="
echo "$TOKEN"
echo "=================="
echo ""
echo "Token expires in: $(echo "$RESPONSE" | jq -r '.expires_in') seconds"
echo ""
echo "To test with curl, run:"
echo "./test-preferences.sh $TOKEN"
echo ""
echo "For GraphQL Playground (http://localhost:3000/graphql), add this header:"
echo '{'
echo '  "Authorization": "Bearer '$TOKEN'"'
echo '}'
