# Volume Noise Hardening

- Status: current orientation
- Last updated: 2026-06-29
- Scope: Maya packet volume/noise corpora, order experiments, and live-run
  interpretation

## Current Corpora

| Corpus | Purpose | Current read |
| --- | --- | --- |
| `packet-hard-volume-v1` | 100-document long-context and document-order smoke test based on `packet-medium`. | Useful for testing runner caps, packet metadata, and order controls, but many added distractors are easy to dismiss. |
| `packet-hard-volume-v2` | 100-document realistic noisy retrieval benchmark with near-miss, operational, and broad process artifacts. | Preferred volume/noise benchmark for Maya. It keeps the same canonical answers and form scenarios while applying stronger distractor pressure. |

Keep volume/noise separate from ownership, conflict, and required-evidence
hardening. These packets test long-context retrieval, distractor resistance,
and document-order sensitivity without changing Maya truth or the form surfaces.

## Score Reading

For packet comparisons, read the metrics in this order:

1. Forms: `knownFieldCorrect`, `abstentionAbsentCorrect`, and `overfillCount`.
2. Value presence: `memoryKnownValuePresent`.
3. Strict memory shape: `memoryKnownRecovered`.

When value presence is clean but strict memory is lower, inspect
`memoryKnownPresentAsCompositeOrAlias` and `memoryKnownGenuinelyMissing`.
For example, a full-address memory row can make value presence `25/25` while
strict memory remains lower because the address was not stored as separate
street, unit, city, state, and postal-code rows.

## Recommended Runs

Use `packet-hard-volume-v2` for current volume/noise checks:

```bash
pnpm eval:direct-open-schema-packet --user maya-chen-newhire --corpus packet-hard-volume-v2 --scenarios maya-chen-newhire-i9-packet-hard-volume-v2,maya-chen-newhire-fw4-packet-hard-volume-v2,maya-chen-newhire-direct-deposit-packet-hard-volume-v2 --artifacts-root /private/tmp/maya-noise-direct-volume-v2-canonical --document-order canonical --max-evidence-chars 1000000
```

Repeat with:

```bash
--document-order relevant-last
--document-order seeded-random --document-order-seed seed-c
--document-order reverse
```

Run MCP packet variants for canonical and `relevant-last` when the backend,
Claude CLI, and MCP config are available. Add MCP `reverse` or seeded-random
runs only when full-path order pressure is the question.

## Related Docs

- `implementation-plan.md`: v1 volume/order plan.
- `implementation-summary.md`: v1 implementation and learning summary.
- `volume-v2-realistic-noise/implementation-plan.md`: v2 corpus plan.
- `volume-v2-realistic-noise/implementation-summary.md`: v2 corpus
  implementation status and validation notes.
- `../packet-history.md`: durable live-result summaries.
