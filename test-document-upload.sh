#!/bin/bash
# Test script for document upload feature
# Usage: ./test-document-upload.sh <JWT_TOKEN>

set -e

TOKEN=${1:-$TOKEN}
BACKEND_URL=${BACKEND_URL:-http://localhost:3000}

if [ -z "$TOKEN" ]; then
    echo "Usage: ./test-document-upload.sh <JWT_TOKEN>"
    echo "Or set TOKEN environment variable"
    exit 1
fi

echo "=== Testing Document Upload Feature ==="
echo "Backend URL: $BACKEND_URL"
echo ""

# Create a test document
TEST_FILE=$(mktemp /tmp/test-preferences.XXXXXX.txt)
cat > "$TEST_FILE" << 'EOF'
Patient Information Form

Name: John Doe
Date: 2024-01-15

Dietary Restrictions:
- Allergic to peanuts (severe)
- Lactose intolerant
- No shellfish

Food Preferences:
- Vegetarian diet preferred
- Favorite cuisine: Italian

Travel Preferences:
- Prefer window seat on flights
- Business class when available
- Hilton loyalty program member
EOF

echo "Test file created: $TEST_FILE"
echo "Contents:"
cat "$TEST_FILE"
echo ""
echo "---"

echo ""
echo "=== Uploading document for analysis ==="
echo ""

RESPONSE=$(curl -s -X POST "$BACKEND_URL/api/preferences/analysis" \
    -H "Authorization: Bearer $TOKEN" \
    -F "file=@$TEST_FILE;type=text/plain")

echo "Response:"
echo "$RESPONSE" | jq . || echo "$RESPONSE"

# Cleanup
rm -f "$TEST_FILE"

echo ""
echo "=== Test complete ==="
