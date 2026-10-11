# Claude Desktop connection slice

- Status: independently reviewed source trial ready; real-client acceptance and final validation pending
- Scope: first connection slice of the [pilot brief](README.md), one cohesive pilot PR
- Base: `855e8734b919871eac82415465b456add38a3084`; branch `codex/colleague-pilot`
- Owner: connection coordinator `/root`; sole checkout writer/integrator `/root/writer`

## Outcome and boundaries

An assisted colleague can launch a small stdio bridge from ordinary Claude Desktop
chat and connect to the existing installed app's authenticated
`http://127.0.0.1:8787/mcp`. Discovery, reads, permitted/denied writes and safe
explicit reconnect retain the existing credential/grant authority. The installed
app continues to own backend/model startup and shutdown. Existing Claude Code and
Codex CLI direct HTTP clients remain supported.

The first delivery is a **source-bound standalone bridge**, requiring an absolute
Node 24.21.0 executable and reviewed checkout entrypoint or retained source
snapshot with the same three module bytes. It is not yet included in the
installed bundle. No extension, native launcher, new backend, database, registry,
OAuth, public/LAN listener, tunnel, app replacement or personal-client automation
is part of this slice. No provider calls, model runs/downloads, private documents,
resets, publication or merging are authorized here. Broader distribution/signing,
real replacement/disk qualification and native owner-loss work remain with the
pilot coordinator. Reset designation stays undecided and is not needed for a
bridge that never administers state.

