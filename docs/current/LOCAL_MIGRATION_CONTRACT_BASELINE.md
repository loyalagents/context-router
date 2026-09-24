# Local Migration Contract Baseline

This document is the human-readable companion to the versioned
[`local-migration-contract-baseline.json`](local-migration-contract-baseline.json)
registry. The version-two registry and its referenced fixtures are the
executable baseline. They retain the hosted product characterized at planning
base `9b56d38fde927d4e643af89ba45665a439613939` and now name three explicit modes:
`hosted-baseline`, `local-identity-preview`, and `local-database-preview`.

`hosted-baseline` remains the NestJS backend and Next.js web app backed by PostgreSQL, Auth0, and Vertex AI. `local-identity-preview` retains the non-listening PostgreSQL reference composition through `local-identity:postgres-reference`, with its explicit loopback TLS target and original identity root. `local-database-preview` is the default local command's SQLite composition with separate explicit database/identity roots and no database network dependency. Both previews use a private principal/bearer and fixed unavailable model adapter; neither opens a listener. Missing configuration never selects a fallback.

The third mode is additive: existing capability dispositions, roadmap owners and wire fixtures stay unchanged. All twelve phases remain; seven applicable phases name both previews. The standalone local test command receives no inherited `DATABASE_URL` or administration URL, and its build prerequisite prepares the actual compiled worker. Source and sealed-package smokes require both the exact eight-resource PostgreSQL proof and the independent ten-resource SQLite proof, including two signal-clean preview generations, stable catalog/data/principal, rotation/recovery and actual engine inventory.

## How To Read The Baseline

Every capability has one disposition and an owning roadmap step:

- `RETAIN` means preserve the user or integration outcome while implementation
  may change.
- `REPLACE` means migrate the implementation or unsafe semantics behind a
  compatible expansion and consumer migration.
- `REMOVE` means the capability is outside the final local product, subject to
  the public-contract retirement policy.
- `DEFER` means a named later step must answer the recorded acceptance question;
  it is not an unowned backlog item.

Contract class is independent of disposition:

- `preserved-contract` is an outcome later steps must continue to prove.
- `observed-not-promised` records behavior without turning an implementation
  accident or unsafe behavior into a permanent promise.
- `planned-removal` remains present only through its compatibility window.

The registry currently contains 40 decisions: 18 retain, 8 replace, 10 remove,
and 4 defer. The detailed rationale, evidence path, owner, external callback
allowlists, outbound inventory, and exact consumer map live in the JSON registry.
The checker regenerates an exact census of public-route/tool/resource references
and outbound sink paths/kinds/counts across product, operator, evaluation, and
local-migration orchestration/smoke source trees; missing, stale, changed-count,
or unclassified rows fail automatically alongside the curated semantic
fingerprints.

## Public Contract Families

### GraphQL

[`graphql-schema.semantic.json`](../../apps/backend/test/contracts/fixtures/graphql-schema.semantic.json)
normalizes the complete checked-in [`schema.gql`](../../apps/backend/src/schema.gql)
by type kind, roots, scalar metadata, exact list/non-null wrappers, fields,
arguments, default presence and literals, input fields (including `@oneOf`),
enums, interfaces, unions, every supported deprecation location, and normalized
custom directive applications. Repeatable directive application order is
preserved, while named arguments and input-object value fields are canonicalized.
Descriptions are a separately pinned copy fingerprint: changing them requires
an intentional fixture update but not a breaking migration record. Source
locations and declaration order are deliberately excluded from compatibility.

The baseline has 15 query fields, 15 mutation fields, and no subscription. The
checker parses and validates 49 named in-repo operations across the web app,
developer orchestrator, eval tooling, and clean-restart smoke. It separately
tracks dynamic shell and runbook queries that cannot safely be extracted as
ordinary template literals. Unknown external GraphQL clients are assumed to exist.
Unknown external health monitors are assumed to call `GET /health`.
Unknown external REST upload clients are assumed to call `POST /api/preferences/analysis` and `POST /api/form-fill/pdf`.

`me` is the retained current-principal outcome. The redundant self-only
`user(id)` query is a planned later removal, not a Step 01 schema change.

### HTTP

