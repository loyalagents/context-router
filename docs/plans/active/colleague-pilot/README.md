# Assisted Colleague Pilot

- Status: activated milestone; isolated replacement/lost-reply rehearsal passed, actual Claude and distribution acceptance pending
- Priority: current primary outcome; [plan and evidence](plan.md)
- Owner: product owner; coordinator and sole writer/integrator `/root` in `codex/pilot-interruption-delivery`
- Audience: a few Git-capable colleagues, initially Apple Silicon Macs

Current qualification is limited to the measured M1 Max / 64 GiB / macOS 15.1.1
Mac, per the user's decision. Other Macs remain later compatibility trials.

## Outcome And Agreed Choices

Colleagues can obtain an identifiable app, upload their own documents, inspect
and approve suggestions, use saved preferences from **Claude Desktop**, and
return useful feedback without fighting setup or accumulating large downloads.
Assistance is acceptable; an installer framework or public launch is not required.
GitHub access helps distribution and feedback, but does not by itself solve
signing, Gatekeeper, artifact trust, account entitlement or app compatibility.

Claude Desktop integration is required for the first pilot. Claude Code is a
valuable regression client, not a substitute. ChatGPT desktop support is wanted
next but does not block the first Claude-capable cohort. Qualify the exact app,
version, account/tier, mode and data path; do not equate a Codex connection with
ordinary ChatGPT conversation support. Do not promise either desktop app works
until a real supported-client test demonstrates it.

Keep CR's managed local model as the default. Data sent as MCP tool results to
Claude/ChatGPT may be processed by their hosted models. Clearly distinguish CR's
local storage/inference from the assistant's processing and retention. The user
chooses appropriate documents and grants; never promise end-to-end offline use
of a cloud-backed assistant.

## Pilot Reset Policy

The product owner must explicitly designate each reset release in its release
handoff before distribution; an agent must not infer designation from "pilot" or
a version number. Other releases must preserve existing state on replacement or
refuse incompatible state without modifying it; never silently reset it. This
does not require supporting arbitrary backwards migrations or cross-version restores.
Decide and record whether the first pilot release is a reset release at activation.

Early designated pilot releases may intentionally reset all **CR-managed user
state**. Backwards data migration and cross-version restore are not requirements
for those releases. Warn before installation/reset, obtain confirmation before
destruction, state which data/history/credentials are lost, and explain client
reprovisioning/reconnect. Never delete original source documents or unrelated
files. Preserve and reuse compatible verified model weights unless the user
explicitly chooses to remove them. This policy is not an implemented reset
command and does not authorize deleting uncertain ownership metadata.
Preserve the persisted security floor and process-ownership checks; resetting
user data must not lower rollback protection or recreate the entire envelope.
The reviewed reset plan must explicitly disposition backups, pending stores and
credential export files, including the authority they could restore or expose.

## Plan The Smallest Delivery

These are internal checkpoints, not a required PR count. Prefer one cohesive PR
for a bounded outcome; split only when each merge is independently useful and
keeps a supported runtime. Do not create separate planning or closeout PRs.

