# Maya Packet Difficulty Matrix

- Status: current index
- Last updated: 2026-06-29
- Scope: Maya new-hire packet difficulty families and when to use each one

## Purpose

Use this as the cross-family index for the Maya packet hardening work. The
individual implementation docs remain the source of detail for each corpus, but
this file answers the planning question:

```text
Which packet should we run or improve next, and what kind of failure would it
explain?
```

The current recommendation is to keep difficulty families separate. Avoid one
mega corpus for now. A mega corpus could be useful later, but today it would
make failures harder to attribute: a bad score might be caused by volume,
ownership confusion, stale conflict, required-evidence parsing, form-fill
normalization, or scorer shape all at once.

## Quick Read

| Goal | Use this first | Why |
| --- | --- | --- |
| Compare against the normal shared dossier baseline | `packet-medium` | Baseline Maya packet with 30 documents and the same three form scenarios. |
| Test long-context volume, realistic distractors, and document order | `packet-hard-volume-v2` | Best current volume/noise corpus. It keeps truth and forms unchanged while adding 100 realistic documents. |
| Test whether non-Maya facts leak into memory/forms | `packet-hard-ownership-v1` | Focused ownership/admissibility fixture with other-person and mixed-thread decoys. |
| Test stale/current and authority resolution | `packet-hard-conflict-v1` | Focused conflict/temporal fixture without stacking ownership changes. |
| Move form score by making evidence paths harder | `packet-hard-required-v4` | Best current required-evidence fixture. It forces scored values through multi-hop lookup paths while keeping volume/order out of scope. |

## Matrix

| Difficulty family | Core question | Current corpus status | What changes | Primary failure signal | Detailed docs |
| --- | --- | --- | --- | --- | --- |
| Baseline packet | Can the system handle the ordinary Maya shared dossier? | `packet-medium` is the comparison baseline. | 30 documents with truth-bearing records plus obvious stale and other-person distractors. | Form correctness and abstention behavior should mostly be clean. Failures here are not hardening-specific. | `README.md`, `packet-history.md` |
| Volume/noise | Can the system retrieve and retain the right facts when many plausible but mostly irrelevant files are present? | `packet-hard-volume-v1` is a long-context/order smoke test. `packet-hard-volume-v2` is the preferred realistic noisy retrieval benchmark. | Adds 100 total documents and order variants while preserving canonical Maya truth, form surfaces, and expected answers. | Score differences by `canonical`, `reverse`, `relevant-last`, or seeded-random order; wrong or missing facts caused by distractor pressure; value presence vs strict memory-shape differences. | `volume-noise-hardening/README.md`, `volume-noise-hardening/volume-v2-realistic-noise/implementation-summary.md` |
| Ownership/admissibility | Is this real fact owned by Maya, or by another person, contact, manager, sample, or institution? | `packet-hard-ownership-v1` is implemented and validated. Live score movement still needs durable tracking. | Adds subtle other-person and mixed-context decoys on top of `packet-medium`. | Non-Maya values in active memory, direct extraction, filled forms, or suspicious unscored active preferences. | `make-forms-harder/ownership-hardening/implementation-summary.md` |
| Conflict/staleness | This may belong to Maya, but multiple sources disagree. Which source wins? | `packet-hard-conflict-v1` is implemented, validated, and has live tracking. | Adds stale, draft, before/after, and lower-authority current-vs-old documents while keeping ownership isolated. | Losing values such as old bank, old address/email, draft employment, or draft W-4 values beat current/high-authority values. | `make-forms-harder/conflict-hardening/implementation-summary.md`, `TRACKING.md` |
| Required evidence | Does the model actually read and resolve the hard evidence path when clean proof is removed? | `packet-hard-required-v1` through `v4` are implemented. `v4` is the current score-moving version. | Removes easy proof paths and makes scored answers require audit rows, reconciliation exports, codebooks, or multi-hop lookup. | Missing or wrong scored fields, especially direct-deposit account type/institution and W-4 filing status; memory misses on required facts; normalization issues separated from evidence failures. | `make-forms-harder/required-hardening-v4/implementation-summary.md`, `TRACKING.md` |

## Reading Scores

Read packet results in this order:

1. Pipeline status: did the runner actually complete with the expected tools and
   artifacts?
2. Form outcome: `knownFieldCorrect`, `abstentionAbsentCorrect`, and
   `overfillCount`.
3. Value retention: `memoryKnownValuePresent`.
4. Strict memory shape: `memoryKnownRecovered`.
5. Family-specific leakage or target misses: non-Maya ownership values, stale
   conflict values, unresolved code labels, or genuinely missing required
   evidence values.

Do not over-interpret strict memory misses when value presence and form score
are clean. Those are often storage-shape diagnostics unless the target of the
experiment is memory schema shape.

## Combination Policy

Do not merge all hardening changes into a single mega corpus yet.

Combine families only when the question requires it and the base families are
already interpretable:

| Combination | Current recommendation | Reason |
| --- | --- | --- |
| Volume + required evidence | Plan later as a separate labeled corpus, not by editing v2 or v4 in place. | This could become the strongest benchmark, but failures would mix long-context retrieval with multi-hop evidence resolution. |
| Volume + ownership | Defer. | First understand whether ownership leakage appears in smaller focused packets. |
| Volume + conflict/staleness | Defer. | Order and length effects could obscure whether stale values won because of authority reasoning or context position. |
| Ownership + conflict | Use only for required-evidence style experiments. | `packet-hard-required-*` already stacks some ownership/conflict pressure because the question is whether the hard evidence path is necessary. |

When a combined corpus is eventually useful, give it a new labeled family such
as `packet-hard-volume-required-v1`. Do not mutate `packet-hard-volume-v2` or
`packet-hard-required-v4`; preserving those baselines keeps comparisons
understandable.

## Maintenance Rules

- Update this matrix when a new corpus family becomes the recommended default.
- Keep live results in `TRACKING.md` or `packet-history.md`, not in this index.
- Keep implementation details in each family's `implementation-summary.md`.
- If a new packet changes shared runner behavior, scorer contracts, backend
  form-fill behavior, MCP behavior, or form maps, document that separately from
  corpus difficulty.