[`http-contracts.v1.json`](../../apps/backend/test/contracts/fixtures/http-contracts.v1.json)
pins methods, paths, authentication class, content types, multipart fields,
default limits, success and error statuses, required envelopes, and important
headers for:

- `GET /health` and `POST /graphql`;
- `POST /api/preferences/analysis` and `POST /api/form-fill/pdf`;
- `POST /mcp`, the intentional `GET /mcp` refusal, four OAuth discovery paths,
  and dynamic client registration.

Production guard composition currently rejects an anonymous
`preferenceCatalog` selection even though the method also has an optional-auth
guard. That contradiction is characterized as observed-not-promised. The clean
restart smoke uses a signed test token and does not depend on anonymous catalog
access. Dynamic client registration also pins the production-default 60-second,
30-request rate limit and its exact 429 envelope on request 31.

### MCP

[`mcp-contract-baseline.json`](../../apps/backend/test/contracts/fixtures/mcp-contract-baseline.json)
contains the complete runtime-collected server, tool, resource, OAuth, DCR,
challenge, client, callback, and visibility descriptors. It pins six tools and
the sole `schema://graphql` resource. Five read tools have full output schemas
and return matching structured content plus JSON text. `mutatePreferences`
intentionally has no output schema or structured content and exposes exactly
six mutation operations.

Claude and Codex client buckets can see all six tools. The fallback and a
read-narrowed recognized client can see the five read tools. Unknown clients
see no tools or resources. An absent, empty, or wholly unrecognized token scope
currently restores a recognized client's configured maximum; that unsafe
behavior is observed-not-promised and Step 07 owns replacement with explicit
least privilege.

`MCP_HTTP_PATH`, `MCP_HTTP_REQUIRE_AUTH=false`, and `MCP_STDIO_ENABLED=true`
look configurable but are not complete working modes. They are explicitly
listed as configuration-shaped non-capabilities.

### Catalog And Seed

[`preference-catalog.v1.json`](../../apps/backend/test/contracts/fixtures/preference-catalog.v1.json)
pins all 19 source entries. Value type, scope, sensitivity, ordered options,
default, and validation are semantic. Category, display name, and description
are maintained as a separate copy surface with fingerprint
`sha256:42c01ee95658be04340b9c64109d0683f0e8df0eadf81da54349152250d27832`.

The seed characterization proves the current helper:

- updates a changed active global definition without changing its ID;
- creates a global beside a colliding personal definition while lookup remains
  personal-first;
- retains an archived global and creates a new active replacement;
- retains stale globals absent from the source catalog;
- is non-transactional across catalog entries; and
- is ID-stable and duplicate-free across repeated successful runs.

The exported definition helper and actual production seed entrypoint create no
users. Step 04 removed the sample-user block and added executable tests that run
the require-main path twice, verify the exact catalog and stable active IDs,
and preserve existing principals/bindings. The direct canonical-data import also
fixes the prior plain-ts-node JSON/TypeScript filename ambiguity. See
[storage boundaries](STORAGE_BOUNDARIES.md) for retained per-entry semantics.

### Developer Orchestrator Manifest

[`run-manifest-v3.schema.json`](../../apps/local-orchestrator/contracts/run-manifest-v3.schema.json)
is a strict schema for the current developer-only manifest. Valid empty and
mixed partial/failure fixtures and focused invalid fixtures live under
[`apps/local-orchestrator/test/fixtures`](../../apps/local-orchestrator/test/fixtures).
The TypeScript literal, schema ID and `const`, registry, and fixtures must move
together when the version changes.

Manifest v3 can contain absolute paths, snippets, values, backend URLs, command
arguments, and errors. A dry run still reads and uploads files. These are
privacy boundaries of temporary developer tooling, not installed-product
requirements. The current analysis/apply clients also accept some HTTP-success
JSON values that the canonical schema rejects; the permissiveness is recorded,
not promoted.

## Outbound And Trust Boundaries

