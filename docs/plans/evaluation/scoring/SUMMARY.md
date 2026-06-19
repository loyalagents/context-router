# Evaluation Scoring Summary

- Status: current state summary
- Last reviewed: 2026-06-19
- Canonical runbooks: [`examples/eval/README.md`](../../../../examples/eval/README.md) and [`examples/eval/PLAYBOOK.md`](../../../../examples/eval/PLAYBOOK.md)

## Current State

The scoring stack is implemented under `examples/eval/` and is artifact-first:

- Known-schema database scoring reads `stored-preferences.json`.
- Form scoring reads `filled-form.json`.
- Combined reports join memory and form outcomes by fixture fact key.
- Exporters snapshot backend memory through existing authenticated GraphQL APIs.
- `eval:e2e-known-schema` runs validation, document ingestion, memory export,
  DB scoring, backend form fill, form scoring, and combined scoring.
- `eval:e2e-mcp-agent` can run known-schema or open-schema MCP agent flows and
  reuse the same scoring boundaries.
- Open-schema scoring reads `memory-snapshot.json` and reports active-memory
  value recovery before schema diagnostics.
- `eval:direct-open-schema` provides a no-storage Vertex baseline for extracting
  facts from declared corpus documents and filling the form directly.

Historical live smoke results proved the runners can produce useful research
artifacts, but those scores are dated smoke evidence, not benchmark guarantees.
Use fresh artifact directories when comparing backend or model changes.

## Stable Command Pointers

See the canonical runbooks for full environment setup and arguments. The stable
entrypoints are:

```bash
pnpm eval:verify
pnpm eval:score --help
pnpm eval:e2e-known-schema --help
pnpm eval:e2e-mcp-agent --help
pnpm eval:direct-open-schema --help
pnpm eval:compare-runs --help
```

Live runs can include corpus PII and transcripts. Keep generated artifact roots
out of commits unless a plan explicitly calls for a curated example bundle.
