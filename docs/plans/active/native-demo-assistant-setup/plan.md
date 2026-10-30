# Native demo assistant setup

Status: implementation merged in PR #184. On October 29 the user confirmed full
demo setup, including Claude Code 2.1.299, Claude Desktop and Codex connections
on the delivered `674750a` app. See the
[current acceptance record](../colleague-pilot/assisted-alpha.md#current-delivery-and-demo-acceptance-2026-10-29)
for source/artifact evidence and the remaining live-use/personal-mode limits.
The sections below retain the historical implementation, review and trial
checkpoints; their pending statements do not override that later confirmation.

## Outcome and ownership

Add native Sign in/Open for Codex A and subscription Claude Code B, a remembered
executable picker, and Claude Desktop C prepare/review/apply. Reuse packaged
helpers, isolated profiles, permission contracts, immutable snapshots and guards.
Keep the normal dashboard, demo banner and optional walkthrough. Demo works without
a model and now reuses verified installed weights when present. No general profiles, universal onboarding, chat client, credential
migration, permissions redesign, assistant supervision or retained-guard recovery.

Verified remote main/base: `3bc606ffb9d90ab364d26f6bea5977be30f31b13`, the merge
of [PR #183](https://github.com/loyalagents/context-router/pull/183). The clean
checkout now uses `codex/demo-assistant-setup`. Prior human acceptance includes
A/B/C connectivity, restrictions, Quit/reopen persistence, reset and personal
return; it does not qualify the new native flow. Historical receipts stay with
that PR and retain their original source/artifact binding.

Coordinator `/root`, planner `/root/planner` and reviewers are repository-read-only.
Sole writer/integrator `/root/implementation` owns plans, docs, tests, code, staging
and commits. Requested planner/writer and architecture/security reviewers:
GPT-6 Astra/xhigh for executable trust, configuration, concurrency and recovery.
Effective settings are not independently observable.

Startup guidance, workflow, current application, installed-app runbook, interface
evolution and original example docs were read. Inventory covers native `menu.m`
and `guardian.m`, packaged `runtime/demo.mjs`, shared `installed-clients.mjs`,
`trusted-files.mjs`, `installed-desktop.mjs`, preflights and affected fixtures.
All automation uses owned synthetic roots/profiles/ports/processes. Preserve the
user's app, personal data/configuration/provider sessions and compatible assets.
No automated provider conversations, download or live inference is authorized;
the user will perform local inference in the revised manual trial. Never reclaim
profiles through PID disappearance/timeouts, delete retained evidence or replay
uncertain mutations.

## Native controls and executable choice

Keep the three client groups and secondary Copy-command fallback. A/B each get
Sign in, Open and Choose executable with visible provider consent and fresh-
conversation guidance. Successful handoff means Terminal opened; it never means
the assistant connected or login succeeded. Helper errors remain visible there.

One narrow native adapter captures root/store/runtime-generation/endpoint and
request identity, constructs exact argv, allowlists environment and closes all
unrelated descriptors. Check the binding before launch and before result display.
Allow one finite operation at a time, with responsive guardian/modal polling.
Existing per-role guards remain the sole profile-exclusion mechanism, including
copied commands and concurrently running external helpers.

Add `demo client inspect --client codex|claude [--executable ABS]` by extracting
existing native validation/disposable empty-profile preflights into
`inspectInstalledClient`. Return only canonical path/hash/pinned version; no
persistent profile, token read, login or provider conversation. Every native
action revalidates; actual login/launch revalidates independently again.
Remember success only in non-authoritative `NSUserDefaults`, keyed by canonical
installation root/vendor, containing path/hash/version and no credentials. Tests
use a separate defaults domain. A remembered choice never grants trust.

Picker supports trusted direct native payloads in legitimate nvm/npm layouts;
arbitrary JS/shell wrappers remain refused and unevaluated. Any deterministic
layout resolution must be narrow and tested. Keep the existing exact Homebrew
exception. Missing/unsupported/changed choices explain how to select the native
payload or install the qualified version, without personal-config fallback.

## Finite helper ownership and Terminal handoff

Inspect/prepare/apply run in an owned process group, without managed authority.
Retain the unreaped leader identity until all possible group signaling is over;
never rediscover a PID or signal after releasing its identity. Explicit descriptor
whitelist/CLOEXEC and clean environment exclude guardian pipes, envelope locks,
capabilities, database authority and provider variables. Drain stdout/stderr
asynchronously, with 64 KiB per-stream bounds and a 120-second deadline.

Use `waitid(..., WNOWAIT)` to retain the waitable leader and Darwin
`proc_listpids(PROC_PGRP_ONLY, leaderPid)` for a bounded complete group inventory.
Before final reap, require the retained leader to be the only remaining member;
EOF and direct-child exit alone are insufficient. A failed/truncated inventory
or lost wait/group ownership fails closed. Test a silent descendant that closes
both pipes and survives its parent, as well as one holding a pipe open. The
supported sealed helper/probe path must not detach descendants from its group;
this is not a claim of arbitrary third-party daemon supervision.

Normal completion drains and proves group settlement before reaping. A surviving
group member follows the same bounded settlement path. Deadline, overflow or broken result channel
requests SIGTERM to the still-owned group, drains for five seconds, then SIGKILL
only to that still-owned group if necessary, and reaps. If exact ownership/proof
fails, retain/report uncertainty without a foreign kill. Cancellation never
claims rollback, releases an uncertain guard or retries a mutation. Preserve
proposal/backup/evidence whenever apply may have started. Test actual descendants
and pipe hold-open; source string/FD assertions alone are insufficient.

Done may dismiss the panel while the menu-owned operation and request identity
survive; callbacks cannot write dead views or revive stale proposals. Normal Quit
first cancels and settles the finite helper group as above, then sends the existing
guardian Quit. If settlement cannot be established, report retained uncertainty
and stop polling without releasing the operation, request or transition interlocks.
Quit then requires an explicit Cancel-default confirmation, including system
termination; it may stop the guardian without further helper signals/reaping or
a settlement claim. Explain that the helper may still finish changing Desktop
configuration: keep Desktop/editors closed and inspect retained state before
opening or retrying. One confirmation is in flight; accepted Quit is latched
against reentry. Pending normal Quit reaching ownership loss uses the same path.
The app never owns, waits for or kills externally
launched Terminal/assistant sessions during switch/reset/Quit. Enter/leave/reset/
restart controls are disabled and their action handlers independently refuse
while finite work is unsettled, even after Done dismisses the panel. This prevents
native mode changes racing a reviewed Desktop apply. This bounded
finite-helper ownership is necessary setup lifecycle, not assistant supervision.

Finite inspect/prepare/apply requests use the additive `--native-result` option.
On failure with valid constructor-provided safe text, stdout contains one exact
JSON envelope bound to action and full context. Unknown or invalid diagnostics
leave stdout empty so native per-action uncertainty guidance remains authoritative;
the ordinary safe stderr fallback is unchanged. Reject
messages over 800 UTF-8 bytes, malformed Unicode or control characters. Native
parses the whole envelope, never raw stderr; lifecycle uncertainty takes priority.
Other commands reject the flag and ordinary CLI stderr remains compatible.
Clear old feedback tooltips on actions/results.

Retain only the latest validated Desktop outcome and safe message in memory,
bound to root/store/generation/endpoint/request. A same-binding reopened panel
shows completion even if it was reopened while work was running. Never restore
a proposal, digest or closed-Desktop attestation; hidden prepare requires a fresh
visible prepare/review. New Desktop work and binding changes clear the outcome.

Terminal transport writes a unique retained nonsecret request at
`root/demo/launch-requests/<nonce>/open.command`: directory 0700, file 0500,
canonical trusted ancestry, exclusive creation, no symlink/hardlink adoption,
fsync and maximum 16 KiB. Fixed `/bin/sh` shebang plus `exec` fully shell-quotes
every packaged-helper argument, exact context and canonical `--executable`.
No credentials enter argv, request files, clipboard or logs. Open specifically
in Terminal through LaunchServices, without AppleScript or injecting into an
existing shell. Retain files for delayed consumption; never overwrite/reuse or
automatically clean them. Retention has no global quota and is not lifetime
authority. Delayed execution still revalidates exact context and executable.

Validate native → request → shell → verified wrapper → bundled Node → owned
native client fixture for real argv, environment and FD behavior. LaunchServices
failure gives useful feedback without claiming connection. Actual Terminal and
provider usability remain later human checks.

## Desktop exact review and apply

Prepare returns safe exact-owned-entry details: create/replace, target config and
entry, command/argv/environment, store/runtime/endpoint, backup effects and SHA-256
of exact proposal bytes. Never return/render original or unrelated configuration,
which may contain secrets. Native retains binding/path/digest/summary in memory,
shows readable details with expandable exact entry, and requires an initially
unchecked explicit confirmation that Desktop and config editors are closed.

Add optional backward-compatible `--proposal-sha256`; native always supplies it.
Apply reads private proposal bytes once, verifies digest and parses those same
bytes; the receipt binds those reviewed bytes. Keep current sealed-source/snapshot
checks, collisions, exact original-config checks, unrelated-entry preservation,
backup, fsynced replacement and readback. Never execute a returned applyCommand or
proposal-selected executable. Stale context/config edits require preparing anew;
uncertain application retains evidence without automatic retry/rollback. Missing
Desktop directory explains install/open once; untrusted or 0644 config explains
the required private ownership/0600 prerequisite without silently changing modes.

## Outcomes, checkpoints and validation

| Trigger | Required outcome |
| --- | --- |
| Valid sign-in/open | Explicit isolated external workflow; fresh conversation; honest Terminal feedback |
| Cancel picker/confirmation | No saved choice, helper or configuration mutation |
| Changed/missing/untrusted executable | Refusal and actionable choose/install guidance |
| Duplicate native action | Disabled/refused while its finite operation settles |
| Concurrent external helper | Existing exact per-role guard refuses overlap |
| Changed mode/store/generation/endpoint | Refuse action/result, reopen setup; never retarget |
| Delayed/failed Terminal launch | Retain exact request; no claim of connection; helper rechecks context |
| Normal helper completion | Drain/reap and publish only current request/binding |
| Timeout/overflow/pipe loss/Quit | Owned-group settlement; honest uncertainty; no replay/reclamation |
| Done during work | Menu retains operation; no callback into dismissed view |
| Desktop conflict/stale proposal | No configuration write; explain inspection/new prepare |

1. **C0 — plan and reconciliation.** Independent architecture/usability/
   maintainability/compatibility/scope and security/credentials/persistence/process/
   recovery reviews; record findings, dispositions and reviewed identity. Resolve
   blockers before dependent code. Reconcile #183 status and portfolio.
2. **C1 — helper contracts, tests first.** Failure-first inspect/preflight and
   digest/safe-summary tests before backend helper edits. Cover whitespace and
   config-path tampering, altered binaries/versions, trust/stale failures, guards
   and source contracts. Run targeted tests after each related correction batch.
3. **C2 — native controls.** Compiled AppKit button/picker/defaults tests; real
   argv/FD transport; normal/graceful/forced cancellation, probe descendants and
   pipe hold-open, Done callback lifetime, Quit order, duplicate/stale outcomes.
   Run affected menu/unlock/restart/wrapper checks and inspect panel renders.
4. **C3 — trial and final qualification.** Freeze stable code/docs, commit and
   promptly open a draft PR. Exact-head CI overlaps independent complete-diff
   review and isolated local qualification. Build a sealed source/artifact-bound
   trial and test the installed native/helper paths.

Focused commands: pinned `pnpm check:toolchain`, relevant `node --test` helper/
desktop/native suites, `pnpm --filter desktop build:native`, original example
compatibility tests, `node scripts/check-markdown-links.mjs`, contract checker
tests/current baseline and `git diff --check`. Find doc consumers by path,
filename and distinctive content. Backend behavior remains tests first.

**Agreed milestone (2026-10-14):** “Prepare the trial and draft PR; I’ll schedule
hands-on testing later.” Deliver that reviewable trial/draft, complete all required
automated qualification and fresh independent complete-base-diff reviews unless
a concrete blocker is reported individually, and
keep manual acceptance explicitly pending before readiness/merge. Trial handoff
with outstanding checks says **“Targeted checks passed; final validation pending.”**

Final requirements: full local
`MIGRATION_GATE_BASE_SHA=3bc606ffb9d90ab364d26f6bea5977be30f31b13 pnpm migration:gate`,
applicable portable/native/backend/web/example regressions, installed/full demo/
replacement qualification, exact-head CI, both complete-diff review dimensions
and later hands-on Sign in/Open/picker/Desktop acceptance. Explain purpose/changed
inputs and preflight before expensive runs. Stable inputs and isolated resources
only; later changes renew affected evidence and every applicable final gate.
Carry forward only demonstrably unaffected original source/artifact coverage.

Preflight passed with explicit Node 24.21.0/pnpm 10.25.0 PATH (default Node is
older). Python 3.12.8, clang/macOS SDK, Chromium 1243, Docker 27.3.1 and cached
PostgreSQL 15 Alpine are available. Pinned Node/llama archives and license exist;
packaging still verifies bytes. No download or broad run during planning.

## Separate unactivated follow-ups

| Purpose | Dependency | Acceptance and activation |
| --- | --- | --- |
| Deeper assistant coordination/supervision | Supported foreground/descendant lifetime and independent ownership review | No descriptor leaks/duplicate profile use; tested owner-loss/shutdown/reconnect; no false connected claims. Unactivated; finite setup ownership is the current boundary. |
| Explicit retained-guard recovery | Positive lifetime proof beyond vanished PID, timeout or user guess | Preserve records/profiles until proof; no deletion/copy/fresh-profile workaround or mutation replay. Unactivated; independently review before implementation. |
| Investigate transient accept() error | Reproducible owned fixture and native readiness/error evidence | Confirm cause/effect; regression proves recovery/refusal without weaker admission. Unconfirmed, unactivated investigation. |

## Review dispositions

Architecture preview accepted Planner v1's shape but blocked indefinite helper
settlement/normal Quit. Planner v2 replaces that with explicit owned-group
settlement and panel-independent lifetime above. Architecture approved frozen v2
`de583a648a6fb1d1ab85a5f2b8474ee47186e23bf7bcb0bba6d140ec1c514222`.
Security then required whole-group settlement (including silent descendants) and
native transition exclusion after panel dismissal. The coordinator accepted both;
both reviewers approved the amended design
`e912562ddd62b7b17eced5ee0bf07a889dc6ee0420aad265593cc214af53d9ff`.
Architecture covers usability, maintainability, compatibility and scope; security
covers credentials, persistence, process ownership, concurrency and recovery.
S1 (silent descendants) and S2 (transitions after Done) are fixed by the explicit
proof/interlock above. Security verified Darwin's live+zombie group census:
require exact WEXITED child status and a positive sole-leader, integral, nonfull
inventory; zero/error/truncation/ECHILD never establishes settlement. Coordinator
authorized dependent implementation. C0 markdown, 55 contract-checker tests,
current baseline and whitespace checks passed; final validation remains pending.

## Implementation checkpoints

C1 tests failed first for absent inspect/safe summary/digest and same-byte receipt
binding. After the additive helpers, the selected Desktop/guard/native inspection/
preflight tests passed **20/20**. Native listener fixtures require owned-process
sandbox escalation; the initial restricted run's five startup refusals were
infrastructure limits, not a claimed product pass.

C2 compiled native build and controls passed: real button wiring, picker cancel,
remembered reinspection, stale-result refusal, Desktop confirmation/exact digest,
Done callback lifetime, transition interlock and ordered Quit. Native request →
shell → verified wrapper → Node → synthetic child proved quoted argv, descriptor
closure and stripped provider/managed environment. Fixed `TERM=xterm-256color`
keeps Terminal type with the clean environment. Process fixtures cover normal,
silent/pipe-holding descendants, overflow, graceful/forced cancellation, invalid/
empty group census and lost exact wait. Darwin `getpgid` does not identify an
exited zombie; post-exit ownership uses exact WNOWAIT plus the positive held-leader
census, never empty inventory/ECHILD. Existing native copy/menu/unlock/restart
checks passed **4/4**; new control and transport checks **2/2**, process/request
checks **2/2**, plus the captured-panel check **1/1**.

Synthetic initial/prepared/exact-entry renders are retained under
`/private/tmp/context-router-native-setup-review/`. The initial logical window is
692×894 points on the observed 1728×1027 visible screen; exact-entry modal is
652×500 with scrollable details. This is source-compiled AppKit evidence, not an
installed app or actual Terminal/provider acceptance claim.

The additive installed harness uses a new durable owned root and the production
packaged CLI (no Desktop fixture injection): inspection/trust refusal, real
request/wrapper/client transport, safe summary/digest refusal/apply/backup/replay,
config conflict/stale runtime, and retained requests through Quit/reopen/reset.
Its result, full demo/replacement, full migration gate, complete-diff reviews and
exact-head CI remain pending at candidate freeze. Manual native acceptance is
intentionally scheduled later by the user; no automatic merge.

Before freeze, two added tests failed for absent actionable Desktop prerequisite
messages and a dropped Terminal type at the final client environment. Both were
corrected: safe install/open-once or owned 0600 guidance, no permission mutation,
and explicit `TERM=xterm-256color` in qualified interactive client specs. Selected
Desktop/client tests passed 22 with two optional real installed-CLI probes skipped
at that checkpoint; those offline probes remain part of final qualification.
Source Desktop compatibility passed 4/4. Exact-entry display now includes captured
root/store/runtime/endpoint and reviewed digest, with readable unescaped paths.
New finite-process and opt-in artifact test sinks are additively classified in the
existing outbound inventory; contract checker tests 55/55 and current baseline
pass. No CI requirement, trigger, permission or guard rule was weakened.

## First frozen candidate and review correction

Candidate `566940e6dceb6296581a57e0ce5906285bdb6ef2` opened draft
[PR #184](https://github.com/loyalagents/context-router/pull/184). Independent
complete-diff architecture/usability/maintainability/compatibility/test/scope review
approved it. Security identified P2: child exit between no-event WNOWAIT and
`getpgid` could falsely latch ownership loss. A test-only translation-unit
interposition forces that exact real-child interleaving; before the fix it failed
with permanent unsettled ownership. The correction reobserves the exact exited
unreaped child and a positive complete held-leader census. Empty/ECHILD/error
still never settle; signaling still stops before reap. Affected review is required.

The complete desktop/native/original-example suite at that candidate passed
396/398, with two optional real-provider probes skipped (626 s). A separately
auto-approved Codex 0.160.0 offline disposable-profile preflight passed 1/1; its
source/client byte pins are retained in `/private/tmp/context-router-native-setup-codex-offline-566940e-inputs.json`.
Claude's real offline host-HOME/Keychain probe was rejected by automatic approval
review under the personal-provider-state restriction; bounded user clarification
is pending, and no such probe ran. Neither probe constitutes human acceptance.

The initial full gate failed at the portable desktop suite: 97/101 passed, three
explicit `Credential unavailable` errors and existing seed revoke-once progress
0/189. An owned deterministic counterexample showed unrelated directory creation
changing a checked ancestor's nlink while credential bytes/dev/inode/mode/uid stayed
unchanged. The seed failure is not conclusively attributed; its fixture cleanup
removed the failed root. All four failures remain recorded in the original log.
Unchanged full portable tests then passed **101/101** (45.9 s) with serialized
files and an owned stable TMPDIR. Architecture and security reviewers approved the
narrow scheduling amendment: serialize the same desktop portable test glob, matching
the existing native policy, preserving every test, assertion and internal
concurrency case. Production credential checks and CI requirements/triggers are
unchanged. Private TMPDIR alone does not prevent churn in shared ancestors;
subsequent qualification must isolate scheduling and resources as well.

Initial logs: `/private/tmp/context-router-native-setup-gate-566940e.log`,
`/private/tmp/context-router-native-setup-suites-566940e.log`,
`/private/tmp/context-router-portable-serial-566940e.log`; mechanism receipt:
`/private/tmp/context-router-credential-ancestor-proof-566940e.json`.
The clean566940e sealed build succeeded with caller integrity, but is preliminary:
changed native bytes require a new sealed artifact. Full corrected-candidate gate,
applicable installed checks, exact-head CI and affected reviews remain required.

The same correction batch also closes a feedback race found by the coordinator:
a delayed older LaunchServices callback could replace a newer action's status in
the same panel. A reversed-callback fixture failed first; Terminal result/error
feedback now checks the latest captured request ID as well as panel and binding.
External Terminal ownership is unchanged. The existing CI-path contract assertion
was updated solely to require the approved serial portable command with its same
glob; no workflow trigger/job/requirement changed.

## Exit-observation follow-up

Corrected candidate `91106ba26f44129adeb71a93d919a7bc7e092378` passed the full
local migration gate (12 phases, 1437.9 s), both complete-diff review dimensions
and exact-head CI. The first renewed gate attempt used an unsuitable nested
repository TMPDIR: an existing staging assertion rejected ancestor node_modules,
and its 116-byte Unix socket path reproduced EINVAL. Both unchanged tests passed
in the short private qualification root `/Users/lucasnovak/.crq91106ba` before
the successful gate. No staging or credential assertion was weakened.

The subsequent native suite passed 238/241. The finite-helper normal-exit case
exposed a second Darwin interval: getpgid returns ESRCH while both nonblocking
waitid observations still report no event, with a positive complete leader census.
An owned diagnostic copy reproduced those exact values on attempt 539. A new
deterministic observation fixture failed first against unchanged production code.
The two existing maintenance/codesign deadline failures passed an unchanged
focused rerun (2/2, 24.3 s); their original failures remain retained and unattributed.

Both independent reviewers approved this narrow amendment before production edits:
only ESRCH plus successful no-event wait and positive complete leader census may
defer observation for a fixed, nonresetting five-second budget. No signal, reap or
successful result is permitted during that interval. Exact exit/group proof is
still required; changed group, ECHILD and invalid/empty census fail closed.
Cancellation tracks conclusive signal outcomes: deferred TERM/KILL is retried
after proof returns, grace starts only after TERM completes, and deferred KILL
cannot consume its attempt or start its post-signal deadline. Repeated kill ESRCH
with multiple inventoried members has its own fixed bounded observation budget;
multiple members never count as settled. Uncertainty retains state without replay.

Fixtures now cover one delayed observation, persistent uncertainty, cancellation
during observation, pending KILL, kill-ESRCH follow-up with a surviving descendant,
repeated signal ESRCH, and an actual changed process group, alongside prior cases.
Focused process/control checks passed 2/2 (17 process scenarios). Retained logs
include `native.log`, `native-existing-recheck.log`,
`exit-transient-failed-first.log`, `exit-observation-focused.log`, and
`f/exit-observation/result.log` under the owned qualification root. New runtime
bytes require affected exact-head review and renewed final gate/native/artifact/CI
qualification. No human trial or personal provider session has been started.


## Integration with merged MCP client names

Candidate `cb2992981f0757bb6bceec7019f26a4168ed5a63` passed both independent
final review dimensions and the complete native suite (241/241, 432.8 s). Its
sealed build succeeded with caller integrity. Its renewed gate was deliberately
cancelled during phase 4 after main advanced; the retained cancelled receipt
records phases 1–3 passed, caller integrity and owned database/administration
cleanup. A nested synthetic integration container was separately removed only
after its immutable ID, fixture label and owned mount were verified. No unrelated
process or container was stopped. These results remain scoped to that source.

Verified main `071b329731103ef3be5113ff79faf12b856aa68e` merged PR #181 while
this round was in progress. Integrate it as an ordinary merge, preserving current
MCP names, display-only rename, history attribution and the expanded installed/demo
checks. Resolve the sole textual guardian-help conflict by retaining both `rename`
and native demo inspect/digest options. Review the automatic documentation,
contract-baseline and supervisor-fixture unions. This is integration, with no new
product scope; the original branch base remains `3bc606f` in historical evidence.

The integrated final candidate uses `071b329` as the migration comparison base.
Run focused native forwarding/setup, helper and documentation/contract consumers,
then freeze for affected independent review of the integrated PR diff, a renewed
full migration gate, applicable native and original example coverage, a new sealed
artifact and all installed/demo/assistant-setup/replacement checks. The old original
browser example cannot be carried forward because main changed it. Reconfirm main
before push and require exact-head CI with same-attempt qualification receipts;
no workflow ran for cb29929 because the PR was conflicting. Retain only explicitly
unchanged input coverage. Human acceptance and the bounded Claude offline probe
remain pending; no human trial or personal provider action is authorized by this
integration.

## Review correction round

All three supplied review findings are accepted: ownership-loss Quit feedback,
safe visible helper reasons, and Desktop outcomes after Done. Architecture and
security independently approved the bounded amendments above before dependent
implementation. Refusing transitions still protects against new native races;
it does not prove that an already-past-checkpoint helper cannot rename config
after Quit. Interrupted apply can retain its root-wide guard, proposal and backup.
Do not reclaim that guard, replay apply or describe restart as recovery.

Tests first reproduced the stopped-timer failure, missing safe-result protocol,
and reopened-panel completion bug. Focused fixtures cover Cancel/confirmed Quit,
reentry, closed panels, lifecycle precedence, malformed envelopes, hidden outcomes
and concurrent real NSTask termination alongside the finite adapter. No new
process cancellation policy or provider action is included.

Main `4d68bcf8cf357b21f08681b8313d28e3d1b4e8a5` adds only two backend timing
test corrections, with no overlapping files or new instructions. Integrate those
tests unchanged and use affected checks. Prior `811caf4` CI passed; this round
does not repeat its broad qualification. The sealed `c941d3c` trial is older and
does not include these native corrections. A corrected trial, human acceptance
and final gates wait for the agreed finalization milestone. Targeted checks
passed; final validation pending.

## Activated retained-model reuse (2026-10-15)

The user explicitly requested local Qwen smart search in demo, superseding the
previous unactivated follow-up. Reuse only existing pinned same-envelope weights
through unchanged canonical-path, owner, mode, link-count, size and full-hash
inspection. Missing/invalid assets keep the no-model path; demo download stays
refused. No import, copying, new setting, provider selection or walkthrough edits.

Remove only the personal-mode veto in preparation and managed model authority.
Preserve application role, exact session generation, selected data/identity pair,
held owner, current metadata and revocation checks. Existing supervisor ownership
drains the old application/model before mode/reset/restart and creates fresh
credentials/session. Native labels retain Demo identity for all AI states and
sleep; a user-requested mode transition clears the prior sleep latch, while sleep
during transition still invalidates the new session. Banner availability follows
actual capability status; configuration alone never claims model readiness.

Coordinator and independent security/lifecycle reviewer approved this bounded
four-product-file amendment before implementation. Requested Astra/xhigh remains
unverified. Backend admission and preparation tests fail first, followed by
focused authority/revocation, no-model/assets, native transition/labels/download
and synthetic HTTPS smart-search browser evidence. Review the affected diff,
commit/push once, then build one sealed trial at a new path. Preserve the running
trial, its model bytes and provider configuration. Prepare a same-root launcher
for the user to run after normal Quit; do not launch or run live Qwen automatically.
No full local gate or complete qualification during this feedback round. Report
“Targeted checks passed; final validation pending.” Required final gates remain
for the agreed end milestone; older artifact evidence retains its original scope.

Failure-first evidence: the actual demo authority test denied admission, and the
compiled menu fixture rejected its obsolete label. Preparation initially exposed
a fixture omission (missing synthetic store ID); after correcting that fixture,
an owned copy of the original preparation entrypoint failed because demo never
inspected assets. The corrected entrypoint passes the same assertions. Synthetic
inspection/certificate collaborators test orchestration; unchanged real asset
checks and certificate generation retain their own trust boundaries.

Targeted amendment evidence: preparation/assets/download admission16/16; backend
capability grammar21/21; final affected native authority, labels, mode transitions
and model-loss/unlock4/4. Existing revocation coverage passed in the prior focused
6/6 run with unchanged inputs. The browser's three existing demo cases passed;
the new synthetic smart-search case initially queried before navigation/unlock,
then passed1/1 after fixture ordering was corrected. An early-exit C fixture's
unused handler warning was also fixed before its successful native run. Backend,
web and native builds, Markdown153, contracts and whitespace passed. These are
synthetic tests, not a real Qwen quality or installed model-enabled acceptance
claim. The next single sealed build is for the user's named smart-search retest.

## Smart-search context correction (2026-10-16)

The user's real Qwen request returned `Local model context limit`. The existing
single catalog prompt used 28,420 tokens before chat framing. Keep the unchanged
12,000-token input limit, one inference call, deadline, cancellation and result
ordering. The independently reviewed correction uses request-local numeric
references, authorized active/requested suggested values and compact semantic
rows only for the local adapter's private explicit opt-in. Hosted/unknown adapters
keep definition-only prompts. Filter visible slugs and definition-aware value
permissions before constructing context; absent value permission fails closed.
Never include evidence, provenance or database row identifiers.

Suppress only descriptions/names that exactly match the current public importer's
generated boilerplate; preserve ordinary/custom descriptions, options, types and
all candidate definitions. No persisted/imported data or walkthrough changes.
The dashboard distinguishes context/input limits and invalid responses using
fixed safe messages. Tests first cover references, metadata preservation, denied
and archived-sensitive values, hosted isolation and cancellation; focused actual
adapter/browser consumers follow. Offline pinned vocabulary-only measurement of
the complete public 208-definition catalog includes exact chat framing and repair
text; it is not live inference. One reviewed source-bound trial rebuild supports
the user's manual Qwen retest. No broad gate during this correction round.
