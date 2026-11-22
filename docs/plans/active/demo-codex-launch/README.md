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
