# Packet Volume and Order Hardening Summary

- Status: implemented
- Last updated: 2026-06-29
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
- Fixed direct packet failure artifacts so evidence-cap failures still record
  the ordered document ids, document count, source character count, and cap.
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
- Focused test result after the cap-failure metadata fix: 94/94 passing.
- Default-cap failure check:
  `node examples/eval/scripts/direct-open-schema-packet.mjs --user maya-chen-newhire --corpus packet-hard-volume-v1 --scenarios maya-chen-newhire-i9-packet-hard-volume-v1,maya-chen-newhire-fw4-packet-hard-volume-v1,maya-chen-newhire-direct-deposit-packet-hard-volume-v1 --artifacts-root /private/tmp/direct-hard-volume-default-cap-after-fix --model test-model`
- Default-cap failure result: expected failure because the 302333-character
  packet exceeds the 200000-character default cap; the failure report now records
  100 documents, 302333 source characters, cap 200000, and ordered ids.
- Live Vertex/MCP packet runs require external model/backend credentials; keep
  durable result summaries in `packet-history.md` once the team decides which
  runs are useful enough to preserve.

## Manual Run Observations

- Direct `gemini-2.5-pro` packet runs were tried for:
  - `packet-medium` canonical and `relevant-last`.
  - `packet-hard-volume-v1` canonical and `relevant-last`.
- All four direct runs completed with perfect scored form quality:
  `knownFieldCorrect=27/27`, no wrong fields, no missing known fields, and no
  overfills.
- The volume direct runs recovered all known memory facts and abstained on the
  intentionally missing facts: `memoryKnownRecovered=25/25` and
  `memoryMissingAbsent=2/2`.
- The volume packet increased direct extraction prompt size from about 120 KB
  for `packet-medium` to about 330 KB for `packet-hard-volume-v1`, but this did
  not move scored quality for the tested direct model.
- One MCP `packet-hard-volume-v1` canonical run completed with the same scored
  quality: `memoryKnownRecovered=25/25`, `knownFieldCorrect=27/27`,
  `abstentionAbsentCorrect=3/3`, and zero overfills.
- One MCP `packet-hard-volume-v1` `relevant-last` run also completed with the
  same scored quality: `memoryKnownRecovered=25/25`,
  `knownFieldCorrect=27/27`, `abstentionAbsentCorrect=3/3`, and zero
  overfills.

## Random-Order Learning

Five direct `gemini-2.5-pro` seeded-random runs were tried for
`packet-hard-volume-v1` with seeds `seed-a` through `seed-e`.

- Four seeds stayed clean on scored form quality: `knownFieldCorrect=27/27`.
- `seed-c` exposed an order-sensitive regression:
  `memoryKnownRecovered=17/25` and `knownFieldCorrect=26/27`.
- The seed-c direct-deposit form miss was the checking-account checkbox. The
  packet placed the authoritative direct-deposit confirmation near the top of
  the ordered packet, but the model preferred a later bank verification letter
  phrase, storing `Total Access Checking` instead of normalizing the account
  type to `CHECKING`.
- Seed-c also collapsed the mailing address into one composite value instead of
  decomposing street, unit, city, state, and postal-code facts. Form filling
  could still use the composite value, but memory scoring marked the component
  facts missing.

Interpretation: volume/noise hardness is not only about burying relevant facts
late in the packet. A harder and more realistic failure mode is to surround a
fact with adjacent templates, reference docs, samples, and corroborating
artifacts that make the model choose the wrong level of abstraction. In seed-c,
the model saw relevant evidence, but represented it less usefully for downstream
memory scoring and form normalization.

## Notes

- `packet-medium` remains unchanged.
- `packet-hard-volume-v1` isolates volume/noise rather than combining with the
  ownership, conflict, or required-evidence packets.
- The volume scenarios intentionally reuse the same three form fixtures as
  `packet-medium`: `i-9`, `fw4`, and `direct-deposit-sf1199a-24`. The
  hardening surface is the evidence packet, not new PDFs, field maps, or answer
  keys.
- The first 30 volume documents are the `packet-medium` base. Most are
  byte-identical; the few differences are corpus-local ids or batch labels.
- The 70 added documents mostly act as obvious volume/noise rather than close
  competitors for Maya's actual facts. Many are explicitly self-disqualifying:
  they present themselves as samples, templates, reference material, vendor
  notices, context-only artifacts, or records for other people.
- The repeated structure of many added distractors makes that even easier for a
  model to detect. Common summary, handling-guidance, and checklist patterns let
  a model skip families of documents without resolving messy provenance,
  recency, ownership, or field-level contradictions.
- Current interpretation: `packet-hard-volume-v1` is useful as a long-context
  and document-order smoke test, but it is not yet a strong distractor-resistance
  benchmark for capable models.
- `packet-history.md` should only receive durable live-result summaries after
  useful live runs exist.
