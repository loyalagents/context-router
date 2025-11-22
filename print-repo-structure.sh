#!/bin/bash

# Dynamic script to print clean, accurate file structure
# Excludes common noise directories while showing the actual project structure

echo "# Context Router - Project Structure"
echo ""
echo "\`\`\`"

tree -I 'node_modules|dist|.next|build|coverage|.git|*.lock|.cache' \
  -L 4 \
  --dirsfirst \
  -F \
  --charset ascii \
  /Users/lucasnovak/loyal-agents/context-router 2>/dev/null

# Fallback if tree is not installed
if [ $? -ne 0 ]; then
  echo "Tree command not found. Using find instead..."
  echo ""

  find /Users/lucasnovak/loyal-agents/context-router \
    -not -path "*/node_modules/*" \
    -not -path "*/.next/*" \
    -not -path "*/dist/*" \
    -not -path "*/.git/*" \
    -not -path "*/coverage/*" \
    -not -path "*/build/*" \
    -not -name "*.lock" \
    -not -name ".DS_Store" \
    -print | sed -e "s;/Users/lucasnovak/loyal-agents/context-router;.;" | sort | sed -e 's;[^/]*/;|  ;g;s;|  \([^|]\);+--\1;'
fi

echo "\`\`\`"
echo ""
echo "## Key Directories"
echo ""
echo "- **apps/backend**: NestJS GraphQL API with Prisma ORM"
echo "  - **src/modules**: Feature modules (user, preferences, etc.)"
echo "  - **src/mcp**: Model Context Protocol integration"
echo "  - **prisma**: Database schema and migrations"
echo ""
echo "- **apps/web**: Next.js frontend application"
echo "  - **app**: Next.js App Router pages and components"
echo ""
echo "- Root level contains Docker config, environment templates, and utility scripts"
