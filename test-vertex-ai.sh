#!/bin/bash

# Test script for Vertex AI integration
# Usage: ./test-vertex-ai.sh [BEARER_TOKEN]

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

TOKEN="${1:-${CONTEXT_ROUTER_BEARER_TOKEN:-}}"
if [ -z "$TOKEN" ]; then
  echo -e "${RED}Error: provide a bearer token as the first argument or CONTEXT_ROUTER_BEARER_TOKEN.${NC}"
  echo "Usage: ./test-vertex-ai.sh [BEARER_TOKEN]"
  exit 1
fi

echo -e "${BLUE}Testing Vertex AI GraphQL endpoint...${NC}\n"

# GraphQL query
QUERY='{"query":"query { askVertexAI(message: \"What is 2+2? Please answer in one short sentence.\") }"}'

# Make the request
RESPONSE=$(curl -s -X POST http://localhost:3000/graphql \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d "$QUERY")

# Check if request was successful
if [ $? -eq 0 ]; then
  echo -e "${GREEN}✓ Request successful${NC}\n"
  echo -e "${BLUE}Response:${NC}"
  echo "$RESPONSE" | jq '.' 2>/dev/null || echo "$RESPONSE"
else
  echo -e "${RED}✗ Request failed${NC}"
  exit 1
fi
