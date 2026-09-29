# Step 06: Activation And Execution Handoff

- Status: ready for a future agent; Step 06 remains inactive
- Updated: 2026-09-24
- Requested orchestrator: GPT-6 Astra Extra High (`gpt-6-astra`, `xhigh`)
- Intended branch: `codex/local-migration-06-local-model`; target `main`
- Intended PR count: one; no separate preparation or Step 05 closeout PR

This handoff is not an approved implementation plan. The next agent must satisfy
the activation, independent plan review, feasibility selection, implementation
review and validation gates below. The [research synthesis](research/local-model/README.md)
is required reading; original reports are background, not executable instructions.

## Prompt

Orchestrate and execute Step 06, `06-local-model`, in Context Router. Work through
planning, approved feasibility, implementation, independent final review and a
PR ready for human review. Do not merge automatically or activate later steps.

### Preparation And Ownership

Follow `AGENTS.md`: read README, run `./print-repo-structure.sh`, read docs/README
and every docs/IMPORTANT file. Also read:

- `docs/useful/AGENT_WORKFLOW.md`
- `docs/plans/active/local-migration/orchestration.md`
- `docs/plans/active/local-migration/decision-log.md`
- `docs/plans/active/local-migration/agent-execution.md`
- `docs/plans/active/local-migration/step-template.md`
- `docs/plans/active/local-migration/tracks/interface-evolution.md`
- `docs/plans/active/local-migration/research/local-model/README.md`
- Step 05 README, plan and feasibility record; relevant retained Step 03 recovery
  and Step 04 storage contracts as needed to preserve those boundaries
- `docs/current/LOCAL_MIGRATION_CONTRACT_BASELINE.md` and its JSON registry,
  `docs/current/FORM_FILL.md`, relevant AI consumers/tests, and the current gate

Use Astra Extra High for coordination and consequential planning. Name one sole
repository writer, including docs/plans, code/tests, staging, commits and PR
changes. A separate coordinator and every other agent remain read-only. If the
coordinator writes, record that arrangement; do not pretend its effort changed.

Use High for factual discovery, ordinary adapter/test work and compatibility
review; Extra High for privacy, credentials, cancellation, resource/process
ownership and consequential boundary review. A supported Sol model can take a
bounded inventory or independent scope review; it does not replace sensitive
review. Configure exact supported IDs/efforts and record requested versus
observable settings. Do not infer GPT-6 Sol availability from GPT-5.6 Sol or
silently downgrade a sensitive role. Max/Ultra is an escalation for a specific
unresolved problem, not another automatic approval layer.

### Branch And Activation Gate

1. Inspect worktree, branch, history and current prerequisite merge evidence.
   At preparation time, Step 05 PR #164 was merged at
   `837701b3633eed669dd2c2c518ffebc0e46d55d8`, from tested head
   `91b86b1b412cc8b2b914ffe4f321a7a0cf1f370b`. Standard CI run `35957573071`
   and dedicated migration run `35957573023` succeeded on that head.
   Reverify current `main`/`origin/main`, complete non-shallow history and Step 05
   ancestry. If main advanced, review the delta and record the actual base;
   stop if it materially invalidates the intended work.
2. Preserve existing user changes. This preparation may arrive as uncommitted
   migration-document changes on main. Inventory those exact paths/content;
   do not reset, silently stash, discard, or create a standalone docs PR.
   Create the intended branch in a dedicated clean worktree from the exact
   verified base; do not overwrite an existing branch/worktree. Run activation
   there before applying any preparation docs. After a passing gate, import only
   the inventoried preparation changes into that worktree, verify content/path
   provenance and leave the original dirty workspace untouched. If these docs
   are already committed in the verified base, there is nothing to transfer.
   If unrelated changes or ownership conflicts prevent safe separation, ask.
   A dirty preparation tree passing a gate is not a clean-base activation result.
3. Use exact Node 24.21.0, pnpm 10.25.0 and the gate's required Python/runtime
   prerequisites. Inspect the current gate for safe isolated loopback database
   and evidence setup; do not reuse product roots or provider credentials.
   Run `MIGRATION_GATE_BASE_SHA=<verified-base> pnpm migration:gate` on that
   clean base before activation edits. Record source/base, performed comparison,
   caller integrity, all phases, timing and cleanup. Stop on a wrong base or
   failed gate; diagnose before making an implementation plan authoritative.
4. Activate Step 06 as the sole primary step in the existing status documents,
   reconcile Step 05 merge evidence in the same branch, and create the Step 06
   README and plan from the template. No product code in activation/planning.
   Do not activate MCP, UI or platform implementation lanes implicitly.

