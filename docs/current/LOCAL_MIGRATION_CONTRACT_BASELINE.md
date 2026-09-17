# Local Migration Contract Baseline

This document is the human-readable companion to the versioned
[`local-migration-contract-baseline.json`](local-migration-contract-baseline.json)
registry. The registry and its referenced fixtures are the executable baseline
for migration Step 01. They describe the hosted product at planning base
`9b56d38fde927d4e643af89ba45665a439613939`; they do not declare the hosted
implementation to be the target local architecture.

The supported composition remains the NestJS backend and Next.js web app backed
by PostgreSQL, Auth0, and Vertex AI. Step 01 adds characterization and validation
plus an opt-in `APP_HOST` test setting. Leaving that setting unset preserves the
existing listener call shape.

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

The registry currently contains 39 decisions: 18 retain, 7 replace, 10 remove,
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
checker parses and validates 45 named in-repo operations across the web app,
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

The exported definition helper creates no users. The private production seed
entry point still creates two sample users; removal belongs to Step 04.

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

Normal hosted operation can contact PostgreSQL, Auth0 Management/JWKS endpoints,
Google Vertex and credential endpoints, and the configured web/backend origin.
Opt-in tooling can additionally contact an arbitrary orchestrator backend,
spawn commands with inherited environment, and invoke hosted model/evaluation
providers. The exact data classes, default status, disposition, and owner are
machine-readable in the registry.

Important observed boundaries include:

- raw document bytes and memory values can be sent to Vertex, including on a
  structured retry;
- Auth0 human identity and MCP client identity are currently conflated for M2M
  tokens, and email linking does not require a verified assertion;
- the default backend listener is not code-confined to loopback;
- MCP Origin checks do not cover the entire browser trust boundary, and proxy
  headers are trusted for DCR rate limiting;
- rejected DCR requests currently log the complete untrusted redirect-URI
  array, including any query strings; Step 07 must replace that with redacted
  origin/class/outcome logging before local transport ships;
- provider prompt prefixes, extracted old/new preference values, identity
  subjects/emails, and upload filenames/user IDs can enter current logs; Steps
  06, 08, and 09 own centralized value-aware redaction and safe logging before
  those paths become local-product surfaces;
- audit snapshots contain values, while sensitivity masking is derived from the
  live catalog; and
- the authenticated web debug route renders a complete bearer token.

These facts motivate later replacements and removals. They are not claims that
unsafe behavior must be preserved.

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
supported-mode rules. Every supported mode must retain an active clean-restart
smoke. Each mode records active/retired status and at most one successor; a
retired mode must name exactly one active successor, and a later step adds
replacement evidence before retiring a hosted-only phase. The version-one
command allowlist remains intentionally hosted-specific and must be reviewed
and expanded atomically with the first successor-mode phase set.
The aggregate runner requires a verified merge-base comparison for every
contract-baseline phase command and fails if the bound artifact directory is
missing. Direct checker runs remain useful for current-tree validation and
report `baseComparison=skipped`; aggregate runs report
`baseComparison=performed` so the comparison cannot disappear silently.

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
deployments are infrequent. Before PR 02B lands, an operator verifies that
policy, verifies no GitHub rule or branch-protection setting requires Vercel,
and confirms production still follows `hosted-v1-maintenance`. GitHub Actions
provides the required exact Node and pnpm final-head evidence; an informational
Vercel status cannot replace it. No repository `vercel.json` branch allowlist
is added for this infrequent hosted deployment topology. The checker is not
bypassed or silently loosened.

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
repository. Ignored environment files and credentials are not copied. Installed
dependency trees and the Corepack cache are cloned into private workspace-owned
copies, using copy-on-write file cloning when the filesystem supports it, and
no installer runs. Generators and build tools therefore have no write path
through shared dependency trees. All generation, build, database, and process
activity stays in the disposable workspace. The 11 fail-fast phases cover the
contract checker, documentation, backend
generation/typecheck/production-build/unit, isolated-database integration/e2e, developer
orchestrator, deterministic eval verification and scenarios, web production
build, Harbor static checks, restart smoke, and final generated-output/caller
integrity.

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