Anthropic's [remote connector guidance](https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp)
describes cloud-origin connections, which cannot reach this loopback service.
The MCP [local-server guide](https://modelcontextprotocol.io/docs/2026-07-28/develop/connect-local-servers)
documents Desktop command/arguments subprocess setup; an extension is optional.
Installed Claude metadata observed by the coordinator: 2.31226.1. Actual
account/tier, ordinary-chat mode and organization restrictions remain unverified;
[enterprise settings](https://support.claude.com/en/articles/12622667-enterprise-configuration-for-claude-desktop)
can disable local development MCP. No real client trial has run.

## Ownership and review

| Role | Requested setting | Observable evidence / responsibility |
| --- | --- | --- |
| Coordinator `/root` | Astra Ultra | Requested by user; runtime model/effort not independently observable; repository read-only |
| Sole writer `/root/writer` | Astra Extra High (`xhigh`) | Explicit spawn settings accepted; no independent runtime attestation; all branch/files/staging/commits |
| Inventory `/root/inventory` | Astra High | Explicit spawn request; read-only code/consumer evidence |
| Plan reviewer `/root/plan_review` | Astra Extra High (`xhigh`) | Explicit spawn settings accepted; no independent runtime attestation; security, lifecycle, compatibility, scope and test coverage |
| Complete-diff reviewer `/root/diff_review` | Astra Extra High (`xhigh`) | Explicit spawn request; no independent runtime attestation; complete checkpoint diff and affected correction recheck approved for bounded source trial |

Only the writer edits this checkout. Coordinator/reviewers remain read-only.
Existing foreign edits in `docs/plans/README.md` and
`docs/plans/backlog/agent-assisted-onboarding/README.md` are preserved and excluded
from this slice's staging/commits. Their initial SHA-256 values are respectively
`9cc87614fd852f9324f4cd2caac8a899a0f679160bcd7b530afe078a3b89e963` and
`ce2d603dc57a40a9c842eb87ba3261c1cbeef599a3235ce19ed6818636a34e83`.
No other active writer was found; existing unrelated worktrees are untouched.

Owned implementation paths are `apps/backend/scripts/mcp-bridge/` and new
`apps/backend/test/local-mcp/bridge*.test.mjs`. These stay under existing backend
CI filters and the existing local MCP test command; no new package/dependency or
CI trigger change is needed. Owned guidance is this plan,
`docs/useful/MCP_LOCAL_SETUP.md`, narrowly affected current/installed guidance, and
status/link correction in `docs/plans/backlog/mcp-onboarding/README.md`.
Add the exact bridge directory to reference/outbound discovery in
`scripts/local-migration/check-contract-baseline.mjs`, with focused discovery
regression coverage in its test. Update only accurate bridge classification and
derived census in
`docs/current/local-migration-contract-baseline.json`, with checker evidence;
protected historical ownership and contract dispositions remain unchanged.

Backend HTTP/auth/domain code, web, desktop/native/packaging and managed state
are outside the planned implementation. Any needed change there is a reviewed
plan amendment, with backend tests written first. New bridge behavior also uses
tests first. No shared build output is overwritten: production integration uses
an isolated source/build copy and temporary synthetic roots/ephemeral ports.

## Transport contract and failure model

The executable accepts only `--credential-file /absolute/canonical/private/file`
(and fixed help/version). Client config contains absolute executable/script/file
paths, never token bytes. Production destination is compiled/fixed literal
127.0.0.1:8787 and `/mcp`; no URL/port/env override. An imported test harness may
inject an ephemeral loopback port without making that a CLI capability.
Use Node core `http` directly: no proxy/environment routing, DNS, redirects,
OAuth fallback, automatic request retries or resumable streams.

The CLI refuses nonempty inherited `NODE_DEBUG`, `NODE_DEBUG_NATIVE` or
`NODE_OPTIONS` before credential access or HTTP. The manual config clears all three;
deleting debug flags after Node startup would not disable cached core logging.

Credential is read once at startup. Require canonical absolute path (at most
4096 characters, no controls), non-symlink safe ancestors, same-user 0700 parent,
and same-user regular 0600 single-link file. Use no-follow/nonblocking open,
fstat and path/parent pins before/after a bounded read; reject changed identity,
mode/size/content metadata or path ancestry. Read at most 75 bytes (one overflow sentinel beyond the exact token
export bound of 74 bytes including LF), require the existing
`cr_mcp_<22 base64url>.<43 base64url>` syntax with optional final LF, and close the
file descriptor. Never watch, rewrite, rotate or delete credentials. Rotation
requires a new private export path and an explicit Claude reconnect/restart;
revocation is independently enforced by the backend on every request.

Stdio uses one UTF-8 JSON-RPC message per LF. Bound a line including unterminated
input to 128 KiB, validate JSON-RPC 2.0/request shape/method/typed ID (safe integer
or at most 128 UTF-8 bytes), reject batches and invalid UTF-8 without echoing
content. Advertise only the existing CR tools/resources surface; no invented
server-initiated sampling/elicitation capability, GET stream or generic proxy
claim. Preserve tool/resource results without recording them in diagnostics.

Maintain a bounded state machine: awaiting initialize, initialized, ready,
needs-session, stopping. Forward the initial handshake with validated negotiated
protocol (2025-06-18 or 2025-11-25) and session header, and require successful
`notifications/initialized` before dispatching ordinary requests. Use generated
upstream request IDs and exact typed downstream-to-upstream mappings. Internal
handshakes cannot collide with client IDs. Retain at most 4096 downstream IDs;
reject reuse and require explicit bridge restart at exhaustion. At most eight
ordinary requests can be active, with no unbounded queue. Separately bound control
requests so cancellation/shutdown remain usable under saturation.

Each admitted request captures an immutable session generation. Cancellation
routes only to its exact active request in that captured generation; it never
reinitializes or targets a later request/session. Concurrent session replacement
uses one initialization promise; old responses cannot replace new session state.
Retain original initialization parameters and accepted protocol/capabilities;
renewal must preserve that stdio-negotiated contract or return reconnect-required.
Successful terminal responses retain their original client IDs. A response must
have a matching ID and exactly one result/error, valid JSON/UTF-8, expected status
and content type. Require JSON-RPC 2.0 and integer-code/string-message errors. Bound headers to
16 KiB, each response to 8 MiB, aggregate incoming response buffers to 16 MiB and
queued stdout to 8 MiB (plus bounded parsed objects/serialization). Test representative
descriptors/schema; overflow is unknown outcome if dispatched. JSON is normal; only empty 200 event-stream is understood
as cancellation/no terminal result. Unsupported/nonempty SSE fails conservatively.

| Observation | Behavior |
| --- | --- |
| HTTP 404 for an ordinary request in the current session | Existing edge rejects that request before dispatch. Cancellation/DELETE/handshake 404 never settles earlier work. Retire only that generation, return fixed error stating this request was not dispatched and an explicit retry is needed. Never replay it. Next client request single-flight initializes and sends initialized before its own dispatch. |
| Socket loss, timeout, 5xx, malformed/oversized/mismatched response after dispatch | Return fixed `outcome unknown` error for a tool call; it may have committed. No automatic replay. Next deliberate request may reconnect; inspect shared state/history before retrying a write. |
| Cancellation or empty SSE | Attempt bounded cancellation of original generation, report outcome unknown for dispatched work; cancellation does not prove rollback or settlement. No automatic replay. |
| HTTP 401/403 | Fixed authority error, no fallback/retry/credential reload. Explicit reprovision/rotation and bridge restart as appropriate. |
| Capacity/refusal before bridge dispatch | Fixed bounded not-dispatched error; no queued background work or retry loop. |
| App unavailable at initialize/reconnect | Fixed connection unavailable; no backend/model launch. Later explicit reconnect/request may retry initialization. |
| EOF, SIGINT, SIGTERM, SIGHUP or output error | Stop accepting input, bounded best-effort authenticated DELETE of owned session(s), destroy own HTTP sockets, exit within five seconds. Shared backend/model remain running. |

Use a short connection/handshake deadline (10 seconds), operation deadline
exceeding the backend's 180-second workflow bound (190 seconds), and bounded
control/shutdown deadline (at most five seconds). Stalled stdout cannot grow memory
without limit or prevent bounded exit: pause/refuse input and stop on exceeded
output bound or drain deadline. Do not hold a keepalive/heartbeat that prevents
real inactivity expiry. Protocol-only stdout; stderr contains fixed categories
only, no token, file path, headers, request IDs, payloads, raw errors or stacks.
No diagnostic files or telemetry.

## Checkpoints and evidence

1. **Plan and review.** Complete source/client investigation; draft this plan and
   independently review before implementation. Resolve every blocking finding
   with its trigger, consequence, disposition and revised-plan hash. Source base,
   branch, foreign changes and pinned toolchain are verified. Only docs checks
   run now; no migration gate for orientation.
2. **Bounded bridge, tests first.** Write failing credential, protocol, transport,
   concurrency and lifecycle tests, then implement in small increments. Test path
   aliases/symlinks/hardlinks/FIFO/permissions/oversize/races; fragmented UTF-8,
   malformed IDs/batches/no LF; fixed endpoint/no redirect; typed ID mapping;
   single-flight initialization; stale 404 next-request recovery; old-generation
   cancellation; response loss after accepted mutation; timeout/cancellation;
   stdout backpressure; EOF/signals and redacted failures. Run the new focused
   tests after each behavior change; keep tests unless requirements change.
3. **Production integration and manual guidance.** Run bridge with the existing
   real local MCP composition, auth guard and isolated SQLite fixture on port 0.
   Prove descriptors/resources, allowed reads/writes, denied writes, durable state,
   independent second-client revoke/rotate, stale sessions/restart and mutation
   commit with lost/cancelled response exactly once. Use the real SDK StdioClientTransport with the bridge and SQLite backend, and
   existing HTTP SDK tests for direct-client compatibility. No live model is required. Update manual
   setup/reconnect/privacy guidance; remove unsupported URL-only Desktop guidance
   without weakening hosted HTTP/OAuth support. Record source/input hashes and
   prepare bounded real-client checklist referencing the canonical brief.
4. **Review and trial handoff.** Fresh independent complete-diff review covers
   security/privacy, lifecycle/recovery, contract compatibility, tests and scope.
   Resolve blockers and rerun affected tests/review. Prepare a source-bound trial
   record naming exact source revision/dirty input hashes, Node, entrypoint and
   unchanged installed app identity (actual path/artifact must be resolved before
   the human trial; standard Applications locations were absent). State: **Targeted checks passed; final
   validation pending.** Client configuration and cloud-backed test requests need
   bounded user approval; do not execute them while awaiting it.
5. **Finalization boundary.** The proposed end-of-round milestone is reviewed
   implementation plus targeted synthetic evidence and an approved real-client
   trial plan. Agree with the user when exploratory client feedback ends before
   freezing a final candidate; this plan does not infer that agreement. At that
   point complete all applicable full gates, installed-artifact acceptance and
   exact-head CI. No trial, source integration result or historical artifact
   receipt substitutes for final pilot readiness.

Concrete targeted commands (Node 24.21.0/pnpm 10.25.0, isolated build where needed):

- `pnpm check:toolchain` before validation.
- `node --test --test-concurrency=1 test/local-mcp/bridge*.test.mjs` from the
  backend directory; focused names during iteration.
- `pnpm --filter backend test:local-mcp` against the isolated fresh backend build;
  includes real HTTP/SQLite and direct SDK consumers.
- Existing affected local UI management/http tests if shared-state/authority
  evidence needs them; no browser claim from storage assertions alone. Actual
  dashboard visibility is part of the approved real-client checklist.
- `node scripts/check-markdown-links.mjs`, `git diff --check`, and affected
  doc-reader/checker tests discovered by path, filename and asserted content.
- `node --test scripts/local-migration/check-contract-baseline.test.mjs` and
  `node scripts/local-migration/check-contract-baseline.mjs`; record
  `baseComparison=skipped` when base artifacts are absent. Refresh derived
  fixtures only when new references/sinks require it; test/classify actual sinks.

The full `pnpm migration:gate`, applicable installed qualification and exact-head
CI remain required for final qualification, with pinned toolchain/resource
preflight and a stated purpose before expensive runs. Do not alter CI triggers,
retire modes, weaken tests or repeat the full gate after each correction. Changed
inputs invalidate affected evidence; explicitly carry forward only unaffected
coverage. Source-only trials cannot claim bridge-in-bundle installed qualification.

## Real-client acceptance and open decisions

The [canonical Claude checklist](README.md#claude-desktop-acceptance) remains the
acceptance authority: exact app/Node/bridge source/client/account/mode; discovery,
reads, permitted and denied writes; dashboard visibility; independent revocation,
rotation and explicit reconnect; **real inactivity exceeding 35 minutes**; app and
client restart; stale sessions and uncertain mutation response with no replay.
Synthetic clock manipulation is automated coverage, not the 35-minute observation.
Use only approved synthetic test data/grants for this slice; disclose that Claude
may send tool results to its provider. No actual personal config change or cloud
request is authorized by writing an example or completing local tests.

Evidence cannot determine the user's actual account/organization permissions or
approve client changes/provider requests. The coordinator obtains that bounded
approval once the exact setup and checklist are reviewable. Source investigation,
implementation after plan review, isolated automated tests and docs can proceed
while those answers are pending. Distribution/reset/cohort decisions stay with
the overall pilot; none activates state mutation in this connection slice.

## Change-to-evidence record

| Input / checkpoint | Evidence | Result / limits |
| --- | --- | --- |
| Initial source | HEAD and local/remote main `855e8734b919871eac82415465b456add38a3084`; branch created without reset | Known foreign docs preserved; no implementation |
| Toolchain | `LC_ALL=C PATH="$HOME/.nvm/versions/node/v24.21.0/bin:$PATH" pnpm check:toolchain` | Passed; shell locale must use `C` for local Perl utilities |
| Plan review | `/root/plan_review` approved plan hash `0db9880efd4f5d9043b1e79c7c90622b35d2b0e23428305e3060ce8b36ee34f1` | No blockers. Nonblocking 404/error-validation/aggregate-buffer precision incorporated; coordinator authorized implementation. |
| Checkpoint 2 | Tests-first missing-module red, then 26 focused credential/transport/CLI tests | Passed on Node 24.21.0; synthetic ephemeral sockets only. Pipelined initialization and failed-renewal cleanup regressions failed before correction, then passed. Final validation pending. |

### Synthetic implementation checkpoint (2026-10-11)

The standalone bridge, four bridge test files and test-only stdio child are
implemented. A fresh isolated Nest build copied backend source/generated client,
scripts and tests beneath a private temporary validation root; dependency links
were read-only inputs. The checkout's `dist`, installed app and personal state
were not changed. Node 24.21.0/pnpm 10.25.0 preflight passed.

- Full affected `pnpm test:local-mcp`: **88 passed** against that isolated build,
  including existing direct SDK HTTP, auth, persistence, lifecycle and synthetic
  model-peer tests. No live model or provider was used.
- Subsequent same-inode credential race tightening: failing regression first,
  then **32 bridge tests passed**, including all four real SDK stdio/SQLite tests.
  Existing backend behavior and fixtures were unchanged; the unrelated coverage
  from the 88-test pass carries forward. The new race test raises the combined
  distinct local MCP case count by one.
- Contract-checker and Markdown-checker tests: **75 passed**. Strict Markdown
  links (145 documents), `git diff --check` and direct contract check passed;
  the direct check reports **`baseComparison=skipped`**, not a full migration gate.
- Registry delta is limited to the added bridge outbound classification and
  derived reference/sink census. Every existing outbound row is byte-equivalent
  as parsed data; protected historical ownership/dispositions were not changed.
- Initial integration failures were harness assumptions, not product failures:
  read-only clients intentionally discover five tools versus six for a writer;
  the lost-response fixture needed to parse the nested tool result before dropping
  its response. Corrected assertions still check authority and exactly one commit.
  The first full-suite attempt lacked its copied synthetic TLS fixture and raced
  signal delivery against subprocess startup. The repeat included that fixture
  and waited for a bounded protocol readiness observation; all 88 tests passed.

The coordinator read-only verified retained Candidate 14 at the temporary
`context-router-step09-candidate-20261010-14/Context Router.app` location.
Native package verification passed; manifest SHA-256 is
`944c5be0eb2e44e5c215fdacac3f8ad12546dd190cdddd8afa45c78285d8ff38`, source digest
`c5542b2b07032b89feeacbdfccadbd4a8864d052557388c74022874ef2bc7d70`, security epoch 1.
This identifies an available unchanged artifact, not the user's currently running
app. Its backend production sources/dependency manifests match this slice's base;
that relationship does not replace installed/client acceptance.

**Targeted checks passed; final validation pending.** The complete-diff review
of local trial checkpoint `96809067cc1f1548b7a6b13becab2051291eb536` found two blockers;
corrections and their approved recheck are recorded below.
Real Claude Desktop account/
policy/configuration, >35-minute inactivity, dashboard visibility, app/client
restart and the complete canonical acceptance checklist remain unverified.
The full migration gate, final installed qualification, exact-head CI and agreed
finalization milestone remain pending. No branch was pushed or artifact published.

### Independent review correction checkpoint (2026-10-11)

The complete review by `/root/diff_review` requested changes for two blocking
findings. The coordinator authorized this correction batch without changing the
approved product or validation scope.

- **P1, inherited debug credential disclosure:** Node 24.21.0 core network logging
  under `NODE_DEBUG=net` could write bearer bytes to stderr. The CLI now refuses
  nonempty Node debug/native-debug/options settings before credential access or
  requests; the manual config explicitly clears them. Subprocess regressions use
  only a synthetic token and test-only access/request observers, assert no
  credential access or HTTP attempt, and never print token bytes.
- **P2, SDK-invalid response forwarding:** null/primitive/array results, invalid
  result metadata, unsafe error codes and extra response-envelope keys could pass
  the adapter but fail the pinned SDK parser. The bridge now validates the generic
  result/error envelope and projects known response fields. Invalid dispatched
  responses produce SDK-valid fixed outcome-unknown errors without replay.
  Uncorrelatable invalid input omits its ID instead of emitting SDK-invalid null.
  Initialization also validates optional instructions and projects the supported
  server identity fields, preventing malformed optional metadata from escaping.
- The review regressions failed before correction. After the corrections, **49
  bridge tests passed** in the unchanged isolated backend build, including all
  four real SDK stdio/SQLite integration cases. Added focused checks also cover
  fragmented multibyte UTF-8, malformed typed IDs, lifetime ID exhaustion with
  explicit restart, and bounded shutdown with active/hung HTTP.
- **75 contract/Markdown checker tests passed**. Strict Markdown links (145
  documents), direct contract check (`baseComparison=skipped`) and whitespace
  checks passed after the guidance updates; no census refresh was needed.
  Backend production sources,
  dependency inputs, auth/persistence/lifecycle implementation and native/package
  inputs are unchanged; their unrelated coverage from the earlier 88-test local
  MCP pass carries forward. No full gate or package qualification was repeated.
- The MCP onboarding backlog now links to this implemented source trial; its
  broader C/C+ ergonomics remain backlog. Foreign agent-assisted onboarding edits
  remain untouched and excluded from commits.

The reviewer rechecked the exact correction commit's privacy/protocol changes,
new regressions and affected guidance, with the disposition below. Retain the
three reviewed modules under a private
`/private/tmp/context-router-claude-bridge-trial-<commit>/` directory with a JSON
receipt of exact commit, module hashes, Node identity and source-only limits.
The local trial still requires the real-client approval/acceptance and finalization
gates above. The retained Candidate 14 integrity evidence does not identify a
currently running app; choose the exact app before any stop/admin/restart.


### Review disposition and trial handoff (2026-10-11)

`/root/diff_review` approved correction commit
`38d6f052d347c14bb7d25d003563c2d58971529b` for the bounded source trial, with no
remaining blockers. Both P1 and P2 are resolved. The reviewer independently ran
**17 selected correction regressions: 17 passed, 0 failed** on Node 24.21.0 with
isolated temporary resources and ephemeral sockets. The eight-file correction
diff, including initialization projection, observation fixture and guidance, was
reviewed. Unchanged complete-diff coverage from
`96809067cc1f1548b7a6b13becab2051291eb536` explicitly carries forward for credential
handling, lifecycle/recovery, authority, no replay, checker/census coverage,
integration scope and delivery boundaries.

The subsequent disposition commit changes only this plan. All three bridge
modules remain byte-identical to reviewed `38d6f05` and the 49-test isolated
inputs; their hashes, final source revision, pinned Node identity, retained
Candidate 14 integrity evidence and outstanding limits belong in the external
snapshot receipt. Applicable Markdown/contract checks are rerun for this record;
unchanged code tests and the independent code review carry forward.

**Targeted checks passed; final validation pending.** This approves only a named
source-bound trial artifact, not client configuration, cloud-backed requests,
installed qualification, publication, merge or final pilot readiness. No app or
client was launched or modified by this slice. The next human decision is bounded
approval of the exact app, one preserved client configuration entry/restart,
dedicated synthetic-only credential/grants and synthetic provider-bound requests.
The canonical client checklist and agreed end-of-round finalization remain open.