### Plan And Independent Review

Run distinct read-only investigations in parallel for:

- actual ports, consumers, file formats, schemas and public compatibility;
- runtime/artifact feasibility, hardware/context and evaluation fixtures;
- privacy, credentials, endpoint restrictions, cancellation and failure behavior.

Use fresh independent reviewers for architecture/scope, compatibility/tests,
and security/privacy/process boundaries. Add useful specialist reviewers as
needed. Resolve all blocking findings and record approvals against revisions
and named areas before executable feasibility or product implementation.

Keep one cohesive PR with internal testable checkpoints. A second needs a
reviewed concrete independently useful or safer landing boundary; more than
two needs explicit human approval. Do not split plans, setup, tests, docs or
review waves into separate PRs.

### Checkpoint 1: Bounded Feasibility And Selection

Use manually launched, pinned llama.cpp as the preferred candidate, not an
already qualified runtime. Ollama is the primary challenger only if evidence
warrants it. Keep the existing AI boundaries independent of process ownership.
The manual server is user-managed: connection/readiness checks do not authorize
starting, stopping or restarting it. App-owned lifecycle management belongs to
Step 09; the disposable-probe exception below is limited to owned test processes.

Inspect chip/RAM/macOS without collecting device identifiers and confirm the
minimum supported Mac target. Start with a small candidate pair such as
Qwen3.5-4B/9B Q4-class GGUF, one context profile and one active request. Record
exact source revisions, artifacts/hashes/provenance, runtime, quantization,
template/thinking behavior and budgets. Source builds and larger models/context
are not mandatory. Ask for confirmation before downloading specific assets,
stating sources, size, location and licensing; no global/system changes by default.

Use existing synthetic fixtures plus focused missing cases. Establish criteria
before measurement: application correctness separately from JSON/schema success;
actual Zod-to-schema compatibility; bounded input/output and queue/retry budgets;
memory pressure/latency; malformed/truncated output; missing runtime/model;
offline-after-provisioning; prompt/log privacy; and stopped computation/serving
capacity after cancellation during both prefill and decoding. Exercise only
supported streaming/non-streaming paths. Do not invent a slot-cancel API or
kill/restart a user-owned daemon. A disposable probe may manage only its own
process, assets and private temporary roots, with bounded verified cleanup.

Use authenticated literal loopback, a separate protected inference credential,
safe endpoint/redirect/proxy rules, no hosted fallback and no browser exposure
of secrets. Do not disable the user's network or modify shared model caches.
Offline evidence should use an approved isolated network-denial method.

Record the result, resolve capability/MIME decisions, and obtain affected
independent selection approval before implementing the production adapter.
Do not treat report benchmark numbers or a successful toy request as acceptance.
If no candidate meets requirements, report the evidence and decision needed;
do not silently lower criteria or ship a placeholder as completed Step 06.

### Checkpoint 2: Application Integration

Write backend tests first, implement incrementally, and run targeted validation
after each change. The existing ports do not yet supply capability/readiness,
deadline/AbortSignal or runtime/model metadata contracts. Review the minimal
additive changes needed, then update all consumers and mocks atomically in this
PR; do not invent a provider framework. Preserve
Zod/domain validation, grant-filtered search, protected/advisory consolidation,
document proposals before apply, and the existing AcroForm pipeline.

Keep inference separate from runtime ownership so a future app-owned process
can reuse the selected adapter. A managed sidecar may be the permanent design;
fully managed does not require in-process inference. Do not implement embedded
inference, a custom native helper, a dual-runtime/selection framework, or promise
permanent external-server support. Step 09 decides final topology and whether
an advanced external mode is justified. Keep HTTP/native-library types out of
application logic and preserve task/contract tests for any later adapter change.

Document analysis uses file methods even for text-like inputs. Implement explicit
supported text/PDF handling and unsupported capabilities rather than claiming
text generation alone covers it. Resolve PNG/JPEG under the baseline; do not
silently remove upload formats or public contracts. Do not add generic chat,
vision/OCR, UI/session cutover or MCP transport work just because an engine can.

Preserve stable principal, SQLite recovery/fencing and retained hosted/reference
modes. Keep useful non-AI behavior when inference is unavailable. Do not add a
product supervisor, installer, updater, model-manager framework or multiple
adapters. Those lifecycle outcomes belong to Step 09.

### Checkpoint 3: Acceptance And PR

