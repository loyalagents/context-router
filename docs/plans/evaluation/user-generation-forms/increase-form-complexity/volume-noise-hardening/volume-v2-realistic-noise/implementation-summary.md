# Packet Hard Volume v2 Realistic Noise Summary

- Status: implemented
- Last updated: 2026-06-29
- Scope: `packet-hard-volume-v2` corpus and scenarios

## Implemented

- Added `packet-hard-volume-v2` for Maya Chen under
  `examples/eval/users/maya-chen-newhire/corpora/`.
- Added 100 total documents and about 227k source characters.
- Preserved the canonical Maya truth by copying the 20 truth-bearing
  `packet-medium` documents into the v2 packet.
- Added 80 new realistic volume documents:
  - 35 near-miss documents.
  - 25 operational distractors.
  - 20 broad policy, system, or process artifacts.
- Avoided `noise`, `templates`, and `reference` top-level document folders in
  the v2 additions.
- Added three packet scenarios:
  `maya-chen-newhire-i9-packet-hard-volume-v2`,
  `maya-chen-newhire-fw4-packet-hard-volume-v2`, and
  `maya-chen-newhire-direct-deposit-packet-hard-volume-v2`.

## Corpus Notes

- This is a corpus-first hardening pass. Runner interfaces are unchanged.
- The manifest uses the existing `realistic-generated` schema value because the
  schema currently allows only `realistic-generated` and `template-smoke`.
- The distractor folders are more realistic than v1, but manifest categories
  remain mapped onto the existing category enum for schema compatibility.
- The v2 body text has zero matches for the explicit self-disqualifying cue
  set checked during implementation: `do not use`, `context only`, `sample`,
  `template`, `fake`, `not relevant`, and `not authoritative`.
- The copied truth-bearing documents retain the same validation warnings already
  seen in the medium/v1 family, mostly length-target, native-signal, and
  phone-like support-number warnings.

## Verification

- Corpus validation command:
  `node examples/eval/scripts/validate.mjs --user maya-chen-newhire --corpus packet-hard-volume-v2 --report-out examples/eval/users/maya-chen-newhire/corpora/packet-hard-volume-v2/validation-report.json`
- Corpus validation result: pass, 0 errors, 29 warnings.
- Scenario validation result: all three `packet-hard-volume-v2` scenarios pass
  with 0 errors.
- Focused test commands:
  - `node --test examples/eval/scripts/direct-open-schema-packet.test.mjs`
  - `node --test examples/eval/scripts/e2e-mcp-packet.test.mjs`
  - `node --test examples/eval/scripts/fill-form-from-docs.test.mjs`
  - `node --test examples/eval/scripts/validate.test.mjs`
- Focused test result: 91/91 passing.

## Live Run Defaults

Use a larger direct evidence cap:

```bash
pnpm eval:direct-open-schema-packet --user maya-chen-newhire --corpus packet-hard-volume-v2 --scenarios maya-chen-newhire-i9-packet-hard-volume-v2,maya-chen-newhire-fw4-packet-hard-volume-v2,maya-chen-newhire-direct-deposit-packet-hard-volume-v2 --artifacts-root /private/tmp/maya-noise-direct-volume-v2-canonical --document-order canonical --max-evidence-chars 1000000
```

Repeat with:

```bash
--document-order relevant-last
--document-order seeded-random --document-order-seed seed-a
--document-order seeded-random --document-order-seed seed-b
--document-order seeded-random --document-order-seed seed-c
```

Use matching `--document-order` values for MCP packet runs when backend and MCP
credentials are available.
