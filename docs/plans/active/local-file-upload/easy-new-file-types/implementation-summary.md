# Easy New File Types Implementation Summary

- Status: shipped
- Scope: backend document analysis, local orchestrator, and dashboard upload validation
- Last updated: 2026-04-29

## What Shipped

This workstream added native markdown and YAML support to the document-analysis upload path and expanded the local orchestrator to handle additional easy text-like local files.

Shipped behavior:

- backend upload allowlist now accepts:
  - `text/markdown`
  - `application/yaml`
  - `text/yaml`
  - `application/x-yaml`
- local-orchestrator now uploads:
  - `.md`, `.markdown` as `text/markdown`
  - `.yml`, `.yaml` as `application/yaml`
  - `.toml`, `.ini`, `.cfg`, `.conf`, `.env`, and `.env.*` as `text/plain`
- local-orchestrator adds `--include-hidden`
  - hidden entries are still skipped by default
  - when enabled, hidden files and directories are traversed and supported `.env` files are analyzed normally
- manifest output now uses schema `version: 3`
- manifest config now records `includeHidden`
- file-stage AI previewing still covers markdown and YAML after the native MIME switch
- dashboard single-file upload now accepts markdown and YAML via MIME-or-extension validation

## Key Details

- `.env` support is intentionally narrow:
  - exact `.env`
  - `.env.*`
- broader dotfiles such as `.gitconfig` and `.npmrc` remain out of scope
- markdown and YAML no longer show up as local `text/plain` coercions in orchestrator manifests
- config-like formats are still local-orchestrator-only for now; the dashboard remains limited to the backend-native document types

## Tests Run

- `pnpm --filter backend test:db:up`
- `pnpm --filter backend test:db:migrate`
- `env NODE_ENV=test DATABASE_URL=postgresql://postgres:postgres@localhost:5433/context_router_test pnpm --filter backend exec jest --selectProjects e2e --runInBand test/e2e/document-analysis.e2e-spec.ts`
- `pnpm --filter backend prisma:generate`
- `pnpm --filter local-orchestrator test`
- `pnpm --filter local-orchestrator build`
- `pnpm --filter local-orchestrator lint`
- `pnpm --filter web lint`

Manual smoke:

- ran `pnpm --filter local-orchestrator start -- --folder /tmp/easy-new-file-types-smoke --token smoke-token --backend-url http://127.0.0.1:9 --include-hidden --out /tmp/easy-new-file-types-smoke-manifest.json`
- confirmed manifest `version: 3`, `includeHidden: true`, native markdown/YAML support, `.env.local` discovery, `text/plain` coercion for TOML, and unsupported-file skipping
- the smoke run exited non-zero because the backend URL was intentionally invalid; that was expected for this discovery-focused check

## Remaining Limitations

- config-like formats still rely on local `text/plain` uploads rather than first-class backend MIME handling
- hidden-file support is opt-in and limited to filename-based matching
- dashboard upload verification was limited to lint in this workstream; no authenticated manual browser upload was run here
