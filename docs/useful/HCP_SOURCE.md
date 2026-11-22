# Synthetic HCP Source Dashboard

- Status: bounded C6 source experiment with activated [C7a synthetic MCP reads](../plans/active/hcp-alignment/c7-read-brief.md); final C7a review/validation is recorded in that brief.
- This command uses synthetic data only. Do not paste personal information or connect real assistants.
- This is separate from the installed Mac application, its documents, identities, models and client settings. It does not establish HCP conformance or complete the C6 roadmap.

Use Node **24.21.0**, pnpm **10.25.0**, the repository's frozen dependencies,
OpenSSL, and the existing Playwright **1.63.0 / Chromium 153.0.8010.12** prerequisite.
The commands never download dependencies or a browser. Build the backend once from
the source you intend to test:

```sh
pnpm check:toolchain
pnpm --filter backend build
```

Create a new, empty directory you own with mode `0700`, beneath a private parent.
Pass its canonical absolute path explicitly; `/tmp` on macOS is a symlink, so use
the canonical `/private/tmp` path. A suitable disposable example is:

```sh
umask 077
HCP_SOURCE_SANDBOX="$(mktemp -d /private/tmp/hcp-source.XXXXXX)"
pnpm --filter backend hcp-source initialize --sandbox "$HCP_SOURCE_SANDBOX" --port 9443
```

The initializer prints the complete synthetic fixture bundle, its digest, and a
prompt naming the Synthetic context subject. Read the bundle, then type exactly
`approve <displayed-digest>` to authorize that bundle as that synthetic persona.
The prompt expires after five minutes. Any other input, EOF, cancellation or
interruption leaves a private partial instance that cannot serve. Initialization
does not bind the port or open a browser. The readiness descriptor is published
only after approval and durable initialization finish.

Keep the printed sandbox path. The launcher reports the human credential **file
path**, never its value. Use the terminal to handle this directory: browsing it in
Finder can add `.DS_Store`, which the strict root inventory refuses. Do not delete
unexpected files to bypass admission.

On macOS, this user-run command copies the credential to the system clipboard
without printing it or putting its value in command arguments:

```sh
pbcopy < "$HCP_SOURCE_SANDBOX/launcher/human.credential"
```

Paste only into the owned browser's sign-in password field, then clear the clipboard
with `printf '' | pbcopy`. Do not paste the credential in URLs or chat messages.
These are manual instructions; the launcher does not access the clipboard.
Signing in establishes management identity. It does not authorize a content write.

Start the provider in one terminal, then open its browser in a second terminal:

```sh
pnpm --filter backend hcp-source serve --sandbox /absolute/private/sandbox
pnpm --filter backend hcp-source open --sandbox /absolute/private/sandbox
```

The provider listens only at `127.0.0.1` on the initialized port, with origin
`https://as.hcp.test:<port>`. The browser uses a dedicated profile, profile-local
trust for this instance's CA, and a resolver mapping to loopback. Ordinary CA,
hostname and certificate-expiry checks stay enabled. The launcher changes no OS
trust, hosts file, personal browser profile or installed application configuration.
`open --headless true` is available for owned automated source checks.

The `data/` directory contains only the strict HCP store and its ownership files.
`launcher/` holds the ready descriptor and stable private credential, `tls/` the
private fixture identity, and `browser/` the separately owned browser profile,
browser lease and browser-local files. Do not move, copy into, chmod, repair or
replace these files as a recovery shortcut. A/B registrations are fixed synthetic
clients with complete redirect URIs recorded in the descriptor; callback clients
are not launched in this journey.

The entry list shows every retained lifecycle state, including expired and
withdrawn/deleted entries. Inspect an entry to see content versions, current
lifecycle/classification, provenance, and human-readable history with expandable
full documents and audit events. A previous content version always carries the
current lifecycle/classification label; open the current version before editing.

