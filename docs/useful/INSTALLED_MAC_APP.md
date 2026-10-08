# Installed Mac Pilot

Status: Step 09 local candidate; final qualification and human acceptance pending.
This is an unsigned private build, not a signed or notarized release. The declared
pilot is MacBook Pro 18,2, M1 Max, 64 GiB, macOS 15.1.1 (24B91). Other Macs and
native Windows/Linux are not qualified. The source/manual modes remain available.

## Install And Use

Obtain the complete `Context Router.app` and its build receipt from the trusted
local build. Compare the archive's SHA-256 with that receipt before extracting.
The inventory detects missing or changed payloads; it does not authenticate a
publisher or a modified manifest. Gatekeeper acceptance remains untested. Do not
disable Gatekeeper or strip quarantine to treat this as a distributed release.

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

The dashboard uses an available loopback port. The menu's MCP endpoint is fixed at
`http://127.0.0.1:8787/mcp`, matching the existing manual setup. An already occupied
requested port is refused before managed state is opened. There is no fallback
listener or interference with the occupying process. This is a preflight, not a
reservation: a later port race or partial-startup failure can still leave uncertain
state that blocks launch. Freeing a port does not clear an uncertain generation.

## Model And Restart

Non-AI preferences, grants, history and MCP remain available without weights.
**Download Qwen3.5 9B model…** asks permission for the pinned Q4_K_M asset from
unsloth on Hugging Face: 5,680,522,464 bytes, about 5.7 GB. Allow at least 6.8 GB
free space. The downloader checks the exact size and digest, restricts HTTPS
redirects and publishes only complete verified bytes. Cancellation preserves
existing assets. No automatic retry, resume, hosted fallback or model substitution
occurs. An explicit new attempt needs another menu action and consent.

After download, choose **Restart local runtime…** to enable AI. It interrupts
browser/MCP connections, drains and reaps the previous generation, then creates
new private model credentials. It preserves the database, human identity, MCP
credentials/grants and model assets. Reconnect clients and obtain a fresh browser
unlock. Sleep/wake or one-day certificate expiry invalidates AI until an explicit
restart. Actual sleep/wake and reboot qualification remain pending. The retained
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
"$router_cli" mcp provision --label 'My local client' --out /absolute/private/new-client.token
```

The token export must be absent and have a private parent directory. Use the
existing [manual MCP client setup](MCP_LOCAL_SETUP.md) with port 8787 and that
client's credential. Browser unlock, human identity, MCP and inference credentials
are distinct. A client credential is not a browser unlock code. Provision/rotate
exports are sensitive; routine menu diagnostics do not contain them. Permission
and grant syntax is unchanged from the existing CLI. The installed wrapper also
provides `mcp rotate`, `revoke`, `permissions`, `grant`, `upgrade`, and `inspect ID`.

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

SIGINT (Ctrl-C), SIGTERM and terminal SIGHUP request orderly cancellation of a
running administration or setup child. A matching completion after native-owner
drain and actual normal exit records a failed but quiescent operation, so its
named recovery remains reachable. A completed operation can still report success
when cancellation arrives too late. Forced termination, missing/mismatched
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
termination after journal publication retains an active journal and blocks
re-entry. It does not recover an abandoned active or uncertain owner.

Candidate 05 predates this cleanup journal operation and refuses it. Use the
revised qualified candidate after cleanup; rollback to Candidate 05 is not a
qualified recovery procedure.

## Replacement And Removal

Quit successfully before changing code. Stage and verify a complete compatible
application outside the old bundle, then replace the whole `.app`. Do not merge
files into a running or partially replaced bundle. Retain the previous complete
candidate until verification succeeds. The native inventory refuses interrupted
or altered payloads before Node or database access. There is still a race if code
is modified after verification; a writable local candidate is a trusted local
build, not a tamper-resistant distribution.

Compatibility requires the supported platform, management/security epoch and
SQLite/identity formats. The security floor lives outside code and backups and
cannot be lowered by reinstall or restore. Binary rollback is not database
rollback; never launch an older source binary against managed roots.

Default uninstall means Quit, then remove only `Context Router.app`. Keep the
private envelope: reinstall reuses its selected pair, identity, client credentials,
models and backups. There is no destructive reset/removal command in this pilot.

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
production builds, verifies the native inventory and records caller integrity.
Weights are not bundled. The [Step 09 evidence](../plans/active/local-migration/09-installation-and-packaging/implementation.md)
distinguishes deterministic fixtures, installed-artifact checks, live model tests
and unperformed human/signing/platform acceptance. Do not infer one from another.
