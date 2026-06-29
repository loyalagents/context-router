# Form Complexity Score Tracking

- Status: active tracking
- Last updated: 2026-06-29
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
| `packet-hard-required-v2` direct baseline | Moved scored direct-deposit institution/type evidence into ACH prenote reconciliation with stale and worker-mismatch rows | Passed; memory `21/25`, fields `26/27`, direct deposit `8/9`, wrong `1`, overfill `0` | Worked as a score-moving packet for the weaker/default direct path. The wrong field was direct-deposit institution: expected `Bay Harbor Credit Union`, got employer name `Pacific Ledger Cooperative`. |
| `packet-hard-required-v2` direct `gemini-2.5-pro` | Same v2 packet with stronger direct extraction model | Passed; memory `24/25`, fields `27/27`, direct deposit `9/9`, ownership clean `6/6` | Did not move form score for the stronger direct model. The only memory miss was `banking.accountHolderName`; form still filled account title from identity name facts, so this is minor. |
| `packet-hard-required-v2` MCP Claude | Same v2 packet through stored-memory agent path and backend form fill | Passed after backend null-value tolerance/logging fix; memory `25/25`, fields `27/27`, direct deposit `9/9`, ownership clean `6/6` | MCP handled the evidence path and form fill. Initial failure was a backend structured-output validation issue (`value: null`), not a memory/scoring failure. |
| `packet-hard-required-v3` direct `gemini-2.5-flash-lite` | Kept v2 banking difficulty and made scored W-4 `tax.filingStatus` require doc `038` resolution evidence | Passed; memory `22/25`, fields `27/27`, W-4 `6/6`, direct deposit `9/9`, ownership clean `7/7` | Moved memory but not form score. Flash-lite missed routing number, account number, and work email; routing/account digit boxes are currently out of scope. |
| `packet-hard-required-v3` direct `gemini-2.5-pro` | Same v3 packet with stronger direct extraction model | Passed; memory `23/25`, fields `27/27`, W-4 `6/6`, direct deposit `9/9`, ownership clean `7/7` | Moved memory but not form score. Pro missed employment title/start, which are not currently scored form fields. |
| `packet-hard-required-v3` MCP Claude | Same v3 packet through stored-memory agent path and backend form fill | Passed; memory `25/25`, fields `27/27`, W-4 `6/6`, direct deposit `9/9`, ownership clean `7/7` | MCP solved the v3 evidence path. |
| `packet-hard-required-v4` fixture | Makes existing scored fields require multi-hop lookup: `banking.institutionName` via doc `039`, `banking.accountType` via doc `040`, and `tax.filingStatus` via doc `041` | Fixture/scenarios validated | Ready for live comparison; v4 intentionally avoids volume/order testing. |
| `packet-hard-required-v4` direct `gemini-2.5-flash-lite` | Same v4 packet with canonical order | Passed; memory `21/25`, fields `26/27`, W-4 `6/6`, direct deposit `8/9`, ownership clean `7/7` | Score moved through the intended target. Flash-lite stored `payroll.direct_deposit.account_type = DDA` instead of resolving `DDA -> checking`, so direct-deposit `xcheck[0]` was missing. |
| `packet-hard-required-v4` direct `gemini-2.5-pro` | Same v4 packet with stronger direct extraction model | Passed; memory `24/25`, fields `26/27`, I-9 `11/12`, W-4 `6/6`, direct deposit `9/9`, ownership clean `7/7` | Score moved, but not through the intended v4 banking/W-4 lookup. Pro resolved `checking`, bank, and filing status, but stored citizenship as `person.citizenship.is_citizen = true` without the accepted `workAuthorization.citizenshipStatus = U.S. citizen`; the fill action tried to check `CB_1`, then condition validation treated it as inactive. |
| `packet-hard-required-v4` MCP Claude | Same v4 packet through stored-memory agent path and backend form fill | Passed; memory `25/25`, fields `27/27`, I-9 `12/12`, W-4 `6/6`, direct deposit `9/9`, ownership clean `7/7` | MCP solved the v4 evidence paths, including `DDA -> checking`, RDFI key to bank name, W-4 choice code to filing status, and I-9 citizenship. |
| `packet-hard-required-v4` Claude Code direct baseline | New direct Claude Code packet runner with strict empty MCP config, restricted tools/config, no backend memory source, and comparable model/thinking metadata | Runner implemented; live score pending | Intended to separate Claude/agentic reasoning from MCP/backend-memory effects. The direct runner is not an OS-level filesystem sandbox. Treat direct-vs-MCP Claude conclusions as provisional until canonical direct and MCP runs record matching `--model` and `--thinking-mode` settings. |

## Current Lessons

- Ownership/conflict-only packets mostly added adversarial noise while clean
  baseline proof still carried scored fields.
- Required-hard evidence changed the direct memory score only after clean proof
  was removed.
- To move form score, required-hard facts need to overlap scored fields and not
  be recoverable from obvious aliases.
- `packet-hard-required-v2` can move score for a weaker/default direct baseline,
  but `gemini-2.5-pro` and MCP Claude handled the scored direct-deposit fields.
- `banking.accountHolderName` is a weak score-moving target because the value is
  identical to Maya's legal name and can be filled from identity facts.
- V3 showed that simply moving W-4 `tax.filingStatus` into a resolution audit
  was not enough; both direct models and MCP recovered it.
- V4 moved direct form score without scorer/form-map changes. Flash-lite failed
  the intended `DDA -> checking` lookup; pro passed the intended v4 lookup but
  exposed a separate boolean-vs-enum citizenship normalization issue.
- MCP Claude handled v4 cleanly, so this packet currently differentiates direct
  open-schema extraction more than the MCP path.
- A Claude Code direct baseline is now available to test whether v4 success is
  due to Claude/agentic reasoning or MCP/backend memory. Historical Claude MCP
  comparisons remain provisional unless the run artifacts record comparable
  model/thinking settings.
- JSON formatting failures are separate from memory/form quality and should be
  tracked as extraction reliability failures.
- Backend structured-output failures are also separate from packet difficulty;
  the observed MCP `value: null` failure was fixed with prompt clarification,
  tolerant parsing, and warning logging.

## Next Score-Moving Target

To affect stronger models' form score, target a scored value that cannot be
resolved from identity or other easy aliases. Do not make the documents easier
just to improve baseline performance.

After v4, the next fixture-only move should make the final scored answer less
literal than `form_label: "checking"` while staying fair. A separate product or
eval-infra follow-up could address direct open-schema normalization, especially
code-to-label values and boolean-to-enum citizenship values.
