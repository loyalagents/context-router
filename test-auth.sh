#!/bin/bash

# Test script for Auth0 authentication
# Usage: ./test-auth.sh <YOUR_AUTH0_TOKEN>

set -e

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

TOKEN=$1
API_URL=${API_URL:-http://localhost:3000/graphql}

if [ -z "$TOKEN" ]; then
  echo -e "${RED}Error: Please provide an Auth0 token${NC}"
  echo "Usage: ./test-auth.sh <YOUR_TOKEN>"
  echo ""
  echo "Get a token from:"
  echo "  1. Auth0 Dashboard → APIs → Context Router API → Test tab"
  echo "  2. Or use: curl --request POST \\"
  echo "       --url https://YOUR-TENANT.auth0.com/oauth/token \\"
  echo "       --header 'content-type: application/json' \\"
  echo "       --data '{\"client_id\":\"YOUR_CLIENT_ID\",\"client_secret\":\"YOUR_CLIENT_SECRET\",\"audience\":\"https://context-router-api\",\"grant_type\":\"client_credentials\"}'"
  exit 1
fi

echo -e "${YELLOW}Testing Auth0 Authentication...${NC}"
echo ""

# Test 1: Health check (no auth required)
echo -e "${YELLOW}1. Testing health endpoint (no auth):${NC}"
curl -s http://localhost:3000/health | jq '.'
echo ""

# Test 2: Protected query without token (should fail)
echo -e "${YELLOW}2. Testing protected query WITHOUT token (should fail):${NC}"
RESPONSE=$(curl -s $API_URL \
  -H 'Content-Type: application/json' \
  -d '{"query":"{ users { userId email } }"}')

if echo "$RESPONSE" | jq -e '.errors' > /dev/null 2>&1; then
  echo -e "${GREEN}✓ Correctly rejected unauthenticated request${NC}"
  echo "$RESPONSE" | jq '.errors'
else
  echo -e "${RED}✗ Failed: Should have rejected request${NC}"
  echo "$RESPONSE" | jq '.'
fi
echo ""

# Test 3: Get current user (me query)
echo -e "${YELLOW}3. Testing 'me' query with token:${NC}"
RESPONSE=$(curl -s $API_URL \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"query":"{ me { userId email firstName lastName auth0Id createdAt } }"}')

if echo "$RESPONSE" | jq -e '.data.me' > /dev/null 2>&1; then
  echo -e "${GREEN}✓ Successfully authenticated${NC}"
  echo "$RESPONSE" | jq '.data.me'
else
  echo -e "${RED}✗ Authentication failed${NC}"
  echo "$RESPONSE" | jq '.'
  exit 1
fi
echo ""

# Test 4: Query all users with token
echo -e "${YELLOW}4. Testing 'users' query with token:${NC}"
RESPONSE=$(curl -s $API_URL \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"query":"{ users { userId email firstName lastName } }"}')

if echo "$RESPONSE" | jq -e '.data.users' > /dev/null 2>&1; then
  echo -e "${GREEN}✓ Successfully fetched users${NC}"
  echo "$RESPONSE" | jq '.data.users'
else
  echo -e "${RED}✗ Failed to fetch users${NC}"
  echo "$RESPONSE" | jq '.'
fi
echo ""

# Test 5: Create a user (protected mutation)
echo -e "${YELLOW}5. Testing createUser mutation (protected):${NC}"
RANDOM_EMAIL="test-$(date +%s)@example.com"
RESPONSE=$(curl -s $API_URL \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $TOKEN" \
  -d "{\"query\":\"mutation { createUser(createUserInput: { email: \\\"$RANDOM_EMAIL\\\", firstName: \\\"Test\\\", lastName: \\\"User\\\" }) { userId email firstName lastName } }\"}")

if echo "$RESPONSE" | jq -e '.data.createUser' > /dev/null 2>&1; then
  echo -e "${GREEN}✓ Successfully created user${NC}"
  echo "$RESPONSE" | jq '.data.createUser'
else
  echo -e "${RED}✗ Failed to create user${NC}"
  echo "$RESPONSE" | jq '.'
fi
echo ""

echo -e "${GREEN}✓ All authentication tests completed!${NC}"
