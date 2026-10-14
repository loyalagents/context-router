# Portability demo rehearsal

Status: implementation and local automated validation complete; two fresh
complete-diff reviews approved, including the affected grant-verification rechecks.
Live authentication, assistant behavior and the user walkthrough remain pending.
The later Claude Pro B/Desktop C adapter extension below has focused checks
passed and affected implementation approval, including the subsequent
installed-version requalification. User-run Pro login/discovery remains pending.

## Outcome and scope

Prepare a repeatable local demo of two agents sharing Context Router memory,
independent permissions, and real mutation/access history. Keep reusable import
logic clear. Use the existing backend, SQLite, MCP, dashboard, and administration
interfaces; keep all new tooling under this example directory. No product-only
demo exceptions, source-data edits, personal-state/config changes, model calls,
remote publication, or automatic merge.

Base: `2497cc209e4d8c1233a7dcd6852b9fd8f4b1b42c`.
Branch: `codex/context-router-portability-demo`.
The user approved implementation and local autonomous testing on 2026-10-13;
the main live assistant walkthrough is reserved for the user afterward.

Milestone: a locally committed, independently reviewed rehearsal branch with
automated/local checks passed. Live assistant authentication/discovery/quality,
the human walkthrough, and later PR/merge/release qualification remain pending.

## Ownership and reviews

Use the sensitive profile for credential/persistence boundaries, while keeping
the example's feature scope small. Coordinator is the sole plan writer until
handoff; then one implementing subagent owns all repository edits, including
review corrections and evidence updates. Coordinator and reviewers remain
read-only during implementation. Tests/builds are serialized where resources
or generated outputs are shared.

Requested settings: planner GPT-6 Astra/xhigh; architecture reviewers Astra/high;
security/persistence reviewers Astra/xhigh; implementation writer Astra/xhigh.
Effective runtime settings are not independently observable. Coordinator uses
its inherited settings without claiming a particular tier.

Sequence: planning subagent -> two independent plan reviewers -> coordinator
fixes plan -> distinct implementation subagent -> two fresh complete-diff
reviewers -> implementation writer fixes problems and obtains affected rechecks
-> frozen-input local validation -> contact user for live rehearsal.

## Checkpoint 1: reusable import mapping

Separate these responsibilities, using small modules rather than a framework:

| File | Responsibility |
| --- | --- |
| `records.mjs` | Pure JSONL parsing and record mapping; bounded file loading, hashes, duplicate detection, summaries |
| `mcp-import.mjs` | MCP connection/envelope handling and sequential create-definition/set-value import |
| `runtime.mjs` | Fresh private roots, administration, verification, existing dashboard startup |
| `clients.mjs` | Client launch specifications and session environments |
| `demo.mjs` | CLI parsing and dispatch |
| `README.md` | Setup, import contract, limitations, five-minute rehearsal |

Mapping accepts one validated dataset slug segment; CLI defaults to `demo001`.
Slugs are `<category>.<dataset>.memory_<UUID-without-hyphens>`.
Import 189 active records from 198 source records across 11 files. Preserve the
nine inactive source records in the private preparation report without making
them active. STRING values contain the exact original sentence; GLOBAL means
location-independent, not public. Definitions are user-owned and sensitive.
Evidence contains the complete source record, file, line, and SHA-256. Preserve
qualitative confidence in evidence; leave native numeric confidence null. Keep
memory text out of schema descriptions. Never infer current facts from the
historical 2024-2025 snapshot or reconstruct absent source versions.
Existing MCP SET records native `sourceType: INFERRED`; the original declaration
and import provenance remain distinct in evidence. Do not claim native IMPORTED.

Tests precede changes: corpus counts/hashes, mapping identity, dataset validation,
complete evidence, inactive exclusion, malformed/duplicate/category-mismatched
records, bounded regular files and symlink rejection. Original JSONL stays intact.

## Checkpoint 2: fresh preparation and inspection

