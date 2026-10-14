# Work Portfolio

- Status: current priorities; individual briefs are not implementation approval
- Owner: product owner, with a named coordinator/writer assigned at activation

The cloud-to-local migration foundation is delivered through merged Step 09.
Use the [current application](../current/LOCAL_APPLICATION.md) and
[scoped closeout](../current/LOCAL_MIGRATION_CLOSEOUT.md), not the old numbered
steps, to understand the starting point. Historical plans remain in Git.

The user-approved [in-app demo mode](active/in-app-demo-mode/plan.md) is active on
`codex/in-app-demo-mode`, based on `17c82b3095e04b888b2b80439631a23bf133b5c4`.
`/root/implementation` is the sole writer; the coordinator/reviewers are read-only.
This cohesive PR implements native demo lifecycle plus packaged A/B/C helpers.
Native assistant buttons/settings/proposal screens are tracked in that plan for
the next PR. Targeted checks do not replace final qualification or human acceptance.

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

The main checkout is the user's playground: one writer/integrator owns it.
Worktree tasks need separate resources and a reviewed integration order. Default
to read-only parallel investigation/review until independent boundaries exist.
Do not launch, reset or change the user's app/state/client configuration as a
side effect of repository work.

The pilot milestone started from verified main `7d2df85` and integrates reviewed
main `208e049` (#173/#175) in
`codex/pilot-interruption-delivery`, with `/root` as read-only coordinator and
`/root/delivery_review` as sole writer/integrator for the seal-repair checkpoint.
The [pilot record](active/colleague-pilot/plan.md) reconciles the merged Claude
bridge and its accepted interruption follow-up with delivery/replacement work.
Sealed C's evidence remains scoped to its original inputs. D's installed,
replacement, packaged UI and source validation passed; [current scoped results](active/colleague-pilot/plan.md#d-results-and-review-follow-up-2026-10-12)
retain the open downloaded-menu cleanup and Ready/dashboard limits. The “Fix
wrong-person attribution” chat owns a separate active synthetic investigation;
that invitation dependency is neither fixed nor included in this milestone.
