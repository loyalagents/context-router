# Codex CLI demo launch

- Status: activated implementation and local trial
- Base: `c848c1ce`; branch `codex/demo-codex-launch`
- Owner: root sole writer in the user-created worktree; reviewers read-only

The owner requested the same easy launch as Claude Code: remembered project,
isolated sign-in when needed, normal coding tools and multiple concurrent chats.
This is a synthetic demo on the owner's Mac. Preserve the branch under review,
running app, current chats and existing profiles. Claude Desktop, HCP replacement,
production distribution and presentation-story selection are outside scope.
The handoff milestone is an independently reviewed, source-bound local trial
for the owner to sign in and use. No PR publication or merge is activated here.

## Design and checkpoints

1. Shared bounded dashboard/native launch with separate Codex and Claude request,
   progress and client identities. Existing Claude endpoints remain; Codex gets
   its own status/open pair with a project-picker boolean only. Native code owns
   path/executable selection and serializes the picker/inspection operation.
2. Codex role A uses its stable isolated HOME/CODEX_HOME and explicit file auth.
   Only recognized signed-out status may trigger login; unexpected output stops.
   Recheck active demo, project and executable before delivering the MCP token.
   Enable shell, unified execution and image tools with workspace-write sandbox,
   on-request user approvals and project instructions. Preserve context mutation
   approval and actual grants. Unsolicited apps/plugins/hooks remain disabled.
3. Serialize A setup/sign-in, then use request-scoped foreground guards. Preserve
   existing legacy guards, allowing only complete verified signed-in profile
   reuse. Cancellation during setup release cannot open a subsequent session.
   No guard cleanup, credential copying, process supervision or mutation replay.
4. Shared Connections panel with an assistant selector, remembered per-client
   project, fresh chats and exact-client Activity. State is latest-launch evidence,
   not a live heartbeat or chat count. Describe context saves as subject to
   approval/current permissions, not an unconditional write grant.

Independent sensitive plan review approved with requirements for strict auth
classification, positive coding-tool checks, cross-client correlation, and honest
permission wording. Requested review effort Extra High; inherited effective
model/effort unverified. Complete-diff review is required before trial handoff.

## Validation and evidence scope