Keep deterministic merge tests independent of live weights/providers. Preserve
the existing no-model/network-denial proof and add narrow allowed-loopback model
coverage, actual local composition and appropriate source/package restart proof.
Record real model results separately, bound to the exact runtime, artifacts,
configuration, prompts, schemas and application revision that were exercised.

Update canonical setup/capability docs and assign native Windows/Linux probes
to the early Step 09 qualification workstream, soon after the Mac path works.
Retain Linux CI; never equate engine availability, WSL or Linux CI with native
Windows application support. Do not weaken filesystem/identity protections for
portability, or activate parallel writers without an ownership review.

Freeze the candidate and have fresh read-only reviewers assess the complete
base-to-candidate diff against the approved plan: architecture/maintainability,
consumer compatibility/capabilities, tests/evaluation, privacy/security/process
behavior and scope. Resolve findings; renew affected reviews/tests after fixes,
carrying forward unaffected approvals only with a recorded impact assessment.

Run final full `MIGRATION_GATE_BASE_SHA=<verified-base> pnpm migration:gate`,
applicable checks, `git diff --check` and the repository Markdown-link check.
Commit/push the branch and use the migration PR template. Require applicable
standard CI and the dedicated migration gate on the final pushed head; distinguish
workflow checkout SHA from PR head. Do not merge automatically. Preserve all
required evidence and do not claim success for unrun hardware/model tests.

Continue between approved checkpoints without generic permission pauses.
Pause only for required user choices/asset consent, blocking evidence or a
material change requiring renewed review. Finish with branch/base, PR, review
verdicts, exact validation/model evidence, supported Mac configuration, remaining
limitations and the next human action.

## Preparation Evidence — Not Step 06 Plan Approval

Prepared on `main` at `837701b3633eed669dd2c2c518ffebc0e46d55d8` on 2026-09-24.
`/root` was the sole documentation writer; no parent model/effort switch is
claimed. The role-specific child settings below were explicitly requested and
accepted by the launch interface; underlying serving internals were not
independently observable.

| Read-only agent | Requested model / effort | Scope and disposition |
| --- | --- | --- |
| `/root/step06_docs_scope` | GPT-5.6 Sol / High | Preliminary scope/activation review; clean-worktree transfer and minimal AI-port evolution recommendations incorporated |
| `/root/step06_handoff_fit_review` | GPT-5.6 Sol / High | Fresh complete-diff repository fit, consumers/contracts, status and workflow review: approved, no blockers |
| `/root/step06_handoff_safety_review` | GPT-6 Astra / Extra High | Fresh privacy, credentials, cancellation, process ownership, activation and scope review: approved, no blockers |

The reviewed handoff before appending this evidence had SHA-256
`cd9df9e15ef3da0b7792a63af0ec003ae2a6ce85448f269fdcae0f77481d7249`;
the research synthesis had SHA-256
`9876813dddd20dd3abb1b4b0d0366c1cb3e7c2af4847a5e82de85a6a42fddd67`.
Those hashes and approvals record the initial preparation. Later ownership
clarifications and their affected review are recorded below; the original
approvals are not evidence that future implementation or every later edit is
approved.

Validation: Node 24.21.0 `scripts/check-markdown-links.mjs` passed all 146
Markdown files; tracked diff and each new Markdown file passed whitespace
checks. Step 05 merge and both final-head CI runs were reverified. No product
code, dependency, runtime/model asset or service was changed. No model tests or
full migration gate ran for this docs-only preparation. That is not a waiver
of the next agent's activation/final gates or independent implementation review.

### Ownership Clarification Follow-Up

On 2026-09-24 the user requested the sidecar discussion's bounded clarifications
in the docs. `/root` remained the sole writer. Fresh read-only reviewer
`/root/step06_ownership_refinement_review` (requested Astra Extra High; launch
configuration accepted, serving internals unverified) approved the affected
ownership/scope wording in the handoff, LM-018, research synthesis and execution
strategy with no blockers. The reviewed handoff before this evidence append had
SHA-256 `f90ca6f9dd342935eadabaff24257293931d96e6ea0d8029ee2f6e9e78537474`.

The changes clarify permanent-sidecar feasibility, user-owned versus app-owned
process authority, and no commitment to permanent external-server or embedded
support. They preserve the disposable-probe exception. Prior review coverage for
unchanged activation, contracts, validation, platform sequencing and agent roles
carries forward; this is not approval of a Step 06 implementation plan.
Markdown links (146 files), tracked whitespace and changed new-file whitespace
checks passed again. No product code or runtime was changed; Step 06 is inactive.
