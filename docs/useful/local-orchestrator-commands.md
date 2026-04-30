# Local Orchestrator Commands

- Status: useful
- Read when: running the local orchestrator against a local backend
- Last reviewed: 2026-04-29

## Purpose

This is a quick command reference for:

- getting a real user token from the local web app
- verifying which user the token maps to
- running a dry-run import
- applying suggestions for real
- verifying what was written

Important:

- `./get-test-token.sh` returns an M2M token and writes to a mock user
- to write to your actual user, use the token from the web app debug route instead

## Assumptions

- backend is running at `http://localhost:3000`
- web app is running at `http://localhost:3002`
- shell is `fish`

## Get a real user token

1. Log into the web app as the user you want:

   - `http://localhost:3002/auth/login`

2. Open the debug token page:

   - `http://localhost:3002/api/debug/token`

3. Copy the value from **Raw Access Token**

4. Export it in `fish`:

```fish
set -gx CONTEXT_ROUTER_BEARER_TOKEN 'PASTE_TOKEN_HERE'
```

If you want the raw JSON instead of the formatted HTML page, use:

- `http://localhost:3002/api/debug/token?format=json`

## Verify the token maps to the right user

Run this before applying anything:

```fish
curl -s http://localhost:3000/graphql \
  -H 'content-type: application/json' \
  -H "authorization: Bearer $CONTEXT_ROUTER_BEARER_TOKEN" \
  --data '{"query":"query { me { userId email firstName lastName } }"}' | jq
```

If the returned user is wrong, stop and get a different token.

## Dry-run import

This analyzes files and writes a manifest, but does not persist preferences:

```fish
pnpm --filter local-orchestrator start -- \
  --folder /tmp/local-orchestrator-smoke \
  --backend-url http://localhost:3000 \
  --out /tmp/local-orchestrator-manifest.json
```

## Dry-run import with command adapter filtering

This runs both local AI stages through your own command-adapter executable:

```fish
pnpm --filter local-orchestrator start -- \
  --folder /tmp/local-orchestrator-smoke \
  --backend-url http://localhost:3000 \
  --include-hidden \
  --ai-filter \
  --ai-filter-stage both \
  --ai-command ./path/to/filter-preferences.js \
  --ai-goal "Only keep durable communication, workflow, and tooling preferences" \
  --out /tmp/local-orchestrator-ai-manifest.json
```

## Inspect the dry-run suggestions

Show the extracted suggestions per file:

```fish
jq '.files[] | {file: .relativePath, suggestions: .analysis.suggestions}' /tmp/local-orchestrator-manifest.json
```

Show backend-filtered suggestions if any:

```fish
jq '.files[] | {file: .relativePath, filtered: .analysis.filteredSuggestions}' /tmp/local-orchestrator-manifest.json
```

## Apply suggestions for real

This persists accepted suggestions for the user represented by `CONTEXT_ROUTER_BEARER_TOKEN`:

```fish
pnpm --filter local-orchestrator start -- \
  --folder /tmp/local-orchestrator-smoke \
  --backend-url http://localhost:3000 \
  --apply \
  --out /tmp/local-orchestrator-apply.json
```

## Apply suggestions with command adapter filtering

```fish
pnpm --filter local-orchestrator start -- \
  --folder /tmp/local-orchestrator-smoke \
  --backend-url http://localhost:3000 \
  --apply \
  --include-hidden \
  --ai-filter \
  --ai-filter-stage both \
  --ai-command ./path/to/filter-preferences.js \
  --ai-goal "Only keep durable communication, workflow, and tooling preferences" \
  --out /tmp/local-orchestrator-ai-apply.json
```

## Inspect what was applied

Show applied preferences from the apply manifest:

```fish
jq '.files[] | select(.apply) | {file: .relativePath, applied: .apply.appliedPreferences}' /tmp/local-orchestrator-apply.json
```

Show them as a compact list:

```fish
jq -r '.files[] | select(.apply) | .apply.appliedPreferences[] | "\(.slug) = \(.value|tojson) [\(.status)]"' /tmp/local-orchestrator-apply.json
```

## Verify active preferences from the backend

Query the backend using the same token:

```fish
curl -s http://localhost:3000/graphql \
  -H 'content-type: application/json' \
  -H "authorization: Bearer $CONTEXT_ROUTER_BEARER_TOKEN" \
  --data '{"query":"query { activePreferences { id slug value status sourceType } }"}' | jq
```

## Notes

- `--apply` writes `ACTIVE` preferences, not inbox suggestions
- if you omit `--apply`, the run is dry-run only
- if `CONTEXT_ROUTER_BEARER_TOKEN` is already set, you do not need to pass `--token`
- avoiding `--token ...` on the command line is preferable because it prevents the token from being echoed in terminal command output
- the repo does not currently ship provider-specific wrapper scripts; `--ai-command` must point to your own executable that speaks the command-adapter stdin/stdout JSON contract
