# Local Orchestrator

Local-first batch preference import client for Context Router.

This package treats the backend as an external service. It discovers files locally, optionally filters them, sends eligible files to the backend for analysis, optionally applies accepted suggestions, and writes a local summary/manifest.

## Run

```bash
pnpm --filter local-orchestrator start -- \
  --folder ./my-files \
  --token "$CONTEXT_ROUTER_BEARER_TOKEN"
```

To persist accepted suggestions instead of running in dry-run mode:

```bash
pnpm --filter local-orchestrator start -- \
  --folder ./my-files \
  --token "$CONTEXT_ROUTER_BEARER_TOKEN" \
  --apply
```

To enable local AI filtering with the `command` adapter:

```bash
pnpm --filter local-orchestrator start -- \
  --folder ./my-files \
  --token "$CONTEXT_ROUTER_BEARER_TOKEN" \
  --ai-filter \
  --ai-filter-stage both \
  --ai-command ./scripts/filter-preferences.js \
  --ai-goal "Only keep durable communication, workflow, and tooling preferences"
```

## AI Filtering

- AI filtering is off by default.
- `--ai-goal` is required whenever `--ai-filter` is enabled.
- `--ai-filter-stage` supports `suggestion`, `file`, and `both`.
- `--ai-command` must point to an executable that reads one JSON request from `stdin` and writes one JSON response to `stdout`.
- Suggestion-stage AI only narrows backend-accepted suggestions.
- File-stage AI is text-first in V1. Non-text-like files bypass local file-stage AI and still follow normal backend analysis rules.

### Command Adapter Contract

Suggestion-stage requests contain:

- run goal
- discovered file metadata
- backend analysis metadata
- backend-accepted suggestions
- backend-filtered suggestions for context

Suggestion-stage responses must return exactly one decision per input suggestion:

- `suggestionId`
- `action` as `apply` or `skip`
- `reason`
- optional `score` from `0` to `1`
- optional `details`

File-stage requests contain:

- run goal
- discovered file metadata
- a bounded UTF-8 preview for text-like files

File-stage responses must return one decision:

- `action` as `analyze` or `skip`
- `reason`
- optional `score` from `0` to `1`
- optional `details`

### Failure Behavior

- Dry-run adapter failures fall back to passthrough suggestion decisions for that file, mark the run degraded, and still exit non-zero.
- Apply-mode suggestion-stage adapter failures skip apply for that file, record the failure, continue the rest of the run, and still exit non-zero.
- File-stage adapter failures fall back to analyzing the file and record the fallback in the manifest.
- Invalid JSON, malformed decisions, bad command invocations, and timeouts are all treated as adapter failures.

## Notes

- Dry-run is the default.
- Hidden files and directories are skipped by default.
- Common local text-like files such as `.md`, `.markdown`, `.yml`, and `.yaml` are uploaded as `text/plain` in V1.
- All runs emit manifest schema `version: 2`, even when AI filtering is disabled.
- Accepted AI-filtered suggestions add `filterAudit` metadata to the apply evidence payload so local decisions can be correlated with backend audit history by `analysisId`.
- Re-running the orchestrator on the same folder is safe, but V1 does not deduplicate by file hash or prior run state.
- The bearer token is not refreshed automatically during long runs.
