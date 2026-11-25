# C7b Isolated Claude Code Trial

- Status: merged in PR #217; bounded implementation and November 25 live query/get, scope-denial and explicit-revocation/read-denial trial complete. Owned processes stopped and retained HCP grants revoked; final CI and broader qualification are separate.
- Implementation owner: C7b chat `01a200ed-ae48-78f0-a7a6-31fa72e895d6` retains its worktree and trial evidence; orchestrator `01a1b827-ae7c-7b23-9160-d7b69d0ee2b0` retains sequencing. Earlier sole-writer/publication wording below records the completed assignment.
- Checkout: `/Users/lucasnovak/.codex/worktrees/25a5/context-router`, branch `codex/hcp-c7b-host-trial`, clean starting base `7381ba9d70a9d3597543ae033451920631fab028` (merged C7a, PR #212).
- Requested coordinator/writer and boundary reviewer: Astra/xhigh. Chat creation requested `gpt-6-astra`/`xhigh`; actual execution settings are unverified.
- Target: HCP `2.0-draft-3`, normative `2e2939c9bebcefb3bed7bb3522231c0e4d65a315`, adoption baseline `b764a058eac15a4cd843892e60473089b2e835bb`. No target adoption or upstream change.
- Parent: [C7a contracts and evidence](c7-read-brief.md), [alignment](README.md), [source runbook](../../../useful/HCP_SOURCE.md).

## Completion And Merge (2026-11-25)

Lucas merged [PR #217](https://github.com/loyalagents/context-router/pull/217),
final head `318a2793de44674fd669997710f01b9a18f79e37`, as
`609b00c49a470cf9d15a7db6528ab28d34a91bb8`. The successful separately authorized
Claude Code 2.1.299 / Sonnet 4.6 repeat verified the allowed synthetic query, get
using the exact returned ref, `work_context` scope denial and denied access after
explicit human revocation. Semantic receipt and provider audit agree. The earlier
failed get and observer repair remain part of the evidence below.

The owned host/browser stopped and all retained HCP grants were revoked; this
does not assert revocation of the separate subscription token. Preserve the trial
roots and receipts. No additional live run is needed for the bounded milestone.

At handoff, standard CI, desktop-native, UI and packaging qualification had passed,
while [source qualification](https://github.com/loyalagents/context-router/actions/runs/45695052287)
was still in progress. This completion record does not recheck or assert all-green
final CI. Earlier pending-publication/execution statements are historical;
implementation and live acceptance are complete, while broader HCP, installed-app
and personal-data qualification remain outside this result. The next planned
checkpoint is [C7c](README.md#c7c-activity-and-permission-visibility), with separate
activation and ownership; C8/C9 obligations remain unchanged.

## Outcome And Isolation

Demonstrate one real Claude Code host reading an allowed synthetic entry through
direct HTTPS `/v2/mcp`, getting that entry by its grant-relative ref, receiving a
narrow-scope denial, and being refused after revocation without automatic replay.
Automated host exercises against a fake local model service precede any off-device
trial and are identified separately from human/model evidence.

Own only this checkout and newly created private temporary resources. The installed
app, primary checkout, other agent's non-HCP demo, personal client settings, existing
C6 human sandbox and all model assets stay untouched. No shared demo launcher or
connection code is in scope. HCP-only source/authority/composition changes belong
to this writer. Any later overlap with demo code returns to the orchestrator before
implementation. One cohesive implementation unit; no merge, release or publication
in this activation.

## Verified Host And Proposed Boundary

On the measured arm64 macOS 15.1.1 (24B91), the default executable points to 2.1.330.
The proposed version remains installed and was invoked directly with `--version`:
`/Users/lucasnovak/.local/share/claude/versions/2.1.299` → `2.1.299 (Claude Code)`.
SHA-256: `ba5ab7b8c195fa03ab8d5bf3915c76153b576a2c40e79a5c46e265e7ed9744b3`.
Pin this absolute binary and digest; do not update or silently substitute versions.

Its `--help` supports `--bare`, `--tools ""`, `--strict-mcp-config`,
`--setting-sources`, `--disable-slash-commands`, and `--restricted`. Official
[runtime documentation](https://code.claude.com/docs/en/mcp#mcp-client-runtimes)
supports explicitly selecting `MCP_SDK_GENERATION=v2` and
`MCP_PROTOCOL_NEGOTIATION=auto`; wire evidence must still show 2026-07-28.
[CA documentation](https://code.claude.com/docs/en/network-config#custom-ca-certificates)
supports process-scoped `NODE_EXTRA_CA_CERTS`. Host flags and documentation are
feasibility evidence only.

Use a new profile with issuer/resource `https://localhost:19443`, bound only to
127.0.0.1; exact Host/Origin checking stays enabled. A busy port refuses. A fresh
seven-day CA and leaf certificate have DNS SAN `localhost` and IP SAN `127.0.0.1`; no OS trust/DNS/hosts
change. The TLS identity, issuer, resource and registration are immutable on reopen.
The existing `as.hcp.test` profile and its descriptors are not converted.

Register only `claude-code-c7b`, display name `Claude Code C7b synthetic trial`,
operator Anthropic (`https://www.anthropic.com`); no directive-following claim,
notification endpoint or asserted legal-retention exemption. The HTTPS callback
is `https://127.0.0.1:19444/callback`, also loopback-only and covered by the private
CA. The distinct cookie host prevents provider cookies reaching the callback; a real
browser test must verify this and preserve management access. The source browser
may allow only this descriptor-pinned callback URL and POST method beyond the
provider origin; no general allow-origins option. No A/B registration or grant is reused. Native Claude OAuth uses an HTTP GET
callback; the existing provider deliberately accepts HTTPS `form_post` only.
Prefer a bounded OAuth helper that preserves the existing Code + PKCE flow and
passes the resulting temporary credential to the direct HTTP host. The helper is
an HCP integration, not an MCP bridge or a second read path. If this cannot be
implemented with a demonstrable credential boundary, retain the preparation and
return the concrete blocker; do not relax authority or TLS.

The helper holds PKCE verifier/state/code/token in memory, validates callback
method/path/Host/Origin, size, duplicate fields, state and issuer, exchanges the
code once over verified HTTPS with the exact resource, and never prints secrets.
It presents the existing human login/review/consent in an owned browser. It cannot
approve a live fixture or grant on the human's behalf. Temporary read-only access:
`general_preferences`, purpose `https://example.test/purpose/synthetic-review`,
15 minutes, no persistence/refresh/write/onward permission. Grant revocation is a
separate explicit human act through management; the host gets no management secret.

Claude runs in a fresh empty working directory and dedicated `CLAUDE_CONFIG_DIR`,
with an allowlisted environment, explicit MCP config and no built-in shell/file/
code/web/subagent tools, skills, hooks or auto-memory. The user prefers Claude
subscription access. Prefer a newly minted subscription `setup-token`, supplied
privately through an inherited pipe and then `CLAUDE_CODE_OAUTH_TOKEN`; personal/demo
login is never copied. [Anthropic documents](https://code.claude.com/docs/en/authentication#generate-a-long-lived-token)
that this token normally lasts one year, is printed by the setup command rather
than saved, and supports local MCP servers. Token acquisition is a separate human
action after explicit live approval; do not run it through a captured Codex
terminal or paste its output into chat. `--bare` does not support this token.
A separate API key with `--bare` is a fallback, not a prerequisite now.

For subscription mode, OS confinement must independently deny personal-home
reads/writes (except the pinned executable), Keychain Mach services, child-program
execution and network access beyond the explicit local endpoints. `--restricted`
and an empty settings-source selection are additional controls, not a substitute.
Fail closed if inherited managed settings or helper/plugin/hook sources cannot be
excluded without overriding organization policy. Independently test the sandbox
and missing/invalid-token refusal before live use. No automatic login or auth fallback.
The host may receive the HCP token in its private environment only after tests
prove no model capability can access it. Environment/profile separation by itself
does not establish this boundary. No debug logging; inspect owned host outputs and
files for canary secrets in automated tests. Any unexpected tool, secret exposure,
personal-state read, or automatic authority recovery stops the trial.

The independent subscription-boundary review approved tests-first helper work,
subject to a messages-only local relay. Keep the real subscription token only in
relay memory; give the host an unrelated per-run OAuth-shaped relay credential.
Read and close FD3 before child launch. Fully buffer and validate each bounded
JSON request, unique decoded fields, exact method/path (including the observed
`?beta=true` SDK query), allowed headers/tool inventory/model and secret absence
before opening an upstream connection. Reconstruct headers to the fixed HTTPS
Anthropic destination. Buffer the bounded response to verify complete SSE before
delivery; retain no credential-bearing transcript. Admit one request at a time.
Any failed/uncertain response, disconnect, timeout, redirect, overflow, retry or
unexpected endpoint irreversibly closes the run and aborts the owned host. Never
broaden egress to accommodate profile or policy discovery.

The helper must inspect the actual token and its own-grant response before launch:
temporary, active, exactly the requested read category/purpose, expiry at most 900
seconds and no refresh token. The existing consent UI defaults to four hours and
offers persistence; an incorrect human selection refuses launch rather than being
silently narrowed. Atomically consume the callback transaction before its single
code exchange, with a five-minute deadline and no retry after an uncertain exchange.

## Exact Proposed Synthetic Content And Prompts

The new profile's fixture contains two active, person-declared General Context
entries with no evidence, extensions or real person identifiers. Both allow only
the synthetic-review purpose. The initializer displays the whole actual bundle
and digest for the human's exact approval; this brief is not that approval.

| Category              | Content                                                         |
| --------------------- | --------------------------------------------------------------- |
| `general_preferences` | `Synthetic C7b persona prefers a concise written summary.`      |
| `work_context`        | `Synthetic C7b persona uses the project codename Blue Lantern.` |

For the later bounded trial, destination is Anthropic's Claude API at
`https://api.anthropic.com`, using the pinned Claude Code process and a newly minted
Claude subscription token. Select `claude-sonnet-4-6`, which the official
[model status table](https://platform.claude.com/docs/en/about-claude/model-deprecations)
lists as active. Initial fake tests used 4.5; that identifier is deprecated and its
API retirement is scheduled for November 30, 2026. Renew host/relay evidence on 4.6
before the live packet. No silent model fallback. Only synthetic
prompts, admitted tool definitions/results/errors and ordinary host protocol
metadata may leave the machine. No claim of external deletion, recall, retention
enforcement or directive enforcement is made.

1. `This is a synthetic HCP trial. Call hcp_queryContext once with query "concise written summary", categories ["general_preferences"], purpose "https://example.test/purpose/synthetic-review", maxEntries 1. Then call hcp_getEntry once using the returned ref and the same purpose. Summarize the result. Do not call other tools or retry a failed call.`
2. `Call hcp_queryContext once with query "project codename", categories ["work_context"], purpose "https://example.test/purpose/synthetic-review", maxEntries 1. Report the denial. Do not retry, reconnect, request authorization, or infer the withheld value.`
3. After the human revokes: `Make one new hcp_queryContext request for "concise written summary" in ["general_preferences"] with purpose "https://example.test/purpose/synthetic-review". Report whether access was denied. Do not retry or request authorization. Do not reuse earlier results as evidence of current access.`

Prompt instructions are not the enforcement boundary. The provider independently
checks every call; tests observe actual requests, retries and model-visible tools.

## Checkpoints And Acceptance

1. Independently review this authority/transport/credential plan before runtime
   edits. Verify base, host, official capability references and C7a CI receipt.
2. Tests first: new source profile, one distinct registration and minimal fixture;
   exact identity/reopen/refusal, old-profile unchanged, TLS SAN/expiry/trust,
   cross-profile/client/resource/callback denial and no silent reset. Implement
   only the selected profile/composition/authority seams; run focused tests after
   each behavior change.
3. Build a fake Anthropic endpoint and controlled OAuth/client probes with fresh
   canary secrets. Run the exact host offline against that endpoint, observe tool
   inventory, malicious attempts to call absent shell/file/code tools, complete
   model request bodies and retained outputs. Exercise actual-host trusted CA,
   untrusted CA, wrong hostname and expired leaf; record wire revision, query/get,
   scope and revoked denials, restart and no automatic replay. No live model or
   provider login is allowed during these checks. Use bounded timeouts and stop
   only owned processes.
4. Resolve findings, freeze a candidate, run focused target-Mac checks and a fresh
   independent complete-diff review. Produce a concrete live consent packet with
   actual paths/ports/binary/model/data/prompts/destination/processes and retention.
   Only then request the missing exact human fixture/grant and off-device/model
   authorization. Live trial results or a demonstrated blocker complete the handoff.

Use Node 24.21.0 / pnpm 10.25.0 and independently installed frozen dependencies.
Relevant [validation-policy](../../../useful/AGENT_WORKFLOW.md#default-and-exceptions)
rows are runtime, Mac process/filesystem/TLS and documentation. Required focused
coverage includes source, authority, OAuth, MCP and affected source-browser tests;
links, maintained readers, contract baseline and whitespace. Exact-candidate CI
remains required at authorized publication. No named aggregate evidence gap selects
the full local migration gate; no installed artifact is delivered.

Keep provider, callback, browser and host process ownership explicit. Ctrl-C stops
the owned trial process tree, closes listeners and releases leases; verify stopped
processes before reopen. Preserve provider data/audit and human-trial profile/log
roots for review; no silent disposal or credential-file deletion. Automated
disposable fixtures can clean only their own recorded roots after process reaping.
Temporary access expires and can be explicitly revoked; a stopped host does not
prove Anthropic discarded already transmitted data. Interrupted reads remain
attempted/unconfirmed; never replay automatically.

Pinned §18.3 still requires complete Provider Interop for an independently operated
host; experimental/no-claim wording does not satisfy it. C8 owns protocol fixes
and explicit CR adoption; C9 owns completion/qualification. D3 erasure precedes any
personal data and CR-Q9 resolution/adoption precedes sensitive real data. Capture
findings locally; `hcp-spec` stays unchanged locally and remotely.

## Preparation Evidence

C7a standard/native run `44971592540` and migration run `44971592545` completed
successfully for head `48927bf947c8d293dbcce7c229a8ed609299011b`. The aggregate
job log verifies all three finalized lane receipts, base
`f92260060152b6872b5732587027bd161bc4f590` and test merge
`420adfe71eaf737c9e5881f308eae6672ec74ee8`; the PR body retains older pending
wording. This is C7a evidence, not qualification of new C7b inputs.

The independent plan reviewer identified cross-port cookie sharing in the initial
localhost callback proposal. Corrected to an IP-host callback with explicit TLS
SAN and a required real-browser no-cookie regression; no runtime edits preceded
this review. Requested reviewer `gpt-6-astra`/`xhigh` was accepted by the delegation
tool; actual execution remains unverified.

The subscription helper/relay plan received independent approval for tests-first
implementation, with pre-forward body validation, one-use callback, actual-grant
validation and permanent failure latching. The direct fake endpoint exposed two
model requests after a synthetic 401; retain this finding. Relay tests must prove
only one upstream send on 401, dropped transport and partial response despite the
host's retry behavior. Private-CA/untrusted/wrong-host/expired-leaf checks use the
actual pinned host. A separate native probe exercises the same Mac sandbox;
unsuccessful Keychain lookups are not denial evidence for services absent on the
machine. Exact return codes are retained.

The first complete-diff review (23 changed/untracked files, manifest digest
`1e3a964c2bd7a1a069f40b994159da34d5c92bcb38a6ef995121550402da39d8`)
found four helper-only blockers: readline Ctrl-C handling, cancellation during
browser startup, forced-stop timing relative to cancellation, and a substring-only
SSE completion check. The correction batch wires terminal SIGINT/closure to abort,
checks startup transitions and refuses an already-aborted launch, starts the
five-second SIGKILL deadline at stop, and parses actual SSE framing/event order,
block indexes, model identity and final completion before delivery. Errors and
unsupported events fail closed. Tests reproduce the reviewer findings; affected
review and actual-host fake-service evidence are renewed before live approval.

Focused backend build and **26 HCP suites / 266 Jest tests** passed, including
source, authority, OAuth, MCP, persistence/recovery and isolation wrappers. The
source-browser suite passed nine tests; its unchanged expired-certificate fixture
failed under macOS LibreSSL's rejection of `-days 0`, then passed using the installed
OpenSSL 3 prerequisite. All ten browser cases are covered without assertion changes.
Markdown links (164 files), exact-base contract comparison (41 capabilities,
58 consumers) and maintained documentation/CI-routing readers (38 tests) passed.
The helper correction tests passed **8/8**, including a real child ignoring SIGTERM
that was killed and reaped after five seconds. Source/authority/browser inputs are
unchanged by that batch; their coverage carries forward. Helper checks and offline
host/relay checks are renewed on the corrected files. These are focused target-Mac
results, not a full migration run, installed artifact qualification or candidate CI.

The independent reviewer closed all four findings on the corrected candidate
(reviewer's sorted 23-file manifest digest
`b68373bc38a717205f393f0a1da2598cf2bf718db5c5c32db68021693fd69791`).
Corrected helper plus real-provider integration passed **14/14**. All ten actual-host
fake-service scenarios passed on `claude-sonnet-4-6`: the three-turn positive case
made nine model requests and exactly four MCP calls with statuses **200/200/403/401**
at protocol **2026-07-28**; CA/hostname/expiry failures exposed no HCP tools or HTTP
requests; missing credentials made no model request; rejected credentials, dropped
or partial responses, misleading SSE and SSE errors each latched after one upstream
send. Model payloads, non-auth headers, outputs and retained host files passed the
synthetic secret checks. Native confinement and setup-policy parsing passed, with
Keychain service lookups returning 1100. Logs are retained under
`/private/tmp/hcp-c7b-host-*.log`, `/private/tmp/hcp-c7b-corrected-helpers.log`,
`/private/tmp/hcp-c7b-final-backend.log`, `/private/tmp/hcp-c7b-final-browser.log`
and `/private/tmp/hcp-c7b-browser-expiry-openssl3.log`; each host log names its private
receipt root. Formatting and whitespace passed. This evidence-only paragraph does
not change reviewed runtime/test inputs. **Targeted checks passed; final validation
pending.** No live login, model request, human fixture/grant approval, commit, push,
merge or installed artifact was performed. `hcp-spec` remains clean and unchanged.

## November 24 Setup Callback Repair

Lucas initialized `/private/tmp/hcp-c7b-human-yQzZiq` successfully after approving
the actual fixture digest
`0599ad5545adb21d187626e325d7ce0c5fdceb57587a314bedb6535b0fc2a7bd`.
Preserve this instance; do not rerun initialization. His first private-terminal
token setup stopped with the native callback's port-0 startup error, before an
authorization URL or token. Its root is retained at
`/private/var/folders/pn/rnjt7b1d5xb4pckyss2s55qc0000gn/T/hcp-c7b-subscription-N8M3hh`.
The prior parser-only setup check missed actual listener startup.

A tests-first native regression reproduced `bind(127.0.0.1:0)` returning `EPERM`.
Setup alone now admits IPv4 inbound sockets. Seatbelt's `localhost` matcher also
admits wildcard/assigned interface binds; it cannot enforce the desired loopback
address. Native tests record that limitation, consistent with
[Bazel's measured implementation findings](https://bazel.googlesource.com/bazel/+/696734cfd3d338d04a885fa65b996ece43fe365c%5E!/).
The effective address restriction is the hash-pinned, non-model `setup-token`
process binding its socket to **127.0.0.1**, verified with the actual binary.
The parent checks listeners and descendants every 500 ms, stops on any unexpected
address/multiple listener/descendant/inspection failure, and requires startup
within 30 seconds. This monitoring detects regressions; it cannot prevent an
exposure between checks. The human must wait for **Callback verified** before
opening the URL. Normal callback closure is allowed; the ten-minute process bound
and owned process-group cleanup remain in force.

The independent plan reviewer approved this revised boundary after the original
kernel-enforced bind proposal proved unavailable. Requested Astra/xhigh; actual
runtime unverified. No new login authority is requested: the original bounded
subscription approval applies. Home/provider/Keychain/program-execution controls
remain; the model-host policy is byte-for-byte unchanged. Native and exact-CLI
startup checks cover this setup change; previous provider, browser, relay and
model-host evidence carries forward only for their unchanged behavior. Final
candidate CI and live login/grant/model acceptance remain outstanding.

Focused results: helper suite **10/10**; native confinement and real listener/
descendant inspection passed. The final offline pinned-CLI receipt at
`/private/var/folders/pn/rnjt7b1d5xb4pckyss2s55qc0000gn/T/hcp-c7b-setup-offline-0DfU8T/receipt.json`
records four periodic inspections, one exact 127.0.0.1 callback, a local HTTP
response and verified listener closure. It contains no authorization URL, state,
token or transcript. No browser action or external request occurred. The normal
model policy matched the prior native receipt byte for byte, SHA-256
`9a021d549fe567102a7b284651800cb473beadf7bb5514b6e42789ee46254875`.
Markdown links passed for 164 files; all 58 document/routing checks passed across
the run and one focused rerun after correcting the subprocess PATH to Node 24.
Formatting and whitespace passed. The prior complete-diff reviewer found no
blocking issue in the affected setup boundary. **Targeted checks passed; final
validation pending.** Offline startup is not successful subscription login or
token-handling evidence; the human retry supplies that next checkpoint.

## Approved Live Packet — Bounded Live Trial Passed

### November 25 Authorized Repeat — Passed

After the semantic-check repair and independent review, Lucas explicitly requested
one further bounded trial. He reused the existing isolated subscription token and
initialized synthetic source, approved a fresh temporary grant, and entered
`scope` and `revoked` at the prescribed checkpoints. No new fixture, broader
permission, changed prompt, automatic recovery or additional trial was introduced.
The complete terminal transcript was supplied by the human; the coordinator also
verified the retained receipt and read-only provider audit rather than relying on
the model's narrative.

Receipt:
`/private/var/folders/pn/rnjt7b1d5xb4pckyss2s55qc0000gn/T/hcp-c7b-live-host-k1pyUA/receipt.json`.
SHA-256: `316da8e157f1c2e6b0f469eff51014962969d13df9c6d6eceffe0202f2c26335`.
The pinned Claude Code **2.1.299** host used **claude-sonnet-4-6** and MCP
**2026-07-28**. It exited **0**, with empty stderr, three successful model-turn
results, no control requests, and **7** unique upstream model requests. The relay
was not failure-latched at receipt capture. Only the two approved MCP tools were
advertised. The wire contains one discovery, one tool list and exactly four calls:

| Checkpoint | Verified provider result |
| --- | --- |
| Allowed query | HTTP 200, semantic success, exactly one expected synthetic preference |
| Direct get | HTTP 200, semantic success, request and response refs both exactly match the query ref |
| Out-of-scope query | HTTP 403, `scope-denied`; no successful disclosure |
| New read after manual revocation | HTTP 401, `invalid-token`; no successful disclosure or automatic authorization recovery |

The provider audit binds both successful disclosures to the new grant and
`claude-code-c7b`, with the exact synthetic-review purpose. It records:

- Grant issuance at **20:08:49.257Z**, temporary read-only `general_preferences`,
  scheduled expiry **20:23:36.266Z**, within the approved 900-second bound.
- One-entry reads at **20:08:54.691Z** and **20:08:59.309Z**.
- Explicit management-client revocation of that same grant at **20:09:46.388Z**,
  before expiry. The wrapper separately checked its revoked status before the
  final prompt; the final model turn completed at **20:10:13.212Z** with wire 401.
- A second management-client action at **20:09:53.006Z** revoked the earlier
  already-expired trial grant. No successful read was audited after revocation.

Read-only closeout found all three retained grants revoked, the owned browser
lease `closed`, no listeners on 19443/19444, and no process using the new host's
owned working directory. The shell prompt returned normally. Retain both live
receipts and the provider/audit; do not publish raw assistant/thinking streams or
credential files. The human should clear the shell token variable and clipboard
with the existing cleanup commands. Subscription-token revocation is distinct
from HCP grant revocation and is not claimed here.

Runtime/test hashes match the independently reviewed candidate. The prior **25/25**
focused cases, **5/5** wrapper cases and three native fake-model scenarios carry
forward unchanged. This closeout changes evidence/status prose only; Markdown
links passed **164** files, affected readers/CI-filter tests passed **58/58**, and
whitespace checks passed. An independent read-only review verified the receipt
hash, wire outcomes, audit/grant correlation and stopped ownership, found no
blocking issue, and corrected one stale pending-status sentence. Requested
reviewer setting was Astra/xhigh; actual execution settings remain unverified.
The bounded C7b live journey has passed. At this pre-publication handoff, source
publication and exact-candidate CI remained with the orchestrator; the later
[merge record](#completion-and-merge-2026-11-25) supersedes that publication status.
No installed artifact, broader C6/C7 capability acceptance, HCP conformance,
remote-copy deletion, personal-data extension or C8–C9 execution is implied.
The earlier failed attempt and preparation checkpoints below retain
their historical scope and are superseded only for current live-trial status.

### November 25 Partial Live Result — Stopped

The human approved the temporary `general_preferences`/synthetic-review grant.
Its displayed expiry was `2026-11-25T19:43:00.829Z`. The provider recorded issuance
at `19:30:02.772Z` and automatic expiry at `19:43:03.998Z`. It expired before the
human could perform the requested manual revocation; the empty active-grants view
was correct. Do not count expiry as the planned manual-revocation checkpoint.

Retained receipt:
`/private/var/folders/pn/rnjt7b1d5xb4pckyss2s55qc0000gn/T/hcp-c7b-live-host-p9v0Ao/receipt.json`.
It records **three** upstream model requests, no relay failure latch, MCP protocol
**2026-07-28**, and HTTP **query 200 / get-entry 200**. These HTTP statuses do not
establish tool success: query succeeded, but get-entry returned MCP `isError=true`
with `scope-denied`. Claude inserted one extra `J` into the opaque reference when
copying the query result into its get-entry argument. The provider correctly
rejected the different, unknown reference. Do not broaden the grant, normalize or
repair the ref, or treat the model's separate-query/get-permissions explanation
as authoritative. Both operations are available under the intended read grant
when the exact returned reference is used.

The host's overall model-turn result is `success`, `is_error=false`, `end_turn`,
with a reported 22,940 ms duration. That does not override the failed tool result.
The last assistant message is timestamped `19:30:26.210Z`. The provider's one
`context.read` event is by `claude-code-c7b`, with one disclosed entry. The receipt
passed the launcher's existing output/retained-file secret checks before writing.
Do not publish its raw assistant/thinking stream or credential-bearing files.

The human initially reported only startup lines. Read-only process checks found
the host idle, with no active TCP connection; the source and relay were listening.
The human later supplied the terminal transcript showing the summary and `scope`
prompt before the stop message. The coordinator's stalled-run diagnosis and initial
get-success claim were wrong. There is no demonstrated result-queue or terminal
progression defect; the receipt contains no `control_request`. The concrete
harness defect is HTTP-only result checking, which advanced to `scope` despite
the failed get. Require semantic MCP success and exact ref correlation before
the positive checkpoint can pass.

After expiry, the coordinator verified the exact owned working directory, pinned
Claude executable, Node executable, parent relationship and provider listener,
then sent SIGINT to that wrapper. Both owned processes exited; the host exit was 143. No replay or replacement grant was started. **The scope-denial and explicit
revocation/read-denial stages were not run.** This is partial live evidence, not
full C7b acceptance or conformance. Repair and verify semantic result checks before
preparing any further bounded live attempt; preserve this receipt and provider.

### November 25 Semantic Result-Check Repair

The independent plan review selected bounded observation of the owned provider's
actual MCP response, rather than treating the host narrative as authority. Request
capture is capped at 32 KiB and response capture at 1 MiB; strict UTF-8 and
duplicate-aware JSON parsing, JSON-RPC ID correlation, complete result shape,
explicit `isError`, the existing pinned Core validators, and agreement between
text and structured representations determine the result. The positive stage
requires the expected single synthetic preference and exact query/get reference
correlation. References/bodies are ephemeral; observer events retain only enums,
booleans and counts. Response bytes, callbacks and backpressure remain unchanged.
Malformed/incomplete evidence and HTTP-200 tool errors fail the trial. The relay
latches before host termination, including in-flight dispatch cancellation;
expected scope 403 and revoked-read 401 allow their prescribed reporting turn.
No reference repair, broader grant, prompt change, retry or live replay was added.

Five new observer tests failed before implementation. Focused observer/helper/source
checks passed **25/25**, including the actual provider's correct query/get and its
HTTP-200 rejection of a mistyped ref. The exact Claude Code **2.1.299** binary passed
all three affected scenarios against a local fake Anthropic service:

- Positive: **9** upstream fake-service requests, host exit **0**, semantic
  query/get success, scope denial **403**, and revoked read **401**. Receipt:
  `/private/var/folders/pn/rnjt7b1d5xb4pckyss2s55qc0000gn/T/hcp-c7b-host-probe-iQSaL9/receipt.json`.
- Mistyped ref: **4** upstream fake-service requests, host exit **143**, query
  success followed by HTTP-200 tool error and false request-ref correlation. The
  relay latched; no later summary/repair request reached the fake service, and no
  subsequent stage could start. Receipt:
  `/private/var/folders/pn/rnjt7b1d5xb4pckyss2s55qc0000gn/T/hcp-c7b-host-probe-IuG1WC/receipt.json`.
- Missing get: **4** upstream fake-service requests, host exit **143**. A model
  turn completed after query only; the incomplete-stage check latched before
  throwing, so no second prompt or subsequent upstream request was admitted.
  Receipt: `/private/var/folders/pn/rnjt7b1d5xb4pckyss2s55qc0000gn/T/hcp-c7b-host-probe-EmpQAJ/receipt.json`.

The independent complete-diff review found a missing-evidence stop gap: stage
validation threw before latching. Two additional tests first failed for zero/one
missing calls and prompt-generator failure ordering. The correction latches before
throwing and wraps prompt failures so model-error/human-refusal paths stop dispatch
before host termination. All **25** focused cases and the three native scenarios
above passed after this correction. The previously passing five-case Jest wrapper
still provides unchanged discovery/consumer coverage; affected tests were renewed
directly. No host-queue redesign was needed.

The native evidence renews these affected paths; earlier unchanged confinement,
TLS/authentication negative paths and source/browser coverage remain historical
supporting evidence. The changed Jest source wrapper passed **5/5** owned-process
suites, Markdown links passed **164** files, maintained-reader/CI-filter tests passed
**58/58**, and the contract baseline and whitespace checks passed.

The complete-diff reviewer closed the stop-ordering finding and found no further
required fixes, independently passing observer **6/6** and the prompt-failure
regression **1/1**. Requested reviewer setting was Astra/xhigh; actual model/effort
remains unverified. The reviewed 26-file manifest (sorted SHA-256, two spaces,
repository path and newline) was
`2e530efd1720c01c9523abb17862a6afc91ada6f6d533c0e1373f5d27ce2be94`.
Subsequent edits only reconcile this evidence and review disposition; runtime and
test inputs stay frozen. No further live request was made. **Targeted checks
passed; final validation pending.** Exact-candidate CI remains for authorized
publication; no installed artifact or completed live C7b acceptance is claimed.

### November 24 DNS Follow-Up

The next human attempt used
`/private/var/folders/pn/rnjt7b1d5xb4pckyss2s55qc0000gn/T/hcp-c7b-subscription-0iG5OD`.
Lucas completed the browser flow and pasted its code into the private terminal;
native setup then reported `getaddrinfo ENOTFOUND platform.claude.com`. No code,
token or private-profile contents were inspected or replayed. Ordinary DNS on
the same Mac succeeded. The confined setup policy reproduced the failure.
[Anthropic's network requirements](https://code.claude.com/docs/en/network-config#network-access-requirements)
identify this host as necessary for subscription OAuth token exchange as well as
Console authentication.

The setup-only repair permits exactly the local resolver IPC socket
`/private/var/run/mDNSResponder`, matching installed Apple sandbox profiles. This
grants that daemon's IPC surface, not a hostname allowlist. No general UNIX-socket,
UDP/TCP 53, Keychain or personal-state access is added. The offline pinned-CLI
probe removes both the resolver allowance and the HTTPS allowance before launch.

The tests-first network diagnostic also exposed an unused empty-port edge:
`sandboxPolicy` emitted an empty outbound allow clause, which meant unrestricted
outbound access. Empty-port non-setup policies now omit that clause. The real model
host always supplies its two explicit ports; its generated policy is unchanged,
independently compared with the prior receipt. This does not broaden model access.

Final network receipt:
`/private/var/folders/pn/rnjt7b1d5xb4pckyss2s55qc0000gn/T/hcp-c7b-network-DNluMD/receipt.json`.
The credential-free Node diagnostic checks system `dns.lookup` plus TLS with
certificate and hostname verification for `platform.claude.com` and `claude.ai`.
Both succeed only for repaired setup; normal model, empty-port model and setup
with the resolver allowance removed deny them. All four policies deny an unrelated
owned UNIX socket. These are DNS/TLS checks, not HTTP routing or successful OAuth.
No application request, account credential, prompt or source result was sent.
Renewed native confinement receipt `hcp-c7b-confinement-KMsIjn/receipt.json` and
offline pinned-CLI receipt `hcp-c7b-setup-offline-RyJN6L/receipt.json` under the same
private temporary parent passed; the latter records four inspections and callback
teardown with external access removed. Existing provider/browser/relay/monitor
coverage carries forward for unchanged inputs. Independent plan and affected
code/security reviews found no blocking issue; requested Astra/xhigh, actual
settings unverified. Formatting, whitespace and links passed. A fresh private-terminal
transaction remains under existing approval. **Targeted checks passed; final
validation pending.** Live token handling and final candidate CI remain unverified.

### Execution Instructions

These commands are retained as the runbook for the completed authorized trial;
the successful repeat above supersedes the historical pending-execution notes.
No further live run is needed for this bounded handoff.

On November 25 Lucas reported successful subscription-token creation, entered it
with the hidden shell read, then received the launcher's generic refusal. The
published pipe plus `3<&0 </dev/tty` command was incompatible with zsh's default
`MULTIOS`: an actual pseudo-terminal reproduction showed `stdinTTY=false` even
though FD3 was a FIFO. The launcher refused before FD3 consumption, host-root
creation, authorization or model dispatch. No live host roots existed; the pinned
binary and source instance passed read-only readiness checks. The existing token
is reusable; the failed command's cleanup unset its shell variable, so reenter it
with the hidden prompt. Do not repeat token setup or source initialization.

The corrected command below uses FD3 process substitution with `builtin printf`.
This keeps stdin on the terminal and prevents a shell override from sending the
token through an external printf's argument list. Synthetic checks verify the
exact default-zsh command's terminal input, FIFO descriptor and received bytes.
A tests-first actual-CLI regression verifies the new fixed stdin diagnostic,
no canary exposure and no host-root creation. Authority, transport, relay, token
format and cleanup requirements are unchanged. Independent plan review approved
this handoff-only correction; existing auth/relay evidence carries forward.
Affected implementation review found no blocking issue. Focused helpers passed
**11/11**, document/routing checks **58/58**, and links/formatting/whitespace passed.
Logs: `/private/tmp/hcp-c7b-terminal-helpers.log` and
`/private/tmp/hcp-c7b-terminal-docs.log`. **Targeted checks passed; final validation
pending.** Actual HCP grant/model execution and final candidate CI remain unverified.

On November 21, 2026, Lucas approved the bounded subscription trial and requested
a walkthrough for token creation and execution. This authorizes the login and
three-prompt synthetic off-device scope below. Actual fixture approval is now
recorded above; review of the actual 900-second grant still happens in the browser.
No additional API-key, personal-state, publication, merge or release scope is added.

The preparation round ends after focused local checks, the reviewed helper and
fresh complete-diff review. The next milestone is one bounded human trial; final
publication/CI remains coordinated separately and no merge/artifact claim follows.
The worktree is the source recorded at the top. The mode-0700 sandbox at
`/private/tmp/hcp-c7b-human-yQzZiq` is initialized and holds its source credential.
Do not reinitialize it or substitute the existing C6 sandbox.

The completed initialization used this approved scope (do not rerun):

```sh
pnpm --filter backend hcp-source initialize --sandbox /private/tmp/hcp-c7b-human-yQzZiq --port 19443 --profile claude-code --callback-port 19444
```

The human already reviewed and approved this actual fixture bundle as the synthetic
subject. The exact two values and three prompts are above. The helper owns provider port 19443, callback port
19444, a new loopback relay port, its restricted host process and the owned source
browser. A busy fixed port refuses. Process-local trust, the source browser's own
CA store and a fresh host profile are the only trust/profile changes.

Token creation is complete for this trial according to the human's November 25
report. Reuse that newly created token; do not rerun setup for the stdin failure.
The approved first-time setup command is retained here for reference only:

```sh
node scripts/hcp/subscription-setup.mjs /Users/lucasnovak/.local/share/claude/versions/2.1.299
```

The wrapper creates a separate auth profile, denies personal-home access, Keychain
IPC and child-program execution, and permits outbound HTTPS plus the setup
callback described above for the fixed `setup-token` operation. Wait for
**Callback verified**, then manually open its printed authorization URL; no
personal browser/profile is controlled by the wrapper. Managed-policy detection
refuses before launch. Exact native callback startup is checked offline with the
outbound HTTPS and resolver allowances removed. Human-reported login/token
creation is complete; the stopped live trial's three upstream requests establish
subscription-token acceptance. The separately authorized repeat above completed
the bounded live sequence.
If login requires excluded credentials/programs, stop rather than relax it. The token is
normally valid for one year; it is not the 15-minute HCP grant. Never run that
command through a captured agent terminal or copy an existing login credential.
The setup command's token output must stay private. Paste the new token into this
hidden input, not a command argument or chat:

```sh
read -rs 'C7B_SUBSCRIPTION?New trial subscription token: '
```

Run the hidden-input line alone, paste the token and press Enter. Then run:

```sh
printf '\n'
/usr/bin/pbcopy < /private/tmp/hcp-c7b-human-yQzZiq/launcher/human.credential &&
node scripts/hcp/claude-trial.mjs \
  --live --sandbox /private/tmp/hcp-c7b-human-yQzZiq \
  --host /Users/lucasnovak/.local/share/claude/versions/2.1.299 \
  3< <(builtin printf '%s' "$C7B_SUBSCRIPTION")
unset C7B_SUBSCRIPTION
/usr/bin/pbcopy < /dev/null
```

Use the pinned Node/pnpm toolchain and the reviewed checkout, with no other source
`serve`/`open` owner running. This runner is never invoked merely to inspect it.
It reads and closes private pipe FD3; the real token remains in relay memory.
The host gets an unrelated relay credential and the temporary HCP access token.
In the owned browser, sign in with the new source credential, review the exact
client/category/purpose and select **900 seconds**, without persistence. Incorrect
authority refuses launch and remains available for explicit human revocation.

One live host session runs the first prompt, waits for the human to type `scope`,
runs the denial prompt, then waits for human revocation and `revoked`. The helper
independently observes revoked grant status before the third prompt. All four MCP
calls and their semantic outcomes are recorded. Successful query/get require the
expected synthetic entry and exact reference correlation; HTTP 200 alone cannot
pass. Unexpected tool errors, calls or retries stop the run and latch the relay.
The relay permits at most twelve sequential model requests, 1 MiB per request and
4 MiB per response, with bounded timeouts, only to Anthropic HTTPS `/v1/messages`
(the SDK's `?beta=true` query is admitted). Credentials other than the subscription
Authorization header, source/Keychain files and personal context cannot be forwarded
by the reviewed configuration. Ordinary host request metadata and the synthetic
tool definitions, results and errors accompany the prompts.

Ctrl-C stops the owned host and closes the relay, callback, browser and provider.
No automatic recovery/replay, refresh, alternate model or new consent. Preserve the
provider/audit, browser ownership record, and printed private host root/receipt;
temporary access expires even if no explicit revocation occurs. A stopped process
does not prove Anthropic deleted received data. The separately authorized repeat
establishes the complete bounded query/get, scope-denial and explicit-revocation
journey with a normal host exit, as recorded above. The earlier failed attempt
remains preserved. This packet does not authorize automatic replay or further
live trials.
