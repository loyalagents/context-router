# Local Migration: Scoped Closeout

- Status: Steps 00–09 delivered; numbered program closed by product decision
- Current work: [portfolio](../plans/README.md), not automatic Step 10/11 activation

The migration delivered composition boundaries, provider-neutral/local identity,
storage ports and SQLite, selected local inference, loopback MCP, the reused local
dashboard and a managed Apple Silicon Mac candidate. Completion means this local
foundation is available. It does **not** mean every original acceptance condition,
platform, recovery scenario or distribution requirement passed. Open limitations
are maintained in [Local Application](LOCAL_APPLICATION.md#qualification-and-known-limits).

## Merge And Evidence

Step 09 [PR #168](https://github.com/loyalagents/context-router/pull/168) was human
merged at `d51508168193ece0cd4bb082cc853b2affc1a7f5` from final head
`4489cd1147622f9c7af5cd9f1e0c02c96e6ec39c`.
[Standard CI](https://github.com/loyalagents/context-router/actions/runs/38102565797)
and the [dedicated migration gate](https://github.com/loyalagents/context-router/actions/runs/38102565799)
passed on that head. Candidate 14 records 184 native tests and 11 installed phases;
Candidate 13's live-model evidence stays historical, not renewed for changed inputs.
Frozen receipts/manifests are retained in the [evidence index](../evidence/local-migration/README.md).

The documentation reset starts from `7e8f1c5a90084ba6a5623bf48f3c1186fb64422f`.
Full numbered plans, original reviews/acceptance narratives, decision log and
model research remain in that [immutable Git tree](https://github.com/loyalagents/context-router/tree/7e8f1c5a90084ba6a5623bf48f3c1186fb64422f/docs/plans/active/local-migration).
They are historical evidence, not current activation instructions. Do not rewrite
old hashes, turn failed results into passes or fabricate missing approval records.

## Durable Contract History

The [baseline and JSON registry](LOCAL_MIGRATION_CONTRACT_BASELINE.md) remain
executable. Their numeric `ownerSteps` are protected historical decision metadata,
not instructions to reactivate completed steps. Wire fixtures, dispositions,
supported gate modes, semantic fingerprints and compatibility records are
unchanged by the documentation reset. Only evidence locations and the derived
documentation reference census move; historical consumer IDs remain historical.

- **Step 03:** verified humans resolve by `(provider, issuer, subject)`, never
  unverified email. The main-line transition deliberately reset historical owned
  data instead of translating hosted users. Local stable identity is separate
  from MCP client/grant authority. The [reviewed original plan](https://github.com/loyalagents/context-router/blob/7e8f1c5a90084ba6a5623bf48f3c1186fb64422f/docs/plans/active/local-migration/03-local-identity/plan.md)
  remains the transition evidence; current administration lives in its runbook.
- **Step 07:** a separately selected local HTTP MCP composition reuses application
  services with independent per-instance credentials, strict loopback guards,
  bounded sessions and least-privilege policy. Empty/unrecognized hosted scopes
  now deny rather than restoring maximum authority. The [original transition plan](https://github.com/loyalagents/context-router/blob/7e8f1c5a90084ba6a5623bf48f3c1186fb64422f/docs/plans/active/local-migration/07-local-mcp/plan.md)
  and [acceptance](https://github.com/loyalagents/context-router/blob/7e8f1c5a90084ba6a5623bf48f3c1186fb64422f/docs/plans/active/local-migration/07-local-mcp/acceptance.md)
  retain scope and inconclusive live cancellation. No Desktop, LAN or OAuth
  support is inferred for the local composition.
- **Step 08:** local browser sessions reuse the same human/services, separate
  from MCP credentials. `me` remains; deprecated `user(id)` stays self-only with
  no approved removal date. Legacy apply remains alongside the reviewed expanded
  contract. The [consumer/compatibility record](https://github.com/loyalagents/context-router/blob/7e8f1c5a90084ba6a5623bf48f3c1186fb64422f/docs/plans/active/local-migration/08-local-ui/consumers.md)
  preserves exact transition evidence. Keep additive migration, external-client
  inventory, compatibility window and explicit removal review for future changes.

## Referenced Decision IDs

Surviving decision IDs refer to the immutable pre-reset decision log, not an
active numbered program. Use the current policy below for new work; the original
record explains the historical decision and does not reactivate its checkpoints.

| ID and original decision | Current policy / implementation reference |
| --- | --- |
| [LM-008: expand, migrate, then remove public contracts](https://github.com/loyalagents/context-router/blob/7e8f1c5a90084ba6a5623bf48f3c1186fb64422f/docs/plans/active/local-migration/decision-log.md#lm-008-expand-migrate-then-remove-public-contracts) | [Interface evolution](../useful/INTERFACE_EVOLUTION.md); public deprecation strings still using this ID retain their meaning. |
| [LM-014: Vercel outside local-first `main`](https://github.com/loyalagents/context-router/blob/7e8f1c5a90084ba6a5623bf48f3c1186fb64422f/docs/plans/active/local-migration/decision-log.md#lm-014-vercel-is-outside-the-local-first-main-contract) | [Contract baseline](LOCAL_MIGRATION_CONTRACT_BASELINE.md) and [hosted branch/deployment policy](../useful/HOSTED_DEVELOPMENT.md#branch-and-deployment-ownership). |
| [LM-015: stable human principal and local identity](https://github.com/loyalagents/context-router/blob/7e8f1c5a90084ba6a5623bf48f3c1186fb64422f/docs/plans/active/local-migration/decision-log.md#lm-015-stable-human-principal-and-local-identity-preview) | [Storage boundaries](STORAGE_BOUNDARIES.md) and [identity administration/recovery](../useful/LOCAL_IDENTITY_ADMIN.md). |
| [LM-021: reused UI, MCP management and history](https://github.com/loyalagents/context-router/blob/7e8f1c5a90084ba6a5623bf48f3c1186fb64422f/docs/plans/active/local-migration/decision-log.md#lm-021-reuse-the-ui-basic-mcp-management-and-simple-history-in-step-08) | [Current application](LOCAL_APPLICATION.md); the [pilot reset policy](../plans/active/colleague-pilot/README.md#pilot-reset-policy) narrowly permits designated release resets, not silent deletion or blanket backwards-compatibility promises. |

## Remaining Decision Ownership

This table supplies current outcome ownership without changing protected registry
history. Activate a named writer in the linked brief before implementation.

| Historical decision/work | Current disposition and owner |
| --- | --- |
| Installed delivery, no telemetry, transitive offline/dependency evidence, disk and recovery limits (09) | Pilot coordinator owns release readiness; stabilization owns explicitly delegated defects. No broad offline or supported-platform claim without evidence. |
| Claude Desktop, ChatGPT desktop, fuller credential UI | Pilot coordinator owns the minimum Claude implementation plan under the [active pilot](../plans/active/colleague-pilot/README.md); [onboarding](../plans/backlog/mcp-onboarding/README.md) retains shared boundaries/future conveniences. CLI remains available. |
| UI feedback, history presentation and restart guidance (08/09) | [UI usability](../plans/backlog/ui-usability/README.md); blocked tasks/false success/privacy defects are prioritized for the pilot. History remains until explicit clear; record-level rollback is not restored to scope. |
| Quality/cancellation limits, image input and model alternatives (06) | Current E/H stay visible; [stabilization](../plans/backlog/stabilization/README.md), [evaluation](../plans/backlog/evaluation/README.md), [provider choice](../plans/backlog/model-provider-selection/README.md) own separately activated slices. Live Harbor comparison is not required to reopen model selection. |
| Public removals including `user(id)` (03/08) | [Interface policy](../useful/INTERFACE_EVOLUTION.md) governs a future explicitly owned transition. A `REMOVE` disposition is not permission to delete a live compatibility surface. |
| Bulk import/export, image/OCR, optional LAN (10), future hosting (11), Windows/Linux | [Platform and hosting backlog](../plans/backlog/platform-and-hosting/README.md); wanted options, not mandatory remaining migration steps. No cloud sync activated. |
| Hosted adapters/deployment and developer orchestrator excluded from the installed product | Retained reference/dev code and existing tests remain; deletion or gate retirement needs a separate reviewed scope. No changes to Vercel or hosted maintenance branch in this reset. |

## Gates And Reset Validation

`pnpm migration:gate`, its dedicated workflow, contract checker and supported
reference modes keep their existing names and requirements. Closing the program
does not retire tests or CI. The [workflow](../useful/AGENT_WORKFLOW.md) now owns
iteration, independent review, trial handoff and final qualification instructions.

For this documentation/evidence relocation, run strict Markdown links/whitespace,
tests/checkers that read edited or moved docs (including root README content
consumers), checker tests, baseline/reference validation and deterministic affected
manifest tests. Discover readers by path, filename and asserted content as described
in the workflow; compare moved evidence bytes and the protected registry snapshot to the
reset base. No application behavior is changed or live model run implied. Existing
exact-head CI still applies. A direct contract check without base artifacts is
reported as `baseComparison=skipped`, never as the full aggregate/base-bound gate.
