# Form Complexity Score Tracking

- Status: active tracking
- Last updated: 2026-06-28
- Scope: Maya new-hire packet hardening score effects

## Score Movement Ledger

| Packet / run | What changed | Score effect | Interpretation |
| --- | --- | --- | --- |
| `packet-medium` direct baseline | Baseline shared dossier | Passed; `known-fields=26/27` in reviewed run | Baseline is already strong enough for most scored form fields. |
| `packet-hard-ownership-v1` | Added ownership/admissibility decoys | Fixture validated; no reviewed live artifact in this tracker | Useful fixture family, but score movement still needs live-run tracking. |
| `packet-hard-conflict-v1` direct | Added stale/current and authority conflicts, but kept clean proof docs | Passed on retry; memory `25/25`, fields `27/27`, wrong `0`, overfill `0` | Did not materially affect scored memory/form results. Exposed JSON-format flakiness and some unscored stale-value storage. |
| `packet-hard-conflict-v1` MCP | Same conflict packet through stored-memory agent path | Passed; memory `25/25`, fields `27/27`, wrong `0`, overfill `0` | MCP handled conflicts. Stale values appeared only in evidence notes, not active wrong values. |
| `packet-hard-required-v1` direct | Removed clean banking proof; made employment title/start only available in correction-thread prose | Passed on retry; memory `23/25`, fields `27/27`, ownership clean `6/6` | Worked for direct memory difficulty. Direct missed `employment.title` and `employment.startDate`. Did not move form score. |
| `packet-hard-required-v1` MCP | Same required-hard packet through stored-memory agent path | Passed; memory `25/25`, fields `27/27`, ownership clean `6/6` | MCP handled the required-hard evidence path better than direct. |
| `packet-hard-required-v2` fixture | Moved scored direct-deposit institution/type evidence into ACH prenote reconciliation with stale and worker-mismatch rows | Fixture validation passed; live run pending | Intended to test whether harder evidence can move existing direct-deposit form score without changing form maps or scorers. Exact Bay Harbor/checking evidence is isolated to doc `037`. |

## Current Lessons

- Ownership/conflict-only packets mostly added adversarial noise while clean
  baseline proof still carried scored fields.
- Required-hard evidence changed the direct memory score only after clean proof
  was removed.
- Form score did not move because the current scored fields do not require
  `employment.title` or `employment.startDate`.
- JSON formatting failures are separate from memory/form quality and should be
  tracked as extraction reliability failures.

## Next Score-Moving Target

To affect form score, make a required-hard fact also be a scored form fact. Do
not make the documents easier just to improve baseline performance.
