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

## Notes

- Dry-run is the default.
- Hidden files and directories are skipped by default.
- Common local text-like files such as `.md`, `.markdown`, `.yml`, and `.yaml` are uploaded as `text/plain` in V1.
- Re-running the orchestrator on the same folder is safe, but V1 does not deduplicate by file hash or prior run state.
- The bearer token is not refreshed automatically during long runs.
