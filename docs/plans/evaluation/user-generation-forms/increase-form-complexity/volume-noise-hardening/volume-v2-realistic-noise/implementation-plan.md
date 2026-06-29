# Packet Hard Volume v2 Realistic Noise Plan

- Status: implemented plan
- Last updated: 2026-06-29
- Scope: `packet-hard-volume-v2` corpus and scenarios

## Goal

Add a second Maya volume/noise packet that keeps the same canonical form truth as
`packet-medium` and `packet-hard-volume-v1`, but replaces obvious filler with
more realistic operational artifacts and near misses.

`packet-hard-volume-v2` is a corpus-only hardening pass. It does not change
runner interfaces, form PDFs, field maps, expected answers, or Maya's canonical
profile.

## Corpus Shape

- 100 total documents.
- 20 truth-bearing Maya documents copied from the authoritative
  `packet-medium` evidence set.
- 35 near-miss documents, including same-employer records for nearby people and
  stale Maya archive rows.
- 25 operational distractors, including support cases, audit logs, payroll
  import notes, HRIS records, and vendor queue artifacts.
- 20 broad process artifacts, including policy, system, and runbook-style
  documents.

The new distractors avoid `documents/noise/`, `documents/templates/`, and
`documents/reference/` paths. Manifest categories stay on the existing eval
schema enum, while document paths use more realistic folders such as
`banking-ops`, `support-cases`, `hris-audit`, `systems`, and `compliance`.

## Authoring Rules

- Do not use deterministic eval templates for this corpus.
- Keep final documents hand-authored or manually reviewed.
- Prefer native source signals over self-disqualifying prose:
  source system, worker id, timestamp, status, field ids, queue owner, control
  totals, audit rows, and reviewer notes.
- Avoid obvious body/path cues such as "sample", "template", "fake",
  "context only", "not relevant", and "not authoritative".
- Keep the withheld Maya phone value absent from all model-visible documents.

## Scenarios

Add packet scenarios for the same three forms:

- `maya-chen-newhire-i9-packet-hard-volume-v2`
- `maya-chen-newhire-fw4-packet-hard-volume-v2`
- `maya-chen-newhire-direct-deposit-packet-hard-volume-v2`

Each scenario should remain a live open-schema packet scenario with empty
`expectedSnapshots`; scoring continues to use the existing form maps and Maya
profile truth.

## Verification

Run fixture validation:

```bash
node examples/eval/scripts/validate.mjs --user maya-chen-newhire --corpus packet-hard-volume-v2 --report-out examples/eval/users/maya-chen-newhire/corpora/packet-hard-volume-v2/validation-report.json
```

Run scenario validation:

```bash
node examples/eval/scripts/validate.mjs --scenario maya-chen-newhire-i9-packet-hard-volume-v2
node examples/eval/scripts/validate.mjs --scenario maya-chen-newhire-fw4-packet-hard-volume-v2
node examples/eval/scripts/validate.mjs --scenario maya-chen-newhire-direct-deposit-packet-hard-volume-v2
```

Run focused script tests:

```bash
node --test examples/eval/scripts/direct-open-schema-packet.test.mjs
node --test examples/eval/scripts/e2e-mcp-packet.test.mjs
node --test examples/eval/scripts/fill-form-from-docs.test.mjs
node --test examples/eval/scripts/validate.test.mjs
```

Run live direct/MCP comparisons only after validation is clean. Use
`--max-evidence-chars 1000000` for direct packet runs and compare canonical,
`relevant-last`, and seeded-random ordering.