Follow the [validation policy](../../../useful/AGENT_WORKFLOW.md#validation-and-context-discipline).
Backend tests first. The new Codex auth/coding and runtime routing tests were
written before implementation; new module/routing expectations failed first.
Focused HTTP auth/body/capability checks, login failure/reuse, generation/request/
role binding, guard/cancellation/replay tests and real native foreground overlap
are required. Preserve Claude coverage. Browser evidence covers client selection,
second launch, reload and exact-client Activity. Native build/full native tests
cover changed menu/supervisor routing and affected consumers.

The actual pinned Codex 0.160.0 accepted coding argv and reported signed-out with
an empty disposable profile under blocked provider networking. Owned native CLI
fixtures proved two overlapping Codex chats, login once/reuse, project coding,
independent first-chat exit, unchanged legacy evidence and replay refusal; Claude
passed the same cases. Real provider sign-in/conversation remains user-operated.

A new isolated package and actual artifact smoke will verify both HTTP/native
routes, cross-client rejection, and overlapping Codex/Claude helper sessions under
checkout/toolchain and provider-network denial. Build/trial outputs and shortcut
stay in this worktree. No named aggregate lifecycle gap selects a full local
migration gate; existing CI/gates stay intact. Final exact-candidate CI, contract
merge-base comparison, other-Mac/distribution and broad recovery remain pending.
Report: Targeted checks passed; final validation pending.


Independent diff review verified with the pinned CLI that trusted project config
can add MCP servers, and a full CLI table override does not remove them. The
bounded correction sets `project_root_markers=[]`, refuses a selected folder's
`.codex/config.toml` (including symlinks), and runs auth from the isolated HOME
with the same root-search setting. Validation repeats before credential delivery.
No project settings are edited. Project instructions and normal coding remain;
parent config layers are excluded. Regression tests were written first. This is
a demo-only shortcut, not general Codex project configuration support.

## Local trial checkpoint

Independent complete-diff review approved the scoped trial, including the final
auth working-directory and browser transport corrections. Targeted checks passed:
35 helper/runtime/guard tests, 36 HTTP tests, 250 native tests, 7 transport tests,
75 contract/link-checker tests, and both browser launch cases. The prior full
browser run's 11 unchanged cases passed; the new Codex case exposed the missing
transport allowlist entry, which was corrected and both launch cases rerun.
The native overlapping-chat pair was rerun after strengthening the auth-cwd
fixture, and both passed. Backend, web and native builds passed. Contract census
and all 165 Markdown files passed checks. The HTTP test caught the missing outer
Codex route admission; its final complete-file rerun passed after correction.

Freeze this source for the separate packaged trial. Actual artifact smoke and
owner-operated Codex sign-in/conversation are still pending at this checkpoint;
the package receipts will bind subsequent evidence to this source. Original PR,
running application and profiles remain untouched. Final validation remains
pending as scoped above.

## PR 213 integration checkpoint

The owner requested bringing PR 213's new `a22e7e96` and `93411eff` commits into
this branch. Integrate through a local merge; no push, PR merge or replacement of
the user's running app is requested. Root remains sole writer. Independent plan
review approved the integration; sensitive review requested Extra High, inherited
effective settings unverified. Complete integrated-diff review precedes handoff.

The architecture stays the same. Claude's explicit tool list/default permission
mode remains Claude-only. Both clients inherit phase-based launch timing, an
indefinitely open picker, canonical project validation with native feedback,
persistent launch errors, distinct interrupted status, and a short private
per-chat temporary directory retained for independent jobs. Preserve Codex's
isolated auth, project-config refusal, ordinary approvals, role-bound progress
and concurrent sessions. The incoming Context refresh is useful for Codex writes;
active drafts remain protected. All other upstream UI and CI-test fixes are kept.

Tests were merged/extended first: the prior product failed tool, interruption,
progress and picker regressions before applying the shared fixes. The initial
43 focused launcher/runtime/guard checks passed. Added Codex parity covers picker
timing, unchanged-progress timeout, interruption, launch-error retry, native
canonicalization and per-chat temporary paths. Freeze code for full native and
web suites, plus discovery, contract, path-filter and documentation checks. Those
suites cover native picker changes and the incoming UI/concurrency adjustments;
no aggregate lifecycle gap calls for a full local migration gate. Existing HTTP
and offline pinned-Codex argument/auth evidence is unaffected; no HTTP routes,
Codex configuration or auth parsing change in this integration.

This is a source-branch integration handoff. The previously delivered package
remains bound to `87102afe`; its artifact pass does not cover this merged source.
New package/live-provider acceptance and final exact-candidate CI remain pending.

Integrated-diff review approved with no blocking findings. Final source checks
passed: 250 native tests, 146 web tests, 115 contract/path-filter/discovery/link
checker tests, 43 focused launcher/runtime/guard tests and the four renewed native
picker/concurrent-chat cases. Test counts overlap and are not a combined total.
Web and native builds, contract census, test discovery, Markdown links and
whitespace passed. PR 213 still pointed to `93411eff` at the final remote check.
The merge is local to `codex/demo-codex-launch`; no remote branch, running app or
profile was changed. Targeted checks passed; final validation pending.

## Selected-assistant access shortcut

The owner reported that Review access jumped to the connection list's first row.
Pass the selected assistant's actual native client ID into the existing permission
editor instead. Reuse current-list eligibility for the shortcut and row button;
missing, unknown or revoked clients, refreshes and existing permission/rename
drafts cannot open a different editor. Names and list order do not identify the
target. The mounted editor keeps its identity/draft when the assistant selector
changes, and its existing heading focus brings the controls into view.

Root remains sole writer. Independent bounded UI plan review approved; requested
effort High, effective inherited settings unverified. The new real-browser
regression reproduced the missing editor before implementation. Validate both
assistants, renamed labels, exact editor identity/focus, existing drafts and
missing/unknown/revoked IDs, plus affected permission/connection consumers.
Native/backend behavior is unchanged, so their prior evidence carries forward.
Complete-diff review and a separate verified package precede the human retest;
the actual-artifact smoke now exercises both access shortcuts. Reuse the existing
synthetic demo state only through the updated launcher, preserving the running
app and prior bundle. Exact-candidate CI and live acceptance remain pending.

Independent complete-diff review approved with no blocking findings. The web
build and all 59 affected demo, permission and client-name browser tests passed,
including the new exact-target/focus/draft regression. Contract census, test
discovery, Markdown links and whitespace passed. Freeze this source for the
separate package; its receipt records actual-artifact checks and remaining
human/CI scope. Targeted checks passed; final validation pending.

## Main integration after PR 213 merged

The owner requested latest `main` (`d0464330`), including `d419790d` demo polish.
Root remains sole writer. Independent sensitive plan review approved; requested
Extra High, inherited effective settings unverified. Keep Claude's two exact
context-read allowances inside its own argument branch. Codex arguments and
context-mutation approvals stay unchanged. Shared sign-in interruption reporting
retains uncertain guards and outranks generic failure. Lost launch replies clear
only when the selected assistant reports a new request, without launch replay.
Preserve the exact-ID access shortcut and draft protections. Incoming quiet
context/catalog refresh, stable selection and manual field snapshots improve the
Codex write journey without a new architecture or backend replacement.

Regressions were extended first to both assistants/roles and failed against the
prior helper. After integration, 50 focused helper/runtime/guard tests and both
native concurrent-chat cases passed. Run the full web suite for the changed shared
form/catalog consumers and retained access shortcut, plus contract/link checks.
No native source, HTTP admission, Codex config/auth parsing or persisted schema
changed; carry forward their unchanged broader evidence. Independent integrated
diff review precedes local merge commit. No full local migration gate is selected.

The owner selected a right-side access drawer and continued the demo update.
The reviewed plan uses a demo-only native modal dialog with independent scrolling,
Close/Escape/backdrop dismissal, unsaved-draft confirmation, and blocked dismissal
while saving. Exact client identity and personal-mode inline behavior stay intact.
The actual invoking button is captured from its event and regains focus on close.
Logout/session replacement still forces private editor cleanup without prompting.
Root remains sole writer; inherited reviewer settings remain unverified.

Finalization: review the integrated diff, run the full web suite and affected
contract/document checks, then commit one local merge candidate. Build a separate
source-bound demo artifact and exercise both access shortcuts and both CLI launch
flows on that artifact before updating the existing launcher. Preserve the user's
running app, synthetic state, sign-in and previous bundles. Exact-candidate CI and
human acceptance of this new build remain pending. No full local migration gate
is selected; packaging is a bounded trial, not release qualification.

Integrated source checkpoint: independent complete-diff review approved without
blocking findings. Web production build, all 152 existing local UI tests, 2 focused
drawer tests and 75 contract/link checker tests passed. The reviewer suggested
explicit forced-expiry coverage; the existing expiry test now covers both inline
and demo drawer presentation with a guaranteed dirty draft. Both focused cases
passed after correcting the new test's presentation fixture. Only tests changed
after the full web pass; unchanged runtime coverage carries forward. Contract
census, test discovery, Markdown links and whitespace passed. The 50 renewed
helper/runtime checks and 2 affected native overlapping-chat cases remain valid;
unchanged broader native evidence is carried forward explicitly. Freeze this
candidate for the separate packaged trial. Targeted checks passed; final
validation pending.

## Claude review correction round

The owner requested assessment and fixes for the external review. The actual
built UI reproduced the third-Escape native close and 24-pixel drawer offset.
Accept all six confirmed findings: settle completed Codex status probes before
strict parsing (still refuse unknown output), intercept Escape and reconcile
unexpected native close, keep save outcomes below the sticky toolbar, override
ancestor spacing on the fixed drawer, restore personal focus/rename behavior,
and document both legacy native-panel roles' full-chat setup lock. Connections
remains the overlapping-chat path; no legacy lifetime redesign is selected.

Also exclude the MCP bearer token from Codex coding shell inheritance. This is
bounded protection against accidental environment disclosure, not complete
same-user secret isolation. Preserve real signal/uncertain-login guards and
user-owned labels. Real signed-in Codex and Ctrl-C login behavior remain manual
evidence gaps; no provider session is started for automated validation.

Root remains sole writer. Independent correction-plan review approved; requested
sensitive Extra High/UI High, effective inherited settings unverified. Guard/token
regressions were written first and failed against the prior helper. New tests use
real guards/child exits and actual browser repeated Escape, unexpected native
close, exact drawer bounds, visible save outcome, delayed list/focus settlement,
personal rename/scroll and forced expiry. Renew affected helper/native, pinned
Codex offline preflight and demo/permission/name browser suites. Carry forward
unaffected coverage from the 152-test full UI pass; do not duplicate that broad
run for unrelated context consumers. The first drawer bundle remains untouched
and is superseded for handoff by a new corrected source-bound bundle. Verify that
new artifact before switching the existing launcher; preserve state and sign-in.

Correction checkpoint: independent complete-diff review approved, including the
additional stale queued-close guard. Final production build and all five focused
browser regressions passed, as did 31 helper/guard tests, both native overlapping
chat cases and pinned Codex 0.160.0 offline config/auth preflight. The affected
67-case browser run passed 66; its new native-close focus assertion raced the
queued close event. The test now waits for editor detachment/focus and passed on
the final build. Renew that affected suite on this frozen candidate alongside the
isolated package (tests use disposable resources and do not change build inputs).
The package receipt will bind the final renewed suite and actual-artifact results.
No source changes follow this freeze without affected revalidation. Targeted
checks passed; final validation pending.
