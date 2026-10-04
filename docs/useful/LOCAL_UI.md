# Local Dashboard

- Status: implemented on the Step 08 branch; independent reviews and full local gate passed; verify PR CI; manual acceptance pending
- Read when: starting the dashboard, unlocking a browser, managing local MCP clients or testing local AI
- Source of truth: `apps/web/local-ui.mjs`, `apps/backend/src/bootstrap/local-ui.ts`, `apps/backend/src/local-ui/`, `apps/web/components/local/`
- Last reviewed: 2026-10-04

The reused dashboard runs on literal IPv4 loopback with SQLite and one local
principal. Browser and MCP requests enter the same application services and model
admission owner. No Auth0 account, hosted database or hosted inference service is
required. The separately selected hosted application and earlier local commands
remain available. This is a manual production launch, not an installer or desktop app.

## Build And Start Without A Model

Use Node **24.21.0** and pnpm **10.25.0** from this checkout:

```sh
pnpm install --frozen-lockfile
pnpm --filter backend prisma:generate
pnpm --filter backend build
pnpm --filter web build
```

For a fresh synthetic test only, create a private parent and fresh roots:

```sh
export STEP08_ROOT="$(python3 -c 'import os,tempfile; print(os.path.realpath(tempfile.mkdtemp(prefix="context-router-ui-")))')"
export LOCAL_DATABASE_ROOT="$STEP08_ROOT/data"
export LOCAL_IDENTITY_STATE_ROOT="$STEP08_ROOT/identity"
mkdir -m 700 "$STEP08_ROOT/exports"
pnpm --filter backend local-identity initialize
pnpm --filter backend local-mcp upgrade
pnpm --filter web local-ui serve --unlock-dir "$STEP08_ROOT/exports"
```

For existing state, select its same canonical database/identity roots. **Do not
initialize again.** If it is schema v1, first stop every owner, make an offline
matching-pair backup and explicitly upgrade following
[MCP administration](MCP_LOCAL_SETUP.md). Schema v2 is required. The export
directory must already exist, be private `0700`, and be outside both strict roots.

