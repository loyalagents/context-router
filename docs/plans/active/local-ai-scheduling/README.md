# Local AI Scheduling Follow-Up

- Status: deferred product follow-up; not activated or an approved implementation plan
- Outcome owner: product owner and next assigned local-AI coordinator
- Trigger: revisit after Step 09 closeout; optional Steps 10/11 are not prerequisites
- Direction: bounded waiting with one active operation first; evaluate two model slots separately
- Source: user-requested follow-up on 2026-10-10;
  [LM-024](../local-migration/decision-log.md#lm-024-local-ai-scheduling-is-a-separate-product-follow-up)
- Last reviewed: 2026-10-10

## Outcome And Current Baseline

A PDF import and a dashboard or MCP smart search should be able to overlap
without making the user repeatedly retry an ordinary busy response. Waiting
must be visible, bounded and cancellable. A queue improves request handling;
it does not by itself increase model throughput.

The [selected local adapter](../local-migration/06-local-model/selection.md#fixed-configuration-and-capabilities)
currently permits one active operation across preparation, inference and
settlement, with no queue, shared by UI and MCP. The native runtime also has
one model slot. This made capacity and cancellation ownership tractable for
the initial qualified configuration. Existing measurements cover that setup;
they do not prove two slots would be unsuitable. Preserve the recorded
[cancellation/recovery limitation](../local-migration/decision-log.md#lm-019-manual-cancellation-recovery-is-an-accepted-step-06-limitation)
and its failed evidence until replacement behavior is qualified.

This follow-up is outside the numbered migration and adds no Step 09 acceptance
gate. Corrections for automatic status/session checks competing with a lone
upload remain Step 09 defects; a queue must not conceal those defects. This
document changes no current runtime, API, queue limit or supported configuration.

## Proposed Checkpoints

Keep the initial queue work in one cohesive PR with internal checkpoints by
default; the optional concurrency experiment is neither a prerequisite nor a
mandatory additional PR.

### 1. Define Waiting And Ownership

Inventory dashboard, MCP, workflow and direct AI-port consumers. Choose where
one shared scheduler owns waiting and execution, and define whether its unit
is an adapter operation or a larger workflow. Resolve nested calls and
multi-file fairness without separate UI/MCP queues or holding a database
transaction while waiting for AI. The reviewed activation plan must choose a
boundary that can revalidate authority and reconstruct permission-filtered
inputs at dispatch; retaining a prebuilt sensitive prompt or closure that ignores
changed grants is insufficient.

Specify numeric global/per-client request and retained-byte limits, ordering,
wait deadlines, queue-full responses and supported MCP client timeouts. A small
FIFO queue with per-client bounds is a starting option; review starvation and
repeated multi-file work before choosing it. Define fairness identity across MCP
sessions and browser requests so opening new sessions cannot bypass per-client
bounds. Keep human-principal identity distinct from MCP client authority; the
reviewed plan chooses the grouping and numeric limits. Include upload buffers,
decoded content, prompt copies and inputs captured by queued closures in the
retained-memory budget. Distinguish queued cancellation,
active cancellation and transport disconnect, preserving existing MCP disconnect
semantics unless deliberately evolved. Automatic status/session observation
must not become generation work. Preserve explicit readiness qualification.

End this checkpoint with an independently reviewed contract, an affected-consumer
map and deterministic test cases for limits, fairness and lifecycle transitions.
Follow [interface evolution](../local-migration/tracks/interface-evolution.md)
for any changed routes, schemas, errors or client expectations.

### 2. Implement One Active Operation With Bounded Waiting

Write backend tests first, then add the smallest shared queue and integrate
dashboard/MCP consumers. Show waiting/running/terminal states in the dashboard;
use only verified client-supported MCP response/progress behavior. Do not expose
another client's document names, prompts or results through queue feedback.

Required behavior and acceptance checks:

- A synthetic PDF upload followed by a search from another client completes
  each request once, in the declared order, with correct isolated results.
  Keep a full-queue error and prevent one client from consuming every waiting slot.
- Waiting counts against the original end-to-end deadline. Expired or cancelled
  queued work never reaches the model; waiting never silently resets a timeout.
- Check authority on enqueue and again before dispatch; refresh permitted input
  from current grants/sensitivity rather than trusting a stale queued prompt.
  Preserve the existing publication/mutation authorization rules. Test queued
  credential rotation/revocation, browser expiry/logout and grant narrowing.
- Cancelling active work does not release model capacity until actual settlement
  is established. Uncertain cancellation, runtime loss, sleep, Quit or Restart
  terminates waiting work explicitly; no replay after recovery or application restart.
- Permit bounded temporary in-memory processing, including PDF buffers; prohibit
  durable job/raw-file storage and prompt logging. Release retained inputs when
  work terminates, without promising secure memory zeroization.
- Add no scheduler retries or replay of uncertain work. Preserve the adapter's
  existing bounded schema repair: at most one additional inference after a
  completed invalid structured response when retries are enabled, within the
  original deadline and the same single active ownership. Non-AI reads and edits
  remain usable during waiting, execution and model failure.

End with targeted scheduler/adapter, real HTTP UI/MCP, browser and recovery
checks, including request quotas, client timeout/disconnect behavior and cleanup
of retained inputs. Renew affected independent review. This checkpoint can ship
without any increase in model concurrency.

### 3. Evaluate Two Concurrent Model Slots Separately

If waiting remains disruptive, prepare a bounded experiment comparing one and
two slots on the supported hardware with a representative PDF-plus-search mix.
Define success and resource limits before execution. Measure per-request and
end-to-end latency, throughput, memory pressure, usable context per request,
task quality and cancellation/recovery. More slots do not guarantee faster
individual responses; retain the one-slot option if the tradeoff is unfavorable.

Changing the runtime flag alone is insufficient: the adapter currently enforces
one slot and its cancellation evidence assumes exclusive operation ownership.
Review per-request ownership, slot-specific completion/cancellation, failure
isolation and configuration/readiness checks before an executable experiment.
New live-model runs require a separately bounded approved scope under the
existing migration rules; this backlog entry authorizes no experiment.

If evidence supports two slots, create a reviewed implementation amendment and
qualify the changed configuration. Separate inference workers, priority classes,
parallel preparation and alternative models remain alternatives for demonstrated
needs, not additional deliverables of the initial queue change. No hosted fallback.

## Validation And Closeout

Use incremental validation: run the smallest sufficient checks for changed
behavior and affected consumers, batch review corrections, and carry forward
only evidence whose relevant inputs are unchanged. Rebuild an app when a changed
artifact needs testing, not after every documentation edit or review comment.

For implementation closeout, freeze one candidate and run all required final
validation: full local migration gate, applicable installed-artifact qualification,
independent final review and exact-head CI. A failure returns to targeted fixes,
then renews affected required final evidence; do not reuse an older pass for
changed inputs or weaken CI. Explain an expensive broad run before starting it.
Until then report targeted passes with final validation pending. Never merge
automatically.

When activated, add the concrete reviewed implementation plan here. Once shipped,
update the local model, dashboard, MCP and installed-app runbooks with actual
behavior and remove superseded planning material; Git remains the archive.