Normal hosted operation can contact PostgreSQL, the configured hosted issuer's
JWKS endpoint, Google Vertex and credential endpoints, and the configured
web/backend origin. The backend no longer embeds Auth0 Management or
Authentication SDK clients.
The PostgreSQL reference preview contacts only literal `127.0.0.1` PostgreSQL over direct verified TLS. The SQLite local preview has no database network connection. Neither performs Auth0/JWKS, Vertex/model, web or MCP transport calls or opens a listener. Their private bearer authenticates only the in-process local human guard; it is not an MCP or browser credential.
Opt-in tooling can additionally contact an arbitrary orchestrator backend,
spawn commands with inherited environment, and invoke hosted model/evaluation
providers. The exact data classes, default status, disposition, and owner are
machine-readable in the registry.

Important observed boundaries include:

- raw document bytes and memory values can be sent to Vertex, including on a
  structured retry;
- hosted M2M compatibility tokens still materialize synthetic account rows, but
  those rows cannot carry a human `ExternalIdentity` binding;
- human principals resolve only by exact `(provider, issuer, subject)` identity;
  verified email is a non-authoritative profile hint and may be shared by
  multiple principals;
- the default backend listener is not code-confined to loopback;
- MCP Origin checks do not cover the entire browser trust boundary, and proxy
  headers are trusted for DCR rate limiting;
- rejected DCR requests currently log the complete untrusted redirect-URI
  array, including any query strings; Step 07 must replace that with redacted
  origin/class/outcome logging before local transport ships;
- provider prompt prefixes, extracted old/new preference values, and upload
  filenames/user IDs can enter untouched current logs; the Step 03 hosted
  identity, Auth0, user, Prisma, JWT, and MCP-auth paths use fixed diagnostics,
  while Steps 06, 08, and 09 still own centralized value-aware redaction before
  the remaining paths become local-product surfaces;
- audit snapshots contain values, while sensitivity masking is derived from the
  live catalog; and
- the authenticated web debug route renders a complete bearer token.

These facts motivate later replacements and removals. They are not claims that
unsafe behavior must be preserved.

Step 03's identity boundary stores the exact provider, canonical issuer, and
subject as ongoing authentication authority. Auth0 remains only the current
JWT/JWKS claim adapter, so another verified provider can feed the same resolver.
New principals use a unique non-routable `.invalid` compatibility email when no
verified email exists, and account email is deliberately non-unique. The Step 03
migration is a fresh-data transition: it locks the identity tables, deletes all
user-owned data, and installs the required provider-neutral keys atomically.

## Package Scope

- `apps/backend` and `apps/web` are the current hosted product composition.
- `apps/local-orchestrator` is temporary developer tooling, not installed
  product scope.
- `examples/eval` is deterministic developer/evaluation tooling; live provider
  variants are opt-in and never a migration gate dependency.
- `examples/eval-harbor` is research tooling. Its static checks are deterministic;
  live Harbor/provider runs are not product gates.

## Local Migration Baseline Gate

`pnpm migration:gate` is the authoritative aggregate compatibility command for
later migration checkpoints. Its lifecycle is checked into
[`gate-phases.json`](../../scripts/local-migration/gate-phases.json) and validated
against a strict schema plus semantic ownership, predecessor, retirement, and
supported-mode rules. Both modes share `contract-baseline`, `documentation`,
`backend-unit-build`, `backend-database`, `restart-smoke`,
`packaged-composition-smoke`, and `repository-integrity`.
`local-orchestrator`, evaluation, web-production, and Harbor phases remain
hosted-only. Phase IDs, order, commands, timeouts, and workflow budgets are
unchanged. Every supported mode must retain active contract, build, state,
restart, and integrity evidence. Each mode records active/retired status and at
most one successor; a retired mode must name exactly one active successor. The
command allowlist pins the exact two-mode matrix and rejects added modes,
phases, or command substitutions.
The aggregate runner requires a verified merge-base comparison for every
contract-baseline phase command and fails if the bound artifact directory is
missing. Direct checker runs remain useful for current-tree validation and
report `baseComparison=skipped`; aggregate runs report
`baseComparison=performed` so the comparison cannot disappear silently.

The Step 03 restart and sealed-package evidence starts the compiled local
preview twice around a credential rotation, preserves one principal and its
provider bindings, exercises both clean recovery entrypoints, proves fixed
SIGTERM/SIGINT exits and zero listeners, and leaves the canonical state bytes
unchanged across each preview run. The packaged run uses the relocated sealed
backend with a hostile working directory and environment; its journal owns and
cleans the exact TLS database fixture, private state root, and child processes.