The text editor accepts string-valued General Context with person-declared or
model-inferred assertions in active, conflicted, expired or deprecated states.
Other records remain inspectable and view-only in this editor. Review shows the
exact replacement, target version, selected purpose, deadline and retained
principal restrictions. The revision becomes a new person-declared assertion:
evidence, prior assertion basis/purposes/deadline and confirmations are not inherited.
Unknown content members are preserved without gaining assurance. Cancel returns
to the list without a content write; approval grants one exact, short-lived write.

Use **Inspect the entry and history** after saving. If a response is lost, do not
repeat the mutation to guess whether it committed. Make a separate authenticated
inspection of current state and history. Reopening always starts a fresh GET of
the entry list; it never resubmits a pending form. Existing valid sessions/reviews
keep their original deadlines and bindings, and expired sessions require sign-in.
Any new correction needs a new exact review. Existing bounded recovery of an
original reviewed request keeps its original operation key and authority checks.

Press Ctrl-C in the browser terminal to stop it; the provider remains running.
On macOS, Cmd-Q requests Chromium Quit. Closing its last window is not a guaranteed
process shutdown; visible window behavior remains part of the human retest.
Ctrl-C or SIGTERM during browser startup requests graceful close after the bounded
startup settles; repeated signals do not abandon its ownership proof. Allow that
cleanup to finish. Genuine launch failure still refuses conservatively.
Press Ctrl-C in the provider terminal to close it. Browser close uses
the pinned Playwright 30-second graceful-close bound, then its owned process-group
kill and child reaping. After a protocol disconnect, a separate five-second
monotonic deadline allows the event loop to observe that the recorded browser PID
is absent. The browser lease stays held during this wait; no signal is sent using
that recorded PID. Only stopped-process proof publishes a closed lease. Refusal
prints a bounded message and preserves the ownership record. A rejected launch
without a returned context and stopped-process proof retains its unproven startup
record, including when the profile was previously trusted.
This slice has no supported browser recovery from that unproven startup record,
even if its processes later disappear. Preserve the sandbox and retained store
for diagnosis; a new experiment requires a new empty directory. This refusal does
not erase the store or authorize deleting profile/lock metadata.
Store and browser ownership are separate. A second live
owner refuses. After an unclean stop, recorded controller/browser processes must
be proved stopped; reused PIDs or a partial/unproven browser startup refuse.
Never delete a lock, ownership row or SQLite journal to force reopening.

Reopen with the same `serve` and `open` commands. There is no create-on-open,
alternate-port fallback, reset, migration or automatic credential/TLS rotation.
The fixture certificate lasts seven days; an expired instance refuses rather
than regenerating identity. Missing/changed descriptors, credentials, registrations,
TLS files, roots or store identity also refuse. Preserve that sandbox for diagnosis;
a new experiment uses a new explicitly selected empty private directory. There is
no launcher deletion/disposal command.

The existing experimental grant/revoke, confirmation/conflict, classification,
rules/directives, disclosure/audit and v2 transfer pages remain reachable with their
existing C5 limits. Hard deletion is unavailable; withdrawal retains history and
is not erasure. Legacy GraphQL/MCP/local-admin, uploads/document analysis, PDFs,
profile/schema/location workflows, reset, history clear and old prompt/export/eval
paths are absent from this source composition. No model executes here. Broader
import standing/history, notifications/reporting, OAuth/dormancy, real hosts,
installed delivery and full package/profile qualification remain outside this slice.

## UI Contributor Handoff

Start with the initialization/serve/open commands above; **do not use `pnpm dev`**.
The source dashboard is provider-rendered HTML at `/manage/entries`, not the Next.js
app. Only the backend build is needed for these views. Keep `serve` and `open` in
separate terminals; after a source edit, stop the owned provider, rebuild, and
serve the same explicitly selected sandbox. Do not initialize it again. A closed
browser can be reopened with the same `open --sandbox` command. These are manual
source commands, not installed-app controls.

The first demo keeps the existing correction flow:

1. Sign in, then choose **Memories**. All retained states are visible; open a
   memory to inspect its content, current lifecycle and immutable versions.
