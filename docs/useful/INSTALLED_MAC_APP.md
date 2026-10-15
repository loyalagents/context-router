# Installed Mac Pilot

Status: implemented foundation from merged [PR #168](https://github.com/loyalagents/context-router/pull/168).
Final-head CI passed; see [scoped closeout](../current/LOCAL_MIGRATION_CLOSEOUT.md)
for evidence and [pilot preparation](../plans/active/colleague-pilot/README.md)
for the next acceptance work. Original human acceptance was partial; neither merge
nor this runbook qualifies distribution or every recovery scenario.
This is a private build without Developer ID signing or notarization. The
sealed D candidate passed strict ad-hoc whole-bundle verification, installed and
replacement checks; it supplies no publisher authentication. Safari acquired the
exact pinned bytes with quarantine. The user reported completing per-app Open
Anyway, and the matching downloaded menu was observed. Normal test-menu Quit and
cleanup remain pending; downloaded AppKit Ready/dashboard and model-enabled startup
remain unproved. See [current results](../plans/active/colleague-pilot/plan.md#d-results-and-review-follow-up-2026-10-12). The declared
pilot is MacBook Pro 18,2, M1 Max, 64 GiB, macOS 15.1.1 (24B91). Other Macs and
native Windows/Linux are not qualified. The source/manual modes remain available.

## Install And Use

Obtain the complete `Context Router.app` and its build receipt from the trusted
local build. Compare the archive's SHA-256 with that receipt before extracting.
The v2 inventory hashes ordinary payload files; mandatory strict platform
verification covers the fixed main executable, resource seal and signed manifest.
Neither an ad-hoc seal nor a colocated receipt authenticates a publisher. New
native candidates reject old v1 manifests; retained old apps keep their own
verifier. Preserve an independently trusted archive checksum and full external
byte receipt. A v2 manifest checksum alone does not pin the final executable or
resource seal: ad-hoc re-signing can change them without changing the manifest.
Artifact-bound execution must also match the complete external byte receipt using
its independently trusted digest. Do not modify anything inside a sealed bundle. The 2026-10-11 Safari-quarantined B archive was
refused as damaged: its executable-only ad-hoc signature does not seal the complete
app bundle. That archive is not ready to share. Do not
disable Gatekeeper or strip quarantine to treat this as a distributed release.

The user selected the unsigned-publisher route. D repairs the integrity seal and
includes the qualified #173 packaged UI wiring. Its local Safari/menu observation
has the limits above; a trusted colleague acquisition channel and the remaining
downloaded-app acceptance still need evidence. Keep the source revision,
app manifest, archive checksum and acquisition channel with each handoff. A local
build or extracted temporary copy does not demonstrate downloaded-app Gatekeeper
behavior. Scope remains the measured Mac above; another Mac is a compatibility trial.

The unbundled `legacy-package-manifest.mjs` verifier exists only for explicitly
approved retained-v1 rehearsals with an independently trusted manifest digest.
Remove it when the last approved v1 artifact rehearsal and its callers/tests are
retired together. It is not a production fallback or permission to accept v1 in a
new native candidate.

Place the whole application in a private user-owned location, then open it in
Finder. The installed application bundles Node, the backend, dashboard and selected
native inference runtime. It needs no checkout, pnpm, shell model server or OpenSSL.
The **CR** menu appears and opens the dashboard. Choose **New unlock code…** to
display a one-use code; copy it into the dashboard. Codes expire after five minutes.
**Copy unlock code** deliberately uses the system clipboard; clipboard history
software can retain it. A consumed code must be replaced with a new one.

Closing the browser leaves the runtime and MCP running. **Open dashboard** returns
to it; **Quit Context Router** drains work and stops owned children. No login item,
automatic update, background restart or external-client configuration is installed.
Quit the menu application before offline CLI administration.

The dashboard uses an available loopback port. Personal MCP defaults to
`http://127.0.0.1:8787/mcp`, matching the existing manual setup. An already occupied
requested personal port is refused before managed state is opened. A selected
demo with an occupied demo port can admit the existing quiescent envelope and
offer **Return to personal mode…** without starting demo. There is no fallback
listener or interference with the occupying process. This is a preflight, not a
reservation: a later port race or partial-startup failure can still leave uncertain
state that blocks launch. Freeing a port does not clear an uncertain generation.

## Historical Demo Mode

This candidate implements a separate persistent demo inside the same managed
envelope. **CR → Enter demo mode…** prepares the frozen historical 2024–2025
sample on first entry, then reopens that store on later entries. The menu-bar
title stays compact as **CR** in both modes. Its tooltip and accessibility label,
the menu's status line and the authenticated dashboard banner identify demo mode;
startup descriptions stay neutral until the mode is admitted. AI is disabled; personal
model files remain retained. **Return to personal mode…** restores the personal
slot. Quit/relaunch remembers the last successfully selected mode. Each switch
closes existing browser/MCP sessions; use the newly opened dashboard and fresh
client conversations.

Demo uses the same dashboard and navigation as personal mode, including Account
Information, Profile Memory, Edit Profile, Preferences, Form Fill, Audit History,
Preference Schema and Permission Grants. The historical banner and demo data
identify the mode. **Demo walkthrough (optional)** below the dashboard is closed
by default; expand it for the five-step script and copyable prompts. It does not
replace the homepage or add a second navigation menu.

**Reset sample data…** confirms creation of a new store/principal with 189
active memories, original definitions/import history and fresh A/B/C credentials.
Later changes, custom clients and grants do not carry forward. Old stores/exports
and isolated provider login profiles remain retained. Reset is not secure erasure.
Use Clear memory or Clear history only for their separately described behavior.
Controlled sample preparation failure offers explicit return or fresh retry.
A selected demo whose receipt/prepare validation fails, or whose application
fails with acknowledged drain and proven child/lock settlement, offers only
**Return to personal mode…** or Quit. This retains the demo for inspection;
return requires an available personal port. Uncertain ownership, pending
operations, malformed installation metadata and unacknowledged partial startup
remain refused and retained. Do not clear journals or profile guards.

**Demo setup…** groups **Codex · Agent A**, **Claude Code · Agent B** and
**Claude Desktop · Agent C**. A/B offer **Sign in**, **Open** and **Choose
executable…**. Sign in/Open asks for explicit provider consent, revalidates the
qualified native CLI and opens a fresh Terminal document. Continue in Terminal;
opening it does not confirm login or an assistant connection. Start a fresh
conversation and check the assistant's own MCP status. The picker remembers only
the qualified canonical path/hash/version for this installation and vendor; it
is checked again on every action. It never adopts personal login or MCP settings.

**Copy sign-in**, **Copy launch**, Desktop's **Copy setup command** and **Copy
status** remain secondary Terminal fallbacks. Copy reports success/failure and
keeps the panel open. Every action binds the root, store, runtime generation and
endpoint captured by the panel. Changed/stopped context refuses; reopen the panel
for current actions. While an inspect/prepare/apply helper is outstanding, native
mode/reset/restart actions are disabled and refused. **Done** can close the panel;
the menu still owns that finite operation. Reopening the panel shows its completed
Desktop outcome for the same demo. A hidden prepare requires a fresh visible
prepare/review; no old proposal or closed-Desktop confirmation is restored.
Normal Quit settles its exact owned helper group before stopping the guardian.
If ownership becomes uncertain, polling stops and actions remain blocked. Quit
offers **Cancel** by default or explicit **Quit and retain state**; this stops the
local runtime without further helper signals or claiming setup finished. The helper
may still finish changing Desktop configuration. Keep Desktop and config editors
closed, and inspect retained state before opening Desktop or retrying. Interrupted
apply can retain its guard, proposal and backup; never delete a guard or replay an
uncertain mutation. Restart is not automatic recovery.

Terminal handoffs use unique private retained `demo/launch-requests/.../open.command`
files. They contain quoted helper arguments and no credentials, use a clean
Terminal environment, and are never overwritten, reused or automatically removed.
They are diagnostic records, not proof of client lifetime. External assistants
remain independent of the menu; the app does not close them on reset or Quit.
Run each intended action separately. They use
the bundled runtime and need no checkout, pnpm, handwritten MCP config or copied
tokens. `status` validates native readiness and immutable receipts only; it does
not assert unchanged current memories/grants. Inspect actual state in the app.
After Quit, the same bound command with `verify` runs native offline baseline
verification; edits may correctly cause a baseline mismatch. Offline authority
commands use `--root ROOT --mode demo mcp ...`; other maintenance defaults to the
personal slot, even when demo was selected. Demo recovery/backup/restore is not
exposed. Existing personal restore rules and pending-operation exclusion remain.
Admitted offline commands print their nonsecret mode on stderr; stdout JSON stays
available to scripts.
Rotating or revoking a built-in A/B/C client invalidates its packaged connection.
Reopening preserves that changed authority; prepare/apply does not repair it.
There is no in-place export refresh or rebinding: do not delete, overwrite or adopt
exports. An explicitly confirmed **Reset sample data…** creates new baseline
credentials, but also resets demo edits, custom clients and grant changes; the old
store is retained. It is not a credential-only repair.

The primary story uses Codex 0.160.0 as Agent A and Claude Code 2.1.299 subscription
as Agent B. Install these external CLIs separately. The panel explicitly selects
B's client/auth; A defaults to Codex. Run `login A` or `login B --client claude
--auth subscription` explicitly to establish fresh app-demo provider profiles,
then the corresponding `launch` command for each fresh conversation. Never copy
old demo/personal credentials. Optional `launch B --client codex` and Claude A/B
`--auth subscription` or `--auth api-key` use the same guards. API-key launch
requires the explicit `CR_DEMO_ANTHROPIC_API_KEY` environment variable; inherited
ordinary provider variables are not adopted. Provider sessions may send retrieved
sample context off-device. The user has confirmed live A/B connectivity and an
approved Codex change → fresh Claude Code read → Audit History sequence; the
artifact/version was not independently confirmed for those earlier A/B reports.
The user subsequently confirmed Desktop prepare/apply/connect/read, permission
restrictions, Quit/reopen persistence, reset and return to personal mode for
merged PR #183. New native setup controls need separate hands-on acceptance.

Discovery accepts the exact qualified native arm64 foreground CLI, rejecting
arbitrary shell/Node/npm wrappers. Use **Choose executable…** to select the native
payload inside an nvm/npm installation when its public command is a script shim;
the app does not execute or interpret wrappers to find it. The CLI fallback is
`--executable /absolute/native/client`. `demo client inspect --client codex|claude`
with the same current binding optionally accepts that path and returns only its
canonical path, hash and qualified version. The helper qualifies pinned
version/isolation settings with empty temporary profiles before using a stable
per-role login. Claude uses its dedicated config and workspace; macOS OS-account
HOME is retained only for Keychain discovery. Background/agent-view tasks are
disabled and behavior-probed. Only this role's MCP credential enters the client.
The guard covers the qualified native foreground invocation. Normal owned-client
exit is its supported completion boundary; observed ownership loss or abnormal
termination retains refusal. It does not promise arbitrary descendant extinction.
Concurrent raw launches, detached/daemon clients and manually changed executables
are unsupported. A normal nonzero exit can release its exact guard; signal death,
helper loss or replaced records cannot. The app does not stop external assistants
when switching/resetting; old commands remain pinned and become unusable.
The helper announces its preflight checks. SIGINT/SIGTERM/SIGHUP during preflight
are latched; bounded synchronous probes finish before cancellation unwinds and
releases the exact untouched guard. No profile or client session is then started.
Exit a running assistant normally while its helper Terminal remains open. Closing
the Terminal or killing a client can leave uncertain lifetime evidence: retain the
guard and profile, do not delete/copy them or bypass refusal with a fresh profile.
Demo reset does not reclaim these guards. Explicit recovery with positive lifetime
proof is tracked with the next native assistant-coordination work.

The narrow Darwin Codex Homebrew exception accepts only canonical
`/opt/homebrew/Caskroom/codex/0.160.0/bin/codex` through current-user-owned admin
(group 80) mode-0775 `/opt/homebrew/Caskroom`; all other ancestors/files remain
strict. This trusts local privileged admins and is not publisher authentication
or protection against an administrator changing a binary at execution time.
Generic source/config/proposal paths never use that exception.

For Agent C, **Prepare setup** validates the active generation and writes a
private immutable bundled-Node/bridge snapshot and proposal. The panel shows
create/replace, target configuration/entry and backup effects. **View exact
change…** shows the owned command, arguments and environment without unrelated
configuration or credentials. Close Desktop and all config editors, then check
the explicit confirmation and choose **Apply reviewed change**. Apply is disabled
until that confirmation and cannot replay a submitted proposal. No configuration
changes during prepare/review. The helper compares the exact reviewed proposal
SHA-256 and original config bytes, preserves unrelated settings, backs up the
original and verifies atomic replacement. Start Desktop normally afterward and
confirm its connection in a fresh conversation.

The Terminal fallback `desktop prepare` prints the same safe review, digest and
exact `applyCommand`, including `--proposal-sha256` and `--desktop-closed`. Review
before explicitly running it. The digest option is additive for old CLI callers;
the native panel always requires it. Neither the panel nor apply executes an
untrusted returned command or proposal-selected executable.
Changed config, unknown collisions, stale generations or uncertain application
retain evidence and refuse replay. Start Desktop normally and use a fresh
conversation. The applied entry pins installation, store, endpoint, C client ID,
credential hash and immutable snapshot. A newly started bridge may discover the
current native runtime generation only for that same installation/store/endpoint,
then verify its native readiness challenge. Ordinary Quit/relaunch or Restart at
the same endpoint needs no new apply. After reset or an explicit endpoint change,
prepare/review/apply a new entry. Built-in client rotation/revocation instead
invalidates the connection as described above; prepare/apply cannot refresh its
export. There is no automatic redirection or mutation replay.
Previously applied snapshots retain their old behavior and need one explicit new
prepare/apply to obtain this reconnect behavior. Prepare/apply commands themselves
remain bound to the runtime generation shown in Demo setup.
The envelope and config
must be durable private locations outside temporary directories. Packaged app
bytes may be temporary because snapshot copies are durable. No actual user
Desktop config has been changed by automated implementation checks.
An existing config must be a canonical current-user-owned regular file with one
link and mode **0600**, inside a trusted durable directory. If the Desktop configuration directory is absent, install/open Desktop once. A
typical 0644 config is refused; the helper does not change its permissions automatically.

For an isolated human trial, choose a **fresh durable** root such as a named
private directory under `~/Library/Application Support/Context Router Trials/`,
ending in `managed-v1`, and invoke the exact qualified artifact:

```sh
"$router_cli" menu --root /absolute/private/durable/trial/managed-v1 \
  --ui-port 0 --mcp-port 18787 --demo-mcp-port 18790
```

Choose free fixed alternate MCP ports for a C reconnect trial. Occupied ports are
refused without stopping their owner. Port `0` remains supported, but a different
effective demo endpoint on relaunch correctly requires a new C prepare/apply.

Passing `0` for a port requests an available port. Fixed nonzero choices must
be distinct and free; defaults remain UI ephemeral, personal MCP 8787, demo 8790.
The receipt/panel records actual endpoints, so never reuse old copied commands.
Do not point a trial at personal state or retained source-demo homes. New binaries
upgrade quiescent v1 installation metadata to v2/epoch2; old apps then refuse that
envelope. This is a metadata transition, not a database conversion or permission
to discard source documents, old stores or compatible weights. The unbundled
previous-epoch verifier is restricted to explicitly pinned replacement rehearsals;
production verification does not accept old package epochs.

## Model And Restart

Non-AI preferences, grants, history and MCP remain available without weights.
**Download Qwen3.5 9B model…** asks permission for the pinned Q4_K_M asset from
unsloth on Hugging Face: 5,680,522,464 bytes, about 5.7 GB. Allow at least 6.8 GB
free space. The downloader checks the exact size and digest, restricts HTTPS
redirects and publishes only complete verified bytes. Cancellation preserves
existing assets. No automatic retry, resume, hosted fallback or model substitution
occurs. An explicit new attempt needs another menu action and consent.

Weights live in the managed envelope outside the app. Compatible replacement and
normal Restart preserve them; startup verifies the pinned size and digest before
use. Replacing the app does not require another download of matching weights.
Do not copy manual model sessions or credentials into the managed envelope. A
retained file or synthetic marker alone does not qualify real model reuse.

The 6.8 GB guidance covers the model download, not the entire installation or
replacement. Account separately for downloaded archives, extracted and retained
apps, weights, incomplete downloads, state, logs, backups and credential exports.
Measure retained usage and usage while staging and replacing. Samples establish
an observed maximum, not an exact peak; APFS sharing and links can make logical,
allocated and exclusively used space differ.

If download fails immediately while the dashboard stays ready, the candidate
may predate a change to Hugging Face's CDN redirects. The current pinned URL
uses `us.aws.cdn.hf.co`, an exact host listed in Hugging Face's
[download documentation](https://huggingface.co/docs/hub/models-downloading).
Use a candidate with the updated allowlist; the pinned model size and checksum
remain required. Do not disable verification or edit the installed bundle.

After download, choose **Restart local runtime…** to enable AI. It interrupts
browser/MCP connections, drains and reaps the previous generation, then creates
new private model credentials. When ready, it opens the current dashboard; unlock
there with a fresh code. Restart can change the dashboard's local address, so an
older tab may no longer reach the app. Use **CR → Open dashboard** to return to the
current address rather than trying new codes in that old tab. When an open tab
detects a connection failure on return to the tab or while unlocking, it clears
its browser session and replaces the page with **Dashboard disconnected**, with
no unlock form. Close that tab and unlock the current dashboard. Tabs loaded by
an older app retain the older behavior until closed. A live server rejecting an
expired session still permits a fresh unlock at its current address.
Restart preserves the database, human identity, MCP
credentials/grants and model assets. Reconnect clients and obtain a fresh browser
unlock. Sleep/wake or one-day certificate expiry invalidates AI until an explicit
restart. Native process, shutdown and control-write budgets count awake time, so
system sleep cannot consume the drain allowance. Unlock codes still expire during
sleep. Real sleep during shutdown and reboot recovery remain unqualified; the
clock correction does not repair already uncertain owner journals. The retained
[model E/H limitations](LOCAL_MODEL.md) are not resolved by packaging.

## Data And Offline Administration

The default private envelope is
`~/Library/Application Support/Context Router/managed-v1`. It contains selected
`stores/<id>/data` and `stores/<id>/identity`, models, private session/export files,
ownership metadata and bounded diagnostics. Do not rename, edit or delete its
metadata to bypass exclusion. Source/manual commands cannot open managed roots.
Existing source/manual roots are not imported or modified automatically.

Set the path to your actual application, then use its native executable:

```sh
router_cli="$HOME/Applications/Context Router.app/Contents/MacOS/context-router"
"$router_cli" --help
"$router_cli" verify-package
"$router_cli" mcp list
"$router_cli" mcp rename --id CLIENT_ID --label 'Personal laptop'
"$router_cli" mcp provision --label 'My local client' --out /absolute/private/new-client.token
```

The token export must be absent and have a private parent directory. Use the
existing [manual MCP client setup](MCP_LOCAL_SETUP.md) with port 8787 and that
client's credential. For the source-only Claude Desktop trial, use the
[private-file bridge recipe](MCP_LOCAL_SETUP.md#claude-desktop-assisted-source-bridge-trial);
the installed bundle includes a generation-bound bridge for the demo workflow below; personal Desktop setup retains the source recipe. Browser unlock, human identity, MCP and inference credentials
are distinct. A client credential is not a browser unlock code. Provision/rotate
exports are sensitive; routine menu diagnostics do not contain them. Permission
and grant syntax is unchanged from the existing CLI. The installed wrapper also
provides `mcp rename`, `rotate`, `revoke`, `permissions`, `grant`, `upgrade`, and `inspect ID`.

Rename is display-only and creates no token export. It preserves credentials,
policy, grants and stable history keys, including for revoked instances. Quit and
exclusive-owner checks still apply to this offline CLI command; the browser can
rename while the app runs. Offline rename defaults to the personal store even
when demo was selected. Use `--mode demo mcp rename --id CLIENT_ID --label NAME`
to rename a demo client; the browser edits clients in its active mode.
Inspect the current name after an unconfirmed result
before making another explicit attempt. Pending-store administration supports
`mcp rename` only with the same explicit `--pending-store STORE_ID` selection.

Names are trimmed, nonempty and limited to 64 UTF-16 code units before trimming.
The installed CLI also rejects Unicode control and format characters in MCP
command arguments. This includes the zero-width joiner used in emoji such as
👩‍💻; ordinary non-ASCII names such as `Café 東京 💻` are accepted. To use a name
containing a format character, rename in the browser instead; its name validation
rejects C0 controls (U+0000–U+001F) and DEL (U+007F), a narrower rule. The installed
restriction also applies to provision and is unchanged by rename support.

Back up only after Quit, through the installed command:

```sh
"$router_cli" backup
"$router_cli" restore --from /absolute/private/completed-backup
"$router_cli" --pending-store STORE_ID mcp list
"$router_cli" --pending-store STORE_ID mcp revoke --id CLIENT_ID
"$router_cli" activate-restore STORE_ID --acknowledge-restored-authority
```

Backup reports its completed export path. Restore reports a new pending store ID
and preserves the current selection. Pending restore blocks ordinary startup and
administration. Inspect the pending pair and revoke/rotate restored authority
before activation. The acknowledgment accepts restored data, history, preferences,
human authority, MCP credentials/revocations and grants. `abandon-restore STORE_ID`
clears the pending choice while retaining its files. Never substitute copying a
live SQLite file or silently rolling back to an older backup.

Named `identity recover-initialize`, `recover-rotation`, and
`recover-database-bootstrap` retain the existing recovery rules. `resume-setup`
resumes a verified non-ready pair; `initialize-recovered` is restricted to the
same empty pair after successful named identity or bootstrap recovery. Bootstrap
recovery can be followed by recovered initialization when the original identity
directory was never created, only after proving the existing database has no
principals. Controlled drained preparation failures remain explicitly retryable;
lost completion stays uncertain. None clears an abandoned active
or uncertain owner journal. Preserve that state for explicit diagnosis. Cross-boot
abandoned-owner recovery is not qualified; no automatic repair is provided.

If ownership is uncertain, stop and preserve the app, envelope and diagnostics.
Reinstalling does not clear it. Do not remove journals, claims, exports or compatible
model assets to make launch succeed. There is no personal reset command or designated
reset release in this pilot. Demo reset is the bounded operation described below.

SIGINT (Ctrl-C), SIGTERM and terminal SIGHUP request orderly cancellation of a
running administration or setup child. A matching completion after native-owner
drain and actual normal exit records a failed but quiescent operation, so its
named recovery remains reachable. Late cancellation can report failure after an
operation has already made durable changes, or success after completion was
acknowledged. Cancellation does not promise rollback: inspect the operation's
state and use its named recovery when applicable before retrying. Forced termination, missing/mismatched
completion, malformed private control or lost ownership still preserve uncertainty
and block further commands. Do not delete the ownership journal to bypass this.

After Quit, explicitly remove interrupted model-download stages with:

```sh
"$router_cli" cleanup-downloads
```

This native-only command requires a ready installation, no pending restore, and
proven prior quiescence. It checks the entire model directory before deleting any
file, removes only private owned `.download-<generation>-<random>.part` stages,
and completes an interrupted two-link publication only when both names identify
the exact same pinned model file. Unknown names, unexpected links, symlinks or
invalid metadata cause refusal; preserve the files for diagnosis. The model's
full size/hash verification still runs on restart. This bounded synchronous
cleanup finishes its current operation on ordinary terminal signals; abrupt
termination or an I/O failure after journal publication can retain an active journal and block
re-entry. It does not recover an abandoned active or uncertain owner.

Candidate 05 predates this cleanup journal operation and refuses it. Use the
revised qualified candidate after cleanup; rollback to Candidate 05 is not a
qualified recovery procedure.

### Finder Metadata Refusal

Opening managed directories in Finder can create `.DS_Store`. The envelope root
allowlist and the complete model-cleanup inventory deliberately reject that extra
name; cleanup does not silently remove it. This refusal occurs before changing
the owner journal or deleting download stages.

After a successful **Quit Context Router**, with no installed CLI running and
proven quiescence, inspect only the exact `.DS_Store` in `managed-v1` or its
`models` directory. If it is a regular file owned by your user with exactly one
hard link, remove that single Finder metadata file and retry. A symlink, directory,
different owner, extra link or another unexpected name requires diagnosis instead.
Do not recursively clean the envelope, edit ownership metadata, or use this remedy
to bypass an active or uncertain journal. Keep Finder closed on these directories
while retrying so it does not recreate the file.

## Replacement And Removal

Quit successfully before changing code. Stage and verify a complete compatible
application outside the old bundle, then replace the whole `.app`. Do not merge
files into a running or partially replaced bundle. Retain the previous complete
candidate until verification succeeds. The native inventory refuses interrupted
or altered payloads before Node or database access. There is still a race if code
is modified after verification; a writable local candidate is a trusted local
build, not a tamper-resistant distribution.

Record both source and manifest identities. Back up through the installed command
after successful Quit; retain the managed envelope during whole-app replacement.
Launch the exact verified new app and check preserved data, grants and history.
Retaining the previous bundle preserves evidence; it does not authorize launching
it against newer state. Never substitute copying a live database for backup.

When testing separately named candidates, launch the exact newly verified app.
For example, staging a candidate in `$next_app` does not update an earlier `$app`
variable. Quit the previous CR menu successfully, close its dashboard tabs, and
launch only the new candidate against the same explicit test root.

Compatibility requires the supported platform, management/security epoch,
SQLite/identity formats and every persisted owner-journal operation name. An equal
epoch alone does not make an older candidate compatible; new operation vocabulary
must be included in future compatibility/epoch decisions. The security floor lives outside code and backups and
cannot be lowered by reinstall or restore. Binary rollback is not database
rollback; never launch an older source binary against managed roots.

Default uninstall means Quit, then remove only `Context Router.app`. Keep the
private envelope: reinstall reuses its selected pair, identity, client credentials,
models and backups. There is no destructive personal reset/removal command in this pilot.

## Build And Evidence

Contributors need the repository's pinned Node 24.21.0/pnpm 10.25.0 and the Apple
compiler. Production acquisition inputs must match the reviewed cached archives:

```sh
pnpm --filter desktop package \
  --out /absolute/absent/output \
  --node-archive /absolute/node-v24.21.0-darwin-arm64.tar.xz \
  --model-archive /absolute/llama-b11146-bin-macos-arm64.tar.gz \
  --model-license /absolute/Qwen3.5-9B-LICENSE
```

The packager copies source and dependencies to an isolated build, makes fresh
production builds, writes the v2 inventory and then ad-hoc seals the outer app
without re-signing pinned nested binaries. It verifies the platform seal and
native inventory, records final full-file hashes in external `sealed-payload.json`
and records caller integrity. No bundle content changes after sealing; the final
archive checksum is retained in the build receipt.
Weights are not bundled. The [Step 09 evidence](https://github.com/loyalagents/context-router/blob/7e8f1c5a90084ba6a5623bf48f3c1186fb64422f/docs/plans/active/local-migration/09-installation-and-packaging/implementation.md)
distinguishes deterministic fixtures, installed-artifact checks, live model tests
and unperformed human/signing/platform acceptance. Do not infer one from another.

The additive installed assistant-setup check is
`node scripts/local-migration/installation/assistant-setup-smoke.mjs APP NEW_DURABLE_ROOT`.
Use a new owned private durable fixture directory. It exercises the packaged CLI
inspect and exact proposal contracts, a compiled request writer through the
sealed native wrapper/Node to a synthetic client, and retained requests through
Quit/reopen/reset. It never opens actual Terminal, accesses provider login or edits
personal Desktop configuration. The full installed demo and replacement checks
remain separate; this narrower check does not replace them or human acceptance.