The repository toolchain contract is exact Node.js 24.21.0 and pnpm 10.25.0.
The tracked `.nvmrc`, strict root engine/package-manager metadata, standard and
dedicated workflows, and both backend Docker stages select that pair. Install,
each package build, direct and package-script LMBG entry, and Docker build
evidence run `scripts/check-toolchain.mjs`; unsupported Node majors, other Node
24 patches, and other pnpm versions fail with one remediation message. The
direct LMBG check runs before diagnostic directories, disposable workspaces,
Corepack clones, databases, containers, or other owned resources are acquired.
The unreferenced root `Dockerfile.dev` was removed instead of retaining its
stale Node 20/npm path; supported backend container builds use
`apps/backend/Dockerfile`.

The checked contributor and gate path currently covers macOS and Linux only.
The implemented Step 02E staged-artifact smoke uses platform-specific listener
evidence: exact owned-PID/port native socket-table rows prove the bind tuple on
macOS, while exhaustive nonloopback interface connection probes on Linux prove
only runner-local negative reachability and are not authoritative bind-address
evidence. Neither observes arbitrary outbound sockets or provides an offline or
zero-egress guarantee.
Earlier 2026-09-17 pre-correction runs passed the direct packaged-composition
smoke on macOS arm64 with Node 24.21.0 and pnpm 10.25.0. They recorded exact
owned-PID/port `/usr/sbin/lsof` loopback rows for both staged generations and
verified the sealed target-native stage, source inputs, Corepack copy, generated
outputs, and caller-owned paths remained within their declared integrity
contracts. Those runs are historical rather than final-tree acceptance evidence
after the subsequent review-finding corrections. On 2026-09-18 the corrected
final tree passed the direct macOS arm64 smoke in 167.223 seconds with manifest
`4b72d2f23dbc3dc41ffc7d023f9254acfbc1bb6201a53c6726e6ae940d5ff871` and stage
`05ba11662cbae3c72a72898f1c2abd3833998ba045518ea9000f2d82bf47c5b1`.
Linux staged-artifact evidence from the dedicated remote workflow remains
pending; no unrun target is promoted.
Windows remains analysis-only because the credential-free version probe
deliberately uses no shell and therefore does not execute the `.cmd` pnpm shims
commonly installed by Corepack/npm; no Windows support claim exists without a
native safe executable-resolution design and full gate evidence.

Vercel is an external build topology, not a repository-controlled exact-version
selector. It exposes a Node major selection and may roll minor/patch releases,
so it cannot durably select Node 24.21.0. LM-014 therefore excludes Vercel
preview builds from the supported local-first `main` product and its required
merge evidence. The external Vercel project uses `Only build production`: a
local-first push may create a canceled preview deployment record or
informational status, but the ignored-build check must cancel it before the
configured application build proceeds. The canceled record still consumes a
deployment and concurrent-build slot; that cost is accepted because hosted
deployments are infrequent. On 2026-09-16, PR 02B head
`e84e39867797801c2ab8cbfe1547ebb4d34c1a1f` received a successful Vercel status
labeled `Canceled by Ignored Build Step`; separate repository inspection found
no rulesets and no `main` branch protection that required Vercel. Production
remains on the operator-confirmed `hosted-v1-maintenance` branch recorded in the
orchestration document, and that external topology must be reverified before a
branch-role change. GitHub Actions provides the required exact Node and pnpm
final-head evidence; an informational Vercel status cannot replace it. No
repository `vercel.json` branch allowlist is added for this infrequent hosted
deployment topology. The checker is not bypassed or silently loosened.

The dedicated workflow also selects Python 3.12 and PostgreSQL 15. A run
requires installed frozen dependencies, an offline Corepack cache containing
pnpm 10.25.0, and full Git history containing the selected base SHA. Supply a
safe loopback or local Unix-socket administration connection through
`MIGRATION_TEST_ADMIN_URL`. If it is absent, the runner may start only an
already cached `postgres:15-alpine` image with `--pull=never` and a
loopback-published random port. It never downloads packages, images, datasets,
or model assets.

