# Work Portfolio

- Status: current priorities; individual briefs are not implementation approval
- Owner: product owner, with a named coordinator/writer assigned at activation

The cloud-to-local migration foundation is delivered through merged Step 09.
Use the [current application](../current/LOCAL_APPLICATION.md) and
[scoped closeout](../current/LOCAL_MIGRATION_CLOSEOUT.md), not the old numbered
steps, to understand the starting point. Historical plans remain in Git.

The [assisted alpha kit](active/colleague-pilot/assisted-alpha.md) shipped in
[PR #194](https://github.com/loyalagents/context-router/pull/194); dashboard AI
guidance shipped in [PR #195](https://github.com/loyalagents/context-router/pull/195).
The integrated `674750a` artifact passed automated qualification. The user
confirmed full demo setup and Claude Code 2.1.299, Claude Desktop and Codex demo
connections on October 29. The [current checkpoint](active/colleague-pilot/assisted-alpha.md#current-delivery-and-demo-acceptance-2026-10-29)
records the exact artifact and scope. Remaining live-use/personal-mode acceptance
and an approved colleague trial are next; the kit implementation is complete.

The [in-app demo mode](active/in-app-demo-mode/plan.md) shipped in
[PR #183](https://github.com/loyalagents/context-router/pull/183), followed by
[native demo assistant setup](active/native-demo-assistant-setup/plan.md) in
[PR #184](https://github.com/loyalagents/context-router/pull/184). Native Sign
in/Open, reviewed Desktop apply and same-envelope model reuse are implemented.
Deeper assistant supervision and retained-guard recovery remain separate
follow-ups. Demo acceptance is not personal-mode Claude onboarding evidence.
The latest user report closes the unconfirmed demo setup/connections status.
It does not enumerate every native control, permission or lifecycle test; the
[native setup plan](active/native-demo-assistant-setup/plan.md) retains those
historical requirements and points to the current scoped acceptance.

The [MCP client permissions slice](active/mcp-client-permissions/README.md)
shipped in [PR #187](https://github.com/loyalagents/context-router/pull/187):
clearer cards, server previews, atomic maximum-policy/grant editing and draft
reconciliation. Final source validation is recorded in the merged PR; it does
not qualify a newer installed artifact. Those plans' earlier writer assignments
and pending implementation checkpoints are historical.

## Three Lanes

| Lane | Purpose | Canonical brief |
| --- | --- | --- |
| Assisted colleague pilot — first priority | Get a few Git-capable colleagues using their own data, with Claude Desktop and tolerable install/update/reconnect friction | [Pilot](active/colleague-pilot/README.md) |
| Stabilization | Bounded correctness, recovery, diagnostics and usability fixes; eligible slices can run in parallel worktrees | [Stabilization](backlog/stabilization/README.md), [UI usability](backlog/ui-usability/README.md) |
| Future capabilities | Wanted features, prioritized individually rather than extending a completed migration | [MCP onboarding](backlog/mcp-onboarding/README.md), [agent-assisted onboarding](backlog/agent-assisted-onboarding/README.md), [AI scheduling](backlog/local-ai-scheduling/README.md), [provider choice](backlog/model-provider-selection/README.md), [evaluation](backlog/evaluation/README.md), [platform/network/hosting](backlog/platform-and-hosting/README.md) |

Priority and parallel eligibility are separate attributes. A stabilization item
can be a pilot blocker; that does not make it safe to implement concurrently.
Keep one canonical item, link it from the pilot, and assign a named owner and
landing order. Do not copy tasks between lists or activate every backlog brief.

`active/` contains currently coordinated work. `backlog/` holds useful but
unactivated briefs; promotion requires an explicit scope/owner/acceptance decision.
After shipping, distill actual behavior into current docs/runbooks and remove
obsolete plans. Git is the prose archive; [frozen evidence](../evidence/local-migration/README.md)
is retained separately where tests or audit bindings still need it.

## Starting A Task

Use the [workflow task brief](../useful/AGENT_WORKFLOW.md#reusable-task-brief).
Record outcome/non-goals, priority, risk, owner, paths/contracts, dependencies,
parallel eligibility, internal checkpoints, acceptance evidence and finalization
milestone. Prefer one cohesive PR; split only for independently useful outcomes,
not separate planning/review/closeout PRs. Human review and merging remain required.

The [validation matrix and scope rules](../useful/AGENT_WORKFLOW.md#default-and-exceptions)
govern new work. Completed or merged implementation requirements do not carry into
new PRs merely because a document remains under `active/`. Separately outstanding
delivery, recovery and manual acceptance commitments can survive merge; reconcile
those explicitly with their owner. Reconcile backlog proposals at activation and
retain current operation-specific runbook requirements and historical receipts.

The [MCP client names slice](active/mcp-client-names/README.md) shipped in merged
[PR #181](https://github.com/loyalagents/context-router/pull/181), verified at
`071b329731103ef3be5113ff79faf12b856aa68e`: shared current names, browser/CLI
rename and exact-client activity navigation. Native demo assistant setup integrates
that main revision and preserves its behavior; other usability items stay backlog.

The main checkout is the user's playground: one writer/integrator owns it.
Worktree tasks need separate resources and a reviewed integration order. Default
to read-only parallel investigation/review until independent boundaries exist.
Do not launch, reset or change the user's app/state/client configuration as a
side effect of repository work.

The [historical pilot record](active/colleague-pilot/plan.md) retains the merged
Claude bridge, interruption and sealed C/D delivery evidence. D's installed,
replacement, packaged UI and source validation passed; its
[scoped results](active/colleague-pilot/plan.md#d-results-and-review-follow-up-2026-10-12)
retain downloaded-menu cleanup and Ready/dashboard limits. Those passes remain
bound to the original artifacts. The current kit plan explicitly reconciles the
remaining human, acquisition and disk commitments. Attribution/PDF investigation
and colleague guidance have separate ownership and are not duplicated here.