Commands: `inspect`, `prepare --out`, `serve --root`, `verify --root`,
`claude --root`, and `codex --root`. Verify is non-listening and runs with the
demo server stopped. It tolerates legitimate post-import edits.
Verification checks identity, expected definitions/ownership/sensitivity, expected
active-row membership, current attribution and retained import audit evidence.
Report modified values/evidence separately from those structural invariants;
deletion, unexpected membership or mismatched ownership is an explicit mismatch.

Preparation validates source and build prerequisites before exclusive creation
of a canonical private 0700 root. Refuse existing roots; do not implement reset,
resume, arbitrary live-state import, or concurrent merge. Initialize a separate
database/identity using existing administration. Provision a narrowly scoped
importer, write through real MCP, then verify every persisted value, schema,
ownership, sensitivity, null confidence, and complete evidence via application
readers. Revoke importer before success; attempt safe revocation on failure.

Issue independent client credentials: A can READ/WRITE demo values but cannot
DEFINE; B can READ except health and finance. Prepare private workspaces and
client configuration roots. Publish completion manifest only after verification
and successful closure. Record source hashes, source revision/dirty state,
dataset, build/toolchain evidence, actual client IDs, skipped data and limits;
never record credential bytes. Stop on ambiguous writes with no retry. Preserve
failed state with a sanitized stage; refuse incomplete preparations.

Validate private paths/files before reuse, including ownership, permissions,
canonical paths and links where appropriate. Use existing credential parsing.
Delegate startup to existing no-model local UI on default ports 3003/8788, with
ephemeral ports for tests. Occupied ports fail without disturbing their owners.
Keep ambient database/model/provider/debug variables out of runtime children.

## Checkpoint 3: real MCP, audit and persistence

Use isolated state and real production MCP HTTP with A/B credentials. Aggregate
category reads: A=189, B=145; largest category=31. Test excluded categories and
exact slugs, A's denied DEFINE, B's denied WRITE, revoked importer, independence,
and restart persistence. Restricted reads are filtered, not necessarily DENY.

Update the known family-dinner record once as A; preserve its other sentence
details and append an explicitly labeled rehearsal change. B freshly reads it.
Verify one persisted audit event with before/after, A's actual actor key, MCP
origin and correlation ID, plus live lastModifiedBy. Verify persisted successful
read/write and denied-write access events, sanitized metadata, and correlation
with the mutation. Denied writes change neither value nor mutation audit count.
Assert A's typed `MCP_PERMISSION_DENIED`, B's exact dispatch authorization-error
envelope, and persisted typed `DENY` outcomes. B's existing dispatch envelope has
no code; do not invent one. Never accept arbitrary rejected promises that could
represent transport or validation failures.
Use paginated history reads. Access append is best-effort; mutation audit is
atomic. Do not claim logging of discovery or pre-dispatch authentication failures.

Important existing behavior: an ordinary SET without evidence clears the live
row's imported evidence. Test that behavior and retained original source in the
audit before-state; unedited rows retain their evidence across restart. Do not
promise live provenance survives every update, or change product semantics for
this demo. Ordinary MCP reads omit evidence; use owner dashboard/history readers
to inspect it. Search uses schema metadata, not value text; category-prefix
retrieval avoids truncation and needs no local inference.

Retain no-replay tests. Cover incomplete preparation, startup/port conflicts,
owned-resource shutdown, and preservation of unrelated state.

## Checkpoint 4: clients and dashboard

Use supported per-invocation client settings with fresh demo-only configuration
roots/workspaces. Keep personal auth/config/hooks/plugins/connectors untouched;
do not copy them. If isolation requires fresh login, document it as a later
user-run step. Credential bytes are environment-only, never argv/config/logs.
Verify exact installed CLI behavior locally; fail clearly rather than falling
back to personal config. Do not claim stronger OS isolation than provided.
Explicitly disable supported native shell/file and unrelated connector tools;
a read-only sandbox alone still permits file reads. Verify required settings
offline against the installed client and fail launcher preflight if unsupported.
Describe permission enforcement as MCP server authority, not OS isolation.

