# Assisted Mac alpha: operator instructions

This kit supports a helper-led personal-mode trial. `release.json` identifies
the source, app archive, external full-byte receipt and standalone bridge/Node.
It does not certify a recipient's Mac. The release handoff must include the
[acceptance record](#acceptance-record), separating assembly integrity, other
automated evidence and human acceptance. No reset release is designated.

## Prerequisites and trust

Recipients need an Apple Silicon Mac, a user account allowed to open this private
unsigned-publisher app, Terminal, a browser, and Claude Desktop with local MCP
configuration permitted by its account/organization. The measured platform is
M1 Max / 64 GiB / macOS 15.1.1; the app declares 15.1.1 as its minimum. Other
hardware/OS combinations are compatibility trials, not qualified configurations.
The historical personal-Claude observation used Desktop 2.31226.1 Pro ordinary
chat. Record the recipient's actual version and account/mode; later versions need
acceptance. Demo Agent C setup does not establish this personal connection.

The app bundles its own Node/backend/dashboard/llama runtime. The kit also carries
separate Node 24.21.0 for the standalone personal bridge. Recipients need no Git,
pnpm, compiler, Python, package install, shell model server or build credentials.
Internet is needed for the explicitly approved model acquisition and Claude's
service. Saved facts can be read over MCP without a local model. Claude may send
retrieved data to its provider; choose documents and grants accordingly.

Get the kit ZIP **and its exact SHA-256 from the helper through an independently
trusted channel**. Also receive `releaseMetadataSha256` from the helper's
`handoff.json`; this independently pins the extracted `release.json` as a second
anchor. A checksum inside the same download is only integrity evidence.
Ad-hoc sealing supplies neither publisher authentication nor notarization. Do not
publish the binary or invite colleagues until the owner approves that milestone.

Preserve the original ZIP. Before downloading in Safari, turn off **Safari →
Settings → General → Open “safe” files after downloading** (see
[Apple's General settings](https://support.apple.com/guide/safari/ibrw1072/mac)).
If the browser already expanded it, recover the exact original ZIP if available
or download it again without auto-opening. Do not recreate a ZIP from the expanded
folder or treat its own checksums as a trusted substitute. The route below still
requires the original ZIP hash; the second anchor adds a check, not a bypass.

## Verify and place the app

For an existing installation, start with [Replacement, reconnect and recovery](#replacement-reconnect-and-recovery)
before following this section. It supplies the old-app backup/retirement order.
Use actual absolute paths. Replace every placeholder before running a block.
Commands below create new destinations; do not rerun them over existing files.
Keep the original downloaded archive until acceptance is complete.

```sh
archive='/absolute/path/to/Context-Router-alpha-SOURCE12.zip'
LC_ALL=C shasum -a 256 "$archive"
# Compare exactly with the independently supplied handoff digest. Stop on mismatch.
stage="$HOME/Context-Router-alpha-staging-SOURCE12"
mkdir -m 700 "$stage"
ditto -x -k "$archive" "$stage"
kit="$stage/Context-Router-alpha-SOURCE12"
LC_ALL=C shasum -a 256 "$kit/release.json"
# Compare exactly with the independently supplied releaseMetadataSha256.
(cd "$kit" && LC_ALL=C shasum -a 256 -c SHA256SUMS)
```

Require every checksum to say OK. Retain `release.json`, `SHA256SUMS` and
`sealed-payload.json`. Inspect the parent paths: every component must resolve
without symlinks, be owned by this user or root, and have no group/other write
permission. Use a private, durable user-owned application folder. If
`~/Applications` is absent, create it with `mkdir -m 700 "$HOME/Applications"`;
inspect an existing folder rather than changing its permissions implicitly.

```sh
app_parent="$HOME/Applications/Context-Router-alpha-SOURCE12"
mkdir -m 700 "$app_parent"
ditto -x -k "$kit/Context Router.local-candidate.zip" "$app_parent"
app="$app_parent/Context Router.app"
codesign --verify --deep --strict "$app"
LC_ALL=C shasum -a 256 "$app/Contents/Resources/package-manifest.json"
# Compare with release.json app.manifestSha256 before executing app code.
router_cli="$app/Contents/MacOS/context-router"
```

The operator assembler verifies the complete external byte receipt against both
the built app and extracted ZIP before issuing the handoff. The recipient's
independently pinned ZIP hash binds those bytes; strict seal/native verification
checks extraction. A manifest hash alone does not pin the executable/resource
seal. Never change files inside the app or re-sign it to bypass a failure.

The steps above do not execute app code. Do not run `router_cli` yet. For an
upgrade, finish the old-app retirement and variable reassignment below first.
Open this exact app from its version directory in Finder; do not use Spotlight,
Launchpad or an old Dock shortcut to choose among copies. If macOS blocks an unidentified/unnotarized app,
follow Apple's per-app **System Settings → Privacy & Security → Open Anyway**
only after trust and integrity checks. A damaged/malware alert, missing override
or organization policy refusal is a stop-and-diagnose outcome. Do not disable
Gatekeeper globally or remove quarantine. See
[Apple's instructions](https://support.apple.com/en-us/102445).
Wait for the CR menu to reach Ready, then choose **Quit Context Router** and wait
for successful completion before the first CLI invocation:

```sh
# app must still name the exact newly approved version.
router_cli="$app/Contents/MacOS/context-router"
"$router_cli" verify-package
```

If this CLI invocation is blocked, preserve the exact error and stop for the
helper; Finder approval must not be assumed to qualify every executable. Do not
strip quarantine. Record the download/extraction route, Finder and CLI prompts,
quarantine/translocation observations and prior approval history. Reopen the
same exact app in Finder to continue. A local extraction or cached approval is
not fresh-Mac launch evidence.

## Unlock, model and document rehearsal

Wait for the **CR** menu and Ready. Ensure personal mode is selected. Use **New
unlock code…**, open the current dashboard and enter the one-use code. Codes
expire after five minutes. Do not use an MCP token as an unlock code. Clipboard
managers can retain copied codes. Closing the browser leaves CR running.

Verify the no-model dashboard first. With the recipient's consent, choose
**Download Qwen3.5 9B model…**. The pinned Q4_K_M asset is 5,680,522,464 bytes;
the menu advises 6.8 GB free for that operation. The downloader enforces model
bytes plus 1 GiB (6,754,264,288 bytes). Allow separately for
archives, extracted/staged/retained apps, support, partial downloads, documents,
state and backups. A practical starting allowance is **10 GB free for a fresh
trial**, plus existing retained apps/backups; this is a planning allowance, not
a measured universal peak. Record `df -h` before/after and actual folder usage.
The model is outside the app and compatible replacement reuses verified weights.

After download, choose **Restart local runtime…**. It closes browser/MCP sessions
and enables AI using fresh private inference credentials. Open the current
dashboard from CR and use a new unlock code; close old dashboard tabs. A failed
or cancelled download has no automatic retry/resume. An explicit retry needs
another menu action. Do not copy model credentials or manually edit the envelope.

Use a small synthetic UTF-8 `.txt` document for the first human extraction, e.g.
“My preferred morning drink is mint tea. I prefer meetings after 10 a.m.”
Upload through the dashboard, review each proposed fact and its subject before
saving, then confirm the saved values in Preferences and Audit History. Record
expected versus observed facts; reject incorrect attribution. This step runs
the local model and needs consent. It is not covered by synthetic transport tests.
Original files are the user's responsibility and must be retained separately.

Text and the qualified text-PDF subset are supported; image/scanned/OCR documents
are not. The bounds include 10 MiB/file, 50 PDF pages and 32 KiB decoded document;
smaller inputs may still hit model/context limits. Treat rejected PDFs and
wrong-person suggestions as findings, not invitations to broaden the parser here.
The parallel document investigation owns their disposition. Known extraction
omission and cancellation-recovery limits remain; never promise every fact.

## Durable personal Claude bridge

Place the immutable support outside the managed envelope and outside temporary
directories. It must not disappear when an app version is replaced. Inspect all
ancestors as above. If the support parent is absent, create it once with mode
0700; if present, inspect its ownership/mode and retain existing versions.

```sh
support_parent="$HOME/Library/Application Support/Context Router Bridges"
# Run only if this exact parent does not already exist:
mkdir -m 700 "$support_parent"
support="$support_parent/Context-Router-alpha-SOURCE12"
mkdir -m 700 "$support"
mkdir -m 700 "$support/bridge"
cp -p "$kit/bridge/bridge.mjs" "$kit/bridge/cli.mjs" \
  "$kit/bridge/credential.mjs" "$support/bridge/"
tar -xJf "$kit/node-v24.21.0-darwin-arm64.tar.xz" -C "$support" \
  node-v24.21.0-darwin-arm64/bin/node node-v24.21.0-darwin-arm64/LICENSE
cp -p "$kit/release.json" "$kit/SHA256SUMS" "$support/"
node_bin="$support/node-v24.21.0-darwin-arm64/bin/node"
LC_ALL=C shasum -a 256 "$node_bin" "$support/bridge/"*.mjs
```

Compare Node with `release.json`'s `node.binarySha256` and all three modules
with `bridge.files`. Require user-owned private support/bridge directories, regular
read-only module/receipt files, a regular executable Node without group/other
write permission, and canonical trusted ancestry. Inspect extracted Node
directories too. The Node binary digest is
`e4b5a3af0e05c75de2eae013904145f40fe7fc2a6e6f17510128bf45cca4e79b`.
Then check `"$node_bin" --version` returns `v24.21.0`. This separately extracted
Node may have its own quarantine/approval behavior; record its result and its
later launch by Claude. If either is blocked, stop for the helper without
removing quarantine or assuming the app's Finder approval covers Node.
Do not substitute a PATH
Node or npm/npx wrapper. Keep the bundled Node license with this separate copy.

After **Quit Context Router** completes successfully, create a new private token
directory outside managed state and provision one personal Desktop instance:

```sh
credentials="$HOME/Library/Application Support/Context Router Claude Personal"
mkdir -m 700 "$credentials"
"$router_cli" mcp provision --label 'Claude Desktop personal' \
  --out "$credentials/claude-01.token"
"$router_cli" mcp list
# Copy the full nonsecret client ID from the command result, then choose actual slugs.
client_id='REPLACE_WITH_FULL_CLIENT_ID'
"$router_cli" mcp permissions --id "$client_id" \
  --capabilities preferences:read --targets 'REPLACE_WITH_CHOSEN_SLUG'
```

The existing export must be a same-user regular single-link **0600** file under
the canonical **0700** parent. Never print/copy its contents into configuration,
screenshots or feedback. Defaults allow no targets. `permissions` replaces the
entire maximum policy; use chosen exact slugs or a deliberately reviewed scope,
not `*` for convenience. Omission of `--allow-sensitive` denies sensitive values.
The dashboard permission preview/editor can refine the policy and grants after
reopening CR. Keep this connection read-only for the first retrieval.

Reopen the exact CR app in personal mode. Personal MCP must be
`http://127.0.0.1:8787/mcp`; the production bridge has no endpoint override. If
8787 is occupied, diagnose its owner instead of stopping it automatically or
redirecting the bridge. An alternate-port synthetic test does not prove this
production endpoint or personal onboarding.

With the recipient's explicit approval, open Claude Desktop **Settings →
Developer → Edit Config**. Preserve the original configuration in a new private
backup, fully quit Claude and close other config editors before editing. Merge
one new uniquely named entry into existing `mcpServers`; retain unrelated
settings. Use literal resolved absolute paths, not `$HOME`, `~` or placeholders:

```json
{
  "mcpServers": {
    "context-router-personal-alpha": {
      "command": "/Users/RECIPIENT/Library/Application Support/Context Router Bridges/Context-Router-alpha-SOURCE12/node-v24.21.0-darwin-arm64/bin/node",
      "args": [
        "--no-global-search-paths",
        "/Users/RECIPIENT/Library/Application Support/Context Router Bridges/Context-Router-alpha-SOURCE12/bridge/cli.mjs",
        "--credential-file",
        "/Users/RECIPIENT/Library/Application Support/Context Router Claude Personal/claude-01.token"
      ],
      "env": { "NODE_OPTIONS": "", "NODE_DEBUG": "", "NODE_DEBUG_NATIVE": "" }
    }
  }
}
```

The file is normally `~/Library/Application Support/Claude/claude_desktop_config.json`.
This is the local desktop configuration, not a remote cloud connector. The
[MCP local-server guide](https://modelcontextprotocol.io/docs/develop/connect-local-servers)
describes the UI. Organization restrictions may prevent this route; stop for
the helper rather than install an unreviewed extension or tunnel.

Fully reopen Claude, inspect local server status/tool discovery, and start a
fresh ordinary conversation. Approve a read of the chosen saved fact; compare
the actual result with the dashboard and inspect Access History. Confirm a fact
outside the allowed scope is unavailable. Discovery/connection alone is not
retrieval evidence, and a previous demo connection does not qualify this entry.

Quit CR normally, reopen the same app/root, unlock its new dashboard, and confirm
the fact/client policy/history remain. Fully restart Claude to establish a fresh
bridge session and repeat the read. Restart is an explicit user action; the
bridge never launches CR or automatically replays a mutation.

## Replacement, reconnect and recovery

For replacement, explicitly identify the currently running version before
changing shell variables. Successfully Quit it, then back up through that version:

```sh
previous_app='/absolute/path/to/previous/Context Router.app'
previous_cli="$previous_app/Contents/MacOS/context-router"
"$previous_cli" backup
# Retain the reported completed backup path privately.
```

Keep the **original verified previous ZIP and its receipts** as evidence. If
those are missing, stop for the helper before retiring the old app. Follow
**Verify and place the app** through the non-executing checks, using a new unique
version directory; stop before opening the new app. Then, in Finder, move only
the identified previous `.app` to Trash and remove its old Dock shortcut. Do not
delete the managed envelope, models, support, credentials or backup. This is a
deliberate manual retirement step; neither the kit nor a background updater does
it. Do not assume moving a still-launchable `.app` outside Applications prevents
macOS from selecting it.

Explicitly bind every subsequent command to the new verified app:

```sh
new_app='/absolute/path/to/new/version/Context Router.app'
app="$new_app"
router_cli="$app/Contents/MacOS/context-router"
unset previous_cli
```

Use its exact Finder path, then Ready → successful Quit → `verify-package`, as
above. Reopen that app against the same default envelope and check facts, grants,
history and verified model reuse. Replace any retained Dock shortcut with this
version only after checking its path. Do not use old Terminal variables or
Spotlight/Launchpad to select a version. Keeping an old ZIP does not authorize
running older code against newer state; equal security epochs do not establish
backward compatibility. Do not merge bundles or copy a live SQLite file.
Existing standalone bridge paths do not change with app replacement.

For a bridge/Node update, stage a new verified support version, review the
configuration path changes with Claude closed, preserve the old config/support,
then explicitly restart Claude. Never overwrite a running immutable snapshot.
Rotation reads a new export only after a configuration update and restart:

```sh
# CR must be successfully quit; use a NEW absent filename in the private parent.
"$router_cli" mcp rotate --id "$client_id" --out "$credentials/claude-02.token"
"$router_cli" mcp list
```

Inspect the result before editing the config's credential-file path. An
unacknowledged export may be active; a file alone does not prove success.
Revocation is terminal: `"$router_cli" mcp revoke --id "$client_id"` after Quit.
Use a separate credential for each client instance. Do not reuse the human
identity, browser unlock or inference credential.

After 30 minutes idle, a call can report **Session expired; this request was not
dispatched**. Make a separate explicit request. **Outcome unknown** instead
means a mutation might have committed: inspect preferences/history before any
new write. Do not replay it blindly. Human acceptance includes an actual interval
over 35 minutes, permitted/denied access, independent revoke/rotate, and supported
restart/uncertain-result handling on the named app/Claude/account pair.

For model unavailability after cancellation/sleep/certificate expiry, use the
menu's explicit Restart, preserving data and verified weights. If ownership is
uncertain, stop and retain the envelope/app/diagnostics for diagnosis. Reinstall
does not clear it. Forced termination, reboot and abandoned journals have no
qualified general recovery here. Do not delete journals, claims, guards or state.

The supported offline restore path is `restore --from COMPLETED_BACKUP`, inspect
the reported pending store with `--pending-store ID mcp list`, revoke/rotate
restored authority as needed, then `activate-restore ID
--acknowledge-restored-authority`. Pending restore blocks normal startup;
`abandon-restore ID` retains its files. Do not casually restore over newer facts
or assume an old backup preserves current revocations. A helper must review the
specific recovery before acting. Interrupted downloads have the bounded
`cleanup-downloads` command only after successful Quit and proven quiescence.

Uninstall: Quit, remove only the app, and retain the private envelope at
`~/Library/Application Support/Context Router/managed-v1`. There is no personal
reset command. Keep the support version while a Claude entry references it.
Removal of that entry/support/token is a separate deliberate action with Claude
closed and the client revoked; never sweep unrelated support or source documents.

## Build operator: repeatable assembly and evidence

Use a clean reviewed checkout and the pinned Node 24.21.0/pnpm 10.25.0, frozen
dependencies, Apple compiler/SDK and existing cached archives. The build operator
also needs the pinned Playwright Chromium for installed checks. These are not
recipient prerequisites. All output paths below must be absolute and new.

```sh
pnpm check:toolchain
pnpm --filter desktop package --out /absolute/new/package-output \
  --node-archive /absolute/node-v24.21.0-darwin-arm64.tar.xz \
  --model-archive /absolute/llama-b11146-bin-macos-arm64.tar.gz \
  --model-license /absolute/Qwen3.5-9B-LICENSE
LC_ALL=C shasum -a 256 /absolute/new/package-output/build-receipt.json
node scripts/local-migration/installation/assisted-alpha-kit.mjs \
  --package-dir /absolute/new/package-output \
  --build-receipt-sha256 INDEPENDENTLY_RETAINED_RECEIPT_SHA256 \
  --node-archive /absolute/node-v24.21.0-darwin-arm64.tar.xz \
  --out /absolute/new/kit-output
```

The assembler accepts only a package receipt matching the current clean commit;
it reuses the existing strict package/external-byte verifier and verifies the
extracted app ZIP. Bridge and operator bytes must match committed Git blobs,
including when Git status hides a working-tree change. It includes only an
explicit public-file allowlist. The sanitized `release.json` excludes local
paths; separate build logs/receipts, databases, credentials and qualification
evidence remain private. The unchanged app and full-byte receipt can contain
build/dependency paths, including the builder's account name. This kit does not
redact or re-seal the existing package. Inspect that disclosure before sharing.
`handoff.json` outside the kit records the final kit archive and release-metadata
digests; provide both to the recipient through the trusted channel.
Any failure retains its output for diagnosis;
start a new output after resolving it, never label partial output ready.

Run the selected source checks and actual extracted artifact checks, including
installed smoke and old-to-new synthetic replacement. Use private isolated state,
alternate ports and denied provider/model execution. Keep the source HEAD,
copied-input digest, actual CI test-merge identity, app/kit digests, toolchain,
commands, results, failed attempts, normal process settlement and limitations.
Move/copy temporary receipts into a durable private evidence folder before they
can be reclaimed. Do not commit generated binaries, state, private evidence or
client configuration. A source CI pass does not qualify the artifact.

For the shipped-support proof, retain the runner source and its SHA-256 with the
evidence. Copy the unchanged bridge CLI/credential/transport tests and observer
fixture into an isolated tree, point its bridge import directory at the exact
extracted kit modules, and run those tests with the kit's separately extracted
and hash-verified Node. The test SDK may come from the verified packaged backend;
the bridge itself uses Node builtins. Record the runner command, all test/module
hashes, executable path/digest, SDK version, exit result and log. Use synthetic
ephemeral endpoints; CLI EOF checks must not initialize against personal 8787.

## Acceptance record

`release.json` and `handoff.json` list only the integrity checks performed by
assembly under `acceptance.verifiedByAssembly`. They are not runtime, CI or
recipient acceptance receipts. The helper must accompany the handoff with a
dated record for the exact kit digest, using **passed**, **failed** or **pending**
for every row; list commands/receipt references for automated results and the
named Mac/client/version plus sanitized observations for human results.

| Evidence | Required record |
| --- | --- |
| Source qualification | Actual PR head/test-merge, CI runs/attempt and final receipts; input comparison to artifact source |
| Actual artifact | Installed, replacement, full demo and shipped-support results; retain failed attempts and cleanup outcomes |
| Downloaded launch | Preserved ZIP and both trusted hashes; extraction route, Finder/Gatekeeper/translocation, AppKit Ready, CLI after approval |
| Model/document | Consent-bound download/restart, live review/save, and real-weight retention across replacement |
| Personal Claude | Standalone Node quarantine/launch, exact config/client/account, permitted/denied reads, restart and >35-minute idle |
| Demo | Native setup controls, external-client behavior, demo/personal separation and return on the exact build |
| Recipient/release | Fresh-Mac compatibility and owner approval to distribute |

Unperformed checks remain pending. A failed download/launch or test is never
silently replaced by a later pass. Do not copy private paths, tokens, documents,
raw configuration or tool-result payloads into the shareable human record.

For disk accounting, include the outer kit ZIP (~app ZIP + Node archive), its
unpacked payload, separately extracted app/support, downloaded model, retained
old apps/archives/support, partial model downloads, state/logs/exports/backups.
Measure logical and allocated usage and sample while staging/replacing; APFS
sharing means sums are not exclusively used space and samples are not exact peaks.
The 6.8 GB download check is not a complete install/replacement budget.

Before a human rehearsal, pin the exact artifact and bound consent to its named
Mac, root, chosen synthetic document, model acquisition/use and personal Claude
configuration/read actions. Record each of: downloaded Finder launch and Ready;
unlock; no-model state; model download/restart; document review/save; personal
Claude permitted/denied reads; normal Quit/reopen; retained state. Mark unperformed
items pending. Prior AppKit, demo or synthetic evidence cannot fill those boxes.
Keep diagnostics sanitized: no token/unlock bytes, private documents, raw config,
provider sessions or tool-result payloads in shared feedback. The colleague
quickstart/feedback task owns recipient-facing guidance beyond this operator kit.
