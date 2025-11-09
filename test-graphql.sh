#!/bin/bash

echo "Testing GraphQL API..."
echo ""

echo "1. Testing health endpoint:"
curl -s http://localhost:3000/health | jq '.'
echo ""

echo "2. Query all users:"
curl -s http://localhost:3000/graphql \
  -H 'Content-Type: application/json' \
  -d '{"query":"{ users { userId email firstName lastName createdAt updatedAt } }"}' | jq '.'
echo ""

echo "3. Create a new user:"
curl -s http://localhost:3000/graphql \
  -H 'Content-Type: application/json' \
  -d '{"query":"mutation { createUser(createUserInput: { email: \"test@example.com\", firstName: \"Test\", lastName: \"User\" }) { userId email firstName lastName } }"}' | jq '.'
echo ""

echo "4. Query all users again (should show 3 users):"
curl -s http://localhost:3000/graphql \
  -H 'Content-Type: application/json' \
  -d '{"query":"{ users { userId email firstName lastName } }"}' | jq '.'
