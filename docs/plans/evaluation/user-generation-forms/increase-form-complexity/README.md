# Increase Form Complexity

- Status: distilled historical context
- Last updated: 2026-06-28
- Scope: shared-dossier form evaluation work before the next hardening pass

## Current Purpose

This folder keeps the compact context for the completed shared-dossier packet
work. Active planning for making the packet harder lives in `make-forms-harder/`.

Canonical eval runbooks remain:

- `examples/eval/README.md`
- `examples/eval/PLAYBOOK.md`

Current hardening docs:

- `make-forms-harder/orchestration.md`: ordered plan, checkpoints, packet
  labels, validation commands, and recommended PR boundaries.
- `make-forms-harder/brainstorm.md`: rationale and examples for ownership,
  conflict/temporal validity, evidence confidence, tagging, and scoring.

## Current PR Plan

Keep the planning docs separate from fixture implementation, but combine
skeleton setup with the first useful document batch for each hard packet.

Recommended sequence:

1. Planning docs for the hardening approach.
2. `packet-hard-ownership-v1`: corpus skeleton, first ownership trap batch,
   manifest metadata, validation report, scenarios, and implementation
   summary.
3. Ownership live-results summary plus any tiny directly related cleanup.
4. `packet-hard-conflict-v1`: corpus skeleton, first conflict/temporal trap
   batch, manifest metadata, validation report, scenarios, and implementation
   summary.
5. Conflict live-results summary plus any tiny directly related cleanup.

Split separately if a change touches shared eval tooling, scoring contracts,
backend form-fill behavior, MCP behavior, or runner semantics. Keep ownership
and conflict packets in separate implementation PRs so failures stay
interpretable.

## Durable Decisions

- Keep `profile.yaml` as the only canonical user-truth file.
- Add difficulty through corpus evidence first, not new product behavior.
- Reuse the V2 corpus manifest shape: `forms[]`, document roles, source specs,
  fact contracts, challenge tags, and intentionally missing facts.
- Use one shared dossier plus multiple normal one-form scenarios instead of a
  new multi-form scenario schema.
- Keep form maps narrow. Skip signatures, attestations, employer-only fields,
  certification boxes, worksheet fields, split digit boxes, and ambiguous
  fields until they are deliberately evaluated.
- Use live open-schema evaluation as the headline signal:

```text
stored-memory MCP:
  docs -> live open-schema storage in backend DB -> fill packet forms

direct Vertex baseline:
  docs -> one open-schema extraction artifact -> fill packet forms without DB memory
```

Known-schema and deterministic `eval:run` are useful debugging aids, but they do
not measure document ingestion quality for these packet fixtures.

## Packet Shape

The first shared packet uses Maya Chen as a synthetic new-hire:

```text
user: maya-chen-newhire
forms: i-9, fw4, direct-deposit-sf1199a-24
```

The packet added tax, banking, employment, work authorization, identity,
contact, and form-ready address facts. Maya intentionally has
`contact.phone: null`, so phone fields are abstention tests.

Implemented corpora:

| Corpus | Shape | Purpose |
| --- | --- | --- |
| `packet-small` | 8 docs, about 6.5 KB | Plumbing and correctness slice. |
| `packet-medium` | 30 docs, about 68 KB | Larger shared dossier with obvious stale and other-person distractors. |

Implemented packet scenarios:

- `maya-chen-newhire-i9-packet-small`
- `maya-chen-newhire-fw4-packet-small`
- `maya-chen-newhire-direct-deposit-packet-small`
- `maya-chen-newhire-i9-packet-medium`
- `maya-chen-newhire-fw4-packet-medium`
- `maya-chen-newhire-direct-deposit-packet-medium`

## Runner State

Useful entrypoints:

```bash
pnpm eval:e2e-mcp-packet
pnpm eval:direct-open-schema-packet
pnpm eval:compare-runs
```

Packet-level reporting writes one memory/extraction score plus per-form score
reports. `status: pass` means the pipeline completed; use `qualitySummary` and
the score reports to judge quality.

## Historical Summary

For the distilled implementation history and known packet-small/medium results,
see `packet-history.md`.
