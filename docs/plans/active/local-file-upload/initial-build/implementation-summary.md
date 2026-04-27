# Local File Upload: Initial Build Implementation Summary

- Status: implemented
- Read when: understanding what shipped for the first local orchestrator build
- Source of truth: `apps/local-orchestrator/**`
- Last reviewed: 2026-04-26

## What shipped

This change adds a new workspace package:

- `apps/local-orchestrator`

The package is a local-first batch import client for preference extraction. It:

- scans a local folder recursively
- skips hidden files/directories by default
- uploads eligible files to `POST /api/preferences/analysis`
- records backend `suggestions` and `filteredSuggestions`
- applies accepted suggestions through GraphQL `applyPreferenceSuggestions` when `--apply` is set
- prints a local summary
- optionally writes a JSON manifest with `version: 1`

The orchestrator treats the backend as an external service. It does not import Nest services directly.

## CLI shape

Supported flags:

- `--folder <path>` required
- `--backend-url <url>` optional, default `http://localhost:3000`
- `--token <token>` optional if `CONTEXT_ROUTER_BEARER_TOKEN` is set
- `--apply` optional, default off
- `--concurrency <n>` optional, default `1`
- `--out <path>` optional manifest path
- `--file-filter passthrough`
- `--suggestion-filter passthrough`

V1 behavior:

- dry-run by default
- only passthrough file and suggestion filters are implemented
- `.md`, `.markdown`, `.yml`, and `.yaml` are uploaded as `text/plain`
- hidden files and directories are skipped by default

## Important implementation notes

- `applyPreferenceSuggestions` is the V1 writer because it preserves `DOCUMENT_ANALYSIS` origin and inferred provenance.
- The orchestrator preserves the backend-generated `analysisId` and suggestion IDs from the analysis response.
- Backend `filteredSuggestions` are recorded in the manifest and counted in the summary.
- Partial apply success is handled explicitly: the backend may return fewer rows than requested without a GraphQL error, so the orchestrator reconciles requested suggestions against returned slugs and records unmatched items.
- Package tests use `node:test` via `node --import tsx --test ...`. This is a deliberate V1 tradeoff for a lightweight CLI package even though the backend uses Jest.

## Known limitations

- No real local-agent adapter yet; only passthrough filters are implemented.
- No token refresh. Long-running imports may fail if the bearer token expires mid-run.
- No automatic retries or pacing. Higher concurrency increases Vertex AI request volume and quota/cost pressure.
- Markdown/YAML are coerced to `text/plain`, which is practical for V1 but may lose some format-specific extraction quality.
- Re-running the orchestrator on the same folder is safe, but V1 does not deduplicate by file hash or prior run history.
- V1 can only import preferences for slugs that already exist in the preference catalog. Unknown slugs surface in `filteredSuggestions`.

## Tests run

Package gates run successfully:

- `pnpm install`
- `pnpm --filter local-orchestrator build`
- `pnpm --filter local-orchestrator test`
- `pnpm --filter local-orchestrator lint`

The automated package tests cover:

- CLI parsing and defaults
- recursive discovery with real temp-directory fixtures
- hidden-file skipping
- MIME coercion for markdown
- analysis client request shaping
- apply client request shaping
- analysis failure recording
- filtered suggestion recording
- apply request evidence mapping
- manifest versioning and summary counts

## Manual smoke example

Example dry-run:

```bash
pnpm --filter local-orchestrator start -- \
  --folder ./my-files \
  --token "$CONTEXT_ROUTER_BEARER_TOKEN"
```

Example apply run with manifest output:

```bash
pnpm --filter local-orchestrator start -- \
  --folder ./my-files \
  --token "$CONTEXT_ROUTER_BEARER_TOKEN" \
  --apply \
  --out ./tmp/local-orchestrator-manifest.json
```
