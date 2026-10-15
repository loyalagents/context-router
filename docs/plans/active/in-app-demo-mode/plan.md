# In-app demo mode

Status: **reduced scope and implementation approved by the user on 2026-10-14**.
Both affected independent plan rechecks approved frozen design `40419393519379f54d9de25167d91a7d2937ea3676197556fe54a257024ce3ce`. Feature code is implemented in [draft PR #183](https://github.com/loyalagents/context-router/pull/183). Both complete-diff reviews and automated qualification passed through `5dfadcf`; exact receipts are in the PR. The user then requested assessment and useful fixes from an external static review before hands-on testing. This bounded correction round targets a source/artifact-bound isolated human trial after affected checks/reviews; renewed final qualification follows the human-feedback round. Human acceptance remains pending.
The subsequent hands-on trial reported the menu disappearing after demo entry;
the bounded compact-label correction and retest scope are recorded below.
The user then explicitly required the normal dashboard UI in demo, with its
historical banner/data and only optional walkthrough help; that correction
supersedes the earlier replacement-homepage provision below.
One cohesive PR; the native assistant-control follow-up is tracked below for the
next PR. General profiles remain future work. Focused evidence is recorded below; full final validation and human acceptance are pending.

## Outcome, ownership and starting evidence

Let a presenter use the installed Context Router application to demonstrate
portable context, independent agent authority and attribution. Basic CR actions
(enter, reopen, leave, reset, open agent setup) use the app. External assistant
setup, explicit provider login and conversations use guarded packaged helper
commands in Terminal for this PR. No developer checkout, handwritten client
configuration or manual credential provisioning is required.

The coordinator fetched `origin/main` and verified
`17c82b3095e04b888b2b80439631a23bf133b5c4` as the current base, then created
`codex/in-app-demo-mode` in the clean main checkout. Other worktrees are preserved.
The verified base matches PR #182's merge; this was checked, not assumed.
The implementation agent `/root/implementation` owns all code, tests, docs,
staging and commits. The planner, coordinator and reviewers are read-only. The approved user check-in need not be repeated for routine
implementation decisions.

Use the sensitive profile because the change touches identity, durable selection,
reset, child ownership and executable/client configuration. Requested planner:
GPT-6 Astra/xhigh. Requested independent plan reviewers: Astra/xhigh for
architecture/product/packaging and Astra/xhigh for isolation/persistence/recovery.
Recommend Astra/xhigh for the sensitive implementation and the two corresponding
complete-diff implementation reviews. The delegation tool accepts these settings;
effective runtime settings are not independently observable. The coordinator's
model/effort is not independently observable; no claim that Ultra was used.

Required startup docs, the current application/reset/storage docs, installed-app,
local-UI/MCP runbooks, interface-evolution policy, and the example README/PLAN
(including corrections) were read. Source inspection included the named example
modules, native menu/guardian/supervisor/envelope/maintenance, desktop runtime and
packager, local UI launcher/components/bootstrap, local composition/configuration,
identity/managed admission and SQLite boundaries. Tests, gate phases and CI jobs
were inspected before choosing the design below.

The coordinator's read-only inventory found the user's retained installed app
owning personal MCP 8787, Claude Desktop and CLI assistants running, both old demo
locations present, and Desktop still pinned to its older demo snapshot. No
listeners were observed on the old demo ports 8788/8789 or UI ports 3003/3004 at
that instant. These are observations, not authorization to change those inputs.
Do not stop/relaunch that app, reset either old demo, adopt/copy their logins,
rewrite personal client config, read credential contents, or make provider calls.
Automated work uses fresh owned synthetic envelopes, profiles, processes and
ephemeral ports. Pinned Node 24.21.0/pnpm 10.25.0 toolchain preflight passed. Product checks completed during implementation are
recorded below; they do not qualify provider or human acceptance.

## Smallest useful experience

The native **CR** menu is the lifecycle control surface. Add **Enter demo mode…**
in personal mode, **Return to personal mode…** and **Reset sample data…** in
demo mode, and **Demo setup…**. Keep the compact **CR** menu-bar title unchanged
across modes. Its tooltip and accessibility label identify the admitted mode,
with **Demo mode · historical sample** in the menu status while demo is active.
Before a validated mode/store frame arrives, descriptions remain neutral. Existing
Open dashboard/New unlock/Quit retain their meaning for the active runtime.
Controls are disabled during a transition; Quit remains available and requests
orderly cancellation. Do not expose browser mode/reset commands or a general
profile picker.

**Demo setup…** opens a small read-only native instruction panel, showing the
active historical sample, generation, endpoint, A/B/C roles and exact commands
for the verified installed helper. Text is selectable, with Copy selected command for one nonsecret command line at a time. It neither launches an assistant nor prepares/
applies Desktop configuration. The dashboard demo guide directs presenters to
this panel. This keeps setup discoverable without adding native executable
settings, assistant process coordination or a Desktop configuration editor.

Entering for the first time explains that sample data is separate, switching
disconnects browser/MCP sessions, and the app prepares 189 active memories from
198 historical 2024–2025 source records. Returning personal explicitly preserves
demo edits. Both actions open the current dashboard once ready and offer the
existing fresh unlock flow. Relaunch remembers the last successfully selected
mode; a retained demo is reopened without a reset prompt or import.

Every authenticated local dashboard page gets a persistent, accessible **Demo
mode — historical 2024–2025 sample** banner when the admitted runtime is demo.
Managed personal pages show **Personal mode** unobtrusively and a discoverable
instruction to use **CR → Enter demo mode**. Trusted runtime metadata also exposes
whether native lifecycle controls exist: manual source local UI and hosted pages
must not suggest a nonexistent CR menu. Before authentication, use neutral unlock
copy without an unverified mode/native-menu claim. Mode labels come from
authenticated runtime metadata, never a URL flag or browser storage. A
stale/disconnected managed tab keeps the existing session-clearing behavior and
directs the user to CR → Open dashboard; source UI retains its own launch guidance.

**User override (2026-10-14):** demo uses the same `DashboardView` as personal,
including Account Information, Profile Memory and all normal local navigation:
Edit Profile, Preferences, Form Fill, Audit History, Preference Schema and
Permission Grants. Demo data and the authenticated historical banner distinguish
the mode. This explicitly supersedes the earlier requirement to replace the
dashboard with a guide; there is no separate demo landing page.

Keep the existing five-step walkthrough only in **Demo walkthrough (optional)**,
a native details/summary section after the dashboard, closed by default and
absent in personal mode. It has no second main heading or duplicate navigation.
Its prompts cover historical category-prefix reads (within the 100-result limit),
one explicitly approved A change, fresh B/C reads, restricted health/finance reads,
and attribution/history. Permission Grants shows actual stored grants; Audit
History/MCP Access and Modified by preserve the existing evidence workflow.
Copyable prompts contain slugs/instructions, never credentials.

Keep the existing Clear memory and Clear history actions and their separate
semantics clear; **Reset sample data** is a native lifecycle action, not the
GraphQL `DEMO_DATA`/`FULL_USER_DATA` mutation or a renamed Clear memory button.

Demo runs without local inference, using the existing unavailable-model adapter.
The story uses ordinary memory operations, no download or model startup. Model
download/start controls are unavailable in demo with concise guidance to return
personal. Personal compatible weights and configuration are retained and normal
personal restart creates its own fresh inference session. No new AI capability,
hosted fallback, general onboarding, chat UI or permissions redesign is included.

## Durable layout and compatibility

Keep one native managed envelope and its existing lock/process lifetime proof.
Add **exactly two named slots**, personal and demo, to versioned installation
metadata; this is not an arbitrary store/profile selection API. Existing
`stores/<id>/data` and `identity` remain the pair layout. Personal retains its
original store ID. Demo's slot points to a separately initialized store/principal
and database target; every reset uses another unique store ID. Neither import nor
demo administration can obtain a personal-store capability.

Add a narrow private `demo/` directory to the native allowlist, containing
versioned generation receipts/import evidence, generation-specific A/B/C exports,
stable per-vendor/role provider profiles and immutable Desktop snapshots/proposals.
Do not put extra files inside strict data/identity roots. Old demo homes remain
external and are neither discovered for adoption nor modified. Retained old demo
generations are not user-selectable in this PR and are never silently deleted.
Warn that resets retain previous generations for diagnosis and are not secure
erasure; bounded archival/cleanup is future work.

Use a strict v2 installation schema with the original installation identity,
personal store, optional completed demo store, active mode/selected store, setup,
minimum security epoch, existing pending restore and a mutually exclusive bounded
pending demo operation. Invariants: selected store is exactly the active named
slot; personal and demo IDs differ; a pending candidate never equals either live
slot; pending operations bind their exact prior selection, candidate, seed version
and stage. Unknown fields, IDs, modes/stages and contradictory combinations fail
closed. The final code should use one small typed contract per language and
cross-language fixtures, not a generic transition framework.

Under proven quiescence and the native lock, read supported v1 installations as
personal, preserving every store/identity/database byte. Atomically upgrade only
management metadata to v2 before enabling mode changes. Advance the installed
management/security epoch to 2 in native/package/backend validators in lockstep;
old binaries must refuse the new envelope before opening stores. A crash around
upgrade preserves a valid old or valid new metadata record, or retained staging
evidence and explicit refusal; never infer permission to remove an unknown stage
or journal. Test this transition with the actual v1 fixture/artifact. No SQLite,
GraphQL, MCP wire, identity-file or hosted-adapter version changes are intended.

Update `managed-admission.ts`, native envelope/package validation, capability and
journal vocabulary together. Every capability binds mode, exact store, operation,
native generation, metadata pins and inherited lock. Only a specifically reserved
demo-prepare candidate permits fresh initialization/import; general application,
personal maintenance and source/manual roots cannot select that candidate. A
ready demo reopen validates its completed receipt, seed identity and pair/authority
integrity, **not** original memory membership or baseline policy: legitimate edits,
definitions, revocations and narrowed grants must survive.

Default personal MCP remains 8787 and default installed demo MCP is **8790**,
distinct from the old source-demo ports 8788/8789. Only one runtime is active per
managed envelope. UI defaults to an ephemeral port, with fresh browser sessions/
unlock after every switch/reset/restart. Add this supported native launch form
for isolated trials, rather than relying on an unreachable test hook:

```text
context-router menu --root /canonical/private/trial/managed-v1 --ui-port 0 --mcp-port 0 --demo-mcp-port 0
```

The no-argument Finder launch and existing `menu --root ROOT` retain their default
behavior. Parse named options strictly: reject duplicate/unknown/missing options,
noncanonical or unowned roots, signs/whitespace/leading-zero malformed numbers,
out-of-range ports and duplicate nonzero UI/personal-MCP/demo-MCP ports. Each port
accepts exactly `0` or decimal 1–65535; zero requests an available ephemeral port,
not a fallback after a requested-port failure. Existing guardian invocation stays
compatible, with the new optional demo-port selection propagated from menu to
guardian. Native menu state, guardian argv and per-mode restart must retain the
requested configuration for this launch.

Resolve effective nonzero ports under the native startup protocol and verify
actual bound ports in Ready. Generation/connection receipts bind the store ID,
native runtime generation and **effective** demo endpoint; A/B launch receipts and
C proposals pin that endpoint, never a hardcoded 8790 or a mutable current-port
lookup. Durable seed/data identity is separate from runtime connection identity.
If a later explicitly launched runtime has different ports, existing assistant
connections/proposals remain pinned and require explicit relaunch/reconfiguration;
do not mutate their receipts. Use fixed alternate free ports for a hands-on trial
that needs repeatable external-client connections, or renew setup after ephemeral
port changes. Persisted selection of demo data does not promise port persistence
when the caller deliberately requests port zero.

Owned automated fixtures use these explicit root/port options; no test contacts
8787–8790. Occupied target ports cause an actionable refusal, without fallback or
stopping the occupant. Check before draining the current mode when possible and
again after drain; binding is still race-prone and must fail safely. The trial
contract permits a separately owned synthetic app envelope to coexist with the
user's app; the single-active-mode invariant applies within each envelope, not
by killing or retargeting an unrelated installation.

Offline installed administration defaults explicitly to **personal**, even if the
last active mode was demo. Add an explicit `--mode demo` only for bounded existing
MCP list/inspect/provision/rotate/revoke/permissions/grant administration; outputs
identify their mode. Require Quit as today. No implicit arbitrary-store argument.
Backup/restore and named identity recovery remain personal-only in this PR. A
pending personal restore blocks app launch/mode changes/reset just as it blocks
current startup. Restore selection checks bind the personal slot; activation
updates that slot and selects personal while retaining the demo slot. Existing
acknowledgment of restored authority, security-floor and incomplete/uncertain
restore rules remain. Reject unsupported demo backup/restore rather than silently
operating on personal state. Include these consumer changes in replacement tests
and the installed runbook.

## Switching, initialization and reset protocol

The native guardian remains the sole lifecycle owner. Extend its existing bounded
menu pipe vocabulary with enter-demo, leave-demo and reset-demo commands, each
bound to the current runtime generation. No arbitrary root, port, executable,
credential or script arguments enter through this channel. Native code derives
fixed named slots and validated paths. App/menu relaunch and offline commands
must contend for the same ownership boundary.

All metadata selection changes occur with **no admitted child alive**. An
installation-file change currently revokes managed admission at storage
boundaries, so do not change selection beneath a running application or seeder.
Use existing close → drain acknowledgement → direct child reap → inherited
descriptor extinction proof before changing metadata or granting a new capability.
Quit/disconnect invalidates all browser sessions and drains MCP; old external
clients are not killed or rewritten.

| Transition | Durable result and failure rule |
| --- | --- |
| Personal → existing demo | Preflight target; drain/reap personal and model; validate completed demo receipt/pair without baseline enforcement; atomically select demo; start fresh no-model UI/MCP owner. Personal bytes/authority remain. |
| Personal → first demo | Preflight package/seed/paths/port before reserving anything; drain/reap personal; reserve a unique candidate; initialize, import, provision/verify, revoke importer, close/reap; publish complete receipt then select demo; start UI/MCP. |
| Demo → personal | Preflight target; drain/reap demo; validate retained personal pair; select personal; start normal personal runtime/model policy. Retain demo data, credentials, grants and receipts. |
| Demo → reset | Confirm consequences; drain/reap old demo; reserve a unique candidate and prepare exactly as first initialization; only a complete verified candidate can replace the demo slot. Retain old demo store/exports; old tokens fail on the new store even when its effective demo endpoint is reused. |
| Quit/relaunch or ordinary restart | Reopen selected complete store; retain demo modifications and authority. Sessions are new. No importer/baseline overwrite runs. |
| Failure before meaningful mutation | Release only this operation's owned reservation/lock when proven untouched; selection unchanged; explain prerequisite and allow explicit retry. |
| Preparation fails after partial writes, with matching terminal result and proven child quiescence | Revoke importer if possible, retain failed candidate/evidence, never replay it. Keep previous selection. Native UI offers explicit Return to previous mode; another explicit prepare/reset allocates a new candidate only after acknowledging retention of the failed candidate. |
| Forced exit, malformed/missing completion, inherited-holder loss or uncertain publication | Preserve candidate, selector, journals and receipts. Fail closed; do not select a fallback, delete locks or automatically retry. Single-envelope uncertainty can block both modes until existing ownership/recovery requirements are satisfied. |
| Target startup fails after selection commit | The selected, completely prepared target remains selected. Report “Demo selected; runtime unavailable” (or personal equivalent), not successful Ready or rollback. A proven-quiescent retry starts that same store; explicit Return personal is available only after a controlled drain. |

Preparation is a finite managed child operation, using explicit configuration and
the existing production SQLite/identity/MCP composition. It receives authority
only for the reserved candidate and private exports, starts a temporary owned
ephemeral MCP listener, and imports sequentially through the real mutation tool.
Do not turn an unprepared candidate into an ordinary listening dashboard or grant
the seeder access to both named stores. No direct preference/definition inserts.

Preserve the foundation's first-interruption behavior: finish the in-flight MCP
request, observe cancellation before dispatching another mutation, attempt importer
revocation, close services/workers, send a bounded terminal result. The native
owner must observe actual exit and required ownership extinction before accepting
that result. Repeated interruption/forced shutdown cannot promise cleanup. Native
control failure must not be upgraded into a successful preparation or safe retry.
The current `managed.mjs` helper revokes admission on every stop, including orderly
Quit, so it cannot be reused unchanged for importer cleanup. Give only the finite
demo-preparation role an explicit orderly-stop path: stop dispatch, settle the
current request, revoke importer/close owners while its original authority is
still valid, then revoke admission and acknowledge terminal completion. Control
protocol failure, EOF/owner loss and forced termination still revoke immediately;
cleanup is unconfirmed and the candidate remains quarantined. Do not relax the
ordinary application's stop/revocation rule. Cover both paths in managed control
and real seeding tests.
Tests synchronize through explicit count-only callbacks/IPC; **never poll/copy
live zero-timeout SQLite**. Inspect durable state only after writer exit.
Likewise, do not hash/fsync/open-and-close a database file while any connection in
that process remains alive; descriptor closes can release SQLite's POSIX locks.

Complete generation metadata/import evidence and containing directory entries are
fsynced before native publication of the new slot/selection. A successful seeder
receipt alone is insufficient: verify importer revocation, exact prepared
authority, complete baseline and normal close/reap. Recheck queued cancellation
immediately before the non-interruptible atomic publication section. A cancellation
accepted before commit never selects the candidate, even after its final manifest
was written. If commit wins before cancellation is accepted, report that reset
completed and the runtime stopped; do not report failure suggesting rollback.
Lost/ambiguous publication requires inspection, not automatic selection repair.

Reset's confirmation says that the **new active demo** contains the original 189
active memories, their definitions and import audit/access history; nine inactive
source records stay in import evidence. Subsequent demo edits, extra definitions,
history, custom clients and grant changes do not carry forward. It creates a fresh
principal and A/B/C credentials with the baseline policies below. It preserves
personal data, old generations, compatible model assets and dedicated provider
login profiles. It does **not** promise empty history, restoration of revoked
authority in-place, rollback of already committed external calls, or automatic
connection migration. Existing CLI/Desktop connections require explicit new
launch/configuration and a new conversation.

## Shared import, package and authority

Promote the pure record mapping/loading and sequential MCP importer from the
example into a small package-owned module set, preferably
`apps/backend/scripts/demo/`, with thin example wrappers preserving its existing
default corpus path and public helpers. Package the exact required scripts through
the backend's explicit `files` list. Extract shared baseline A/B/C policy and
verification helpers only where the app/example would otherwise duplicate them.
Keep source-checkout build/pnpm/git preflights and old home lifecycle in the
example; do not import `home.mjs`/`runtime.mjs` wholesale into production.

The managed desktop adapter supplies trusted bundled seed/backend/SDK paths and
native admission; the source example supplies its existing source paths. Keep
one mapper and one sequential definition/SET importer, with no retries or second
SQL importer. Preserve exact sentences, sensitive USER definitions, GLOBAL scope,
source file/line/hash/full record evidence, qualitative confidence in evidence,
native null confidence and current `INFERRED` source type. Ordinary later SET may
clear live evidence; import audit retains provenance. Mutation/audit is atomic;
access logging remains best effort, with persisted representative events tested.

All eleven original JSONL files remain byte-for-byte unchanged. The packager
copies that single canonical corpus into a fixed versioned resource directory,
checks the expected 198/189/9 counts and source hashes, and seals its seed manifest
and bytes in the ordinary payload inventory. Runtime preparation uses only those
verified bundle resources. The completed generation pins its seed version/hash;
updating the app never silently refreshes existing demo data. Reset uses the
bundled baseline explicitly shown in its dialog. No pnpm/git/source checkout,
temporary absolute source path or network fetch is needed at installed runtime.

| Role | Fresh baseline |
| --- | --- |
| Importer | Temporary dataset-category WRITE+DEFINE, including implied read; revoked before any completed generation can be selected. |
| A — Codex | Independent credential; dataset-category WRITE+DEFINE, implied read, sensitive enabled. Human approval for each intended mutation. |
| B — Claude Code | Separate READ credential over dataset category targets excluding health/finance, sensitive enabled; explicit `health.*` READ DENY. |
| C — Claude Desktop | Its own credential with B's maximum policy and explicit denial. Revoking B does not revoke C or A. |

Baseline fresh reads are A=189 and B/C=145 across category prefixes; maximum
category size is 31. A DEFINE then SET remains two independent audited calls.
Show filtered health/finance reads honestly: empty results do not prove absence.
B/C do not discover the mutation tool; direct SDK checks prove the exact denied
write envelope, typed persisted denial and absence of mutation. The UI describes
actual authority after presenter changes, never merely hardcodes this table.

## Packaged agent helpers — approved reduced scope

This section replaces the original native launch/settings/proposal-screen design.
The app owns CR lifecycle and opens setup instructions; the presenter explicitly
runs the generated packaged helper commands. Keep Codex 0.160.0 and Claude Code
2.1.299 pins and fail clearly on unsupported/missing clients. External client
installation remains a prerequisite; no automatic download or provider login.

Expose a bounded `demo` command family on the verified installed executable,
separate from maintenance commands that acquire managed database authority. The
setup panel derives commands from its verified bundle path, explicit envelope,
completed demo generation and effective endpoint. The implemented forms (each command retains the same binding options) are:

```text
context-router demo --root ROOT --store STORE --generation GENERATION --endpoint ENDPOINT status
context-router demo --root ROOT --store STORE --generation GENERATION --endpoint ENDPOINT login A
context-router demo --root ROOT --store STORE --generation GENERATION --endpoint ENDPOINT launch A
context-router demo --root ROOT --store STORE --generation GENERATION --endpoint ENDPOINT login B --client claude --auth subscription
context-router demo --root ROOT --store STORE --generation GENERATION --endpoint ENDPOINT launch B --client claude --auth subscription
context-router demo --root ROOT --store STORE --generation GENERATION --endpoint ENDPOINT desktop prepare
context-router demo --root ROOT --store STORE --generation GENERATION --endpoint ENDPOINT desktop apply --proposal ABSOLUTE_PROPOSAL --desktop-closed
```

Render the actual absolute executable/root/ID with tested shell quoting in the
panel, not these placeholders. Also retain Codex B, supported Claude A/B auth
options and isolated Codex login through the same shared helper; A/B defaults
must be explicit. An optional `--executable ABSOLUTE_CLIENT` selects a CLI when
trusted discovery is missing/ambiguous; there is no native picker or persisted
executable-setting UI in this PR. Resolve the invoking shell's PATH entry to the supported native CLI, or use
`--executable` when that entry is an unsupported wrapper. Execute with the shared
clean environment. Arbitrary Node/npm/shell launchers are refused. Canonicalize and validate executable
ancestry/ownership/type before version/help/offline probes. Test wrapper refusal and explicit native entry selection with bundled Node. Do not source shell startup files or inherit provider/debug
variables into assistants. Never execute a proposal-supplied path to validate it.

Promote and reuse the existing launch specs/preflights, role-specific approvals,
native-tool exclusions and macOS subscription-Keychain handling. Each helper
reads a bounded immutable connection receipt and credential export for one exact
generation, validates it against current native-owned active runtime metadata,
and reads the token once only after preflight. Helpers have no managed database
capability and never open live SQLite to discover selection. Runtime metadata
publication/readback must be atomic and bound to the envelope/store/native runtime
identity; an old/partial/stopped/mismatched receipt is refused. A switch racing a
completed launch cannot retarget it: the client keeps its pinned endpoint/token,
which cannot authorize the replacement store. No later mutable-selector lookup
or automatic mutation replay is permitted.

Generate neither handwritten MCP configs nor raw token-export instructions for
presenters. Token bytes must never appear in commands, shell files, configuration,
clipboard, prompts or logs. Provider auth is established only by the user's
explicit login in new private stable per-vendor/role profiles, outside generation
stores. Preserve profiles across reset/switch; do not adopt or copy old demo or
personal login state. macOS subscription Claude retains OS-account HOME only for
Keychain discovery, with both Claude/Anthropic config paths and empty workspace
dedicated to this app demo. Do not inspect/reset Keychain secrets or silently
resume an old conversation. Source example commands retain their existing paths
and behavior through the shared modules.

**Bounded helper concurrency, not an app-managed assistant supervisor.** Retain
the documented one-active-conversation-per-vendor/role rule, and add a small
exclusive per-role invocation guard under the dedicated profile parent so two
packaged helpers cannot race into the same login/config. It is independent of
`CREnvelope.owner.lock` and is not part of app quiescence. An exclusive private
record binds an invocation nonce and observed helper/child lifetime. A second
helper refuses while it exists. Release only the exact current invocation's
record after its owned child has exited and the helper has proved the supported
child lifetime settled; ordinary elapsed time, PID disappearance or a free lock
is insufficient. If helper/child loss or supported foreground settlement is uncertain,
retain the record and require inspection; no automatic stale-guard removal,
force stop, profile copying or fresh-profile workaround. Reuse existing bounded
process/ownership primitives where needed, not a new global process framework.
Install latched SIGINT/SIGTERM/SIGHUP handling before guard acquisition. Unwind
the owned action before exact-record cleanup; never unlink from the signal handler
or abandon a running probe/action. Explicitly yield after synchronous preflight
before persistent profile mutation or foreground spawn. Proven pre-mutation
cancellation can release its own guard; uncertain foreground outcomes cannot.

This guard is not OS isolation and cannot prevent a user manually launching a
raw third-party CLI against the same profile. Such concurrent use is unsupported.
The app does not track, control or wait for external assistants: switch/reset/
Quit may complete while a conversation stays open; that conversation retains
its old credential/endpoint and the same profile cannot be relaunched through a
helper until safely released. Close it and start a fresh conversation after reset.
Tests must cover simultaneous helper invocations, normal child completion,
helper loss with a surviving child, abnormal foreground termination and refused
second use; do not claim stronger lifecycle guarantees than the tested mechanism.

The standalone packaged helper path starts without managed authority. Its own
child launch uses an explicit FD/environment whitelist: no managed storage/
lifetime FD3, capability FD4, control/status descriptors, human credential, browser
unlock or importer authority reaches a launcher/assistant. External clients receive
only their exact A/B MCP credential plus their dedicated provider profile. They
cannot hold envelope shutdown hostage. Test descriptor inheritance even when the
helper is invoked by a synthetic parent holding unrelated descriptors.

For C, `desktop prepare` creates the existing generation-pinned proposal and
prints a nonsecret review summary (generation, endpoint, entry and target config
path). It does not apply configuration. The presenter reviews that summary and
explicitly runs `desktop apply --proposal ... --desktop-closed` after closing
Desktop and config editors. Preserve the foundation's guarded application:
serialize helper writers independently of the live envelope owner, validate
private trusted files, refuse collisions/edited owned entries, save exact original
bytes privately, compare original bytes again before fsynced atomic replacement,
and verify readback. Unrelated parsed entries survive; JSON formatting may
normalize. This is not compare-and-swap against arbitrary writers. Partial or
uncertain replacement retains evidence and never auto-restores/replays. The full
private proposal may contain existing config secrets; do not copy it into the
setup panel, logs or shared diagnostics. Normal explicit apply changes only this
app's exact owned demo entry and never retargets personal/old source-demo entries.

Package the production bridge protocol/secure reader and small port adapter;
do not fork no-replay behavior. `desktop prepare` snapshots required bridge modules
and bundled pinned Node into an immutable durable private directory, verifies
them against sealed package inputs, and records source hashes. Proposals pin that
exact snapshot, C credential and effective endpoint, never current selection or
an executable inside a mutable replaced app. No external Node install, git or
checkout is needed. Reject normal temporary persistent references; any owned-test
fixture exception is unreachable through production CLI/environment. Retain
referenced snapshots; disk duplication is an explicit tradeoff.

An old C proposal stays pinned after reset and cannot silently select the new
store. Display its exact runtime generation at review/apply; those commands stay
strict to that generation. The applied entry additionally pins installation ID,
store, endpoint, C client ID and credential hash. Only a newly started C bridge may
discover the current active owner generation for those exact pins, validate the
native receipt/challenge and post-probe metadata, and use its once-read validated
credential. Same-store/same-endpoint reopen therefore needs no config rewrite.
Reset, endpoint, installation or credential changes require new explicit
prepare/apply; no selector following or mutation replay is added. Existing
immutable snapshots require one explicit prepare/apply for the new behavior.
Provider-backed
Desktop acceptance remains a human check using the designated demo entry; other
enabled personal connectors are not silently disabled, and no Desktop-wide
conversation isolation is claimed.

## Capability parity and next-PR boundary

All established demo capabilities remain available in this PR. The reduced scope
changes their presentation/launch surface, not authority, persistence or safety.

| Capability from the foundation | This PR | Evidence / boundary |
| --- | --- | --- |
| Historical 198-record corpus, 189 active/9 inactive, exact mapping/provenance | Bundled seed and shared mapper/importer; originals unchanged | Counts/hashes, real import/audit and package closure |
| Prepare once, reopen edits, explicit fresh generation | Native enter/reopen/reset/leave with managed ownership | Native persistence/failure/return-personal and artifact cycle |
| Memory, authority, audit/access walkthrough | Shared normal dashboard, demo indicator and optional collapsed guide | Actual API/browser/history checks |
| A WRITE+DEFINE with explicit mutation approval; B READ with health/finance restrictions | Guarded packaged Codex/Claude helpers; alternative supported A/B client roles retained | Shared launch specs, exact pins, actual argv/env and SDK authority checks |
| Dedicated login, next-day reuse and fresh conversation after reset | Packaged Codex login and explicit Claude subscription flow, stable private profiles | Byte-preservation, helper concurrency and offline installed-client probes; human login separate |
| Independent C credential, exact-generation proposal, review/apply/backup | Packaged Desktop prepare/apply helpers, immutable bridge/Node snapshot | Config conflict/interruption/backup and real SDK stdio tests |
| Current state/authority inspection and original-baseline verification | Existing app views plus bounded installed `demo status` / offline `demo verify` helpers | Status labels receipt-only versus live data honestly; verify uses native maintenance admission after Quit and never opens live SQLite |
| Existing source example commands and legacy v1/durable v2 instances | Keep compatible thin wrappers and complete example regression suite | No existing homes/logins/config migration; custom input/dataset source workflows stay available there |
| No replay, importer revocation, retained interruption evidence | Same contracts inside managed preparation and packaged helpers | Actual cancellation/publication/cleanup tests |

`demo status` verifies native readiness and reports immutable selection/endpoint
receipts without database access; it does not verify current content, grants or baseline.
Actual data and authority are visible in the dashboard. `demo verify` is an
explicit read-only-in-intent maintenance command requiring Quit and the selected
completed demo slot; use existing strict baseline checks through managed admission.
Changed current values/evidence may be reported, but membership, authority, schema
or missing-audit mismatches fail the original-baseline check. Nothing is fixed by
reseeding. It is not an arbitrary store opener or a helper-side SQLite
poll. Preserve existing personal maintenance defaults and pending-operation gates.

**Tracked next PR: native assistant setup controls.** Owner: the next assigned
sole writer/coordinator; priority: follow-up to this approved demo PR. These are
not current implementation tasks and must not delay the safe lifecycle/packaged
helper handoff. If time remains, finish this PR's required qualification/review
first, then explicitly activate the follow-up as a separate cohesive PR; do not
silently expand this PR or promise completion within a day.

| Follow-up item | Dependency | Acceptance criteria |
| --- | --- | --- |
| Native Open Codex A / Sign in / Open Claude B buttons | Qualified packaged helper/receipt interface and exact CLI preflights from this PR | Buttons invoke the same pinned helper, preserve explicit provider consent and fresh-conversation behavior, handle absent/unsupported clients, and leave no credentials in argv/clipboard/logs. Real AppKit→Terminal argv/FD tests plus human usability check. |
| Native executable picker and saved CLI choice | Explicit helper `--executable` contract and trusted executable validation | Select/remember canonical trusted paths, revalidate changed bytes/version, handle nvm installations, never run config/proposal-selected executables before trust validation. |
| App-managed external launcher/coordination | This PR's bounded per-role guard/lifetime evidence; reviewed process-ownership design | No envelope lock/capability leaks, no double profile use or PID/timeout reclamation, exact child-loss/reconnect outcomes, clear close/retry UI, and independent safety review before launch ownership changes. |
| Explicit retained-guard recovery | Positive supported-client lifetime proof, beyond PID disappearance, elapsed time or user guess | Preserve uncertain records/profiles until proof is available; no manual deletion, copying or fresh-profile workaround. Independently review the recovery operation before implementation. |
| Native C proposal review/apply screens | Qualified packaged Desktop prepare/apply/backup format and immutable snapshots | Show nonsecret exact-generation/endpoint diff summary; require explicit closed-Desktop/editor confirmation; apply the same reviewed proposal, preserve unrelated entries and backup/conflict rules, surface uncertain results without replay. |

Do not combine this follow-up with general profiles, universal MCP onboarding,
a new chat client, provider-credential migration or a permissions redesign.

**Next-stage TODO: optional reuse of an installed local model in demo.** Current
demo remains model-free: runtime preparation enables a model only in personal
mode. Model assets already live outside the per-mode stores in the same managed
envelope. A separately activated follow-up may offer explicit opt-in reuse of
existing verified compatible assets in that same installation, with no silent
download/copy, adoption from another envelope or reuse of a running inference
session. Start a fresh owned inference session and preserve normal drain/ownership
rules across switch, restart and reset. Demo data and permissions must remain
isolated, the no-model fast path must still work, and original assets must remain
preserved. Existing model compatibility, lifecycle and acceptance limitations are
not waived. This optional TODO is separate from required final validation and
does not block current demo or Codex/Claude connection testing; it does not add
general model/provider selection to this PR.

The shared cross-language malformed-metadata acceptance/rejection corpus promised
above remains final-validation/maintenance evidence to settle before final
qualification, not an optional next-PR deletion of that requirement. Independent
native/backend/lifetime admission cases already exist; read-only helper readiness
checks grant no managed authority. This isolated trial does not require a schema
framework or expanding admission code. Transient `accept()` error handling remains
an unconfirmed follow-up investigation; no probe semantics change in this round.

## Checkpoints and focused evidence

The implementing agent records tests-first failures before backend behavior
changes, then runs the affected tests after each small related correction. New
test names below are planned files; existing suites remain unchanged in scope.

1. **Shared baseline and packaged inputs.** Extract mapper/import/client helpers
   without example behavior drift; freeze corpus hash manifest. Add malformed
   corpus/unsafe path and package closure/tamper checks. Run focused example
   mapping/import/client tests and `node --test apps/desktop/test/package-manifest.test.mjs`.
   Before proceeding, the original example suite must pass on its owned fixtures.
2. **Native metadata/admission and lifecycle.** Write backend/native tests first
   for v1→v2 preservation, old-binary refusal, exact modes/slots/capabilities,
   pending restore, invalid candidate access, concurrent guardians/maintenance,
   clean switch and uncertain drain. Add `apps/desktop/test/native/demo-mode.test.mjs`
   and `demo-supervisor.test.mjs`, using existing native fixture patterns and IPC.
   Run managed-admission unit tests plus affected envelope/admission/supervisor/
   maintenance/setup-recovery/native control tests. Test wrong/stale generation,
   switched inode, leaked inherited holder and occupied target port.
3. **Real seed/domain behavior and managed reset.** Add Linux-compatible
   `apps/desktop/test/demo.test.mjs` for shared mapper/seed/domain behavior using
   explicit source fixtures, actual SQLite/MCP and real module adapters:
   counts/content/provenance, strict fresh baseline, importer revoked, A DEFINE+
   SET, fresh B/C read, exact denials/audit, independent revocation, reopening a
   source fixture after edits/extra definitions/grant changes and token rejection
   between independently prepared stores. These tests do not claim managed
   initialization/switch/reset coverage. The macOS native suites in checkpoint 2
   own actual managed-admission initialization, preparation, publication, reset,
   cancellation and return-personal preservation. Snapshot synthetic personal
   identity/data while stopped, then prove bytes/authority unchanged after that
   native roundtrip. Inject prerequisite, partial-write, revoke/close,
   receipt/fsync/publication and cancellation failures through explicit callbacks/
   IPC in the relevant portable or native fixture; inspect DB after writer exit.
   Run affected local MCP/local UI/storage and new desktop suites serially where
   outputs/resources overlap. No provider/model calls.
4. **Native UI, dashboard and clients.** Add menu-state/control tests, an
   authenticated runtime-mode API test and a Linux-compatible Chromium journey
   in `apps/web/test/demo-browser.test.mjs`. Its source fixture serves actual
   backend data/API responses with explicit personal/demo presentation metadata;
   exercise banner/guide on each reused view, actual authority/history, source
   process/session restart and stale-tab rejection. Verify manual source UI does
   not advertise unavailable native controls. This suite does not emulate or
   claim native first entry, mode transitions, reset confirmation or AppKit
   cancellation. The macOS menu fixtures and artifact harness own those actions,
   including first enter, edited-state relaunch, reset/leave and their visible
   confirmation/status. Add selectable setup-panel rendering/copy tests and
   packaged helper invocation/guard tests with stubs capturing argv/env/cwd,
   offline pinned
   CLI tests, and Desktop proposal/apply tests against owned config and real SDK
   stdio. Cover reset/launch races, stale proposal, unrelated entries, byte-change
   conflict, temporary executable rejection, interrupted apply and no automatic
   mutation replay. Assert the menu-to-guardian argv for defaults and all explicit
   port options, actual transitions on nondefault ports, and A/B/C receipts bound
   to the resulting endpoint. Keep an assistant open across switch/reset/Quit;
   force helper loss while its child lives and prove second launch refusal; prove
   clean supported child completion releases the helper's own guard; assert the
   FD/env whitelist and refusal to clear uncertain ownership. Verify the setup
   panel itself never launches a provider client or prepares/applies config.
   Real provider login/assistant behavior stays human-only.
5. **Package and handoff candidate.** Update deployment closure, seed/resource
   inventory and installed commands/docs. Build a sealed candidate in isolated
   outputs; verify relocated execution with caller checkout inaccessible, bundled
   Node only, no pnpm/client installation assumed and no model required. Test
   synthetic v1 personal replacement and full installed enter/edit/quit/reopen/
   reset/leave cycle. Bind trial evidence to actual source/copied inputs and
   complete artifact bytes; then complete reviews and final gates below.

Representative focused commands (use exact affected file selectors rather than
running every command after each edit):

```sh
pnpm check:toolchain
pnpm --filter backend prisma:generate
pnpm --filter backend build
pnpm --filter backend exec jest --selectProjects unit --runInBand --runTestsByPath src/infrastructure/managed/managed-admission.spec.ts
pnpm --filter desktop test
pnpm --filter desktop build:native
node --test --test-concurrency=1 apps/desktop/test/native/demo-mode.test.mjs apps/desktop/test/native/demo-supervisor.test.mjs
pnpm --filter backend test:local-mcp
pnpm --filter backend test:local-ui
pnpm --filter web build
pnpm --filter web test:local-ui
CR_DEMO_TEST_CODEX=1 CR_DEMO_TEST_CLAUDE=1 node --test --test-concurrency=1 examples/demo-10-2026/*.test.mjs
node scripts/check-markdown-links.mjs
git diff --check
```

Keep new portable tests in existing desktop/backend/web suite discovery so app
feature coverage runs in the established CI jobs. Add one bounded example-suite
step to the existing frontend job after its already required backend/web builds
and pinned Chromium install, with installed-CLI opt-ins off. Add the canonical
demo corpus/shared helper paths to relevant CI path filters and their tests so
corpus-only changes are covered. Do not duplicate installs/builds, launch provider
clients in CI, rejoin the recently split migration lanes, change required triggers,
weaken gates/timeouts or claim native/package acceptance from Linux. Native demo
fixtures run in the existing macOS desktop-native lane. Test any changed filter/
gate discovery with its existing tests; record any justified small timeout change
from measured new bounded work, not by skipping checks.
That macOS lane already builds the backend/workers but not Next.js: keep its
headless managed fixtures independent of a web build. Portable desktop tests must
run on Linux without AppKit/managed macOS admission. The frontend lane supplies
the real source-browser fixture; the separately qualified macOS artifact harness
supplies the integrated native menu → packaged backend → browser cycle.

## Finalization, reviews and delivery

Finalization milestone under the approved scope: resolve all implementation review
corrections and affected rechecks, end the agreed exploratory human-feedback
round (or explicitly schedule its remaining checks for final qualification),
then freeze source and relevant runtime/build/test inputs. A scoped trial may
precede that milestone only after the necessary safety checks/reviews; label it
**“Targeted checks passed; final validation pending.”** Basic feature scope above
does not require repeated permission for routine implementation decisions.

Before every expensive run, explain its purpose, changed inputs since prior
evidence, plan requirement and prerequisites. Verify the pinned toolchain,
compiler/SDK, browser, PostgreSQL fixture service and trusted cached package
archives first; no global installation/profile changes. Use the README PATH
guidance if standalone pnpm shadows the pinned copy.

The frozen candidate requires:

- Two independent reviews of the **complete base-to-candidate diff**, including
  new/untracked files: correctness/compatibility/UI/tests and security/isolation/
  credentials/persistence/recovery. Record actionable findings/dispositions,
  artifact/revision binding and affected rechecks; coordinator independently
  inspects integration and evidence. Plan reviews use the same disposition rule.
- Complete original example suite (including the locally installed offline
  probes), desktop portable/native suites, backend/web affected suites and corpus
  hashes. Source-browser evidence cannot substitute for the packaged UI cycle.
- Full local `MIGRATION_GATE_BASE_SHA=17c82b3095e04b888b2b80439631a23bf133b5c4 pnpm migration:gate`
  because managed runtime/composition/package contracts changed. Preserve every
  existing contract/gate and hosted adapter. Amend the base only if an explicitly
  integrated new base changes the candidate; record source vs PR vs merge SHA.
- A real sealed package produced by `pnpm --filter desktop package --out <absent-output>
  --node-archive <trusted-node-archive> --model-archive <trusted-model-archive>
  --model-license <trusted-license>`, then
  `node scripts/local-migration/installation/installed-smoke.mjs <verified-app>`
  and the new artifact-bound demo lifecycle/browser/client setup harness. Use
  exact sealed payload/archive digests and explicit synthetic root/ephemeral
  ports. Extend the current replacement rehearsal deliberately for the supported
  epoch-1→epoch-2 transition; its current equal-epoch assertion must not simply be
  removed. Prove old artifact refuses the upgraded envelope, new artifact
  preserves personal state/authority, pending restore remains bounded, and
  unchanged compatible real weights are not deleted. No inference/download or
  new model-quality claim is needed for no-model demo acceptance.
- Human acceptance of native menu discoverability and actual provider-backed
  A/B/C story remains separately identified. Do all offline/native/browser/SDK
  work first. No automatic provider calls, personal app stop or actual Desktop
  configuration write during implementation. A later named hands-on test must
  select the exact app, test envelope/ports and config proposal before requesting
  those bounded user actions. SDK/config probes do not satisfy that acceptance.
- Push the stable branch and open one PR against main promptly, while isolated
  complete-diff reviews/local qualification may proceed. Require exact-head CI,
  including both migration lanes and matching same-attempt receipts/aggregate.
  Attach the PR to this chat. No automatic merge. Update PR description with
  review dispositions, source/artifact identities, checks and remaining limits.

Corrections after freeze return to focused iteration, renew affected reviews,
then renew the required full local migration/product/package qualification on
the corrected candidate. Carry forward only explicitly unaffected evidence;
existing foundation 54/54 or earlier pilot results do not qualify these changed
managed/runtime inputs. Do not commit solely to announce a remote pass; put final
run links and results in the PR description/receipts.

The final human instructions will be artifact-specific: launch the qualified
trial's verified native executable with the supported `menu --root ... --ui-port
... --mcp-port ... --demo-mcp-port ...` contract, naming a fresh synthetic root and
checked free alternate ports without disturbing the current personal app; enter
demo, unlock the current
dashboard, open **Demo setup…**, run its packaged A/B login/launch commands,
explicitly prepare/review/apply C through its guarded packaged commands if chosen,
use fresh category reads, approve one A SET and inspect
B/C/history, reset through the menu and reconnect, quit/relaunch to prove edits
persist, then return personal and verify its synthetic sentinel. The final report
must distinguish completed automation from scheduled/unfinished human acceptance.

## Approved tradeoffs and scope boundary

This plan favors existing native ownership and two fixed slots over a second
standalone demo supervisor/envelope. It requires a reviewed management-format
upgrade and old-binary refusal; genuinely uncertain ownership can block personal
return as well as demo until diagnosed. Controlled failed preparation retains the
prior usable selection and offers an explicit safe return without replay.

The rejected alternative was a fixed separate demo `managed-v1` envelope plus a
menu-level durable selector. It would avoid changing personal installation
metadata and could isolate some demo recovery failures from personal startup.
However, two envelope locks alone allow two menu instances to serve different
modes concurrently; enforcing one active app then needs another selector/lifetime
lock across the menu and guardian, cross-envelope crash publication rules, and a
second authority path for retained clients/profiles. Extending the existing
single-owner proof and strict metadata contracts is the preferred total scope,
despite more compatibility fixtures. This tradeoff was reviewed and presented in
the user's check-in; do not treat the existing schema as a reason to mutate it
beneath admitted children or weaken uncertain-owner refusal.

Reset creates new credentials rather than mutating a live store. This makes
personal/demo isolation and interrupted import clearer, but requires explicit
assistant reconnection and retains old disk usage. New app-owned provider logins
are created once; existing demo logins are not adopted. No local model is needed.
Native menu control plus a dashboard guide is smaller than browser lifecycle
authority or general profile/onboarding work, while covering the requested story.
The 2026-10-14 reduction preserves helper capability parity and defers native
assistant launch/settings/proposal UI. The presenter uses generated packaged
commands for those external-client steps in this PR. The tracked next-PR items
add UI around the same contracts after this candidate is qualified.

## Plan review disposition

The two independent reviewers reviewed frozen plan
`0f98d8810049fc812edc95300b430855a3ab71f86431f6480cdf9b825fbdc03d`.
The coordinator accepted and batched these corrections. Both affected reviewers
approved the earlier full-native-controls design
`3bf13f95c264f439225093553e9072e65aabdab41c91c603259850ede389736a`, with no
remaining blockers at that revision. The approval-record-only version was
`557cf85e8c65561ab649a054fe5e77db3219b64b120a5d4a5679bdca659ffe52`.
On 2026-10-14, the user approved the reduced scope and implementation using the
agreed agents. Both affected rechecks approved the reduced-scope frozen design
`40419393519379f54d9de25167d91a7d2937ea3676197556fe54a257024ce3ce`
before sole-writer implementation began.

| Finding | Disposition and affected evidence |
| --- | --- |
| S1 — assistant profile lifetime could hold managed ownership or permit unsafe reuse after helper loss | Prior full-launcher design approved; reduced scope retains managed FD/authority exclusion and uncertain-owner refusal, using a bounded independent packaged-helper guard. Affected plan rechecks approved the guard boundary; implementation evidence below qualifies focused behavior; the deferred native coordinator is not assumed implemented. |
| A1 (P2) — alternate-port native menu trial contract was missing | Accepted; add strictly parsed supported menu/guardian launch options with unchanged defaults, effective-endpoint receipts/proposals, nondefault menu argv/mode/agent-binding tests and concrete isolated human trial invocation. |
| A2 (P2) — portable browser/desktop suites incorrectly implied native lifecycle coverage | Accepted; separate Linux source fixture data/API/banner coverage from macOS managed admission/AppKit mode/reset/cancellation and full artifact integration. Keep each in its existing appropriate CI lane. |
| A3 — manual local UI has no native menu | Accepted fit correction; native-menu guidance is conditional on trusted managed-lifecycle metadata, with a source-UI regression. |

The architecture reviewer assessed the complete revised plan and explicitly
carried forward shared import, package closure, reset and single-envelope coverage.
The safety reviewer rechecked the affected changes and explicitly carried forward
data separation, reset authority, cancellation/publication, no-replay, credential
independence, Desktop and recovery coverage. The coordinator independently inspected
the draft and revision, reran the Markdown link check (150 files) and checked
tracked whitespace; the new-file no-index whitespace check had no diagnostics
(its exit 1 denotes a differing file). Those earlier checks remain historical. The two subsequent affected reviews
approved the helper/setup scope at the frozen hash recorded above.

Architecture and safety reviewers accept the single-envelope v2/epoch2 direction
as proportionate, including its old-binary refusal and possible whole-envelope
unavailability after uncertain demo ownership. That availability/compatibility
tradeoff is unchanged by the user-approved scope reduction. Carry forward only
unaffected data isolation, baseline/reset, native mode/port, managed preparation/
cancellation/publication, package seed/import and existing-view contracts.

**Changed areas covered by the approved affected rechecks:** setup-panel-only UX; standalone
packaged A/B helper invocation/discovery/active-receipt checks; bounded profile
guard and FD/authority boundary; packaged C proposal/apply invocation; packaged
status/verify admission; parity matrix, revised tests/human steps and tracked
next-PR scope. Earlier approval of native buttons/settings/screens or full external
launcher coordination does not qualify these changes. No further user approval
is required for routine implementation within the approved reduced scope, but
new material safety/product tradeoffs must be reported rather than hidden.

## Implementation ownership and evidence

On 2026-10-14, `/root/implementation` accepted sole ownership of code, tests, docs, staging and commits after both independent affected plan rechecks approved the reduced scope. The coordinator and reviewers remain read-only. Requested writer settings: GPT-6 Astra/xhigh; effective runtime settings are not independently observable. Full native-wrapper → Node → assistant FD/environment exclusion, stale runtime receipts, preflight/reset races and conservative profile-guard release remain implementation acceptance requirements.

Checkpoint 1 tests first: `node --test apps/desktop/test/demo-inputs.test.mjs` failed both cases on missing package-owned seed/import modules and deployment entries before implementation.

Checkpoint 1: package-owned mapper, sequential MCP importer and client launch/preflight specs now back thin example wrappers. The original 11 JSONL files are unchanged and the frozen seed manifest is checked before and after packaging. Targeted seed/deployment/package tests passed 21/21. The full original example suite passed 54/54 including both installed offline client probes in 73.6 seconds. The first sandboxed run could not start its owned loopback listeners; the passing run used bounded escalation. No provider requests occurred.

Checkpoint 2, partial: strict v2 fixed-slot metadata and epoch-2 capabilities pass 33 backend unit cases, including rejected demo recovery/setup authority. Native byte-preserving quiescent-v1 upgrade, unique candidate reservation, explicit failed-candidate retention and existing envelope safety pass 23 cases. Backend/native builds passed; real inherited admission, worker revocation, bootstrap and recovery pass 41 cases. Download lifetime/package validation passed 28 cases. Finite demo preparation preserves authority only for orderly cleanup; subsequent control failure revokes it, with 18 control cases passing. Later checkpoints below supersede this partial status; final qualification remains pending.


### Approved implementation clarification: native foreground client lifetime

The safety reviewer independently approved this bounded clarification during
implementation (2026-10-14); other plan approvals carry forward. The guard covers
the qualified native foreground invocation. Normal owned-client exit is its
supported completion boundary; observed ownership loss or abnormal termination
retains refusal. This does not claim universal descendant extinction. Arbitrary
shell/Node shims, detached or daemon launches, concurrent raw launches outside the
helper, and executable replacement are unsupported. Discovery resolves trusted
native arm64 entries and qualifies the pinned version before use. Local qualified
paths resolve to native Codex 0.160.0 and Claude 2.1.299. Claude foreground controls
include `CLAUDE_CODE_DISABLE_AGENT_VIEW=1` and
`CLAUDE_CODE_DISABLE_BACKGROUND_TASKS=1` for both authentication modes, with actual pinned offline `--bg --help` and `--background --help` refusal
qualification passed; provider sessions remain untested. Reference: official
[Claude environment variables](https://code.claude.com/docs/en/env-vars) and the
[pinned Codex wrapper](https://raw.githubusercontent.com/openai/codex/rust-v0.160.0/codex-cli/bin/codex.js).
The exact invocation record is retained after signal death, forced kill, helper
loss, lost wait ownership, or record replacement. A normal supported foreground
exit, including an ordinary nonzero exit, can release only that invocation's
record. Human login/provider acceptance remains pending and is not automated.

Checkpoint 2 native integration: backend/native builds passed, as did 23 focused
native cases covering switch/reentry/reset retention, controlled failed-seed
return, preflight ports, menu state, guardian drain and explicit personal/demo
maintenance selection. Four authenticated runtime-presentation unit cases and a
real HTTP source-runtime presentation case passed. The generation/endpoint-bound
native readiness probe passed refusal checks after Quit. Three isolated profile
and invocation-guard cases passed. Later focused helper/cancellation evidence appears below. Browser, assembled
artifact integration and full final validation remain pending.

### Approved implementation clarification: Homebrew executable ancestry

The safety reviewer approved one executable-only Darwin exception: canonical
`/opt/homebrew/Caskroom/codex/0.160.0/bin/codex` may traverse the exact
`/opt/homebrew/Caskroom` directory when it is current-user-owned, admin group 80,
mode 0775 and not world-writable. Every other ancestor and the executable remain
strict; generic source/config/proposal reads do not use this exception. This is
trust in the local privileged admin boundary, not authenticated binary identity.
File/hash rechecks detect changes but cannot eliminate a final path-to-exec race
against an administrator. No permissions are changed. Positive and negative
predicate tests passed; the actual pinned native Codex and Claude offline probes
passed without login, model requests or personal configuration changes.

Checkpoint 3: real shared MCP seed/import, importer revocation, A write/fresh B
read, edited-state reopen, new-store old-token rejection and settled partial
cancellation passed. Native early/late cancellation, current/stale readiness,
fragmented challenge, full wrapper/Node/client descriptor and environment
exclusion passed in an 18-case batch. Five native foreground lifetime tests cover
normal success/error, benign fork-and-wait/relaunch, signal death, replaced record
and helper loss with a surviving client. The real native reset-during-client-
preflight fixture passed with no profile/session creation. Six Desktop tests
passed, including malformed UTF-8 (red then green), immutable snapshots, unrelated
config retention, stale receipt, changed config, pre-rename race evidence and no
replay. Menu command assertions select Codex A and Claude subscription B and pin
store/runtime-generation/endpoint. All 29 package preflight/previous-epoch cases
passed. CI corpus-discovery tests passed 13/13. Targeted checks passed; final
validation pending. No provider-backed or actual Desktop acceptance is claimed.

Checkpoint 4: production web build and the Linux-compatible demo browser journey
passed. That journey uses real historical seed, identity, MCP authority and app
APIs; only authenticated runtime presentation metadata is response-injected. It
qualifies the banner/guide and reused pages, not native transitions. The complete
original example suite renewed 54/54 including actual offline pinned clients.
Seven latest native checks passed, including prior-displayed-generation Quit
(red then green), early/late cancellation, single selected-command copy and
reset during client preflight. Full artifact and final gate evidence is pending.
The new `scripts/local-migration/installation/demo-smoke.mjs` binds the real
packaged guardian/backend/browser/MCP lifecycle and retains an owned dashboard
screenshot; it explicitly excludes AppKit and provider acceptance. The replacement
harness accepts `--model-file` only for an owned APFS clone verified against the
unchanged model pin; a separate fresh envelope initializes without weights, then
performs only offline maintenance after installing the clone. This proves byte
retention across epoch upgrade without model startup/inference when run; it is
not yet evidence of a completed qualification.

Checkpoint 5 — review corrections: correctness P2 startup-return and security S1
share a bounded return-only state. Existing demo metadata must admit as ready,
with no pending operation and non-uncertain quiescence. An occupied demo port can
offer Return personal after that admission. A failed prepare/receipt check or app
failure can offer it only after ordinary child exit, required acknowledgements
(including app drain), and exact child/lock settlement; protocol/ownership loss
and unacknowledged partial startup still refuse. The return checks the personal
port and requires explicit selection; it never repairs/retries demo or stops an
occupant. Twenty-two focused native recovery/menu/maintenance/clock cases passed,
including controlled failure and uncertain refusal. Offline mode context goes to
stderr without changing stdout JSON.

The guide uses data-bound literal search prefixes, with a red-then-green browser
regression. Source importer evidence version 2 adds the promoted demo and bridge
closure while retaining the old example-only digest meaning. Same-chunk bytes
after Quit now revoke orderly finite cleanup authority. Focused backend package
contract checks passed 8/8; deployment allowlists include only the two intended
helper subtrees. CI uses an owned private durable copy of its already-pinned Node
with exact byte/version checks for source Desktop tests; product trust checks
remain strict. The canonical source alias at the package-copy caller and the
sleep-clock fixture link list are corrected. Initial local broad runs stopped at
missing Python/Docker PATH prerequisites and a package corpus alias; initial CI
reported bounded closure, fixture-link and Node-ancestry integration failures.
These attempts are not passing final qualification. Affected rechecks, renewed
full gate/native/package/artifact/CI evidence and human acceptance remain pending.
The corrected source/CI/deployment/control checks passed 21/21, the guide browser
regression passed, and the exact private-Node CI foundation command passed 53 with
its two existing opt-in installed-client probes skipped. Earlier actual pinned
client qualification is unchanged and carried forward only for those probes.
The final occupied-port rebuild/recheck, contract baseline, markdown links and
whitespace checks passed. Python 3.12.8, the cached PostgreSQL image, pinned
Node/pnpm, compiler/SDK and Chromium prerequisites are available for the final
round. Record its outcomes in PR #183 and retained receipts, without an
evidence-only source commit.

Checkpoint 6 — qualification harness correction: both fresh reviewers approved
`9f7e142` with no remaining blocker, carrying their complete-base reviews through
the affected rechecks. That revision's portable 83/83 and native 223/223 suites
passed and its clean, sealed package receipt binds copied inputs
`a54ce993e40aa8cb9bdb5ff6c8fa3e1c8d3afa057c1d5a3fa9ddd8fba9a5ef48`.
Remote Linux qualification exposed the same shared Node ancestry prerequisite in
portable Desktop tests. One small CI-only script now supplies a byte/version-
verified private Node through `GITHUB_PATH` to each affected job; both Desktop
suites passed 10/10 under it and workflow contracts passed 14/14.

Artifact execution exposed a test-client SDK lookup from the web package instead
of its backend owner; only the harness lookup changed. Installed isolation's
initial five-second probe failed under parallel copy load and passed unchanged
on its retained copy; its deadline stays unchanged with bounded diagnostics
added. The replacement fixture reached epoch-2 authority/state continuity and
old-artifact refusal, then exceeded its outer 240-second budget: the next owned
session began at 245.208 seconds. The coordinator approved a bounded 600-second
outer budget for full sealed artifact copies/inventories and optional real-weight
hashes. Existing startup, stop, command and product bounds stay unchanged;
sanitized phase timing and failure diagnostics were added. Failed fixtures remain
retained, and corrected harnesses rerun serially against the exact sealed artifact.

This correction changes only CI qualification setup, harnesses, their checks and
this record; runtime/package inputs remain identical to `9f7e142`. Carry-forward
evidence must retain that original source/artifact provenance and explicitly
verify the unchanged runtime/package tree against the final head. The corrected
harness revision and new exact-head CI/affected reviewer approvals are recorded
in PR #183. Full local gate, complete artifact cycles, offline real-weight
retention and human acceptance are not claimed by this checkpoint.

### Approved pre-human review correction round (2026-10-14)

After `5dfadcf` passed both reviews, full local qualification and exact-head CI,
the user requested assessment and useful fixes from an external static review
before hands-on testing. The coordinator approved this bounded batch. Requested
writer/reviewer settings remain Astra/xhigh; effective settings are unobservable.
Affected security and native/architecture reviewers accepted the design and
product delta; their frozen trial dispositions and receipts belong in PR #183.

- Preflight signals: confirmed. Guard-wide signals now latch before acquisition,
  synchronous probes settle, an explicit event-loop yield precedes profile work,
  and cleanup removes only the owned exact record after action unwind. Progress
  is visible. Abnormal post-start termination remains uncertain by design; the
  suggested manual guard deletion/reclaim is rejected. Positive-proof recovery
  stays tracked with assistant lifetime work, with no fresh-profile workaround.
- Desktop C: confirmed for a **new bridge process** after runtime restart. An
  already running bridge may reconnect. New applied snapshots use C-only pinned
  installation/store/endpoint/client/credential admission; strict copied commands
  and prepare/apply still reject old runtime generations. Snapshot modules keep
  the source's sibling demo/MCP-bridge topology. No mutation replay or silent
  credential adoption is introduced. Existing snapshots require explicit reapply.
- Retry then Quit: confirmed in same-guardian and reopened-failure paths. Update
  the immediately previous displayed generation only when accepting retry; only
  Quit receives that narrow allowance. Unknown/older commands retain refusal.
- Small presentation corrections: invalid Copy selection keeps the dialog open
  with feedback; the runbook states existing config 0600 ownership/type requirements;
  baseline verification wording reflects its real mismatch rules; unlock help
  names the native CR action alongside source-launcher instructions. Port flags
  already work, and status already probes native readiness; contrary static-review
  claims do not require product changes. Additional hub links are optional.
- Transient accept-error behavior is unconfirmed and deferred for investigation.
  Shared cross-language malformed-metadata fixtures remain required final evidence
  as stated above; they are not silently waived or made a schema-framework task.

Failure-first signal tests observed SIGINT/SIGTERM/SIGHUP process death instead
of orderly cancellation, and both synchronized retry tests observed exit 1 instead
of 0. New C admission assertions failed against the absent bounded admission API.
The corrected focused run passed 44/44 cases covering safe cancellation/reuse, ordinary/abnormal client
completion, token/owner/receipt races, four failed/cancelled/reopened retry paths,
strict old-generation refusal and immutable Desktop proposals. Expected uncertain
negative-test fixtures remain retained; no product recovery policy is weakened.

**Agreed milestone:** one stable source/artifact-bound isolated hands-on trial,
after focused checks and affected reviews. Its packaged real-SDK test starts a
fresh bridge from the unchanged applied entry after both Quit/relaunch and native
Restart at the same fixed endpoint, then checks reset refusal and no replay.
The prior artifact cannot qualify these changed product inputs. Report
**“Targeted checks passed; final validation pending.”** The full local migration
gate, applicable installed/replacement qualification, complete final review/input
assessment and exact-head CI remain required after the human-feedback round and
before merge. Existing CI runs normally during iteration; no triggers, budgets,
checks or safety/live-run approvals are weakened. Human AppKit/provider acceptance
is still pending, and all trial work uses owned synthetic state only.

### Approved compact menu-label retest (2026-10-14)

The user reported that the CR menu disappeared on entering demo in the sealed
`a03d059` trial, including with Finder active. Read-only process/listener checks
showed that its menu, guardian and demo runtime remained running. The user then
confirmed that **CR Demo** reappeared after freeing menu-bar space, establishing
capacity hiding rather than application exit. Source inspection confirmed the
avoidable expansion from **CR** to **CR Demo** under AppKit's content-sized
status-item policy. Keeping the title compact cannot guarantee visibility under
arbitrary menu-bar crowding.

The approved narrow correction keeps the title **CR** in both modes, with an
explicit mode-aware tooltip/accessibility label and the existing menu status and
dashboard banner. It uses the validated store/mode marker to keep startup
descriptions neutral, rather than trusting the initial personal-mode default.
No lifecycle, authority, guard or state behavior changes. Requested writer and
affected reviewer settings remain Astra/xhigh; effective settings are unverified.

The compiled existing menu fixture failed first on title/width-policy invariance.
The corrected menu, unlock and restart fixtures passed 3/3. The presentation
fixture observes real admitted mode updates using a fake status item: it proves
compact title, unchanged width policy and semantic descriptions, not actual
AppKit allocation or visibility under a notch. Human acceptance of the compact
label remains pending. Normal Quit is accessible again in the running trial,
which is not stopped or modified and can continue its hands-on checks.

After the affected review, build one new isolated sealed trial from its exact
frozen source because the native menu bytes changed. The earlier 44-check and
nine-phase artifact evidence retain their original `a03d059` product/`5d84ee0`
harness binding; only unaffected lifecycle/import/client coverage may carry
forward after explicit input assessment. The earlier artifact cycle does not
qualify this new menu presentation. No automatic repeat of the full migration
gate or full artifact cycle is required for this focused retest. Final gates,
CI and human acceptance remain required at the post-feedback milestone above.

### Approved shared-dashboard correction (2026-10-14)

The user rejected the separate **Explore the demo** homepage during hands-on
testing and explicitly required the normal UI plus demo banner/data. This user
instruction overrides the earlier guide-replaces-dashboard design. The approved
implementation removes only the demo-specific `DashboardView` bypass, reuses the
unchanged normal component and appends the five prompts in a closed native
details/summary section. There is no duplicate navigation or second main heading.
The optional help uses the real **Permission Grants** label. Data, credentials,
lifecycle and the current no-model policy are unchanged.

Failure-first production-browser evidence passed personal mode but failed demo
waiting for the normal Dashboard heading. After correction, all three focused
browser cases passed: normal personal profile editing plus personal/demo heading
and exact navigation parity, authenticated demo-only banner, collapsed/expanded
help with real clipboard copy, valid literal search prefixes, existing
profile/schema/preferences/permissions/history routes and the real 189-memory
sample. These isolated source fixtures inject only admitted presentation metadata;
native admission remains a separate packaged check.

After affected review, freeze and build one new sealed UI trial. The existing
artifact harness's explicit `--browser-only` path records its three-phase scope:
artifact isolation, native demo entry/personal byte preservation, and real
packaged shared-dashboard/help/view assertions. It retains normal awaited
guardian stop/reap and cleanup. It excludes the later client-authority, Desktop,
reconnect, reset and personal-return proofs; no-flag invocation still runs the
full nine-phase cycle, and unknown/extra arguments are rejected. Capture the
default dashboard and expanded help for visual review. Prior full-cycle evidence
keeps its original source/artifact binding and does not qualify this changed UI.

Requested writer/affected-review settings remain Astra/xhigh; effective settings
are unverified. The running human trial and durable root remain untouched.
**Targeted checks passed; final validation pending.** Human UI/provider testing
and the agreed post-feedback final gates remain outstanding; no full migration
gate or broad qualification is automatically repeated for this UI iteration.