The runner validates the merge base and caller whitespace, then copies tracked
and nonignored inputs into a private disposable workspace with its own Git
repository. Ignored untracked environment files and credentials are not copied; tracked inputs remain included even if ignore rules now match them. Installed
dependency trees and the Corepack cache are cloned into private workspace-owned
copies, using copy-on-write file cloning when the filesystem supports it, and
no installer runs. Generators and build tools therefore have no write path
through shared dependency trees. All generation, build, database, and process
activity stays in the disposable workspace. Before preparation, the gate writes
a private external recovery record and then a nonce-bearing internal
`.git/lmbg-workspace-owner.json` marker. Cleanup requires both mode-`0600`
regular JSON records to agree on their exact canonical paths, nonce, device,
and inode, so immediate directory inode reuse cannot make a replacement
workspace look owned. The 12 fail-fast phases cover the contract checker,
documentation, backend
generation/typecheck/production-build/unit, isolated-database integration/e2e, developer
orchestrator, deterministic eval verification and scenarios, web production
build, Harbor static checks, hosted restart smoke, staged packaged-composition
smoke, and final generated-output/caller integrity.

Full and smoke-only summaries include `source.headSha` (the actual caller Git HEAD), `source.dirty` (observed porcelain status), and `source.copiedInputsSha256`. The digest hashes the exact deduplicated sorted copied input list from the destination before Git setup, dependencies or builds: versioned records bind relative path, file kind, regular-file permission bits and content SHA-256, or literal symlink target. Random ownership markers, Git home, absolute paths and timestamps are excluded by input-list membership. A disposable synthetic commit is never reported as caller HEAD. Caller HEAD/status are rechecked around copying; these observations do not promise an atomic working-tree snapshot. The digest identifies the inputs actually copied, including tracked-but-ignored files. Unknown pre-capture fields are `null`, and known fields survive failed preparation and finalization.

When external summary export is configured (`MIGRATION_GATE_CI_SUMMARY_PATH` or `RUNNER_TEMP`), both modes persist nonterminal external evidence before removing owned diagnostics and publish `passed` only after cleanup. Summary `callerIntegrity` retains its narrower meaning: selected generated Prisma, GraphQL SDL and web-generated paths are unchanged in the caller; it does not certify every source file or Git state. Final review evidence separately binds a frozen clean candidate and the actual CI checkout.

Run the production-process proof independently with:

```sh
pnpm migration:smoke:restart
```

The Hosted Baseline Clean-Restart Smoke migrates a random, server-verified
`context_router_<hex>_test` database, seeds the exact 19-entry catalog twice,
builds the backend and web app once each, and starts `node dist/main.js`
from `apps/backend` twice against the same state. An ephemeral loopback HTTPS
OIDC/JWKS server and short-lived signed read-only M2M token exercise the
production GraphQL and MCP verifiers without Auth0 or model-provider egress.
Before the backend generations, the built Next.js server is started on loopback
and its unauthenticated chat and debug-token envelopes plus login redirect/OIDC
discovery are probed. Each backend generation checks health, public and guarded
GraphQL behavior, the full authenticated catalog, exact OAuth/DCR metadata,
headers and success/error variants, MCP initialization/descriptors/resource
SDL/read tool envelope, loopback-only reachability, and stable catalog/principal
identity through restart.

Run the target-native staged-artifact proof independently with:

```sh
pnpm migration:smoke:packaging
```

The Step 02 Packaged Composition Smoke builds in an owned disposable workspace,
stages an offline production-only backend closure and Next standalone output,
seals both read-only, and launches both generations from a hostile
non-repository working directory with private mutable roots. It seeds the exact
catalog before each generation, exercises the hosted health, GraphQL, MCP,
OAuth protected-resource metadata, CORS, and web-support behavior through a
stable loopback proxy, and proves target-native package resolution,
stage/source/caller integrity, platform-appropriate loopback isolation, bounded
shutdown, and no live owned descendants. The backend deploy environment forces
`npm_config_package_import_method=copy`, and the smoke rejects regular-file
inodes shared between its private pnpm store and staged payload before sealing.
Both staged Node entrypoints disable global module lookup with
`--no-global-search-paths`. Its exact dependency-materializer allowlist excludes
installers and downloads, while an explicit source census covers every reviewed
direct and imported-helper `runCommand`, `spawn`, and `execFile` callsite and
pins the Git, Node, lsof, OpenSSL, and optional Docker-helper categories. This
remains staged-hosted feasibility evidence, not an installed product, offline,
or zero-egress claim. When the aggregate gate supplies its existing disposable
workspace, the packaging smoke independently reads the bounded non-symlink
ownership records and cross-validates the same canonical path, nonce, device,
inode, regular-file type, and private mode before using that workspace.

