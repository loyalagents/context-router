# Step 08 Activation And Execution Handoff

- Status: preparation and accepted product direction; **not** step activation or
  an independently approved technical plan
- Target: `08-local-ui`, one cohesive PR by default
- Checkout: existing repository on a new local branch; no development worktree
- Requested coordinator/sole writer: GPT-6 Astra Extra High (`gpt-6-astra`, `xhigh`)
- Next action: verify prerequisites, run the clean-base gate, activate and plan,
  independently review, then implement and validate in this same PR
- Last reviewed: 2026-10-03

## Prerequisite And Source Identity

Step 07 [PR #166](https://github.com/loyalagents/context-router/pull/166) was
human-merged at `5e2a67dd785500ba053b2e836c47166e8adeada8`. Final head
`a1a3e0167579f20839b5f91e2a5e52b5a2fd2a6e` passed
[standard CI](https://github.com/loyalagents/context-router/actions/runs/37168124820)
and the [dedicated gate](https://github.com/loyalagents/context-router/actions/runs/37168124816).
The [closeout](07-local-mcp/README.md) preserves manual evidence boundaries;
do not turn inconclusive live cancellation into a pass. Reverify Git/PR/CI
metadata at activation. If main advanced, report the difference and agree the
new base; do not reset main or silently run against a stale SHA.

## Required Reading And Inspection

Follow `AGENTS.md`: read the root README, run `./print-repo-structure.sh`, read
`docs/README.md` and every file under `docs/IMPORTANT/`. Then read:

- [Orchestration](orchestration.md), [decisions](decision-log.md), especially
  LM-008/015/019/020/021/022, [agent execution](agent-execution.md),
  [workflow guide](../../../useful/AGENT_WORKFLOW.md),
  [step template](step-template.md), and [interface evolution](tracks/interface-evolution.md).
- [Contract baseline](../../../current/LOCAL_MIGRATION_CONTRACT_BASELINE.md)
  and [JSON registry](../../../current/local-migration-contract-baseline.json),
  plus the Step 01 scope/ownership decisions in its [plan](01-contract-baseline-and-product-scope/plan.md).
- Step 07 [README](07-local-mcp/README.md), [plan](07-local-mcp/plan.md),
  [implementation](07-local-mcp/implementation.md), [acceptance](07-local-mcp/acceptance.md),
  and [MCP setup](../../../useful/MCP_LOCAL_SETUP.md).
- Step 06 [selection](06-local-model/selection.md), [plan including E/H](06-local-model/plan.md),
  [evidence](06-local-model/implementation.md) and [manual model runbook](../../../useful/LOCAL_MODEL.md).
- [Storage boundaries](../../../current/STORAGE_BOUNDARIES.md),
  [identity administration](../../../useful/LOCAL_IDENTITY_ADMIN.md), and
  downstream-needed Step 03 recovery/R1 and Step 05 upgrade/backup plans.
- [History](../../../current/AUDIT_AND_ACCESS_HISTORY.md),
  [reset](../../../current/DATA_RESET.md), [MCP authorization](../../../current/MCP_AUTHORIZATION.md),
  [document analysis](../../../current/DOCUMENT_ANALYSIS.md),
  [form fill](../../../current/FORM_FILL.md), [workflows](../../../current/WORKFLOWS.md),
  and the [deferred onboarding boundary](../mcp-onboarding/README.md).

Inspect actual local/hosted composition roots, identity/model/storage ownership,
local MCP guard/credential administration, permission grants, GraphQL/REST and
generated clients; all web pages/middleware/API proxies/Auth0/token consumers;
history/reset/sensitivity behavior; existing tests, package scripts, gate and CI.
Inventory actual retained UI capabilities and known external consumers, not just
the happy-path dashboard. A web build or unauthenticated smoke is not browser
acceptance. Do not claim a test command exists without checking its package script.

## Same-Checkout Preparation And Clean-Base Gate

Create `codex/local-migration-08-local-ui` from the verified exact base in
`/Users/lucasnovak/loyal-agents/context-router`. Do not use a development worktree,
change hosted deployment settings, switch to another agent's branch, or discard
user changes. Check current branch, status, local/remote main, full non-shallow
history and that the new branch does not already hold unrelated work.

These handoff preparation docs may still be uncommitted. Preserve them for the
Step 08 PR; do not commit them to main, run a dirty activation gate, or create a
separate planning/closeout PR. `MIGRATION_GATE_BASE_SHA` binds contract comparison;
it does **not** make dirty source into a clean-base run.

The launch prompt may authorize this exact preservation procedure:

1. Inspect the diff and record every preparation path, original staged/unstaged
   state and content hash, including new files. Compare with this allowlist;
   unexpected files or mixed user edits require clarification, not a broad stash.
2. On the new branch at the base commit, temporarily preserve **only** the verified
   preparation changes in a named, path-scoped stash including their untracked
   files. Record the exact stash object ID and verify its contents/recoverability.
   No generic stash/pop, reset, clean, or destructive checkout. Keep this handoff
   and the preservation manifest available outside gate source inputs.
3. Verify tracked and nonignored untracked source is clean and HEAD is the exact
   base; use Node **24.21.0**, pnpm **10.25.0**, and the gate's required Python
   toolchain. Run `MIGRATION_GATE_BASE_SHA=<verified-base> pnpm migration:gate`.
   Record all phases, base comparison, source identity/dirty flag, caller
   integrity, cleanup and timing. Use only owned loopback test resources.
4. Whether the gate passes or fails, restore that exact stash with `apply`, not
   `pop`; verify byte-identical file contents and prior staging before further
   edits. Retain the recovery copy until verified. Stop for any conflict or base/
   gate failure; never present a partial/dirty run as successful activation.

Preparation allowlist (not permission to stash unrelated changes at these paths):

```text
README.md
docs/IMPORTANT/CURRENT_STATE.md
docs/plans/active/local-migration/README.md
docs/plans/active/local-migration/orchestration.md
docs/plans/active/local-migration/decision-log.md
docs/plans/active/local-migration/agent-execution.md
docs/plans/active/local-migration/step-08-handoff.md
docs/plans/active/local-migration/07-local-mcp/README.md
docs/plans/active/local-migration/07-local-mcp/plan.md
docs/plans/active/local-migration/07-local-mcp/implementation.md
docs/plans/active/local-migration/tracks/interface-evolution.md
docs/plans/active/mcp-onboarding/README.md
```

Gate-managed temporary validation copies are allowed; implementation and the
user's runnable checkout remain on the new branch in the original repository.
Do not run competing builds/listeners or touch the user's real data, client
configuration or manually operated model. No global Docker/process cleanup.

## Activation, Planning And Agent Roles

After the passing clean-base gate and restoration, activate Step 08 as the sole
primary step in the status docs. Create `08-local-ui/README.md` and `plan.md` from
the template. Include Step 07 closeout/preparation in this branch, retain required
earlier plans, and leave Steps 09–11 and onboarding inactive. The plan must record
base, sole writer, role roster, actual/requested settings, risk/classification,
contracts/consumers, checkpoints, supported modes, rollback/recovery, exact
validation commands and human acceptance. Do not change product code yet.

Use Astra Extra High for the coordinator who is also the sole repository writer.
Keep that role's actual setting honest; don't label its routine edits High unless
the configuration changed. Assign bounded read-only work in parallel:

- High: UI/consumer inventory, existing test/gate inventory, usability/accessibility.
- Extra High: composition/session trust, credential/CSRF/security/privacy,
  persisted-history sensitivity/deletion/upgrade and recovery.

Use fresh independent reviewers for architecture/scope, security/privacy,
persistence/recovery, and compatibility/tests/usability. Combine mandates only
where coverage remains explicit; there is no two-reviewer limit. Scale to slots,
keep all reviewers read-only, and avoid duplicate full-repo discovery. Record
requested versus observable settings; ask before downgrading requested sensitive
work. Max/Ultra is a bounded escalation for a difficult unresolved decision, not
a required extra final approval.

Resolve all blocking plan findings before implementation and obtain explicit
revision-bound approvals. Renew affected reviews for material changes; carry
forward unaffected coverage explicitly. One cohesive PR is preferred, with
testable internal checkpoints and as many useful review waves as needed. A second
PR needs a concrete reviewed independently useful/safety boundary; more than two
requires explicit human approval. Do not split by planning/tests/docs/review phase.

## Required Step 08 Outcome

Implement accepted LM-021/022 with the smallest maintainable design:

- Reuse the existing dashboard, not a redesign. Manual browser-first local
  launch is acceptable. Preserve useful profile/preferences/definitions/schema,
  history, permission and form/document workflows according to the baseline.
- UI and MCP use the same stable human principal, SQLite data, application
  services and **one** Step 06 admission/model owner. Don't start a competing
  backend against the same state or claim the same inference session twice.
- Plan the simplest safe browser unlock/session separately from MCP authority.
  Prefer a same-origin browser boundary where practical. A short-lived one-time
  bootstrap and restart-expiring browser session are candidates, not approved
  mechanisms. Specify delivery/expiry/replay, cookie/session fixation, logout,
  CSRF, exact Host/Origin, DNS rebinding, route exposure and logging. Never expose
  human-file/inference credentials to browser code or authenticate it with an
  MCP token. Keep the MCP listener's Origin rejection and authority checks.
- Local UI runs without Auth0 config/DNS/API/session dependencies or hosted
  model fallback. Inventory all auth/token/debug consumers; preserve `me` and
  apply LM-008 before the planned `user(id)` removal or other breaking changes.
  Remove Search Lab/generic hosted chat, token-debug and demo/full-reset product
  surfaces only according to approved baseline dispositions and consumer review.
  Do not purge all hosted/reference adapters or remove their coverage casually.
- Basic MCP management B: real independently identified instances, effective
  capability/target/sensitivity limits, narrowing grant edits and revocation.
  No hardcoded product-name identities. Issuance, rotation and maximum-policy
  editing remain CLI. ALLOW cannot bypass maxima; UI and CLI share operations.
- Two history tabs with retain-until-cleared semantics. Fix event-time sensitivity
  including archived definitions; preserve existing local records safely when
  older metadata is missing. Add a separate confirmed atomic clear of **both**
  history streams, not Clear memory or FULL reset. Preserve all live application
  data, identity/credentials/grants and live value/actor provenance. Keep memory
  clear's history-preserving behavior and explain retained old values.
- Specify history-clear confirmation, failure rollback, bounded response, cache/
  cursor invalidation and stale-response races. Subsequent/in-flight operations
  may append history; logging is not disabled. Decide any minimal clear receipt
  during review, never label it PREFERENCES_RESET when preferences are unchanged.
  Logical deletion is not secure disk/backup/client-transcript erasure. No TTL,
  automatic pruning, retention framework, record undo or per-record deletion.
- Capability-gate AI against the selected runtime: qualified text/PDF, no local
  images/OCR promise. Keep proposals subject to user/domain validation and raw
  file non-retention. Propagate bounded execution/cancellation through browser
  consumers; present busy/unavailable/unsupported states accurately. Preserve
  single-owner admission, no queue/hosted fallback, no unsafe retry of uncertain
  mutations, and non-AI use when the model is absent/busy/latched unavailable.
- Preserve Step 06 E/H exactly: no claim reuse or implicit latch clearing;
  manual recovery stops and awaits both old processes, then uses fresh model
  session credentials while retaining application data/identity/MCP credentials.
  Closing the browser must not stop the shared backend or user's model process.

Explicitly exclude installers/shell/signing/updaters, managed downloads/model
supervision, platform expansion, LAN, stdio, cloud sync, UI redesign and future
C/C+ onboarding. No new runtime/model benchmark or native experiment is authorized
by old consumed approvals. Step 09 and the separate onboarding follow-up retain
their own work. Do not invent a new generic architecture to accommodate them.

## Implementation, Evidence And Handoff

After independent plan approval, implement as sole writer, backend tests first
with targeted checks after each small change. Keep supported modes runnable and
documented at checkpoints. Pause affected work for renewed review of material
deviations. Add/update browser test infrastructure only as needed; integrate real
local UI coverage into relevant standard CI and the aggregate migration gate.

Require automated evidence for authenticated browser happy/negative paths,
bootstrap/session boundaries, no-Auth0/no-hosted-egress operation, no-model flows,
browser+MCP shared state and separate authority, grant maxima/revocation, history
sensitivity/clear/rollback/races, existing-data upgrade/restart, AI execution
controls, and source/relocated runtime behavior. Deterministic fake inference
is the automated default. Preserve existing covered modes until reviewed
replacement coverage exists; don't merely delete failing hosted/browser checks.

Freeze the complete base-to-candidate diff for fresh independent final reviews
across the required dimensions. Resolve findings, rerun affected checks/reviews,
run the full local migration gate with the recorded base, Markdown-link/diff
checks and applicable standard CI plus dedicated gate on the final pushed head.
Parallel review and isolated validation are allowed only on frozen inputs;
changes invalidate affected evidence. Preserve failures and evidence limitations.

Then provide one consolidated, bounded synthetic human checklist: local UI
unlock, retained non-AI flows, basic MCP management and same-product instances,
history/memory-clear distinction, restart persistence, browser+Claude Code/Codex
CLI interoperability and qualified AI states. Offer exact commands for anything
the agent cannot safely complete. Use separate owned test data/credentials and
explicitly explain any cloud-client data flow; don't modify personal client
configuration or operate a live model without authorization. Ask the user only
after automated checks/reviews are green; never invent manual results.

Push one draft PR using the migration template and include preparation docs.
Keep it draft while required acceptance is pending; resolve acceptance defects
and renew affected evidence, then hand off for human review. Never merge. Finish
with branch/base, PR, supported launch path, review verdicts, exact validation
receipts, remaining limitations and the next user action. No further activation
or receipt-only closeout PR is needed.