2. On a supported current text entry, choose **Edit as your own statement**.
   Enter synthetic text and choose **Review my statement**.
3. Read the exact proposed text and replacement effects, purpose and deadline.
   **Cancel without saving** leaves the content unchanged. Only the person's
   **Approve and save my statement** act authorizes the exact write.
4. From a committed result, choose **Inspect the entry and history**. Version
   links show historical content with current lifecycle/classification labels.
5. Choose **Grants** to inspect active or all retained grants, their approved
   actions, categories, purposes, deadlines and history. Registration alone grants
   no access. Add/create and other existing experimental management controls stay
   under the expandable section on this page; they are outside the correction
   demo's human acceptance.

Pages use normal browser loading and form navigation, with no client JavaScript,
background requests or automatic retries. A denied/stale review requires separate
inspection and a fresh review. A server failure after submission can leave the
outcome uncertain: do not resubmit to test whether it committed. If the browser
loses the response entirely, use **Memories** or reopen the browser for a fresh GET,
then inspect current state and history. A known committed result with withheld
details still says committed; it does not invite another save.

### Small View And Action Contract

The UI owner can edit
[`management-presentation.ts`](../../apps/backend/src/infrastructure/hcp-experiment/management-presentation.ts)
and focused presentation/browser assertions. It holds CSS, escaped HTML and small
structural input types. It receives admitted snapshots and explicit form fields;
it never opens a store, authenticates, creates authority, generates operation keys,
performs requests or sends responses. Unknown stored members remain inspectable
in expandable full documents, without acquiring assurance.

| View | Data supplied by the HTTP owner | Supported action |
| --- | --- | --- |
| Memories | `managementEntries`; HTTP-computed text-editor eligibility | GET `/manage/entries/:id` |
| Entry and history | `managementEntry`, `audit`, current/selected versions and session CSRF | GET version/history links; existing reviewed actions |
| Text editor | Current supported entry and CSRF | POST `/manage/person/review`: `csrf`, `entryId`, `expectedVersion`, `value` |
| Exact review | Previous entry, `reviewPersonWrite` result, subject, CSRF and generated operation key | POST `/manage/person/approve`: `csrf`, `reviewId`, `reviewCsrf`, `operationKey`; cancel is a GET |
| Saved | Only the representation supplied inside `releaseWrite`, possibly without an ID | Separate GET inspection; no replay |
| Grants | `listGrants`, last possible copy deadlines and filtered `audit` | Existing inspect/all/revoke routes, with unchanged authority |

[`http.ts`](../../apps/backend/src/infrastructure/hcp-experiment/http.ts) remains
owned by the integrator for route/body validation, eligibility enforcement,
session/origin/CSRF checks, exact request construction, authority calls and final
render/release checks. The presentation eligibility flag only controls a link;
it cannot authorize an edit. No route/API framework, shared client cache or legacy
GraphQL adapter is needed. Coordinate changes to these contracts before overlapping
UI and future C7 work; keep one writer for shared routes/authority and separate
resources for independent runtime work. `authority.ts`, schema, launcher and browser
ownership are outside presentation-only ownership.

Focused verification after a backend build uses the existing tests:

```sh
node --test --test-concurrency=1 apps/backend/test/local-database/hcp-experiment/dashboard.test.cjs
node --test --test-concurrency=1 apps/web/test/hcp-source-browser.test.mjs
```

