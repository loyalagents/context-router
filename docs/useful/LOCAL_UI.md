# Local Dashboard

- Status: merged in Step 08 PR #167; independent reviews, full local gate and final-head CI passed; user-run acceptance completed with explicit evidence limits
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

Returning to a dashboard tab revalidates its browser session without probing the
model. The authenticated, empty-body JSON `POST /api/local/session` returns only
the remaining session lifetime and never renews it. Unlock/restoration and
**Check model status** still use `/api/local/capabilities` for full qualification.
The displayed AI state is the last checked result; completing or cancelling an
operation does not start another model check. Every AI request still performs
its own qualification and shares the existing one-operation admission limit.

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

**MCP Clients** identifies actual instances by stable ID and shows each maximum
value level, allowed scope, independent DEFINE maximum, sensitivity, rule count
and effective access across current active definitions in that scope. Mixed means
those fields have different value access. Prefixes also apply to future fields;
a current summary is not a guarantee of uniform future access.

**Edit permissions** changes the maximum and related rules with one atomic Save.
Choose Blocked, Read, Suggest changes or Write; Write includes Suggest and Read.
Definition management independently allows creating, updating and archiving field
definitions subject to scope and rules. Search categories (explicit slug prefixes)
or readable fields instead of typing identifiers; existing custom targets survive.
A scope default preserves more-specific exceptions and DEFINE rules. Advanced
rules offer explicit removal/inheritance, which can widen access. Reducing a
maximum retains inert ALLOW rules; expansion or sensitive access can reactivate
them. New ALLOW rules must fit the proposed final maximum.

Preview shows server-evaluated before/after access and possible widening, including
new ranges, future fields and archived-definition values. Every draft change
invalidates its preview. Save requires that exact preview and current authority
and catalog revisions. A conflict preserves the draft for a fresh read and preview.
Only an acknowledged commit confirms Save. Transport/malformed/generic failures
remain uncertain, even beside a fresh state read; reads cannot prove the earlier
attempt rolled back or cannot settle later. There is no automatic mutation retry.
A failed reconciliation marks the previous authority stale and offers read-only
retry. Focus/broadcast refresh preserves drafts; lock, expiry, navigation and
session replacement clear them.

Complete summaries/preview/editing are unavailable if grants or catalog metadata
cannot be safely projected (512 editable rules; 2048 definitions/2 MiB metadata).
No omitted rules are treated as allow. Revocation and CLI recovery remain usable.
Sensitive values follow their actual stored definition IDs, including archived
ones; global/personal fields sharing a slug share rules. Revoke affects only the
selected instance. Issuance and rotation remain [CLI operations](MCP_LOCAL_SETUP.md);
no client configuration is written. The older exact-slug inspection/grant routes
remain compatible.

**Rename** edits the selected instance's current display name, with Save/Cancel
and an explicit read after a conflict or unconfirmed response. Duplicate names
remain separate instances; full IDs are shown in management and filter chips,
accessible labels, and expanded history. Names are plain text, trimmed and limited
to 64 UTF-16 code units before trimming, with no C0 controls (U+0000–U+001F) or DEL
(U+007F). The [installed CLI](INSTALLED_MAC_APP.md) has a stricter argument rule
that also rejects Unicode format characters, including joiner emoji; these names
can be set in the browser. Renaming also works for revoked
instances and never restores authority. Credentials, active MCP sessions, grants
and policy remain unchanged. Open grant snapshots require reinspection after a
rename. A lost reply is never automatically resubmitted: a fresh read reports the
present name, not whether that particular attempt committed.

**View activity** opens MCP Access filtered to the exact full instance ID; Audit
retains the same client filter when switching tabs or refreshing. Removing/resetting
or manually applying a different client filter updates the selected instance.
The fragment in the history link contains the instance ID, never its name or token.
The browser resolves current names for loaded history and visible preference
attribution in bounded batches, including revoked clients. A renamed client uses
its current name on older events; stored keys and snapshots are unchanged. Missing
or unavailable names fall back to full IDs, with a read-only retry. Returning to
the window refreshes names after CLI changes; management changes invalidate other
windows. Lock, expiry and navigation discard the page's private names and drafts.

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
Linux harness runs need a short temporary parent (normally `TMPDIR=/tmp`):
Chromium appends its Unix socket name to the owned temporary directory. The
sealed smoke uses the short `runtime/ui` child to stay within Linux's socket
path limit. Each generation owns a short `1` or `2` child there for its browser
temporary files. Each browser uses its private profile as HOME, keeping browser
caches outside the application HOME. The journal records the browser's exact
temporary path before launch; confirmed group reaping precedes removal. Failed
reaping, removal or journaling retains the existing private recovery boundary.
Startup failures expose fixed categories only; raw browser stderr
and private paths are not copied to gate diagnostics.

Source and relocated production smokes use synthetic state, pinned TLS inference
fixtures and authenticated Chromium. App policy checks restrict exact module
closures, listeners and model destination, including SQLite workers. Browser
routing confines page HTTP/WebSocket requests; it is not an OS-wide browser or
zero-egress claim. macOS arm64 and Linux CI evidence do not expand native model
qualification. Windows, LAN and installers remain outside Step 08.

The consolidated [human acceptance disposition](https://github.com/loyalagents/context-router/blob/7e8f1c5a90084ba6a5623bf48f3c1186fb64422f/docs/plans/active/local-migration/08-local-ui/acceptance.md)
records the completed 2026-10-04 user-run walkthrough and explicitly accepted
unverified observations. Its reusable checklist does not turn those observations
into independently passing tests. Use synthetic data and isolated client
configuration for future runs; Step 09 managed installation and native model
qualification require their own evidence and applicable authorization.

## Installed Historical Demo

The native app now owns a separate persistent historical demo store. Its
**Demo setup…** panel provides packaged generation/endpoint-bound A/B login and
launch commands plus C Desktop prepare/apply. No checkout or manual token/config
construction is needed for that flow. The existing source/manual recipes above
remain independent. See [installed demo mode](INSTALLED_MAC_APP.md#historical-demo-mode)
for lifecycle, explicit provider login, stale-command refusal, durable C snapshots
and the remaining human acceptance limits.
