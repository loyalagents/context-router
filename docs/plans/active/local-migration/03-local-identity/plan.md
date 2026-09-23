# Step 03: Local Identity

- Document status: approved for implementation after renewed independent review
- Program step: `03-local-identity`
- Target line: `main`
- Planning and implementation branch:
  `codex/local-migration-03-local-identity`
- Planning base: `6b420ed24e9dd344af8990c9045832990ae1b5ec`
- Change classification: `local-only`
- Hosted production line: `hosted-v1-maintenance` is unchanged
- Depends on: Step 02 PR
  [#161](https://github.com/loyalagents/context-router/pull/161), human-merged
  at the planning base; final tested head
  `00e4240564b3b63997d63cc581c6e52fbba0f613`
- Planning owner, implementation owner, and sole repository writer: `/root`
- Implementation shape: one draft PR with five internal checkpoints; no
  automatic merge
- Supported modes after merge: retained `hosted-baseline` and explicit,
  non-listening `local-identity-preview`
- Last updated: 2026-09-22

## Outcome

Keep `User.userId` as the stable opaque human principal and make provider
credentials replaceable edge adapters. A verified provider adapter emits one
small provider-neutral assertion keyed by `provider + issuer + subject`; a
generic resolver returns or creates the principal without using email as an
identity key. Auth0 remains one adapter for the retained main-line hosted
baseline, but no historical Auth0 user, issuer, session, or email binding is
migrated. Existing user-owned rows on an upgraded main-line PostgreSQL database
are intentionally deleted before the new identity key is installed, consistent
with LM-002 and the user's explicit fresh-data direction.

Add a single-user local adapter whose authoritative ready principal and
independent credential live in one canonical private file under an explicitly
supplied absolute root. A durable operation mutex and complete private
candidate fence filesystem mutation across database-session loss; explicit
recovery distinguishes an empty database from the exact committed principal
before canonical publication. Rotation atomically replaces the ready state
while preserving the principal. The local preview initializes the real Nest
composition with `init()` and never calls `listen()`.

The already-pushed Checkpoint 2 commit implemented a historical-user migration
path before the fresh-data requirement was clarified. It will be corrected by
a normal follow-up commit; branch history will not be rewritten or force-pushed.

## Required Reading

- Repository `AGENTS.md`, root `README.md`, `docs/README.md`, and every file in
  `docs/IMPORTANT/`
- [`../orchestration.md`](../orchestration.md),
  [`../decision-log.md`](../decision-log.md),
  [`../step-template.md`](../step-template.md), and
  [`../tracks/interface-evolution.md`](../tracks/interface-evolution.md)
- Complete Step 01 and Step 02 README/plan material and the current human/JSON
  contract registries
- Current identity, authorization, reset, access-history, runtime, packaging,
  restart, and operator documentation
- Identity/Auth0/user/external-identity/guard/composition/configuration/MCP/
  reset/test/gate source and tests

## Entry Criteria And Evidence

- Step 02 PR #161 was human-merged at the exact planning base after standard CI
  [35318582335](https://github.com/loyalagents/context-router/actions/runs/35318582335)
  and dedicated Local Migration Baseline Gate
  [35318582309](https://github.com/loyalagents/context-router/actions/runs/35318582309)
  passed.
- `HEAD`, local `main`, `origin/main`, and both merge bases matched the planning
  base before activation; history was complete and the worktree was clean.
- `/root` is the sole writer. Review agents are read-only. No other writer owns
  identity, composition, generated-contract, lockfile, or gate hotspots.
- The activation gate passed all 12 phases in 461,692 ms on exact Node 24.21.0,
  pnpm 10.25.0, Python 3.12.8, and an isolated loopback PostgreSQL 15.15
  fixture. It performed the base comparison, reported caller integrity true,
  and cleaned its exact container/resources.
- The user explicitly clarified on 2026-09-22 that existing user data may be
  wiped and that future provider compatibility takes priority. This restores
  alignment with accepted LM-002 and LM-007 and invalidates the historical-user
  migration portion of the first approved Step 03 plan.

## Current Evidence

- `User.userId` already keys preferences, grants, audit, access history, and
  GraphQL. A repository-wide rename is unnecessary.
- Base `ExternalIdentity` identifies a user by provider and provider subject but
  lacks an issuer/authority dimension. Base auth falls back to email lookup and
  automatic linking, so provider identity and contact data are conflated.
- Prisma and public GraphQL currently require non-null unique `User.email`.
  Profile email is editable memory and cannot be authentication authority.
- Common GraphQL/REST guards hardcode one Passport strategy, while Auth0 clients
  and JWKS are composed only by the hosted root.
- MCP client identity, client grants, browser/session credentials, and the local
  human credential are separate security subjects.
- The Step 02 package already provides sealed relocatable backend output and
  bounded restart/package evidence. Step 03 adds ordinary compiled Node
  entrypoints, not a native launcher or alternate package system.
- Checkpoint 1 characterization is committed. Checkpoint 2's pushed historical
  link/audit implementation is unmerged and may be removed without preserving
  its behavior. Checkpoint 3 work remains uncommitted and is being realigned
  with the revised provider/data contract before it becomes supported.

## Scope

1. Preserve useful characterization for hosted exact identity, `me`, self-only
   `user(id)`, REST guards, M2M separation, reset, GraphQL SDL, MCP/grants,
   restart, and package behavior.
2. Bind common human guards to the stable Passport name `human`, with exactly
   one hosted or local implementation per explicit composition root.
3. Add a narrow verified-human-identity assertion and provider-neutral
   principal resolver. Keep Auth0 verification/profile enrichment at the Auth0
   edge. Never look up or link a principal by email.
4. Add required external-identity issuer storage and exact triple uniqueness.
   Intentionally wipe old user-owned data instead of backfilling, auditing,
   mapping, or admitting historical identities.
5. Add crash-safe private local identity state, explicit initialize/recover-
   initialize/rotate/recover-rotation/open behavior, direct verified-TLS
   PostgreSQL reconciliation, advisory serialization, bounded deadlines, and
   fixed diagnostics.
6. Add a local Nest root and non-listening preview using real guards, a fixed
   unavailable model adapter, and no Auth0/MCP/web composition.
7. Remove the backend's now-unused direct `auth0` SDK dependency from its
   manifest and the workspace lockfile using the exact toolchain; add packaged
   process/restart/failure evidence inside the existing gate phase and update
   registries and lasting documentation.

## Non-Goals

- Any change to `hosted-v1-maintenance`, deployment, or production-remediation
  claim
- Preserving, translating, auditing, backing up, or automatically linking
  existing PostgreSQL/Auth0 users on `main`
- An account-merging UI or implicit linking of multiple provider keys; a future
  link flow must start from an already-authenticated principal
- A provider registry, generic IAM framework, repository-wide `User` rename, or
  provider enum
- SQLite or the generic repository/unit-of-work work owned by Steps 04–05
- Local model runtime owned by Step 06
- Local MCP transport/client auth owned by Step 07
- Browser sessions/UI cutover owned by Step 08
- Final data location, keychain, installer, signing, supervision, backup UI, or
  destructive identity-reset UX owned by Step 09
- LAN listener/pairing owned by Step 10
- Changes to `.github/workflows/ci.yml`; the lockfile is in scope only for the
  exact backend `auth0` dependency removal

## Contracts And Compatibility

| Surface | Step 03 contract |
| --- | --- |
| Human principal | `User.userId` remains opaque and stable. Email, provider subject suffixes, MCP keys, machine identity, paths, and row order never derive it. |
| Verified provider assertion | Generic code receives `{provider, issuer, subject}` plus optional non-authoritative profile hints only after an edge adapter verifies the credential. |
| External identity | Required canonical issuer and exact unique `(provider, issuer, subject)` key. Multiple keys may point to one principal only through a future explicit authenticated-link flow. Metadata is never authentication authority. |
| Existing user data | Intentionally incompatible on the local-first `main` upgrade: user-owned data is deleted before the new required issuer key is installed. No sentinel/backfill or email claim path exists. `hosted-v1-maintenance` preserves the old hosted product. |
| Email/profile | `User.email` remains non-null public account data but is no longer unique. A verified provider email is stored for a newly created hosted principal; absent verified contact and local principals use a deterministic non-routable `.invalid` value. Email may seed profile memory but is never lookup, linking, authentication, or authorization input. Later email changes do not invalidate identity. |
| Auth0 | Retained only as one hosted edge adapter. Exact signature, audience, canonical issuer, and subject are verified before the generic resolver. Provider network calls do not occur inside its transaction. |
| Local credential | Independent 256-bit bearer in private state only; not an external identity, MCP credential, browser credential, database secret, or profile value. |
| Local database reconciliation | Empty DB inserts the canonical principal. Existing DB must contain exactly that sole `userId`; email is ignored after creation. Provider bindings are allowed only when attached to that principal. Wrong/multiple users fail without mutation. |
| GraphQL/REST | Existing schema, routes, and response envelopes remain. `me` is current principal and `user(id)` remains self-only. |
| MCP/OAuth/DCR | Hosted wire contracts remain. A hosted MCP token for a human may resolve its verified human subject through the generic resolver, but `azp`, client bucket, scopes, and grants never become the human key. Existing `sub@clients` M2M compatibility remains outside `ExternalIdentity` until Step 07. Local preview excludes `McpModule`, and the local human bearer never authenticates MCP. |
| Model | Hosted model stays in hosted composition. Local composition binds both AI ports to a fixed unavailable/no-I/O adapter. |
| Configuration | Backend hosted auth keeps only explicit `AUTH0_ISSUER` and `AUTH0_AUDIENCE`; JWKS URI/host derive from the canonical issuer. Backend `AUTH0_DOMAIN`, client ID/secret, Management audience, sync strategy, legacy issuer, and link claims are removed. Identically named web variables and `AUTH0_MCP_*` remain in their owning compositions. Local reads exactly its explicit state root, database URL, and TLS CA snapshot and never dotenv/cwd/HOME/cloud/Auth0 values. |
| Process/network | Hosted entrypoint remains default. Local CLI is relocatable compiled package output. Preview never listens; its only socket is direct verified TLS to literal loopback PostgreSQL. |

Known consumers that must stay green are hosted bootstrap/restart/package
smokes; GraphQL resolvers/guards/schema; REST controllers; dashboard generated
types; web Auth0 middleware/routes; MCP guard/controller/client/grant/access/
audit services; reset and seed; test setup/launchers; env examples; eval/local-
orchestrator fixtures; package closure; registries; and the migration gate.
Unknown external GraphQL/REST/MCP consumers retain the Step 01 interface policy.

## Design

### 1. Narrow provider-neutral human identity

Keep `HUMAN_AUTH_STRATEGY = "human"`. Common human GraphQL, optional GraphQL,
and REST guards use it. Hosted composition registers the Auth0 JWT strategy
under that name; local composition registers the private bearer strategy.

Add a small shared port, conceptually:

```ts
interface VerifiedHumanIdentityAssertion {
  key: { provider: string; issuer: string; subject: string };
  profileHints?: {
    verifiedEmail?: string;
    displayName?: string;
    givenName?: string;
    familyName?: string;
  };
}
```

The assertion carries verified adapter output, not a raw JWT/Auth0 object. The
generic resolver imports no Auth0, JWT, JWKS, provider SDK, or hosted config
types. Provider strings remain adapter-owned open values; adding Google,
GitHub, or another provider requires a verifier that emits this assertion, not
a schema or application-service switch. The shared boundary nevertheless
revalidates fixed bounds and canonical representation: a short lowercase ASCII
provider identifier, a bounded adapter-canonical issuer/authority string, a
bounded nonempty opaque subject, and bounded UTF-8 profile hints. Invalid input
fails with fixed cause-free diagnostics before a query. Only verified edge
strategies receive the resolver in composition; a type name alone is not
treated as runtime proof.

The resolver uses a bounded retry around a fresh serializable transaction:

1. find the exact `(provider, issuer, subject)` including its `User`;
2. return the principal if present;
3. otherwise generate an opaque `userId`, use the verified account email when
   supplied or derive the compatibility `.invalid` value, and atomically create
   `User` plus `ExternalIdentity`;
4. on serialization/unique conflict, roll back the whole transaction and retry
   from a fresh transaction;
5. treat a final unique conflict as a benign race only when an exact
   post-rollback lookup exists; otherwise fail closed.

Different exact keys create different principals even when verified account
email is identical; `User.email` therefore loses its database uniqueness
constraint while remaining non-null in Prisma and GraphQL. No provider call or
profile write occurs in the transaction. Profile hints are seeded only after a
newly created principal commits; seeding failure does not rebind or fail
authentication of an otherwise valid exact identity. Human MCP tokens may use
this resolver, but MCP client identity/grants and the temporary `sub@clients`
compatibility path remain outside it. Because email uniqueness is removed, that
temporary M2M path uses a deterministic namespaced compatibility `userId` and
an atomic upsert/race check rather than email uniqueness; the row is explicitly
not a human principal or `ExternalIdentity` binding, and Step 07 still owns its
removal/replacement.

### 2. Fresh-data schema and Auth0 adapter

`ExternalIdentity` gains required `issuer`; the existing database column mapped
as `provider_user_id` continues to carry the opaque subject. The unique/indexed
key becomes `(provider, issuer, provider_user_id)`. `User.email` remains
required but its unique constraint is removed so two exact identities with the
same verified contact remain distinct principals without inventing a different
display value. There is no legacy sentinel, default, metadata marker,
historical email canonicalizer, disposition manifest, audit CLI, admission
scan, or automatic account claim.

The migration is one transaction that first locks the user and external-
identity tables against old writers, deletes `User` rows and relies on existing
foreign-key cascades for user-owned records while retaining unrelated global
rows, then adds the required issuer column, removes email uniqueness, and
installs the triple indexes. Old binaries must be stopped before migration and
must not restart. Fresh installation and destructive-upgrade fixtures seed
every user-owned relation plus retained global definitions, block a concurrent
old writer, force a DDL failure to prove whole-transaction rollback, and prove
the successful exact result. Translation is unsupported.

The Auth0 JWT strategy remains responsible for signature/JWKS, audience,
canonical configured issuer, token issuer, expiration, and subject validation.
It emits provider `auth0` plus the configured issuer/subject and only verified
token-claim profile hints to the generic resolver. The backend `Auth0Service`,
Management client, Authentication client, and their module are deleted; Step 03
therefore fulfills the accepted outbound-registry removal and makes no Auth0
profile/API call beyond JWKS. The backend derives JWKS from canonical
`AUTH0_ISSUER` and no longer accepts its management/domain/client/sync settings.
Web Auth0 configuration is untouched for Step 08; `AUTH0_MCP_*` stays with the
hosted MCP composition until Step 07. Env examples, Cloud Run/login guidance,
test setup, schema fixture, gate runner, restart/package smokes, token-tool
environment propagation, outbound registry, and sink census are updated and
tested accordingly. The exact Node/pnpm toolchain removes the backend's direct
`auth0` runtime dependency and updates the workspace lockfile; a frozen install
and relocated deployed-backend closure prove the SDK is absent there while the
web package's separately owned Auth0 dependency remains. Touched logs/errors
remain fixed and omit token claims, email, subject, principal, URL, SQL, and
causes.

### 3. Local configuration and database peer

The supported compiled CLI has exactly `initialize`, `recover-initialize`,
`rotate`, `recover-rotation`, and `preview`. It reads a narrow supplied snapshot
containing:

- absolute `LOCAL_IDENTITY_STATE_ROOT`;
- bounded `DATABASE_URL` for literal `127.0.0.1`, explicit port/database, and
  user/password, with no socket, alternate host, query, or fragment;
- bounded single-certificate `LOCAL_DATABASE_TLS_CA_PEM`.

The parser never loads dotenv or reads cwd, package root, HOME, XDG, `.env`,
`.pgpass`, Auth0, Vertex, Node-option, or cloud values. Dedicated `pg.Client`
and local Prisma pool options use direct TLS with CA/IP-SAN verification,
bounded connect/query/statement/lock timeouts, and no proxy/discovery. A
credential-free `databaseTargetId` hashes protocol, host, port, decoded
database/schema, and CA SPKI digest, excluding username/password.

Every admin mutation owns one dedicated non-pooled PostgreSQL session and the
two-key `pg_try_advisory_lock(int,int)` lock until file/database work completes.
Timeouts use an injected database clock in unit tests, destroy the client, issue
no later query, and map commit ambiguity to fixed recovery guidance. Connection
error/end events latch session loss; guards run around every filesystem
mutation. These health checks limit work but are not claimed as the filesystem
fence: the durable fixed operation record owns the root until cleanup, and
candidate-before-commit ordering prevents an old different-root session from
publishing ready state after a new database owner proceeds. Fresh-client tests
prove lock release after success, error, deadline, cancellation, signal, and
killed session.

### 4. Canonical private state and crash protocol

The canonical `identity.json` is bounded canonical UTF-8 JSON containing
schema version, credential-free database target ID, independent random
principal ID and credential, and positive generation. Principal and credential
are separate 32-byte CSPRNG values encoded as unpadded base64url.

The state root is an explicit current-UID-owned mode-0700 real directory under
a trusted pinned ancestry. Every component is a real non-symlink directory
owned by root or the current UID and not group/other-writable, except the
root-owned sticky anchor needed for conventional temporary directories.
Parent/root `(dev,ino)` identities are pinned and checked around every pathname
mutation. Final files use no-follow access and are current-UID-owned regular
mode-0600 files. Unsafe owner, type, mode, symlink, hardlink, replacement, size,
format, unknown entry, or target mismatch fails closed. Same-UID/root/kernel
attacks and hardware power-loss qualification remain Step 09 limits.

Mutation uses only same-directory, fixed-format artifacts:

- fixed `identity.operation.json`, containing a non-secret operation type,
  target ID, nonce, candidate basename, and base/proposed generation/digests;
- complete `identity.pending-<nonce>.json` or
  `identity.rotate-<nonce>.json` candidate;
- unique operation/candidate staging inodes whose names include the nonce.

An operation is published from a completely written/fsynced private stage by a
same-directory no-clobber hardlink to the fixed operation basename. The winner
must prove stage and record are the same pinned inode with exact canonical bytes,
metadata, and link count, fsync the directory, remove only its redundant stage,
and fsync again. A loser removes/fsyncs only its own unlinked stage. The fixed
record is the durable root mutex independent of database-session liveness. The
same complete-write/fsync/no-clobber/post-link-verify/directory-fsync/stage-
unlink/directory-fsync sequence publishes the candidate. No database mutation
may begin until both operation and complete candidate are durable and verified.

Initialization order is database advisory lock, fixed root operation, complete
candidate, locked database transaction, acknowledged commit, then no-clobber
hardlink of that candidate to canonical ready state and cleanup. The transaction
accepts only an empty database or the exact sole candidate principal from a
prior ambiguous commit. On empty DB it inserts the principal with deterministic
`.invalid` email. On an existing exact principal it ignores email bytes and
performs no user/email/provider mutation. Zero or more external identities are
accepted only when all attach to that principal; wrong/multiple users or a
foreign identity fail without mutation.

Same-database/different-root attempts serialize on the advisory key. If an old
session dies, its different root can contain only an operation/candidate until
the DB outcome is known; it cannot publish a ready credential for a competing
principal. Same-root/different-database attempts race on the fixed root record,
and only the verified winner can reach either database. The operation mutex
also prevents a stale in-flight rotation rename from being followed by a new
same-root rotation after lock loss. Each filesystem syscall still has before/
after session checks, but correctness relies on durable ordering and ownership,
not on observing connection death before an in-flight syscall.

First canonical publication hardlinks the committed complete initialization
candidate no-clobber, proves same inode/bytes/metadata, fsyncs the directory,
then removes/fsyncs candidate artifacts. Rotation similarly publishes its
complete candidate first, verifies the old canonical/principal under both
locks, then atomically renames the candidate over the revalidated canonical and
fsyncs the directory. Rotation never changes principal, target, account email,
or provider bindings. After successful cleanup, artifacts are removed/fsynced
before the fixed operation record is removed/fsynced last; successful rest has
exactly `identity.json`.

Normal open refuses any operation, candidate, stage, unknown entry, or insecure
state and never repairs. Named recovery is a quiescent break-glass operation:
the caller must first terminate and reap the original admin process and every
other admin process using that root. Acquiring the database advisory lock is
not proof of process death because a session-lost process may still complete an
in-flight filesystem syscall. The CLI documentation and gate supervisor make
this precondition explicit; supported recovery never overlaps a live or
stopped original process. After quiescence, named recovery acquires the matching
database lock and validates exact target/root/operation ownership before
mutation. The enumerated recovery classes are:

- orphan operation stages before any published operation/candidate: acquire a
  fresh `recover-orphans` no-mutation operation record as root mutex, remove
  even partial stages one at a time with a directory fsync after each unlink,
  and remove/fsync the recovery record last;
- a published `recover-orphans` operation with zero or more bounded orphan
  operation stages and no candidate/canonical mutation authority: validate the
  record and matching database/root ownership, resume the same one-at-a-time
  stage cleanup, then remove/fsync that recovery operation last; a crash at any
  cleanup boundary re-enters this same class;
- a published operation plus its exact redundant same-inode stage: remove only
  the redundant stage, then continue that operation;
- after the published operation and matching DB advisory lock establish root
  ownership, normalize composable crash/race residue before DB-state recovery:
  remove/fsync the winner's exact same-inode operation stage; remove/fsync any
  bounded nlink-1 operation stage that provably never won the fixed basename,
  even if partial and from a different-database loser; and verify/remove/fsync
  an exact same-inode candidate stage while retaining its published candidate;
  these residues may coexist and all other link/inode relationships fail;
- a published operation plus an unpublished partial/complete candidate stage:
  remove it and the operation only when ordering proves DB mutation could not
  have begun;
- a published initialize operation with no canonical state, published
  candidate, or candidate stage: ordering proves database mutation could not
  have begun, so remove/fsync the operation and allow a later fresh
  initialization; this also resumes the state left by a crash after safe
  candidate-stage cleanup but before operation cleanup;
- initialize operation/candidate plus DB empty: resume that candidate through
  insertion, commit, canonical publication, and cleanup;
- initialize operation/candidate plus exact sole principal: treat commit as
  successful, publish that same candidate, and clean up;
- canonical plus initialize operation and optional same-inode candidate: verify
  exact principal and finish cleanup;
- rotation operation with exact old canonical and no published candidate: keep
  old credential and clean up;
- rotation operation with exact old canonical and complete proposed candidate:
  verify DB/principal, discard the uncommitted candidate, and keep old state;
- canonical at proposed generation/digest after atomic rename: keep new state
  and finish cleanup.

A partial/corrupt stage is removable only in a pre-mutation class where ordering
proves it never authorized DB/file authority. Partial/corrupt published records
or candidates, wrong target/principal/generation/digest, missing authority,
multiple candidates, unsafe metadata, or an unenumerated inode relationship
fail without deletion. Cleanup is monotonic and restartable at every create,
write, fsync, link, post-link verification, directory fsync, rename, and unlink
boundary. Process-crash consistency is claimed; platform full-sync and hardware
durability remain Step 09.

Fault tests stop after every boundary between publishing an initialize
operation and beginning its candidate stage, after candidate-stage removal and
before operation removal, and after publishing `recover-orphans` with zero,
one, or several orphan stages. Repeated named recovery must monotonically reach
no transient artifacts without touching the database: an empty
pre-initialization root, or canonical-only state when ready state coexists with
a rotation-origin orphan. Tests cover both, and an injected crash at every
stage unlink/fsync or final operation unlink/fsync must re-enter the same
enumerated class.

Process tests separately force session loss immediately before each filesystem
mutation, hold the original child stopped, and prove the supervisor does not
start recovery yet. They then terminate and reap that exact child, record the
exit observation before the recovery child starts, and prove recovery reaches
the expected clean state. The signal, deadline, restart, package, and gate
paths use the same terminate-wait-recover ordering; recovery while the original
process remains live or stopped is outside the supported contract and is never
presented as safe takeover.

A lost/timeout response during or after `COMMIT` is always fixed `recovery
required`; it never deletes the candidate/operation or retries with a new
principal. Unit tests use injected storage/database clocks and fault adapters
for every syscall and query, including rollback. Real tests use a test-only
deferred PostgreSQL constraint trigger/advisory lock to hold the child inside
`COMMIT`, stop the Node process, release the database blocker, prove the exact
row committed while the process cannot publish, then kill and recover. No
production hook, proxy, hidden channel, or test resource enters the package.

### 5. Local authentication and non-listening composition

The local Passport strategy accepts one strict Bearer value, opens validated
ready state for each request, compares exact decoded bytes in constant time,
loads the exact principal, then rereads/revalidates canonical state before
returning. The second read is the linearization point for rotation. Missing,
wrong, malformed, old, changed, extra-artifact, target-mismatched, or
principal-mismatched state fails with fixed unauthorized output.

`LocalApplicationModule` explicitly composes local configuration/database,
local auth, shared GraphQL/REST application modules, reset, and a fixed
unavailable model adapter. It does not import the hosted Auth0/JWKS strategy,
Auth0 clients, hosted model provider, `McpModule`, or web app. `preview` verifies
state/DB, creates the real app with bounded logging, calls `init()`, emits one
fixed non-secret readiness record, waits for SIGINT/SIGTERM, and closes without
ever calling `listen()`.

### 6. Package, restart, gate, and cleanup

Admin/preview entrypoints compile into and execute from relocated Step 02
package output using `node --no-global-search-paths`. Tests run from hostile
cwd/HOME with allowlisted environment, poisoned dotenv/cloud/Auth0/driver
canaries, and no source-tree fallback or absolute build path.

The human/JSON contract registry and migration-gate manifest advance together
to list `hosted-baseline` and `local-identity-preview`. Existing phase IDs,
order, commands, outer timeouts, hosted evidence, and exact toolchain remain.
The local mode is named on every phase that supplies one of its required
contract/build/state/restart/integrity classes:

| Existing phase | Active modes |
| --- | --- |
| `contract-baseline`, `documentation`, `backend-unit-build`, `backend-database` | `hosted-baseline`, `local-identity-preview` |
| `local-orchestrator`, `eval-fixtures`, `eval-deterministic-scenarios`, `web-production-build`, `harbor-static` | `hosted-baseline` |
| `restart-smoke`, `packaged-composition-smoke`, `repository-integrity` | `hosted-baseline`, `local-identity-preview` |

The relocated sealed-package composition smoke executes `initialize`, both
recovery commands, `rotate`, and `preview` without source fallback. Restart
evidence covers two preview starts with one principal, provider-binding
coexistence, old/new rotation behavior, pre/post-commit kills, deadline and
SIGINT/SIGTERM handling, fresh-client lock release, and exact cleanup. The
outer gate owns and journals the exact TLS fixture database, private state root,
and child process group, then proves no owned database/process/file/listener
remains on success, failure, timeout, or signal. No phase, workflow job, timeout
increase, or listener is added.

## Checkpoints

### Checkpoint 1: Activation and characterization

**Status:** committed. Record exact base/ownership/gate evidence and pin current
identity, public contract, reset, M2M, package, and consumer behavior without
product changes.

### Checkpoint 2: Correct provider seam and fresh-data adapter

**Tests first:** replace historical migration expectations with fresh and
destructive-upgrade fixtures; generic assertion/resolver unit and real-DB race
tests; same/different provider/issuer/subject matrices; two exact identities
sharing one verified email returning distinct principal IDs and the same
GraphQL `me.email` value; fake non-Auth0 adapter; malformed Auth0 never reaching
the resolver; no backend Auth0 SDK client/management configuration or legacy
environment/marker/sentinel/audit CLI; human-MCP versus `azp`/M2M separation;
fixed-log canaries.

**Implementation:** remove the unmerged historical link/audit/admission surface
in a corrective commit. Keep the common `human` strategy, exact issuer checks,
triple schema key, sanitized diagnostics, and external-identity APIs. Add the
generic resolver and make Auth0 an edge adapter. Replace sentinel backfill with
the explicit user-data deletion migration. Remove the backend direct `auth0`
dependency and update the lockfile with the exact toolchain. Do not rewrite
pushed history.

**Checkpoint evidence:** focused unit/integration/contract tests, Prisma
generate/migrate, destructive-upgrade fixture, exact frozen install, backend
build and relocated deployed-backend dependency scan, hosted restart, and
unchanged GraphQL/REST/MCP wire contracts.

### Checkpoint 3: Crash-safe local state and admin CLI

**Tests first:** canonical codec; config/TLS target; owner/type/mode/symlink/
hardlink/ancestry/rebind protections; injected clocks and every query including
rollback; session loss around each filesystem mutation; operation/candidate
create/write/fsync/link/verify/directory-fsync/unlink/rename crash points,
including after candidate link and both surrounding directory fsyncs; exact
enumerated and combined recovery shapes; kill a different-database loser after
fixed-operation EEXIST and normalize its nlink-1 stage; DB empty/exact/wrong/
multiple matrices; changed email and exact-principal provider bindings; both
concurrency axes; old/new atomic rotation; deterministic committed-before-
publication recovery;
cancellation/signals/killed sessions; secret canaries; relocated compiled
process execution.

**Implementation:** retain the config/TLS/advisory/ancestry and durable
operation/candidate foundations from the uncommitted work, revise database
validation for non-authoritative email and exact-principal provider bindings,
add the injected database clock/complete deadline matrix, and expose exactly
initialize/recover-initialize/rotate/recover-rotation.

**Checkpoint evidence:** focused unit fault injection, real direct-TLS
PostgreSQL integration, concurrent/terminated packaged processes, package
relocation scan, backend build, and one canonical file after success.

### Checkpoint 4: Real local composition and authentication

**Tests first:** real-module correct/missing/wrong/rotated bearer; `me` and
self-only `user(id)`; REST guard; exact SDL; provider-binding coexistence;
unavailable model; reset byte stability; no MCP/Auth0/hosted-model imports or
providers; DNS/socket tripwire; no listener; request/rotation linearization;
SIGINT/SIGTERM close.

**Implementation/evidence:** add the explicit local root, strategy, unavailable
adapter, and preview lifecycle. Run focused unit/in-process integration, hosted
and local schema comparison, real DB/state tests, build, hosted restart, and
relocated preview smoke.

### Checkpoint 5: Gate, documentation, review, and PR closeout

Update the exact registry/gate schema and active mode, lasting identity/reset/
operator/outbound docs, and outer cleanup journal. Run fresh read-only reviews
of base-to-head architecture, persistence/recovery, compatibility/consumers,
security/privacy, and maintainability. Resolve findings, run the complete local
matrix and exact-base aggregate gate, push final head, obtain applicable remote
CI/dedicated workflow evidence, and mark the single draft PR ready for human
review. Never auto-merge.

## Validation Matrix

| Surface | Required evidence | Required for merge |
| --- | --- | --- |
| Provider/unit architecture | Guard seam, generic assertion/resolver, Auth0 edge isolation, exact key matrices, no email link/legacy machinery | Yes |
| Schema/persistence | Fresh migrate plus intentional user-data deletion upgrade, serial resolver concurrency, no orphan principal | Yes |
| Local filesystem/DB | Fault injection, manual clock, direct TLS, durable operation/candidate recovery, wrong target/user, provider bindings, rotation, lock release | Yes |
| Local composition | Real GraphQL/REST guards, exact SDL, reset preservation, unavailable model, no Auth0/MCP/listener | Yes |
| Contracts | Existing GraphQL, REST, MCP, OAuth/DCR, grant, audit, and hosted package fixtures unchanged except documented config/registry additions | Yes |
| Package/restart | Relocated compiled commands, hostile cwd/env, two previews, rotation/recovery, signals/kills, no source fallback or secret output | Yes |
| Build/gate | Prisma generate/migrate, backend/web builds as affected, seed typecheck, contract/link checkers, all 12 gate phases | Yes |
| Hygiene/remote | `git diff --check`, clean scoped status, base-to-head review, final-head standard CI and dedicated gate | Yes |

Representative commands retain the repository's exact Node/pnpm and isolated
test database inputs. Targeted suites run after each small backend change; the
expensive aggregate gate runs at activation and final closeout unless a gate-
specific checkpoint needs an earlier run.

## Parallel Work And Conflict Surfaces

`/root` is the sole repository writer. Reviewers may inspect but may not edit,
stage, commit, create branches, or mutate external state. Exclusive hotspots
are common guards; hosted/local auth and composition; Prisma schema/migration/
generated fixture; backend manifest and exact lockfile dependency removal;
local state/config/CLI; package scripts; registry/gate; restart smoke; and
identity/reset/operator docs. `.github/workflows/ci.yml`, web auth, MCP
transport, and broad storage abstractions remain out of scope absent a renewed
ownership decision.

## Privacy And Security

- Provider credentials are verified at their adapter. Generic code receives
  only the exact external key and optional attributes; email never grants or
  merges identity.
- Local principal and credential are independent 256-bit values. The raw bearer
  appears only in the canonical/private stage file and request/comparison
  memory. It never enters argv, environment, logs, errors, responses, profile,
  DB rows, metadata, journals, or retained artifacts.
- The database password remains only in the explicit local process environment
  and driver memory for this preview. It is never copied to state or output.
- Fixed logs/errors exclude token claims, emails, subjects, principal IDs,
  credentials, URLs, SQL, parameters, and underlying SDK/driver causes.
- The preview has no listener, so Host/Origin/CSRF/DNS-rebinding controls are
  not applicable in Step 03. Adding a listener is a material redesign.
- Trusted POSIX ancestry and modes protect against another OS UID. Same UID,
  root, debugger, dependency/runtime, kernel, and hardware compromise remain
  stated Step 09 limits.

## Rollback Or Recovery

The main-line identity schema deliberately has no in-place legacy-user upgrade.
The supported transition is an explicitly targeted reset/fresh database. The
preserved deployed hosted product remains on `hosted-v1-maintenance`; Step 03
does not touch or remediate it. Reverting the unmerged PR returns `main` to the
Step 02 baseline; no new user data is promised compatibility across that
revert.

Local recovery never invents or replaces a principal. A durable operation and
complete candidate preserve the proposed identity until database empty/exact
state is resolved; canonical ready state is published only after commit is
known or recovered. Rotation preserves principal, and reset preserves state
bytes. Corrupt, unknown, wrong-target, wrong-user, or unenumerated state fails
closed. Code rollback stops the preview and leaves the supplied state root
untouched. Step 09 owns an explicit destructive identity reset.

Test/gate cleanup targets only journaled fixture databases, private temporary
roots, containers, and child processes. It never traverses HOME, the workspace,
or a user-supplied state root.

## Risks And Resolved Questions

| Risk/question | Resolution |
| --- | --- |
| Work continues preserving users despite fresh-data direction | Delete the historical admission/audit path, use explicit destructive upgrade, and test that no legacy config/sentinel/marker remains. |
| Future provider requires core/schema edits | Open provider string plus exact issuer/subject key and one verified assertion port; fake non-Auth0 adapter proves no resolver/schema switch. |
| Same email under two providers silently merges principals | Email is profile-only; different exact keys create different principals unless a future authenticated link flow says otherwise. |
| File and DB cannot commit atomically | A complete candidate is durable before DB mutation; explicit recovery resolves DB empty/exact before ready publication. |
| Session loss permits a stale filesystem syscall | The fixed durable operation is the root mutex, candidate-before-commit prevents a different root from publishing uncommitted ready state, and recovery takes over only after the stale process is terminated and reaped. Health checks are supplementary. |
| Same root points at different databases | No-clobber fixed operation ownership plus target binding lets at most one contender reach either DB. |
| Provider binding breaks local auth | Local reconciliation authorizes by sole exact principal, accepts bindings attached to it, and ignores later email changes. |
| Rotation crashes | Durable operation/candidate plus atomic rename leaves only the enumerated old/new outcomes and blocks stale same-root rotation. |
| Local root accidentally reaches cloud/MCP | Explicit imports/providers, absent config, unavailable model, and DNS/socket tripwire prove isolation. |
| Step grows into installer/IAM work | No registry framework, link UI, listener, native helper, final path, keychain, or multi-user policy is added. |

No open design choice may be decided ad hoc during implementation. A new
dependency, listener, public schema change, native helper, different authority
model, hosted-production change, second PR, or gate-budget increase returns to
plan review.

## Independent Plan Review

All reviews are read-only. The earlier approvals remain historical evidence but
are invalid for the changed legacy-data and local-state contracts.

| Wave/dimension | Finding and disposition | Status |
| --- | --- | --- |
| Original Step 03 review | Approved the historical link/audit design and journaled candidate protocol. The user's fresh-data clarification materially supersedes those portions. | Superseded |
| Fresh provider-pivot audit | Confirmed the provider seam was partial, identified the exact legacy-only rollback map, and retained principal/issuer/subject, guard, logging, and local durability boundaries. | Resolved in revised draft |
| Fresh provider architecture | Required a tiny verified assertion, Auth0 edge isolation, serial exact resolver, no email linking, destructive reset, and local coexistence with provider bindings. | Resolved in revised draft |
| Fresh local persistence exploration | Proposed canonical-first reconciliation as a simplification. Independent persistence review demonstrated that connection-health checks cannot fence an in-flight filesystem syscall after advisory-lock loss, so the draft retains the durable root operation/candidate protocol. | Superseded |
| Renewed persistence/concurrency review on checksum `1875901614 34205` | Blocked unfenced canonical-first mutation, incomplete stage recovery, non-atomic destructive migration, and underspecified gate-mode evidence. Disposition: restore durable operation/candidate ownership, use one locked destructive transaction with rollback/concurrent-writer fixtures, and name sealed-package/restart/integrity coverage. | Resolved; renew review |
| Renewed compatibility review on checksum `1875901614 34205` | Blocked synthetic hosted `User.email` semantics, unresolved Auth0 Management/Authentication removal, and inaccurate MCP wording. Disposition: store verified hosted account email while removing uniqueness/identity authority, delete backend Auth0 SDK clients/config, use verified token hints only, and distinguish human MCP resolution from client/grant identity and M2M compatibility. | Resolved; renew review |
| Renewed architecture review on checksum `1875901614 34205` | Approved scope and provider boundaries, but the checksum is invalidated by the persistence and compatibility corrections above. | Renew review |
| Second architecture review on checksums `2520288740 42869` / `1363558484 43170` | Blocked retaining the unused backend `auth0` SDK while claiming its clients were removed. Disposition: own the backend manifest/lockfile, remove the direct dependency with the exact toolchain, and prove frozen-install/relocated closure while leaving web dependencies alone. | Resolved; renew review |
| Second persistence review on checksum `2520288740 42869` | Blocked omitted same-inode candidate stages and nlink-1 loser operation stages from recovery. Disposition: add composable normalization under verified root/DB ownership and crash/loser-kill tests for combined residue shapes. | Resolved; renew review |
| Second compatibility review on checksum `1363558484 43170` | Approved corrected email, Auth0-client/config, MCP human/client/M2M, public-contract, and fresh-data dispositions. Later lockfile/recovery clarifications do not change interface semantics, but final checksum still requires re-verification. | Renew review |
| Third architecture and persistence reviews on checksum `2336167928 45595` | Blocked a published initialize operation with no candidate and a crashed orphan-cleanup mutex from the recovery enumeration. Disposition: enumerate monotonic cleanup/resumption for both, including every unlink/fsync crash boundary. All other architecture findings passed. | Resolved; renew review |
| Third persistence review on checksum `3245993983 47358` | Blocked recovery deleting the durable operation while its session-lost original process could still finish an in-flight filesystem syscall. Disposition: make named recovery a quiescent break-glass operation only after the original admin process is terminated and reaped, and prove terminate-wait-recover ordering in process, signal, restart, package, and gate evidence. | Resolved; renew review |
| Architecture/scope/maintainability | Approved the provider-neutral seam, destructive fresh-data boundary, dependency removal, composition, scope, corrected recovery classes, and quiescent recovery contract on checksum `1416604905 48917`. | Approved |
| Persistence/concurrency/recovery/gate | Approved the locked destructive migration, exact-key transaction, durable operation/candidate protocol, complete recovery enumeration, terminate/reap fencing, and gate mapping on checksum `1416604905 48917`. | Approved |
| Compatibility/consumers/interface evolution | Approved the intentional data incompatibility, email-only public compatibility, generic provider adapter, Auth0/M2M dispositions, and retained wire consumers on checksum `1416604905 48917`. | Approved |
| Security/privacy/credentials/local threats | Approved provider trust boundaries, secret handling, destructive transition, local filesystem/database controls, quiescent recovery, no-listener composition, and package evidence on checksum `1416604905 48917`. | Approved |

All four renewed dimensions approved the same substantive checksum. The status
and approval rows above are the only later plan edits; implementation may
resume under this contract.

## Exit Criteria

- Stable opaque principal semantics pass in hosted and local roots; no email,
  provider-subject suffix, client key, machine/path, or row-order derivation.
- Historical admission/audit/link/legacy-config machinery is absent; fresh and
  destructive-upgrade fixtures pass and `hosted-v1-maintenance` is untouched.
- Auth0 is only an edge adapter to the generic resolver; a fake second adapter
  uses the same assertion/resolver with no schema or core switch.
- Local initialize/restart/recover/rotation/concurrency/wrong-target/reset and
  provider-binding coexistence pass against real direct-TLS PostgreSQL and
  leave exactly one canonical private state file after success.
- Correct/missing/wrong/rotated bearer exercises real local guards; `me` and
  self-only `user(id)` retain exact shapes.
- Local startup/import evidence proves no human Auth0/JWKS/provider API, hosted
  model, MCP server, web process, or listener.
- Hosted GraphQL/REST/MCP/OAuth/DCR/client/grant/restart/package evidence stays
  green; local credential never authenticates MCP.
- New entrypoints are relocatable Step 02 package contents with no source
  fallback, absolute build path, native helper, or runtime toolchain.
- Existing aggregate gate retains all 12 phases/order/timeouts, cleans exact
  resources, and passes on reviewed final head locally and remotely.
- Canonical docs/registry describe the supported fresh-state provider boundary;
  the single PR is ready for human review and is not auto-merged.

## Closeout

After human merge, record the PR and concise outcome in orchestration while
activating the next step. Retain this plan while downstream identity/storage
steps depend on its exact contracts; Git and the PR remain the long-term
implementation archive.