Open [the local dashboard](http://127.0.0.1:3002/dashboard). The launcher's
readiness JSON prints the browser origin, MCP URL and a new private `0600` unlock
file path. Read that exact file locally and paste its content into **Unlock token**.
The token itself is never printed by the launcher. Do not use the human identity
file, an MCP token or model credentials in the browser. The Next standalone
advisory is expected for this explicit custom server; use the `local-ui` command.

The default ports are UI **3002**, MCP **8787**. Both must be distinct and bind to
`127.0.0.1`; `--port 0 --mcp-port 0` selects owned test ports and reports them.
`localhost`, LAN addresses, tunnels and reverse proxies are not supported.
Do not start another `local-mcp serve` owner for this dashboard's MCP endpoint.

## Browser Sessions And Shutdown

An unlock token is single-use and expires after five minutes. Enter the literal
line `unlock` in the running launcher's terminal to export a fresh token for
another browser session. A successful export invalidates the previous unused
unlock token. An export failure leaves the earlier token's original lifetime intact.

Each browser session has an absolute eight-hour lifetime and is kept in that tab's
`sessionStorage`. Cookies and `localStorage` are not used. The session is a local
browser credential; scripts running in the same origin and the same OS user are
inside its trust boundary. Do not paste untrusted scripts into developer tools.
**Lock dashboard** clears the private view immediately and revokes the session;
expiry, rejected authentication and a server restart require a fresh unlock.
Closing the browser does not stop the backend or model. Closing terminal input
alone also leaves the application running. Use Ctrl-C (SIGINT) or SIGTERM and
wait for process exit; shutdown is bounded to ten seconds.

The HTTP boundary admits only documented page/static/API paths, exact Host/Origin
and an explicit browser header. It rejects raw upgrades and CONNECT. Browser
credentials cannot authenticate MCP; native MCP retains its Origin rejection.
Plain HTTP does not authenticate a preexisting or replacement listener at the
same exact origin, or a service worker already controlling that origin. Use
exclusive free loopback ports and a trusted browser profile; this boundary does
not defend against an attacker controlling that origin or the same OS account.

## Memory, Schema, Clients And History

Use the existing dashboard for profile, manual preferences, literal search,
personal schema creation/edit/archive and JSON export. Definition changes validate
future writes; they do not rewrite older saved values. Location-scoped manual
creation remains outside the existing preference form.

**MCP Clients** identifies actual instances by stable ID. Inspect shows the CLI
maximum, stored grants and understandable effective authority for bounded exact
targets. Labels may repeat. Grants can narrow that maximum; ALLOW never expands
it. An out-of-maximum ALLOW is rejected. Stale generation/revision changes require
inspection again; oversized authority snapshots are unavailable, not guessed.
Revoke affects only the selected instance. Issuance, rotation and maximum changes
remain [CLI operations](MCP_LOCAL_SETUP.md); no client configuration is written.

Both history streams are retained until explicitly cleared. Sensitive and UNKNOWN
legacy audit payloads are masked by default using the stored event-time marker,
including archived definitions. Reveal is a presentation control; authenticated
history APIs still return owned snapshots. **Clear both history streams** requires
an exact `CLEAR HISTORY` confirmation and deletes both in one serializable
transaction. Live preferences, provenance, schema, identity, clients and grants
survive. Other windows invalidate stale views. An uncertain response is never
retried automatically: reload and inspect before deciding what to do next.

**Clear memory** is separate: it removes preference memory while retaining both
history streams and writes a reset event. History clear has no undo, per-record
delete or TTL. It is logical deletion from the current database, not secure media
erasure; older backups retain their histories and restoring one restores those
records. See [history](../current/AUDIT_AND_ACCESS_HISTORY.md) and
[reset contracts](../current/DATA_RESET.md).

## Optional Qualified Local AI

First provision a fresh manually operated selected model session using
[Local Model](LOCAL_MODEL.md). With its explicit `LOCAL_MODEL_SESSION_ROOT` and
`LOCAL_MODEL_PORT`, launch `local-ui serve-model` with the same unlock directory.
The dashboard does not download/start/stop inference or silently fall back to
hosted inference. One owner serves UI and MCP; one operation is admitted at a
time, with no queue. Busy/unavailable AI leaves manual flows usable.

Readiness and formats come from the selected adapters and configured limits.
Local document analysis accepts supported UTF-8 text, Markdown, JSON, YAML and
text-bearing PDF within the selected maximum (at most 10 MiB). It rejects images
and offers no OCR. Consent is required, with additional confirmation for detected
secret-like files. Raw files remain bounded browser/server memory and are released
after completion/cancellation. Proposals require review; per-item results distinguish
applied, invalid, changed saved state and uncertain outcomes. No write retry is
hidden behind the interface.

Document-analysis PDF structure/text extraction stays in the existing owned
parser child with cancellation, deadlines and reaping. Its wire/heap/output limits
provide a responsiveness boundary, not a total-RSS guarantee. The existing
pdf-lib AcroForm extraction/fill pipeline still parses in the shared process;
this step does not add parser isolation or decompression limits to that pipeline.

Local PDF form fill always uses policy v2. Existing nonempty fields remain unless
the user explicitly names fields to overwrite. This still enforces types, domains,
source slugs and field policy. Inspect partial/skipped outcomes and the downloaded
PDF. Existing field values are not added to the model prompt. Smart search uses the
same selected model; literal search needs no model.

The UI offers cancellation and shorter deadlines (5/30/180 seconds). Requests also
end on disconnect/logout/expiry, and late results cannot repopulate a locked view.
Cancellation does not prove a committed write rolled back. The selected model's
existing E omission and H recovery limitation remain: the known adversarial email
omission is accepted; native cancellation was inconclusive/failed qualification,
and an unsettled session latches unavailable. Stop and reap the old backend and
inference owners and provision fresh session credentials following the model
runbook. Never delete a claim or reuse consumed model-session credentials.

## Automated And Human Validation

Install the pinned test browser explicitly before browser tests or migration gate:

```sh
pnpm --filter web exec playwright install chromium
pnpm --filter backend test:local-ui
pnpm --filter web test:local-ui
MIGRATION_GATE_BASE_SHA=5e2a67dd785500ba053b2e836c47166e8adeada8 pnpm migration:gate
```

Linux CI installs Chromium system dependencies with `playwright install --with-deps
chromium` before the gate. Playwright is pinned to 1.63.0 and Chromium to its
153.0.8010.12/revision-1243 prerequisite. The gate never downloads a browser. It
validates and passes the canonical executable to test harnesses before isolating
HOME; product processes receive no browser tooling configuration.

Source and relocated production smokes use synthetic state, pinned TLS inference
fixtures and authenticated Chromium. App policy checks restrict exact module
closures, listeners and model destination, including SQLite workers. Browser
routing confines page HTTP/WebSocket requests; it is not an OS-wide browser or
zero-egress claim. macOS arm64 and Linux CI evidence do not expand native model
qualification. Windows, LAN and installers remain outside Step 08.

The consolidated [human acceptance checklist](../plans/active/local-migration/08-local-ui/acceptance.md)
remains pending until explicitly recorded. Use synthetic data and isolated client
configuration; automation has not operated a live model or modified personal clients.