Database names, connected peers, and `current_database()` are validated before
destructive operations. Duplicate connection-routing parameters fail before a
PostgreSQL client receives credentials. Generated databases carry an
independent per-run ownership nonce in their comment and fallback containers
carry a separate per-run ownership label; cleanup refuses a known name
conflict, rechecks database identity/marker immediately before `DROP`, and
removes a verified container by immutable ID rather than mutable name.
Timed-out command trees receive bounded SIGTERM then SIGKILL, and nested phase
scripts forward cancellation into their own command groups. Diagnostics are
written mode `0600` only after streaming redaction of URL credentials,
bearer/JWT values, secret assignments, and test canaries. Every owned database,
container, listener, process, secret directory, and private temporary home is
recorded in the aggregate, restart, or linked web-subprobe mode-`0600`
lifecycle journal before or as it is acquired, with an exact recovery
instruction. Journal replacements are private, flushed, and atomically renamed.
Lifecycle serialization validates the schema and preserves control fields such
as resource IDs, types, ownership, status, cleanup state, and timestamps while
redacting only dynamic identity, recovery, and error values; a secret-canary
collision therefore cannot corrupt structural lifecycle evidence. After the
packaged-smoke command settles on either success or failure, the outer gate
independently verifies the diagnostics-directory identity, requires a regular
non-symlink mode-`0600` JSON journal, and rejects any nonterminal resource or
recovery-required state. A successful command additionally requires the exact
fixed resources, both backend generations, web-attempt evidence for both
generations, and exactly one administration source. Incomplete evidence reports
the persisted redacted recovery identities but does not automatically signal a
process named only by journal content.
Before loading the in-process Next build, the web subprobe snapshots the caller
environment, removes every inherited key, installs only its explicit allowlist
and synthetic credentials, and restores the exact snapshot after bounded
Next/listener cleanup.
SIGINT/SIGTERM cancel the active command tree and still run bounded cleanup;
the parent grants the web subprobe more termination grace than the sum of its
listener, Next preparation/closure, and temporary-home cleanup bounds. Failure
diagnostics live in a mode-`0700` directory that is retained and printed with
both primary and cleanup errors; success removes it together with the
disposable workspace and exact generated database/container. No production
database or persisted user state is a gate target.

The implemented Step 02E gate treats T+103 as a cooperative signal-aware
internal budget. The dedicated workflow's 108-minute gate-step timeout is the
hard process-execution fail-safe; it does not claim that arbitrary in-process
code which ignores cancellation can still complete scoped cleanup. Cleanup
never races resource-owning work that has not settled, and any outer-timeout
recovery is limited to exact identities already persisted in private journals.

On 2026-09-18, the Step 02E correction tree passed all 244 local-migration tests.
The dedicated Linux run had exposed zombie-only process groups that remained
observable to `kill(0)` after every member was non-executable; the correction
now treats only Linux `Z`/`X`/`x` members as quiescent, fails closed on ambiguous
`/proc` evidence, and bounds post-`SIGKILL` settlement. A subsequent Linux
phase-1 run exposed immediate device/inode reuse after a disposable workspace
was deleted and recreated on overlay storage. The gate now writes the external
recovery record first, binds it to a nonce-bearing internal `.git` marker, reads
both through bounded non-symlink regular-file checks, and independently
cross-validates canonical path, nonce, device, and inode before cleanup and in
the packaging consumer. Fresh read-only reviews approved both CI corrections
with no remaining findings. All seven focused Linux cleanup regressions and all
three focused workspace-identity regressions passed in the network-disabled
Node 24 image. The corrected final tree then passed the direct
packaged-composition smoke in 167.223 seconds with manifest
`4b72d2f23dbc3dc41ffc7d023f9254acfbc1bb6201a53c6726e6ae940d5ff871` and stage
`05ba11662cbae3c72a72898f1c2abd3833998ba045518ea9000f2d82bf47c5b1`.
The exact-base 12-phase aggregate gate then passed in 454.088 seconds, including
phase 11 in 180.580 seconds, with merge-base comparison performed and caller
integrity preserved. Final-head standard and dedicated remote workflows are
still required before human landing.