1. **Pin the cohort and acceptance contract.** Record target Mac/RAM/macOS,
   exact clients and account constraints, download source, supported inputs,
   data/privacy warning and reset policy. Assess the
   [known limits](../../../current/LOCAL_APPLICATION.md#qualification-and-known-limits).
   Treat new hardware as compatibility testing until measured. Review the plan
   across implementation, packaging/trust, persistence/recovery and client security.
2. **Prove Claude Desktop on the installed app.** Own the minimum setup and
   reconnect implementation in this active pilot's `plan.md`, following the shared
   boundaries in the [MCP onboarding brief](../../backlog/mcp-onboarding/README.md).
   Broader C/C+ onboarding remains backlog unless separately activated.
   Investigate current first-party client documentation and an actual client.
   Keep loopback HTTP as the server contract. A thin local stdio adapter is a
   candidate if required by the client, not a second backend or credential system.
   Prefer the simplest documented local connection over public tunnelling.
   Do not introduce public/LAN listeners, OAuth infrastructure or automatic
   third-party configuration edits without a separately reviewed trust boundary
   and explicit consent. CLI support remains additive and tested.
3. **Make install/replacement/reset tolerable.** Identify source/artifact/checksum
   and publisher trust; qualify the actual download/quarantine/launch route on a
   clean colleague-like Mac. Decide signing/notarization or another supported
   assisted path before inviting users. A pinned-source build with the existing
   packager is an assisted fallback candidate, not a qualified route; assess its
   exact toolchain prerequisites, trust/launch behavior and colleague effort.
   Disabling Gatekeeper/stripping quarantine is not acceptance evidence.
   Measure old-to-new app replacement and peak/retained
   disk usage, including model reuse, partial downloads, previous app archives,
   logs and backups. Name safe cleanup ownership/retention and any explicit reset.
   A same-candidate fixture replacement is not real version A-to-B evidence.
4. **Resolve pilot-blocking stabilization, then invite a small cohort.** Triage
   [stabilization](../../backlog/stabilization/README.md) against the agreed journey.
   Independent bounded fixes may use worktrees; process ownership, resets, shared
   credentials and packaging need an integration owner. Do not require every
   cosmetic backlog item before testing. Finish a supported end-to-end rehearsal,
   freeze a candidate, complete applicable final qualification, then obtain human
   approval to share the artifact. Publication is not authorized by this brief.
5. **Use feedback to choose the next slice.** Expand ChatGPT desktop support or
   other capabilities from evidence, not as an automatic expansion of checkpoint 2.

## Minimum Pilot Rehearsal

- Exact artifact and supported Mac: obtain/open, unlock, download with consent,
  cancel/fail safely, restart with retained weights, show non-AI behavior without
  a model. Confirm actual disk use and a documented uninstall/reset boundary.
- Upload representative supported text/PDF inputs, handle rejected formats
  honestly, review proposals before apply, show the applied values without a
  misleading stale display. Investigate possible wrong-person attribution as a
  separate correctness/privacy issue; the accepted email omission is not a waiver.
- Complete the [Claude Desktop acceptance](#claude-desktop-acceptance) below.
- Ordinary Quit/reopen and explicit restart preserve state. Exercise occupied
  port, duplicate launch and interrupted startup; classify sleep/owner-loss/reboot
  honestly. Provide a supported safe recovery or explicitly supported reset path
  for expected pilot failures before relying on resets as the escape hatch.
  Never tell colleagues to delete journals or force-kill an unidentified process.
- Confirm credentials/unlock codes/private documents do not enter diagnostics,
  shared screenshots, GitHub issues or committed fixtures. Collect app revision,
  hardware/OS/client versions, attempted action, expected/observed result and
  sanitized diagnostics; ask separately before accessing a colleague's data.

Use deterministic synthetic fixtures for automated tests; the human pilot is
explicitly for colleagues' own data. Repository work itself does not authorize
agents to upload private files, download weights, spend provider credits, configure
personal clients or reset personal state. Request bounded approvals when needed.

### Claude Desktop Acceptance

This is the canonical minimum client checklist; the onboarding brief links here.
On the exact supported client/version/account mode and installed artifact, verify:

- Tool discovery, reads, explicitly permitted writes and denied writes.
- Independent revoke/rotate and reconnect, with shared app state visible correctly.
- More than 35 minutes idle, app/client restart, stale sessions and uncertain
  mutation outcomes. Never automatically replay ambiguous writes; a transport
  connection is not durable authority.

## Execution And Handoff

Use the [sensitive/quality-first workflow](../../../useful/AGENT_WORKFLOW.md):
Astra Ultra is the starting coordinator preference for this cross-cutting pilot;
Extra High for trust/persistence/client-boundary decisions and sensitive writing
or review, High for routine inventory/docs/bounded fixes. Record requested versus
observable settings. Final review is risk-matched, not automatically Ultra for
every reviewer; use independent specialists and as many waves as findings justify.

Work in a new `codex/` branch in the existing main checkout unless the user
requests otherwise. Read-only investigation can run in parallel; worktree writers
need distinct approved scopes/resources. Keep the user able to try the integrated
app without shared test ports, state or build artifacts being overwritten.

Preserve backend tests first. During correction, run targeted affected checks and
batch fixes. Label trial builds with exact inputs and **Targeted checks passed;
final validation pending.** Agree when human iteration ends; then freeze and run
the full applicable local gate, installed-artifact qualification, independent
complete-diff review and exact-head CI. Do not weaken or skip existing CI gates.
No automatic merging, releases, resets or broad recovery operations.

Outstanding activation decisions are the exact cohort/versions, minimal supported
Claude connection mechanism, distribution/trust route and necessary recovery/reset
implementation. Investigate them first; ask the user only for choices evidence
cannot settle. This brief approves direction, not a specific implementation.
