# Demo session permission activity

- Activated by the owner in the Activity-focused fork; base `93411eff`.
- Worktree: `d54b/context-router`; root is sole writer. The inherited connection-polish test edits were preserved byte-for-byte and
  subsequently arrived unchanged through main at `d0464330`.
- Milestone: reviewed implementation, focused local validation, and a separate
  source-bound demo trial. Preserve the running app, chats, data and sign-in.
  No automatic merge or CI monitoring; the owner handles CI.

## Scope and design

Show real dashboard permission changes interleaved with assistant requests in
Activity. This is explicitly bounded app-session history, not durable audit.
No database/schema migration, search/withheld-count changes, HCP implementation,
provider calls, or changes to permission enforcement. Keep presentation separate
from the temporary log so a future backend can replace the event source.

1. LocalUiManagement owns at most 50 permission events for its store/principal
   lifetime. Record the timestamp, unique ID, monotonic sequence, affected client,
   dashboard human actor, action, and bounded setting/rule differences. Record
   only after a successful main-editor Save, advanced grant edit or revocation;
   no preview, conflict, failure or no-op events. Save's revision check binds the
   before snapshot; compute after from the accepted policy/edits, not a later
   read that could describe another writer. No credentials or memory values.
   Log failures cannot turn an acknowledged committed mutation into an error.
   A lost browser response does not remove a server-recorded event. A process
   failure or uncertain storage acknowledgement can omit an event; no durable
   completeness claim is made. CLI edits are outside the recorded scope.
2. Add authenticated bounded POST read `/api/local/mcp/changes` and explicit
   `/api/local/mcp/changes/clear` routes through the existing local transport.
   Clear binds a random app-session ID and observed sequence cutoff so newer
   events survive and an old-runtime confirmation cannot clear a new session. Apply the
   existing session/origin/body checks. Update HTTP contracts and consumer census.
3. In demo Assistant access, merge session rows with loaded requests by recorded
   time and deterministic IDs. Include newest changes and change-only activity;
   older changes beyond the loaded request range wait for Load more. Respect
   client/date filters; hide changes under request-specific filters and explain
   why. Distinct permission styling, no request outcome badge, concise changed
   settings and expandable exact before/after. Current client names are display
   only. Show the latest-50/session-only limitation and distinguish recorded time
   from causality. Preserve current request labels and sensitive memory history.
4. After a confirmed permission Save that returned a session event ID, show
   View change in Activity. Extend the validated exact-client fragment with optional `&change=<eventId>`
   for highlighting/expansion; page query parameters are deliberately restricted.
   Preserve old client-only links, sidebar reset and Back/Forward handling. Expired/evicted direct links show an explicit unavailable notice; never select
   another event as a substitute. No
   automatic navigation, mutation replay or success inferred from later reads.
5. Keep clearing explicit: rename demo's existing control to Clear stored history,
   explain its two durable streams, and offer a separate Clear session permission
   changes control with confirmation. Each operation reports its own outcome.
   Refresh other windows and discard stale reads after clearing/lock/unmount.

## Checkpoints and validation

A. Independently review this plan before product edits. Backend tests first:
   real combined Save, exact before/after, no-op/preview/conflict/failure, advanced
   grant/revoke, bounded retention, store/principal isolation, restart-empty and
   cutoff clear; HTTP auth/origin/body limits; transport routing.
B. Implement backend and run targeted tests after each related correction. Add
   browser tests for main-editor save/link, empty request history, exact-client
   filtering, reload, real access interleaving, request-specific filters and clear.
   Reuse existing draft/uncertain-save and history invalidation coverage.
C. Freeze the complete diff for a fresh independent implementation review. Run
   backend build, focused management/HTTP tests, web build and affected browser/
   transport/history checks; contract census, docs consumers/links and whitespace.
   Broaden the web suite if shared history/permission behavior warrants it. Native
   source and storage schema are unchanged; no named aggregate lifecycle gap
   calls for a full migration gate. Existing CI requirements remain intact.
D. If delivering a new runnable Mac bundle, build into a separate output, verify
   the actual artifact using isolated synthetic state, and keep source/dirty-input
   identity plus receipts. Never stop or replace the running demo. Human fresh-chat
   permission rehearsal and exact-candidate CI remain separate outstanding evidence.

Requested plan and final reviewers: GPT-6.2 Astra Extra High for authorization,
truthful event attribution and async UI behavior; selected through the tool,
execution internals unverified. Root integrates; reviewers are read-only.

## Plan review checkpoint

Independent plan review approved implementation after requiring session-bound
clears and validated hash-based event links. Both corrections are incorporated.
The reviewer also required normalized no-op comparison, bounded/truncation-marked
diffs, and unchanged revocation availability when catalog/authority inspection
fails. Revoke logging uses its successful generation transition without adding a
catalog read. Root remains sole writer; implementation review is a fresh role.

