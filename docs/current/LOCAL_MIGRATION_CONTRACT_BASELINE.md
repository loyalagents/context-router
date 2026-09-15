# Local Migration Contract Baseline

This document is the human-readable companion to the versioned
[`local-migration-contract-baseline.json`](local-migration-contract-baseline.json)
registry. The registry and its referenced fixtures are the executable baseline
for migration Step 01. They describe the hosted product at planning base
`9b56d38fde927d4e643af89ba45665a439613939`; they do not declare the hosted
implementation to be the target local architecture.

The supported composition remains the NestJS backend and Next.js web app backed
by PostgreSQL, Auth0, and Vertex AI. Step 01 adds characterization and validation
only, apart from the later checkpoint's opt-in `APP_HOST` test setting. Leaving
that setting unset preserves the existing listener call shape.

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

The registry currently contains 36 decisions: 16 retain, 6 replace, 10 remove,
and 4 defer. The detailed rationale, evidence path, owner, external callback
allowlists, outbound inventory, and exact consumer map live in the JSON registry
so missing owners and stale paths can fail automatically.

## Public Contract Families

### GraphQL

[`graphql-schema.semantic.json`](../../apps/backend/test/contracts/fixtures/graphql-schema.semantic.json)
normalizes the complete checked-in [`schema.gql`](../../apps/backend/src/schema.gql)
by type kind, roots, scalar metadata, exact list/non-null wrappers, fields,
arguments, default presence and literals, input fields, enums, interfaces,
unions, and deprecations. Descriptions, source locations, and declaration order
are deliberately excluded from semantic compatibility.

The baseline has 15 query fields, 15 mutation fields, and no subscription. The
checker parses and validates 41 named in-repo operations across the web app,
developer orchestrator, and eval tooling. It separately tracks dynamic shell
and runbook queries that cannot safely be extracted as ordinary template
literals. Unknown external GraphQL clients are assumed to exist.

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
access.

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

## Updating A Contract

Run the checker without update flags during ordinary validation:

```sh
node scripts/local-migration/check-contract-baseline.mjs
```

The `--update-derived-fixtures` flag rewrites only the schema-derived GraphQL,
catalog, and named-consumer sections. MCP has a separate runtime collector:

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
