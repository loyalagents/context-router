#!/bin/bash

# Test script for bearer authentication
# Usage: ./test-auth.sh <BEARER_TOKEN>

set -e

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

TOKEN="${1:-${CONTEXT_ROUTER_BEARER_TOKEN:-}}"
API_URL=${API_URL:-http://localhost:3000/graphql}

if [ -z "$TOKEN" ]; then
  echo -e "${RED}Error: provide a bearer token as the first argument or CONTEXT_ROUTER_BEARER_TOKEN${NC}"
  echo "Usage: ./test-auth.sh <YOUR_TOKEN>"
  echo ""
  echo "Obtain a valid token from the identity provider configured for this environment."
  exit 1
fi

echo -e "${YELLOW}Testing bearer authentication...${NC}"
echo ""

# Test 1: Health check (no auth required)
echo -e "${YELLOW}1. Testing health endpoint (no auth):${NC}"
curl -s http://localhost:3000/health | jq '.'
echo ""

# Test 2: Protected query without token (should fail)
echo -e "${YELLOW}2. Testing protected query WITHOUT token (should fail):${NC}"
RESPONSE=$(curl -s $API_URL \
  -H 'Content-Type: application/json' \
  -d '{"query":"{ me { userId email } }"}')

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
  -d '{"query":"{ me { userId email createdAt updatedAt } }"}')

if echo "$RESPONSE" | jq -e '.data.me' > /dev/null 2>&1; then
  echo -e "${GREEN}✓ Successfully authenticated${NC}"
  echo "$RESPONSE" | jq '.data.me'
else
  echo -e "${RED}✗ Authentication failed${NC}"
  echo "$RESPONSE" | jq '.'
  exit 1
fi
echo ""

USER_ID=$(echo "$RESPONSE" | jq -r '.data.me.userId')

# Test 4: Query current user by ID with token
echo -e "${YELLOW}4. Testing 'user(id)' query with token:${NC}"
RESPONSE=$(curl -s $API_URL \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $TOKEN" \
  -d "{\"query\":\"{ user(id: \\\"$USER_ID\\\") { userId email createdAt updatedAt } }\"}")

if echo "$RESPONSE" | jq -e '.data.user' > /dev/null 2>&1; then
  echo -e "${GREEN}✓ Successfully fetched current user${NC}"
  echo "$RESPONSE" | jq '.data.user'
else
  echo -e "${RED}✗ Failed to fetch current user${NC}"
  echo "$RESPONSE" | jq '.'
fi
echo ""

# Test 5: Query active preferences
echo -e "${YELLOW}5. Testing activePreferences query (protected):${NC}"
RESPONSE=$(curl -s $API_URL \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"query":"{ activePreferences { id slug value } }"}')

if echo "$RESPONSE" | jq -e '.data.activePreferences' > /dev/null 2>&1; then
  echo -e "${GREEN}✓ Successfully fetched active preferences${NC}"
  echo "$RESPONSE" | jq '.data.activePreferences'
else
  echo -e "${RED}✗ Failed to fetch active preferences${NC}"
  echo "$RESPONSE" | jq '.'
fi
echo ""

echo -e "${GREEN}✓ All authentication tests completed!${NC}"
