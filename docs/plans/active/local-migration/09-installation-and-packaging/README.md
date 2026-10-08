# Step 09: Installation And Packaging

- Status: managed local candidate implemented; independent reviews, installed non-AI qualification and full local gate passed; CI tracked on the PR; live/human acceptance pending
- Coordinator and sole repository writer: `/root`
- Branch: `codex/local-migration-09-installation-and-packaging`, existing checkout
- Planning base: `7328ceea63a784577594d52af18062be8b583855`
- Implementation PR: one cohesive draft [PR #168](https://github.com/loyalagents/context-router/pull/168); not merged
- Supported product today: merged Step 08 source/manual local UI and MCP modes
- Intended outcome: a managed installed application on the explicitly qualified Apple Silicon pilot
- Next action: verify exact-head CI on PR #168 and resolve pending live/human acceptance
- Last updated: 2026-10-07

The [activation evidence](activation.md) records the exact clean base, all twelve
passing phases and verified cleanup. Step 08 was human-merged as
[PR #167](https://github.com/loyalagents/context-router/pull/167); its
[accepted evidence limits](../08-local-ui/acceptance.md) and Step 06 E/H remain.
Step 09 is the sole primary migration step. Steps 10–11 and the separate MCP
onboarding and UI-usability follow-ups remain inactive/deferred.

The [plan](plan.md) follows the [step template](../step-template.md), using one
PR with three internal checkpoints. User authorization covers activation,
planning, independent review, implementation and a draft PR; it does not approve
any additional unreviewed mechanism, a merge or publication. Subsequent user and
independent reviews approved P2.3 implementation. Actual non-AI installed-artifact
qualification has passed; final-candidate live model, platform, signing and human
acceptance remain distinct pending evidence. See the [installed runbook](../../../../useful/INSTALLED_MAC_APP.md).

See [review dispositions](reviews.md) for revision-bound approval and
[agreed product directions](../decision-log.md#lm-023-managed-apple-silicon-pilot-in-step-09).

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