Stub-executable tests check actual argv/env/cwd, demo-only MCP config, absence of
unrelated inherited variables, no token leakage, and workspaces without source
data/manifests. Installed help/config checks remain offline and model-free.
Prompts require fresh category-prefix MCP reads, acknowledge historical context,
and omit unavailable local AI tools. Actual cloud assistant runs wait for user.

Browser test uses real existing dashboard, pinned Chromium, fresh profile,
origin-restricted requests and generated unlock. Inspect imported preference,
A's update after normal refresh, actual client identities/permissions, and audit
and access history. No response injection or replacement UI. Stop/reap only
owned processes before removing test-owned fixtures.

## Validation and handoff

Pinned Node 24.21.0/pnpm 10.25.0 pass. Available browser is Playwright 1.63.0,
Chromium 153.0.8010.12/revision1243. Installed client help reports Claude Code
2.1.296 at initial qualification (later requalified below) and Codex CLI 0.160.0;
this is not evidence of live connectivity.

Build backend/web with pinned tools as needed. Run all example unit/integration/
browser tests serially, markdown-link and affected documentation-consumer checks,
and whitespace checks. Bind evidence to final source/builds and corpus hashes.
Review all new/untracked files, including source data, before local commit.

Example-only scope does not require installed-package qualification or a full
migration run to establish this limited rehearsal milestone. Existing gates and
CI are unchanged and remain required when applicable to later PR acceptance.
Any product/runtime changes require scope/validation reassessment.

Final report: "Targeted checks passed; final validation pending." Clearly state
remaining live-client/human/CI checks. Provide exact startup/client commands,
prepared state location, stop instructions, and the rehearsal sequence: shared
read -> explicit A update -> fresh B read -> audit -> restricted read. Live B
does not discover a mutation tool. The direct-MCP integration harness proves its
typed write denial/access event; A's discovered mutation tool can demonstrate a
denied DEFINE in the live walkthrough without broadening B's authority.

Plan review disposition: architecture reviewer required the live/SDK denied-write
distinction and suggested native sourceType/verify invariants; all incorporated.
Safety reviewer required explicit native-tool limits and typed denials; both
incorporated. No other plan blockers were reported. The implementation remains
responsible for proving supported client controls and exact observed behavior.


## Implementation checkpoint (2026-10-13)

The coordinator approved two bounded corrections based on observed contracts:

- B's pre-handler authorization denial has an exact error envelope but no response
  code. The SDK test asserts that envelope, the persisted `DENY`/`LOCAL_MCP` code,
  and no mutation; A's handler denial remains typed `MCP_PERMISSION_DENIED`.
- Different vendors are optional. `codex --agent a|b` gives the two roles separate
  homes/configuration/workspaces. The default is B. Claude's `--bare` skips
  personal keychain/OAuth and requires an explicitly provided demo API key.

