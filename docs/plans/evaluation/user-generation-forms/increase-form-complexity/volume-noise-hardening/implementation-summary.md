# Packet Volume and Order Hardening Summary

- Status: implemented
- Last updated: 2026-06-28
- Scope: `packet-hard-volume-v1`, packet document ordering, and direct evidence
  cap controls

## Implemented

- Added packet-runner document ordering modes:
  `canonical`, `reverse`, `seeded-random`, `relevant-first`, and
  `relevant-last`.
- Added `--max-evidence-chars` to direct-document runners while preserving the
  previous 200000-character default.
- Added packet artifact metadata for document count, char counts, evidence cap,
  order mode, order seed, and ordered document ids.
- Added `packet-hard-volume-v1` planning docs in this folder.
- Added `packet-hard-volume-v1` with 100 documents and about 300k characters.
  The corpus starts from `packet-medium` and adds 70 realistic HR, payroll,
  tax, work-authorization, support, template, vendor, and team-context
  distractor artifacts.
- Added three packet scenarios:
  `maya-chen-newhire-i9-packet-hard-volume-v1`,
  `maya-chen-newhire-fw4-packet-hard-volume-v1`, and
  `maya-chen-newhire-direct-deposit-packet-hard-volume-v1`.

## Verification

- Corpus validation command:
  `node examples/eval/scripts/validate.mjs --user maya-chen-newhire --corpus packet-hard-volume-v1 --report-out examples/eval/users/maya-chen-newhire/corpora/packet-hard-volume-v1/validation-report.json`
- Corpus validation result: pass, 0 errors, 46 warnings.
- Scenario validation result: all three `packet-hard-volume-v1` scenarios pass
  with 0 errors.
- Focused test command:
  `node --test examples/eval/scripts/packet-documents.test.mjs examples/eval/scripts/direct-open-schema-packet.test.mjs examples/eval/scripts/e2e-mcp-packet.test.mjs examples/eval/scripts/fill-form-from-docs.test.mjs examples/eval/scripts/validate.test.mjs`
- Focused test result: 92/92 passing.
- Live Vertex/MCP packet runs were not run in this pass; they require external
  model/backend credentials and should be recorded in `packet-history.md` once
  useful durable results exist.

## Notes

- `packet-medium` remains unchanged.
- `packet-hard-volume-v1` isolates volume/noise rather than combining with the
  ownership, conflict, or required-evidence packets.
- `packet-history.md` should only receive durable live-result summaries after
  useful live runs exist.
