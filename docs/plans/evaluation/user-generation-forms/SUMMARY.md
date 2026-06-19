# User Generation Forms Summary

- Status: current state summary
- Last reviewed: 2026-06-19
- Canonical runbooks: [`examples/eval/README.md`](../../../../examples/eval/README.md) and [`examples/eval/PLAYBOOK.md`](../../../../examples/eval/PLAYBOOK.md)

## Current State

The synthetic-user and form-evaluation fixture system lives under
`examples/eval/`.

- `profile.yaml` is the source of truth for user facts.
- `seed-preferences.generated.json` is generated from profile
  `seedPreferences[]` and bridges fixture fact keys to backend preference slugs.
- `manifest.json` is the V2 corpus contract for both deterministic template
  corpora and realistic generated corpora.
- Template scaffold is deterministic and uses repo-local `.mjs` templates.
- Realistic corpus generation follows the manifest flow:
  `plan -> generate preview -> repair -> promote -> validate`.
- Validation checks schemas, references, field maps, seed determinism, document
  inventory, corpus truth, generated structured files, source realism warnings,
  and scenario snapshot shape.
- The deterministic runner hydrates backend memory from fixture truth and
  compares filled-form snapshots. It does not measure document extraction.

Current committed users and corpora:

- `alex-i9-test` with a 10-document realistic I-9 corpus.
- `elena-marquez` with a template-smoke I-9 corpus and scenario.
- `samir-desai` with a template-smoke I-9 corpus and scenario.

Validation currently passes for the Alex realistic corpus, but it still has
warning-level realism and source-signal issues. Treat it as useful coverage,
not as a benchmark-grade corpus.

There are multiple form PDFs and generated field manifests, but only I-9
currently has a hand-authored `field-map.json`.

## Important Boundary

The current deterministic fixtures are useful for plumbing, regression checks,
and form-fill snapshot stability. They are not yet a full extraction benchmark.
A document-ingestion benchmark still needs extraction snapshots, stronger corpus
truth coverage, and scoring that compares extracted facts against fixture truth.

## Stable Command Pointers

See the canonical runbooks for full command recipes. The stable entrypoints are:

```bash
pnpm eval:verify
pnpm eval:derive-seeds
pnpm eval:scaffold --help
pnpm eval:plan-corpus --help
pnpm eval:generate --help
pnpm eval:validate --help
```
