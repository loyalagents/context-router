# Portability demo rehearsal

Status: the user reports the A/B shared-memory and permission rehearsal works,
including A creating memories after an explicitly requested runtime DEFINE grant.
Desktop C has a separate matching B policy, passed SDK read/filtering checks, and
shows Running in Desktop 2.37337.1; provider-backed Desktop chat acceptance remains
pending. The source-only reproducibility extension below is active. Earlier
checkpoint results retain their original scope and inputs.

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


## macOS subscription Keychain correction (2026-10-13)

The user's Claude Pro B launch reported KeychainNotFound. A read-only lookup of
the default user Keychain succeeded with the OS account HOME and failed with a
fresh temporary HOME. Earlier auth-status tests did not exercise that discovery
boundary. Both plan reviewers approved this bounded four-file correction before
implementation: only macOS Claude subscription mode uses `os.userInfo().homedir`
for HOME. Codex, bare Claude and non-macOS HOME behavior remain unchanged.

Retain the demo `CLAUDE_CONFIG_DIR`, workspace, TMPDIR and every existing guard.
Set `ANTHROPIC_CONFIG_DIR` to the demo config's `anthropic` subdirectory to avoid
personal-profile fallback under the account HOME. The
[profile reference](https://platform.claude.com/docs/en/manage-claude/wif-reference#configuration-directory)
documents this explicit directory's precedence and Claude Code support. macOS
uses the existing account Keychain with a distinct entry selected by the demo
Claude configuration directory; no credential is copied, reset or inspected.
The preflight uses the same HOME/profile semantics with fresh disposable
configuration, profile, temporary and workspace directories, never the user's
signed-in demo configuration. README instructs cancelling the earlier failed
launch's Keychain dialog and retrying without creating/resetting a Keychain.

Four focused regressions failed first: the subscription HOME assertion, missing
preflight profile path, actual default-Keychain lookup and spawned child HOME.
After the correction, all nine client tests passed with both installed-CLI
opt-ins enabled (3,020.152 ms). Coverage includes actual spawned environment,
fresh preflight paths/cleanup, retained role/controls, exact unauthenticated
Claude 2.1.299 full-argv result, unknown-option rejection, read-only default
Keychain-path discovery and Codex A/B strict checks. No password queries,
Keychain writes/resets, login, inference or retained-state changes occurred.
Unchanged import, MCP, persistence, browser and Desktop coverage carries forward.
Both affected reviewers approved all four frozen file hashes without findings.
The coordinator independently passed all nine installed-client tests in
2,968.425 ms, the documentation-link check (149 files) and whitespace checks.
This final factual evidence update preserves those approvals; documentation
and whitespace checks were renewed before the local commit. The user's live
Pro retry remains pending. No push, PR or live-state action was performed.


## Codex A write-confirmation correction (2026-10-13)

The user reported Codex A refusing a mutation under approval policy `never`.
The coordinator's read-only persisted-history check found successful reads but
no A mutation access/audit event. Do not replay the attempt. Both plan reviewers
approved a four-file launcher correction: only A uses `--ask-for-approval
on-request`, `approvals_reviewer="user"`, and the demo mutation tool's
`approval_mode="prompt"`. B remains `never` with no mutation exposure. Preserve
all native-tool disabling, the read-only sandbox, credentials and MCP authority;
human approval permits an attempted update but cannot grant DEFINE. The
[configuration reference](https://learn.chatgpt.com/docs/config-file/config-reference)
and [MCP reference](https://learn.chatgpt.com/docs/extend/mcp) document the controls.

Two tests failed first on A's old `never` setting, including actual spawned
argv. Focused validation with `CR_DEMO_TEST_CODEX=1` passed eight client tests,
zero failed, with the unrelated installed-Claude opt-in deliberately skipped
(2,422.795 ms). It covers role-specific policy, explicit human/per-tool approval,
unchanged native controls, actual child argv, and installed Codex 0.160.0 full
strict A/B parsing plus unknown-key negative controls. Claude, runtime, database,
dashboard and Desktop behavior are unchanged; their prior evidence carries
forward. No provider call, live write, auth change or app/state modification was
performed. README instructs restarting only A and explicitly confirming one
existing family/home value change; B's health/finance filtering remains intact.
Both affected reviewers approved all four frozen hashes without findings. The
coordinator independently repeated the focused suite: eight passed, zero failed,
one intentional unrelated installed-Claude skip, in 2,401.864 ms. Documentation
links (149 files) and whitespace checks passed and were renewed after this final
factual evidence update. Code/test approval carries forward to the local commit.
The live approval UI and write remain pending; no push, PR or live replay occurred.

## Durable, reproducible rehearsal extension (2026-10-13)

The user requested easy local reproduction and a documented route for other
people. They explicitly chose a fresh durable demo from the original dataset,
keeping today's working demo available. Base is `5191f41dc158e6f48b86e6636c0cea50f0e4e2d6`.
The coordinator discussed the workflow before implementation. Scope remains the
example tooling, tests and docs; original JSONL, reusable mapping/import code,
production app behavior and CI stay unchanged.

Use the sensitive workflow for credentials and filesystem publication. Planner
requested Astra/xhigh; independent architecture reviewer requested Astra/high;
independent safety reviewer requested Astra/xhigh; sole implementer requested
Astra/xhigh. Effective model/effort settings are not independently verified.
The planner supplied the proposal; both reviewers approved with the invariants
below. The coordinator reconciled the plan and now hands all repository writing
to the implementing subagent. Two independent code reviews follow before the
local rehearsal handoff. No push or merge is part of this milestone.

### Contract and scope decisions

- Default to a durable private macOS demo home beneath Application Support, with
  an explicit canonical `--home` override. Separate stable per-vendor/role login
  profiles from independent `generations/<unique-id>` data/identity/exports.
- `prepare` creates the first generation and subsequently reports the selected
  prepared generation. Reject explicit conflicting input, dataset or ports.
  `prepare --fresh` creates another generation with new identity and credentials;
  previous and partially failed generations remain. It never deletes history,
  copies personal authentication, resumes uncertain imports or restores authority.
- Serialize home mutations. Fsync complete generation metadata and its directory
  before publishing the selector. Interruption preserves either the previous
  selection or a complete new selection. A stale lock is an explicit recovery
  condition, never an invitation to delete it automatically. Failed/uncertain
  publication is reported with inspection instructions, not replayed.
- Resolve generation, ports and credential once per invocation. Existing serve
  and client commands may default to the selected generation; explicit legacy
  `--out`/`--root` usage remains compatible. Foreground serve, ordinary Ctrl-C,
  and explicit client restarts remain the process lifecycle. Occupied ports fail
  without terminating or replacing their owners. Selection is not live readiness.
- New durable generations give A WRITE+DEFINE over dataset category prefixes.
  B and C have distinct READ credentials excluding health/finance, each with the
  demonstrated explicit `health.*` READ DENY. Revoke the import credential.
  Keep these defaults separate from the immutable v1 preparation contract.
- Preserve isolated client controls and exact supported versions. Add a Codex
  `--login` flow using the selected isolated profile and file authentication;
  Claude subscription login stays its normal explicit launcher flow. Stable
  profiles survive fresh generations; support one active process per vendor/role
  and do not automatically resume old conversations. Fresh preparation does not
  rewrite existing profile contents or redirect active sessions.
- Preserve strict baseline verification, including original v1 semantics; use
  versioned expectations for new A/B/C generations. Ordinary audited additions
  and authority changes can depart from that baseline. Add descriptive `status`
  showing selected generation, paths, ports, actual client policies/grants and
  memory counts; it must not claim a baseline or running-server verification.
  Defer a generic policy-management wrapper; document existing administration.
- Desktop preparation produces an immutable durable four-module snapshot,
  absolute pinned Node identity, exact-generation C credential reference, source
  hashes and a private proposed configuration update. Never use `/tmp` for
  persistent executable/credential references or follow mutable current selection.
  Receipt hashes document provenance, not independent trust; copied modules must
  match reviewed source inputs and record revision/dirty state.
- Desktop apply is a separate explicit command with user-attested closed Desktop
  and config editors. Serialize helper writers, validate trusted ancestry and
  private regular files, preserve unrelated config, refuse entry collisions,
  and require original bytes to match. Save a private backup, fsync a sibling
  temporary file, recheck original bytes, atomically rename, and verify readback.
  This is guarded replacement, not true compare-and-swap against arbitrary
  writers. Preserve recovery artifacts after uncertainty; never auto-restore.
  A newly selected generation requires explicit Desktop setup/apply/restart.

### Testable checkpoints and handoff

1. Home lifecycle and CLI: tests first for idempotency/conflicts, fresh generation
   preservation, stable profile bytes, unsafe paths, writer concurrency, failed
   preparation and interruption around selector publication.
2. Authority and compatibility: real MCP/SQLite tests for A DEFINE+SET, B/C allowed
   reads and write/read denials, independent revocation, import audits, strict
   versioned baselines and unchanged v1 roots. Old A/B/C tokens must fail against
   a new generation even if the same port is reused.
3. Client profiles: actual argv/environment/cwd tests, isolated Codex login,
   exact generation/endpoint/token binding, preserved Keychain workaround and
   both installed pinned-client offline preflights. No provider requests.
4. Desktop: absent/existing configs, collision/private backup/byte preservation,
   unsafe paths and changed hashes, stale proposal conflicts, interruption
   boundaries, fixed generation binding and real SDK stdio reads using C.
5. Freeze the complete extension; two independent code reviews and affected
   corrections. Run the complete example suite including existing dashboard
   coverage, installed-client offline checks, documentation links and whitespace.
   Product code is unchanged, so carry forward only unaffected product evidence;
   do not run the full migration gate without an affected-boundary justification.

After the local code/review milestone, prepare a fresh durable local generation
on dashboard 3004 / MCP 8789, retaining the working 3003 / 8788 rehearsal and its
existing Desktop connection. Verify the new baseline and bounded local reads.
Prepare a separate Desktop proposal for the new generation; leave personal
Desktop application and fresh provider login to the named human handoff.
Report targeted evidence and remaining human/final acceptance honestly.

README must provide separate first-time and next-day walkthroughs, optional fresh
rehearsal, supported macOS source-checkout prerequisites (repository access,
Node 24.21.0, pnpm 10.25.0, dependencies/generated client/backend/web builds),
qualified CLI versions, explicit Desktop switch, permission administration,
failure/lock recovery without destructive guesses, and demo prompts. Keep
machine-specific paths, credentials and live client IDs out of repository docs.

### Implementation checkpoint and candidate evidence

The sole writer implemented the approved extension in example files only.
Durable defaults are explicitly 3004/8789; legacy roots retain 3003/8788. Fresh
preparation inherits the selected input, dataset and ports unless overridden.
The home identity, stable profiles and each generation's receipts are separate.
Preparation verifies the new v2 baseline before syncing state and publishing
selection. Descriptive status remains usable after additions or authority edits.

Tests preceded implementation for home lifecycle, v2 authority, profile/login
dispatch and Desktop proposal/apply. Focused regressions caught omitted fresh
inheritance and the old CLI parser's inappropriate legacy port comparison.
A Desktop tampered-Node test also demonstrated why proposal data cannot select
an executable: apply now derives the trusted running Node identity first and
compares proposal data without executing its candidate path. Snapshot entries
retain `--no-global-search-paths`. These corrections passed their affected tests.

The frozen-code validation command on pinned Node 24.21.0 was:

```sh
CR_DEMO_TEST_CODEX=1 CR_DEMO_TEST_CLAUDE=1 node --test --test-concurrency=1 examples/demo-10-2026/*.test.mjs
```

Result: **38 passed, zero failed, zero skipped**, in 75,985.345 ms. This includes
legacy v1 persistence/denial/recovery, durable A DEFINE and independent B/C
authority, same-port old-token rejection, home locking/publication interruption,
actual CLI selected-port/status dispatch, installed auth-free client probes,
Desktop stdio against a real C credential, backup/conflict/interruption controls,
and the real dashboard showing v2 A/B/C authority and persisted history.
Fixtures used only owned temporary state, processes and ports. No provider
request, personal auth/config change, existing demo mutation or app stop occurred.
All eleven source JSONL SHA-256 values match the coordinator's pre-work snapshot.

The README now distinguishes first-time setup, next-day reuse, fresh generations,
strict verification, descriptive inspection and an explicit Desktop switch.
Markdown links (149 files) and whitespace checks passed. Product builds, mapper,
MCP importer, source corpus and production bridge remain unchanged; prior product
coverage carries forward only for those unaffected inputs. Complete-diff reviews
and the coordinator's independent checks are next. New durable live login,
assistant acceptance and Desktop switching remain user steps after that milestone;
later CI/PR/merge acceptance remains pending.

### Complete-diff review corrections

Both independent reviewers identified one P2: Desktop could persist a pinned
Node executable located in temporary storage. The safety reviewer also identified
a P2: first preparation did not fsync the new home's parent directory entry.
No other blockers were reported. Tests reproduced both findings before fixes.

Desktop now rejects canonical temporary Node paths during both prepare and apply,
including macOS temporary/cache roots when a stripped environment changes
`os.tmpdir()`. The internal owned-fixture exception remains limited to home/config
paths and cannot exempt Node. A regression executes an actual copied pinned Node
binary from owned temporary storage: both operations reject it before creating a
proposal or editing configuration. The home initializer syncs the trusted parent
before state/import; an injected sync failure leaves only the empty home and no
published state, and an explicit retry repeats that boundary.

Affected validation:

```sh
node --test --test-concurrency=1 examples/demo-10-2026/home.test.mjs examples/demo-10-2026/desktop-setup.test.mjs
```

Result: **9 passed, zero failed, zero skipped**, in 26,865.459 ms. Markdown links
and whitespace were renewed. The earlier 38-test evidence carries forward for
unaffected client, mapping/import, v1/v2 authority and browser inputs; the affected
home/Desktop coverage is replaced by this run. The correction is frozen for the
two reviewers' affected rechecks. No commit, push or live-state action occurred.

Both independent reviewers subsequently approved the corrected frozen hashes
with no remaining findings; unaffected complete-diff coverage carries forward.
The coordinator authorized the local 13-file commit. This final evidence-only
addition changes no runtime or test input, so the 38-test run and affected nine
tests retain their stated scope. Markdown/whitespace checks and all eleven
original source hashes were renewed before commit. The coordinator's durable
home preparation, bounded read/bridge smoke and Desktop proposal come next;
live profile login, assistant/Desktop acceptance and broader merge/release gates
remain pending. No push, PR, provider request or live configuration apply is part
of this repository handoff.

### PR 182 external review correction round

Claude reviewed the complete PR at `76d39bb7db8fca60f315805c268983d127690e85`.
The coordinator accepted its four concrete defects and the exact-version
suggestion: prerequisite failures must not strand a home lock, graceful import
interruption should attempt revocation and record failure, pnpm discovery should
honor the user's PATH, and npm-global clients alongside Node must be discoverable.

This bounded round keeps one writer (the coordinator) and read-only reviewers.
Recovery and credential cleanup use the sensitive profile; the independent plan
review requested Astra/xhigh (effective runtime settings are not observable).
The plan review approved these checkpoints before implementation:

1. Reproduce prerequisite/discovery/version failures and cancellation without
   replay; validate source/build/backend and existing profile paths before the
   first home-layout write. Preserve explicitly safe causes only.
2. Handle SIGINT/SIGTERM until preparation completes. Let in-flight MCP calls
   settle, then stop and attempt importer revocation and a failure receipt. The
   manifest write is the completion boundary. Never remove an unknown lock or
   unlock an actually mutated home automatically.
3. Run targeted recovery tests, freeze the bounded correction, renew affected
   independent review and the full example suite, then update the same draft PR.
   No product runtime, CI rules, live demo, login or Desktop config changes.

The source/build/backend checks now precede a `beforeCreate` callback that marks
the home uncertain and initializes its layout. Existing layout/profile validation
is read-only. A failed prerequisite releases only this invocation's lock, creates
no generation and leaves any old selection usable. Actual partial imports retain
the lock and state even after a successful revocation attempt: `failed.json` is
diagnostic evidence, not proof that all writes or selector publication settled.

The pnpm probe discovers via shell PATH but executes in a clean environment;
assistant launch environments stay restricted. Client discovery includes the
running Node bin directory and version checks compare complete whitespace-delimited
tokens. Graceful cancellation is checked between operations without passing an
abort signal into an in-flight mutation. SIGKILL/power loss remain inspection cases.

Other review dispositions:

- Documented v1 shared Claude profiles, JSON formatting normalization and exact
  generation binding of old Desktop proposals. No automatic proposal retargeting.
- Kept the empty-workspace check; the possible Claude-generated settings file
  was unverified. A reproduced live-client issue needs a narrowly scoped follow-up,
  rather than allowing arbitrary workspace/config content now.
- Agreed that CI does not run the example suite; README and PR evidence explicitly
  distinguish local suite results from GitHub checks. A dedicated CI lane is deferred
  to subsequent app-demo integration; this round preserves existing CI policy.
- Dataset publication remains within the user's earlier fake-data/demo PR request;
  no new claim of formal anonymization or publication clearance is inferred.
- The in-process local composition uses explicit database roots, fixed local
  configuration and the unavailable-model adapter. This inspection is not a full
  audit of every dependency's environment access; no egress-isolation claim is made.

Seven targeted regressions passed after reproducing their failures. Actual
SIGINT/SIGTERM tests use owned child processes and SQLite/MCP state, check
interruption after a persisted import event, importer revocation, failure receipt,
absence of a prepared manifest, retained lock and preserved prior selection.
The observer waits for the importer token before opening SQLite so it cannot
interfere with identity/schema initialization. Full candidate results and review
verdicts will be recorded on the PR; previous product/build coverage is unaffected,
while prior home/import/launcher evidence is superseded by this round.

### Follow-up review of 5a177d7

Claude confirmed the earlier fixes but reproduced a test-induced SQLite lock
conflict. This supersedes the preceding claim that waiting for `importer.token`
made concurrent observation safe: token creation precedes the credential insert,
and later reads can still contend with zero-timeout rollback-journal writes.
The previously reported 49-test pass was one successful run, not evidence that
the polling test was reliable.

The coordinator remains sole writer. The independent recovery reviewer approved
this bounded plan before implementation (requested Astra/xhigh; effective runtime
settings unverified). Checkpoints are tests-first progress/cancellation and pnpm
diagnostics, actual child interruption tests, then frozen full-suite validation
and affected independent reviews on this same PR. No product, CI, personal client
or running demo changes are included.

- Replace database polling with an optional counts-only import progress callback
  after validated SET completion. A test wrapper pauses there using IPC. The
  parent waits for the child's signal acknowledgment before releasing the pause,
  and opens SQLite only after child exit. No live database copies or busy-timeout
  changes are used to hide the observer effect.
- First signal requests cleanup; a repeated signal removes only the preparation's
  own handlers and re-sends the signal, restoring normal signal behavior. Forced
  termination cannot claim revocation or a failure receipt. Tests cover repeated
  SIGINT and SIGTERM while preparation is blocked.
- A signal during manifest publication finishes the write and stops before home
  selection, preserving the readable manifest without writing `failed.json`.
  The late-signal fixture performs the real write, holds its promise pending,
  then signals/acknowledges/resumes. Prior selection and the retained lock are
  asserted. This supersedes the previous late-signal completion behavior.
- Keep the exact pnpm requirement and first-PATH-installation semantics; provide
  Corepack and PATH hints instead of silently falling back. README documents a
  terminal-session PATH correction, without modifying installations or profiles.
- Durable failure guidance says to inspect `writer.lock`; legacy output-directory
  guidance is separate. Test imports are grouped at the top of their file.

The seven focused regression cases passed after their failing pre-implementation
run. The final suite and review results will be recorded on the PR. Product/build
coverage is unchanged; the earlier recovery-test evidence is replaced. Signals
outside runtime preparation and unrelated callers' installed signal handlers
retain their existing behavior; this is not a general process supervisor.