The automated tests create and approve their own disposable synthetic fixtures;
that is automated test evidence, never a person's fixture/content approval or
human acceptance. Keep the pinned toolchain/browser prerequisites and run affected
OAuth/governance/portability consumers when changing shared management presentation.
The [validation policy](AGENT_WORKFLOW.md#validation-and-context-discipline) governs
final review/CI; source UI evidence does not qualify the installed Mac app.

## Controlled MCP Read Checks (C7a)

The isolated provider exposes `/v2/mcp` over its existing verified HTTPS identity.
Only `hcp_queryContext` and `hcp_getEntry` are implemented. It speaks MCP
2026-07-28 with per-request metadata/headers and authorization, public static
`server/discover`, and protected `tools/list`/`tools/call`. It issues no MCP session.
The experimental discovery reference makes no HCP conformance claim; three methods
do not establish complete MCP or Provider/Agent Interop qualification.

After the exact toolchain check and backend build above, run the controlled tests:

```sh
node --test --test-concurrency=1 apps/backend/test/local-database/hcp-experiment/mcp.test.cjs apps/backend/test/local-database/hcp-experiment/mcp-parity.test.cjs apps/backend/test/local-database/hcp-experiment/mcp-release.test.cjs apps/backend/test/local-database/hcp-experiment/query-json.test.cjs apps/backend/test/local-database/hcp-experiment/read-wire.test.cjs apps/backend/test/local-database/hcp-experiment/read-contract.test.cjs
```

The `mcp.spec.ts` wrapper includes this coverage in existing local-database/CI
qualification without changing routing. Tests create their own synthetic OAuth
A/B clients, TLS identities and SQLite roots and clean up owned resources. The
test peer is exactly `@modelcontextprotocol/client` 2.4.0, with
`versionNegotiation: {mode: {pin: "2026-07-28"}}`. Fixture-local name resolution
and CA verification change no OS trust, personal client or model. The provider
does not import the SDK peer; unrelated legacy SDK resolutions remain unchanged.

Both interfaces share selection, projection, Core/disclosure result validation,
final authorization and durable `context.read` auditing. Invalid retained results
fail only that request without a read audit or global store latch; management and
revocation remain available. Unexpected serializer/storage/audit faults retain the
existing fail-closed latch. Entry, classification, directive and import admission
also checks Core shapes. New mutation, import and fixture admission rejects
top-level evidence-item `revealed`, which this slice reserves for provider
disclosure metadata. Query/get projection omits that member from retained evidence
without rewriting storage; nested opaque fields and other unknown evidence fields
remain intact. This slice performs no credential derivation. Previously committed
mutation retries preserve their original stored response bytes; this projection
rule applies to query/get, not those durable receipts. MCP serializes its complete envelope and
both content representations before commit. Final handoff is synchronous;
interrupted committed attempts remain `attempted`/`unconfirmed`. A separate read
is a new authorized retrieval, never automatic replay. HTTP query and MCP accept
bounded UTF-8 JSON and reject duplicate decoded member names at every depth
(32 KiB body, at most 64 nested objects/arrays, including empty containers).
OAuth/human forms are unchanged.

Omitted categories expand to all purpose-approved categories and fail if a
standing rule denies any; explicit empty categories return an audited empty
result. Missing/private/foreign/withheld refs have the same generic tool denial.
Request categories must match Core syntax. Request-only grant denials use a
host-visible challenge, with scope hints restricted to requested advertised read
scopes; unknown valid category identifiers add no scope hint. Stored-policy denials
never challenge. Calls are limited to 60 per registered client per 60-second
monotonic window, shared across that client's grants/tokens and reset on process
restart. Governance/revocation is outside this limiter.

One integrator owns `http.ts`, `authority.ts`, `disclosure.ts`, `mcp.ts`,
`mcp-contract.ts`, `core-contract.ts`, `request-json.ts`, schemas and shared fixtures. Bundled Core
schemas come from normative revision `2e2939c9bebcefb3bed7bb3522231c0e4d65a315`;
source IDs are retained and descriptor references are local. Runtime/build never
reads the sibling repository or fetches schemas. Preserve structured/text equality,
hidden-entry denials and the whole-envelope release boundary.

Actual host configuration/model use requires separate C7b activation naming the
exact Claude Code executable/version, fresh localhost TLS/profile/port and
registration, temporary read-only consent, host-held OAuth delivery inaccessible
to model tools, synthetic prompt/destination and human evidence. Never reuse the
retained C6 human sandbox or A/B credentials. Controlled checks establish no
installed-artifact, human host, copy/directive enforcement or full HCP claim.
