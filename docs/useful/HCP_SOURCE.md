# Synthetic HCP Source Dashboard

- Status: bounded C6 source experiment; implementation checks and independent review are recorded in the [active brief](../plans/active/hcp-alignment/README.md#c6-implementation-activation-2026-11-15).
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