## Implementation review and trial checkpoint

The independent complete-diff review approved the corrected implementation. Its
findings were a stale-clear truncation notice and a failure-injection test that
stopped at a read transaction. The log now tracks the last evicted sequence; the
regression failed before the correction and passed afterward. Rollback and
post-commit uncertain acknowledgement now have separate authority/log assertions.
The reviewer also approved exact-client unavailable links and the packaged
save-to-Activity/reload smoke phase. No unresolved source findings remain.

The backend management/HTTP run passed 67 tests before that small log correction;
all six affected session/failure tests passed again afterward. Backend/web builds,
transport/client-name helpers, contract census and Markdown consumers passed.
The shared web regression suite and separate packaged synthetic trial complete
this handoff's local evidence; receipts stay in `out/activity-demo-package/`.
Runtime source is frozen for those checks. The inherited desktop test stays out
of the Activity commit and is recorded as a dirty test-only input if packaged.

This is a local demo trial. Exact-candidate CI (owner-managed), fresh human Claude
permission rehearsal, and full release qualification remain pending. No running
app, provider session, client configuration or personal state was changed.

## Main integration (2026-11-22)

The owner requested merging main at `d0464330` (PR #213, polish `d419790d`).
Its exact Claude read preapprovals, sign-in/launch messages and Context refresh
fixes complement this feature. Preapproval suppresses Claude tool prompts; CR
permission enforcement still determines what the tools can read. No change to
the bounded session log, direct links, or HCP scope is needed.

Resolve the additive browser-test, contract-reference and brief conflicts by
retaining both sides. The formerly dirty desktop test is identical to main, so
its content is now committed upstream rather than an outstanding local edit.
Renew the web build, demo-browser integration cases, Claude helper checks and
contract/document consumers. Backend Activity source and tests are unchanged;
carry their prior evidence forward. Request a scoped independent merge review.
No app bundle is rebuilt in this source integration: the existing trial remains
bound to `79319a20` and its original receipts. The running demo and state stay
untouched; merged-source artifact validation and owner-managed CI remain pending.

## Claude review corrections (2026-11-22)

The owner authorized fixes to the review of `1754b814`. Agree with the linked-row
reveal timing, pagination-gap notice, timestamp consistency, equivalent maximums,
clear wording/reconciliation and missing race coverage. A reveal resets on explicit
link/Back/client navigation, while passive focus preserves its open/collapsed state.
Independent plan review additionally requires reveal only in the visible tab and
DEFINE remaining independent of the Write/Suggest/Read implication chain.

Root remains sole writer; the existing independent reviewer checks this bounded
correction diff. Checkpoints: reproduce the capability issue with a backend test,
fix and rerun session tests; fix UI and run focused browser cases for combined-read
timing, viewport reveal, collapse, pagination, failures and invalidation; then
review the diff and run affected shared-history tests plus build/docs/contract
checks. No authorization, storage-schema, native or HCP changes are introduced.
The supplied review is source-only evidence; renewed artifact testing is needed
before replacing the older trial. This round leaves the current bundle and running
demo untouched. CI monitoring remains with the owner.

The focused browser run reproduced a further collapse race: the native details
toggle event can run after focus invalidation removes the row. The linked summary
now records the toggle synchronously, with the native toggle handler retained as
a fallback. The regression covers passive focus, explicit Back reveal, keyboard
toggling, delayed streams and failures in either stream. Independent review
approved this correction; final focused browser results are recorded separately.

## Follow-up review corrections (2026-11-22)

Accept the failed-refresh regression, duplicate mount read/weak race tests and
CSS accent finding. Keep prior request rows, pagination and expansion only for
the same normalized filters; suppress contradictory empty states after failure.
Hold a later explicit refresh in race tests and verify it is live before clear,
client switch or lock. Strengthen computed-color coverage for every change row.

For the demo, compact single-setting rows lead with the maximum-access change;
retain multi-setting tables and all truncation/failure/gap notices. Move general
limitations into About this list, shorten demo client chips and Save wording, and
label field-list reads in ordinary language. Maximum access is not an effective
field-access claim. Independent plan review approved demo-only focus/page-show
re-reading with dedicated inspect/preview cancellation, latest-draft rebasing,
and no inspection during Save. Keep explicit preview and mutation confirmation.

Defer live polling/remount replacement, effective field-count records, per-category
controls and automatic previews. These need a cohesive follow-up, especially where
existing deny rules override a newly included scope. Root remains sole writer;
renew affected browser/editor checks, web build, contract census and docs checks,
then obtain independent review. No backend/schema/native changes or CI monitoring.
The existing verified `6e484950` bundle and launcher remain unchanged in this source
correction round; a later replacement needs its own artifact verification.