Codex 0.160.0 reports `unified_exec=true` despite `features.unified_exec=false`.
The [official configuration reference](https://learn.chatgpt.com/docs/config-file/config-reference)
explains that its user opt-outs are ignored: it selects an execution transport;
`features.shell_tool` controls command-execution exposure. The launcher preserves
both requested false settings and requires observed `shell_tool=false` and the
other exposure gates. A regression rejects missing/enabled shell exposure while
accepting the documented unified-exec behavior. These are client configuration
controls, not OS confinement. Automatic approval initially rejected removing the
unified-exec setting; it was retained, and the evidence-based preflight correction
passed approval. No personal auth/configuration was copied or altered.

Initial focused results: 18/18 serial example tests passed, including real
production MCP/SQLite, non-listening verification, persisted audit/access,
restart, failed-import revocation, existing dashboard Chromium journey and
occupied-port preservation. Both installed client offline preflights passed.
Client-gate and repository-output regressions were added before complete-diff
review; final frozen-input results are recorded below.


## Fresh implementation review correction (2026-10-13)

Both fresh complete-diff reviewers reported the same P2 blocker: verification
checked maximum client policy but omitted persisted database grants. The bounded
correction uses the existing `inspectForUi` authority snapshot and requires the
prepared empty-grant baseline as well as the expected maximum policy. Changed
or unavailable authority is an explicit authority mismatch, not a claim of
memory corruption. No product contract or administration behavior changed.

A real isolated regression was written first and failed because a B READ denial
incorrectly verified successfully. It now checks B's READ and A's WRITE denial
through existing administration, unchanged maximum policies, verification
rejection, and restored verification after removing each added grant. All five
affected integration tests pass. Both reviewers approved the affected correction
with no new findings; their unrelated complete-diff coverage carries forward.


## Final local evidence (2026-10-13)

The read-only coordinator independently ran the frozen candidate with Node
24.21.0 and pnpm 10.25.0:

```sh
node --test --test-concurrency=1 examples/demo-10-2026/*.test.mjs
```

Result: **21 tests passed, zero failures, zero skipped**, in 28,695.677 ms.
Coverage includes the real existing dashboard/Chromium journey, occupied-port
preservation, MCP permissions and denials, persisted audit/access, restart,
failed-import revocation and the added-grant verification regression. Both fresh
reviewers approved the implementation after the bounded correction. After that run, only README/PLAN evidence text and two extra EOF blank lines
in runtime/importer files changed. The coordinator authorized the whitespace-only
cleanup; meaningful code is unchanged, so test and review coverage carries
forward. Documentation links and the staged whitespace check were renewed.

The coordinator compared all 11 JSONL SHA-256 values against its original
pre-work snapshot: byte-identical. It also compared the existing personal Codex
configuration and Claude configuration/settings snapshots: byte-identical.
The writer's separate corpus snapshot likewise matches. No provider-backed
assistant, model call, personal auth/configuration edit, push or PR occurred.

Both installed client offline preflights passed. Live demo-only authentication,
tool discovery, actual assistant behavior and the user walkthrough are still
pending. The coordinator will prepare retained state outside the repository
and check manual CLI/start/stop behavior after the local commit. Later CI,
PR/merge and any applicable release qualification remain separate requirements;
existing gates were not changed or retired.


## Live launcher correction (2026-10-13)

The user reported successful demo-only Codex A login, followed by strict startup
rejection of `tools.view_image`. The previous feature/MCP offline readers omitted
`--strict-config`, so the passing 21-test suite did not cover this boundary.
The installed 0.160.0 parser is authoritative: remove only that unsupported alias,
retain and verify `features.view_image=false` and every other native-tool gate.

A tests-first regression reproduced the real strict rejection, and a second
regression proved the old preflight ignored an injected unknown configuration
key. Preflight now invokes the exact interactive argv with strict parsing,
piped empty stdin and fresh disposable HOME/CODEX_HOME/workspace. It accepts
only exit 1, empty stdout and the exact `Error: stdin is not a terminal` refusal.
This version validates configuration before that boundary; no signed-in auth,
MCP credentials, assistant session or model call is used. An opt-in installed
binary regression covers both A/B and an unknown-key negative control, keeping
the portable unit suite independent of a Codex installation.

Affected validation: all six client tests passed with `CR_DEMO_TEST_CODEX=1`,
including the actual pinned binary. The coordinator independently repeated the
client suite: six passed, zero failed, zero skipped, in 1,959 ms. Architecture
and safety reviewers approved the affected code/tests with no findings; this
evidence-only update preserves those approvals. Unchanged import/MCP/SQLite/
browser coverage carries forward. The retained demo root, its user login and
running dashboard were not read or modified. The user's live retry remains
pending; no installed-app transition is part of this correction.


## Claude Pro B and later Desktop C (2026-10-13)

The user selected Claude Code with a Pro subscription for agent B first, beside
the existing Codex A session. Desktop becomes a later agent C with a separately
provisioned credential. Preserve the retained demo, running servers, personal
auth/configuration and original corpus. The installed-app move and approved
reset are later operations, not part of this implementation.

Add only explicit `claude --agent b --auth subscription` support; legacy defaults
remain A/API-key/bare. Reuse the existing Claude demo directories for the one
Claude Code session; no prepared-root migration. The supported restricted mode
allows subscription login while retaining empty native tools, strict demo MCP,
explicit settings and disabled hooks/skills/Chrome. Disable account connectors,
IDE auto-connect, memory/CLAUDE.md loading, marketplace auto-installation,
auto-updates and nonessential traffic. Supply no ambient auth or API key.
The [authentication reference](https://code.claude.com/docs/en/authentication)
documents separate claude.ai login/Keychain entries per configuration directory.
Terminal `forceLoginMethod` only preselects the choice, so direct the user to
Claude.ai Pro rather than Console. See the [CLI reference](https://code.claude.com/docs/en/cli-reference)
and [environment reference](https://code.claude.com/docs/en/env-vars) for controls.

Offline preflight uses complete launch argv followed by `auth status --json`
in unique, disposable, unauthenticated directories. Require the exact fresh
config directory, `loggedIn: false`, `authMethod: none`, first-party provider,
disabled analytics, exit 1 and empty stderr. Reject unknown options/unexpected
auth state; this is argument/auth-probe evidence, not a live model test. The
real installed-CLI regression is opt-in (`CR_DEMO_TEST_CLAUDE=1`); portable
tests do not require either installed assistant.

The tiny Desktop adapter imports the unchanged production `createBridge` and
secure credential reader, adding validated `--mcp-port` (default 8788), pinned
Node/debug guards, sanitized startup errors and the existing shutdown pattern.
Do not fork protocol/recovery/replay logic or alter the production 8787 CLI.
Preserve relative paths in a later four-module private snapshot (adapter plus
the three existing bridge files), with a source receipt. Live C provisioning,
Desktop configuration and user restart are not performed by this change.

Both affected plan reviewers approved this bounded approach; the safety review
required explicit memory and marketplace controls, now implemented and tested.
Tests preceded implementation: unsupported subscription options/role and absent
adapter failed first; the added environment requirements also failed first.
Focused results: nine client tests passed with both installed CLI regressions
enabled (2,775.729 ms), ten CLI/mapping tests passed, and three Desktop adapter
tests passed (3,095.666 ms). Desktop tests exercise real SDK stdio to an owned
MCP port, fresh shared reads, health filtering, hidden/denied mutation, persisted
denial/no mutation audit, argument/debug guards before credential/network access,
and EOF/signals. Unchanged import/persistence/dashboard and production-bridge
no-replay coverage carries forward; no broad rebuild or migration gate was run.
Both affected implementation reviewers approved the seven-file candidate with
no findings. The coordinator independently confirmed the three unchanged Desktop
tests (2,840.908 ms), documentation links (149 files) and whitespace checks.
Its client check discovered that the installed Claude executable had updated
to 2.1.299; full-argv auth-status assertions passed, then the version pin correctly
refused the unqualified version. The writer reproduced that failure before
updating the pin and corresponding fixture/documentation references. All nine
client tests then passed on 2.1.299 (2,864.656 ms), including restricted-mode
guards, the exact fresh auth-status result, unknown-option rejection and Codex
A/B controls. Both reviewers confirmed approval of the frozen 2.1.299 candidate
with matching hashes and no findings. The coordinator independently repeated
all nine installed-client tests: nine passed, zero failed, zero skipped, in
2,866.717 ms. Together with its ten mapping/CLI tests and three Desktop tests,
all 22 affected tests passed across the isolated focused runs. Prior unaffected
coverage carries forward. This final evidence-only edit preserves those
approvals; documentation links and whitespace checks were renewed before the
local commit. User-run Pro login/discovery, actual assistant behavior and the
later Desktop C setup remain pending. No login, inference, live-state/auth/config
change, push or PR occurred during this qualification.