The superseded 128-test, 227.805-second, and remote-green results were collected
at head `493bf49` before independent review found a production-entrypoint
regression; they are not current acceptance evidence. On 2026-09-15, the
remediated focused migration suite passed 133/133 tests and committed
implementation head `b568834` passed all 11 aggregate phases in 231.787 seconds,
including its 35.256-second clean-restart phase, with Node 20.19.5, pnpm 10.25.0,
Python 3.12.8, and PostgreSQL 15.15. It reported
`baseComparison=performed`, preserved caller integrity, and removed its exact
generated databases and fallback container. Two consecutive backend builds and
an independent 76.980-second restart smoke also proved the restored
`dist/main.js` production entrypoint. On 2026-09-16, PR #156's remediated head
`d68dd6c` passed its Node 20/pnpm 9 remote gate and all applicable standard
checks. The path-filtered `eval-harbor-checks` job skipped, while the aggregate
gate's Harbor static phase passed. Required checks on the final documentation
head must remain green at human review.

## Updating A Contract

Run the checker without update flags during ordinary validation:

```sh
node scripts/local-migration/check-contract-baseline.mjs
```

The `--update-derived-fixtures` flag rewrites only the schema-derived GraphQL,
catalog, named-consumer, public-reference census, and outbound-sink census
sections. It never adds semantic boundary classifications or source
fingerprints; those remain explicit review decisions. MCP has a separate
runtime collector:

```sh
cd apps/backend
node -r ts-node/register -r tsconfig-paths/register \
  test/contracts/update-mcp-contract-fixture.ts
```

Fixture updates are review actions, not fixes for a failing compatibility test.
The same change must update its evidence, classification and owner; public
breakage must follow the compatibility policy in
[`orchestration.md`](../plans/active/local-migration/orchestration.md). The
aggregate migration gate compares semantic fixtures to a validated merge base
and fails on unreviewed breaking drift or a manifest shape change without a
version bump.

Every migration-record consumer entry carries both `consumerId` and `path`.
The stable IDs are `fp:<fingerprint-consumer-id>` for curated HTTP/MCP/external
boundaries, `graphql:<path>:<kind>:<operation>:<sorted-root-fields-json>` for
static or dynamic GraphQL documents, and
`ref:<path>:<contract>:<kind>:<reference>` for derived public references. The
checker unions identities from both sides of a transition, verifies the exact
ID-to-path mapping, rejects duplicate evidence IDs, and prints every missing or
path-mismatched identity. Static and declared dynamic GraphQL consumers resolve
root fields through named and inline fragments with cycle-safe traversal, and
the four restart-smoke probes are named members of that census. External-client
buckets/callbacks plus explicit unknown- and known-MCP-client contract
affinities are protected as normalized sets. MCP auth/config rows derive their
GraphQL-schema and catalog affinities from the exact tool/resource visibility
fixture; zero-capability unknown clients remain unaffected by those two
contracts. Adding a declaration is compatible, while deletion or retargeting
requires a versioned exact registry migration record.

HTTP evolution fails closed for new constraints on an existing route except
strictly optional request/multipart field growth; response-domain and accepted
upload MIME changes require review. MCP evolution likewise requires review for
new client/visibility buckets; existing-client capability, target-rule and
redirect changes; OAuth, DCR, and challenge metadata changes; visibility and
tool/resource authority changes; tool task-execution changes; tuple/constant
and other constraining input-schema arrays; and output-schema domain changes.
Proven input widenings such as added `enum`, `type`, or `anyOf` members remain
additive. Existing GraphQL enum, union, and interface possible-type widenings
require review because generated or exhaustive clients can treat those output
domains as closed.
