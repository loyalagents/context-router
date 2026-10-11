# Consolidated Installed-App Acceptance

Status: manual feedback round complete; consolidated acceptance/release disposition
remains pending. Candidate 14 corrects sleep-during-shutdown timing; 184 native tests
and all 11 installed phases passed. Final local gate and exact-head CI results are
tracked on the PR and in its external final receipt. Candidate 13 live evidence
remains historical and does not qualify Candidate 14 lifecycle. This checklist records human/platform acceptance separately from
automated qualification. Do not mark it passed from component tests or a build.
Use the latest retest candidate and exact source/manifest identified in its handoff;
acceptance-round corrections can remain local until the final candidate is frozen.
[PR #168](https://github.com/loyalagents/context-router/pull/168) retains historical
qualification and the unsigned/hardware/release limits. Earlier installed passes
do not qualify changed inputs; renewed final qualification must be recorded on the
PR before accepting the final artifact.

The [installed runbook](../../../../useful/INSTALLED_MAC_APP.md) contains exact
CLI syntax and recovery constraints. Use synthetic pilot data and a private
installation; never clear ownership metadata to bypass a refusal.

## Retest Versus Final Acceptance

Follow the reviewed [correction/finalization sequence](plan.md#correction-rounds-and-finalization).
A bounded trial handoff records its artifact digest, source revision and any dirty/
copied-input identity, permitted retest, passed checks/affected reviews and pending
qualification. Package verification and relevant safety/integration checks must
pass before the trial; broad final qualification need not precede every retest.
Say "Targeted checks passed; final validation pending." Trial status grants no
additional live-model, download, personal-state/client or recovery authority.

Record observations against that exact trial, without marking the whole checklist
or a changed artifact accepted. When the agreed feedback round ends, freeze the
candidate and complete required installed qualification, full local migration gate,
independent final review, required human checks and exact-head CI. Carry forward
only explicitly unaffected observations; retest affected behavior on the final
artifact. Existing CI triggers and release limitations remain unchanged.

| Check | Expected result | Status |
| --- | --- | --- |
| Open the complete candidate in Finder | CR menu appears; dashboard opens; no developer tools or separately operated server needed | Pending human |
| New unlock code, copy, unlock; Lock and repeat | One-use code works once, expires after five minutes, re-unlock needs a new code | User confirms locking/unlocking checks completed; exact expiry timing not independently observed |
| Close all dashboard windows | Menu/MCP remain available; Open dashboard returns to local UI | Automated browser passed; human pending |
| Use preferences and a manual MCP client at `http://127.0.0.1:8787/mcp` | Shared state and per-client grants; browser code is rejected as MCP credential | Candidate 10 fresh Claude Code reads and read-only tool discovery confirmed before/after Restart; broader grant/guard acceptance pending |
| Restart local runtime with an idle connected client | Connections interrupt; current dashboard opens when ready and accepts a fresh unlock; same MCP URL/credential and persisted state remain | Candidate 10 user-confirmed restart/unlock, disconnected old tab, persistence and MCP reread |
| Quit, then reopen | Owned cohort exits; normal relaunch preserves state | User confirms offline full Quit/reopen completed; process extinction remains separately measured by installed qualification |
| Explicit model consent and Cancel | Correct pinned source/size shown; progress bounded; non-AI stays usable; no incomplete asset selected | Candidate 11 download/install and AI readiness user-confirmed after CDN fix; user subsequently confirms cancellation checked |
| Selected model already installed, network unavailable | Local AI works within retained limits; no hosted fallback | Dashboard/MCP smart search and post-restart search user-confirmed; user subsequently confirms offline full Quit/reopen checked; isolated live qualification remains separate |
| Real sleep/wake with installed model | AI remains unavailable until explicit Restart; no automatic replay; non-AI remains healthy | Candidate 11 user-confirmed restart-required menu after sleep and successful explicit restart recovery; no in-flight operation tested |
| Certificate expiry or model failure | AI unavailable; explicit whole-generation restart required; preserved data/authority | Candidate 13 actual-model invalidation/restart passed with authenticated non-AI access and preserved identity; real expiry/model-crash human observation remains unperformed |
| Backup, pending restore, revoke/rotate restored authority, activate | Current selection retained until acknowledgment; resulting credential behavior matches explicit restored authority | Automated installed flow passed; human pending |
| Compatible replacement and app-only uninstall/reinstall | Complete verified app starts; data/identity/MCP/models retained; altered payload refuses before state access | Automated installed checks passed; human pending |
| Duplicate launch and occupied MCP port | Existing owner/listener untouched; no second ready listener or fallback | Native fixtures; actual menu pending |
| Abrupt owner loss and reboot recovery | Uncertain state preserved and launch refused; no metadata deletion or inferred successful recovery | Cross-boot recovery unqualified |
| Explicit offline `cleanup-downloads` | Owned partial stages removed; exact interrupted publication completed; unexpected files and uncertain ownership refused | Native fixtures; rebuilt installed smoke tracked on PR |
| Signed private distribution | Real signing identity, nested signing, notarization, Gatekeeper and declared release destination verified | Blocked on missing access/destination |

Record candidate manifest/archive digest, Mac model/RAM/macOS build, each observed
result, timing and failures. Do not put unlock codes, credentials or personal data
in evidence. A failed or unobserved shutdown is not a successful restart. Preserve
its envelope and report the failure for diagnosis.

Windows/Linux deferral is approved; this checklist does not expand the supported
hardware claim. Steps 10–11 and full MCP onboarding/UI redesign remain deferred.

Human report on 2026-10-09: Candidate 08 passed package verification, opened the
dashboard and showed the CR menu without a model. After an initial login, Restart
left the existing tab unable to use fresh codes; Open dashboard restored access.
The confirmed cause is a new ephemeral dashboard address without automatic browser
opening after Restart. The bounded correction opens the current address on each
successful explicit Restart and clarifies menu/terminal unlock guidance. This
report is partial acceptance, not a passing restart or complete human checklist;
retest the rebuilt candidate named on the PR. The old browser session remains
intentionally invalidated, and the old tab is not redirected or automatically
authenticated.

Human follow-up on 2026-10-10: the user staged Candidate 09 into `$next_app` and
then launched the earlier `$app`. Read-only process inspection confirmed the older
app owned the running menu/guardian, so this was not a Candidate 09 navigation
failure. It nevertheless exposed a remaining UX gap: an obsolete tab still
offered unusable unlock. The next correction replaces the page with a disconnected
screen after session restoration/revalidation or unlock encounters a connection
failure, clears private browser state and removes the unlock form. Re-test with
the exact new app after a successful Quit and closing previous dashboard tabs.
Automated targeted passes and any new package verification do not constitute
human acceptance or renewed final migration/CI qualification.

Later Candidate 10 reports confirmed the restart fix, basic persistence and fresh
Claude Code MCP reads before and after CR Restart. The configured read-only client
did not expose a mutation tool; no unauthorized write was actually dispatched.
Model download then failed immediately after consent, leaving the dashboard
ready and no partial model. The pinned URL redirected to the documented
`us.aws.cdn.hf.co` host, absent from the shipped allowlist. A narrow policy
correction is under targeted validation; real download/cancellation, installed
AI and the complete human checklist remain pending.

Candidate 11 follow-up on 2026-10-10: after the reviewed CDN fix at local commit
`351536c1117d1f33d0dafa399acb599586d22a0c`, the user reported the model downloaded
and supplied native/browser screenshots showing AI available. Dashboard Smart
search and one Claude Code `smartSearchPreferences` call returned the expected
synthetic stored full name. A further search worked after restart. Clarification
remains pending on full Quit/reopen versus menu Restart and whether internet
stayed disconnected. The model-download cancellation step is also unconfirmed.

Actual sleep/wake produced the native restart-required status; the user then
reported successful restart recovery and showed the unlocked dashboard with AI
available and profile preserved. This is human functional evidence, not an
independent measurement of the running binary, inference timing, in-flight
cancellation or forced-loss/reboot recovery. Deferred dashboard restart and
installed-model menu presentation are tracked in the
[UI follow-up](../../ui-usability/README.md). The final frozen candidate still
needs the full local gate, applicable installed qualification, independent final
review and exact-head CI; the separately bounded automated live series remains
unapproved. Earlier artifact passes remain historical for changed inputs.

Candidate 11 PDF acceptance then reported one failed upload with model busy while
the dashboard showed AI available. The user confirmed only the upload was active;
Claude was connected but not running an AI request. A synthetic TLS fixture
reproduced the menu's automatic status check taking admission and rejecting a file
request despite zero active inference requests. The correction makes repeated
private menu status observational after initial qualification, preserving real
request qualification and exclusion. This explains a reproducible possible cause;
the exact timing of the user's request was not independently observed. Document
contents were not inspected. Upload acceptance remains failed pending a rebuilt
candidate retest; no automatic retry or write was performed.

Candidate 12 subsequently produced the same PDF busy result. Read-only executable
paths confirmed that Candidate 12 owned CR; a separate Ollama runtime was also
running, but its involvement in the human failure is unproven. A deterministic
browser/backend/TLS fixture reproduced a second CR race without Ollama: focus
revalidation reserved model admission through `/api/local/capabilities`, and
upload returned `ai_error` with zero inference dispatches. A separate regression
also caught automatic status probes after cancellation/completion. The correction
separates passive session validation from AI qualification and removes those
automatic probes; the actual user PDF still requires a new candidate retest.

Following the Candidate 13 handoff, the user reported three uploads without a
repeated busy error: one completed with no preferences, one PDF returned an
unsupported-input error, and a third produced proposals with Applied outcomes.
Saved preferences became visible elsewhere on the page after refresh. These are
functional observations, not proof of complete extraction or universal race
absence; the running executable was not independently rebound for this report.
The user agreed to defer investigation of the rejected PDF and focus on Step 09.
Stale-list refresh and possible attribution of another person's email are recorded
as follow-up findings; document contents and correct attribution remain unverified.

The user subsequently clarified that offline full open/Quit, locking and download
cancellation checks were already completed. Treat those human flows as confirmed
and do not request routine repetition. Exact candidate/timing and internal cleanup
were not independently measured by that clarification. Renew only affected
coverage on the frozen final artifact; full installed qualification, migration
gate, independent final review and exact-head CI remain pending.

## Candidate 13 Finalization Round (2026-10-10)

The user ended routine manual testing and asked the coordinator to complete final
validation. Carry forward the confirmed flows above with their observation limits;
do not silently upgrade incomplete rows to passed or request routine repetition.
The exact Candidate 13 payload is reused: product/build/test inputs are unchanged
and independent review verified its original dirty-source receipt and full payload.

All three fresh complete-diff review mandates passed. The installed smoke passed
11 phases in 210.315 seconds, including browser, CLI/MCP, restart, authority-changing
backup/restore, replacement/removal and cleanup. All five guardians exited zero;
cleanup was empty. The full native suite passed 180 tests with zero skips.

After separate explicit user approval of the reviewed 2,048-token bound, the one
installed live series passed in 68.273 seconds. It exercised two actual completions,
one rejection after invalidation, continued authenticated non-AI access, explicit
restart, a new certificate, preserved identity and clean shutdown. No retries,
downloads, external network access or personal-state changes occurred. This narrow
series does not restore Step 06 quality/cancellation qualification or erase E/H.

See [Candidate 13 qualification](qualification-candidate13.json) for immutable
artifact and receipt bindings. Full local gate and final-head CI results are recorded
there and on the PR. Signing/notarization/Gatekeeper and a private release destination,
other hardware/platforms, real expiry/forced-loss/cross-boot recovery and unperformed
human backup/replacement/duplicate-menu checks remain explicit limitations. No merge,
release, complete human checklist or broader supported-platform claim is inferred.
