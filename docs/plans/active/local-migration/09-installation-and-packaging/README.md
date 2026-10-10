# Step 09: Installation And Packaging

- Status: Candidate 13 finalization; complete-diff reviews and installed/native/live checks passed; full local gate passed; final-head CI tracked on the PR; acceptance/release limits retained
- Coordinator and sole repository writer: `/root`
- Branch: `codex/local-migration-09-installation-and-packaging`, existing checkout
- Planning base: `7328ceea63a784577594d52af18062be8b583855`
- Implementation PR: one cohesive draft [PR #168](https://github.com/loyalagents/context-router/pull/168); not merged
- Supported product today: merged Step 08 source/manual local UI and MCP modes
- Intended outcome: a managed installed application on the explicitly qualified Apple Silicon pilot
- Next action: review exact-head CI and the consolidated acceptance disposition; the manual feedback round is complete
- Last updated: 2026-10-10

The [activation evidence](activation.md) records the exact clean base, all twelve
passing phases and verified cleanup. Step 08 was human-merged as
[PR #167](https://github.com/loyalagents/context-router/pull/167); its
[accepted evidence limits](../08-local-ui/acceptance.md) and Step 06 E/H remain.
Step 09 is the sole primary migration step. Steps 10–11 and the separate MCP
onboarding, UI-usability and [local AI scheduling](../../local-ai-scheduling/README.md)
follow-ups remain inactive/deferred. Scheduling owns bounded waiting and a later
concurrency evaluation after Step 09; it does not change this step's single-operation
contract or defer fixes for automatic status checks blocking otherwise idle uploads.

The [plan](plan.md) follows the [step template](../step-template.md), using one
PR with three internal checkpoints. User authorization covers activation,
planning, independent review, implementation and a draft PR; it does not approve
any additional unreviewed mechanism, a merge or publication. Subsequent user and
independent reviews approved P2.3 implementation. Candidate 13 passed actual
installed-artifact qualification, 180 native tests and the separately approved
bounded live-model series. See [current qualification](qualification-candidate13.json)
and the [acceptance disposition](acceptance.md) for confirmed human flows and
remaining platform, recovery and release limits. Earlier receipts remain historical.
See the [installed runbook](../../../../useful/INSTALLED_MAC_APP.md).

See [review dispositions](reviews.md) for revision-bound approval and
[agreed product directions](../decision-log.md#lm-023-managed-apple-silicon-pilot-in-step-09).

Use the plan's [correction and finalization sequence](plan.md#correction-rounds-and-finalization).
A source/artifact-bound trial app may support a named human retest after its
necessary checks and affected reviews; report "Targeted checks passed; final
validation pending." It is not a final-qualified app. Batch corrections before
full installed qualification, local migration gate, independent final review and
exact-head CI; keep required human acceptance and live-run/safety limits intact.

[Feasibility evidence](feasibility.md) records the passing isolated bundle,
native fixtures and authenticated Node archive, preserving failed runs.
[P2 inputs](implementation-inputs.md) retain concrete reviewer findings; they
are not implementation approval. After P1-N.1 stopped at a checksum-order
preflight, the user authorized the reviewed P1-N.2 correction and continuing
implementation/qualification. P1-N.2 passed two fresh sessions and completions
in 33.394 seconds with exact native cleanup; the failed predecessor is retained.
The scoped Windows/Linux deferral is approved; those platforms remain unsupported.
Signing/notarization access and private release destination remain missing; no
distribution success is claimed.
