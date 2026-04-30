# Easy New File Types Implementation Summary

- Status: shipped
- Scope: backend document analysis, local orchestrator, and dashboard upload validation
- Last updated: 2026-04-30

## What Shipped

This workstream added native markdown support, YAML upload acceptance with provider-compatible normalization, and expanded the local orchestrator to handle additional easy text-like local files.

Shipped behavior:

- backend upload allowlist now accepts:
  - `text/markdown`
  - `application/yaml`
  - `text/yaml`
  - `application/x-yaml`
- backend normalizes YAML-family MIME types to `text/plain` before the Vertex file-analysis call because the provider rejects `application/yaml`
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
- YAML remains a native upload type at the API boundary even though the backend downgrades it to `text/plain` internally for provider compatibility
- config-like formats are still local-orchestrator-only for now; the dashboard remains limited to the backend-native document types

## Tests Run

- `pnpm --filter backend test:db:up`
- `pnpm --filter backend test:db:migrate`
- `pnpm --filter backend exec jest --runInBand src/modules/preferences/document-analysis/preference-extraction.service.spec.ts`
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
- a later real-backend smoke uncovered that Vertex rejects `application/yaml`; the backend now compensates by normalizing YAML-family MIME types to `text/plain` before provider submission

## Remaining Limitations

- config-like formats still rely on local `text/plain` uploads rather than first-class backend MIME handling
- YAML is accepted natively by the backend API, but still depends on provider-aware MIME normalization rather than first-class YAML ingestion by Vertex
- hidden-file support is opt-in and limited to filename-based matching
- dashboard upload verification was limited to lint in this workstream; no authenticated manual browser upload was run here
