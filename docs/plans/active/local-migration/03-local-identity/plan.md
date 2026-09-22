# Step 03: Local Identity

- Document status: independently approved for implementation
- Program step: `03-local-identity`
- Target line: `main`
- Planning and implementation branch:
  `codex/local-migration-03-local-identity`
- Planning base: `6b420ed24e9dd344af8990c9045832990ae1b5ec`
- Change classification: `local-only` main-line migration work; the retained
  `hosted-baseline` adapter on `main` is hardened only as a prerequisite for the
  new principal boundary
- Hosted production line: `hosted-v1-maintenance` is intentionally unchanged;
  this PR is not a production remediation and authorizes no backport or
  cherry-pick
- Depends on: Step 02 PR
  [#161](https://github.com/loyalagents/context-router/pull/161), human-merged
  at the planning base above; final tested head
  `00e4240564b3b63997d63cc581c6e52fbba0f613`
- Planning owner, implementation owner, and sole repository writer: `/root`
- Implementation shape: one draft PR with five green internal checkpoints; no
  automatic merge
- Supported modes after merge: the retained `hosted-baseline` on `main` and an
  explicit, non-listening `local-identity-preview`
- Last updated: 2026-09-22

## Outcome And PR Boundary

Keep `User.userId` as the stable opaque human principal. Introduce only the
provider-neutral human-authentication seam required by the existing GraphQL and
REST guards. The hosted adapter on `main` continues to validate Auth0 JWTs and
retains its M2M compatibility path, while becoming issuer-aware and refusing
automatic email-only account claiming. The local adapter authenticates one
durable principal with an independently random credential stored in a
versioned private file under an explicitly injected absolute root.

The local preview is a relocatable Node/Nest CLI inside the existing Step 02
backend package closure. It initializes the real local Nest composition with
`init()` but never calls `listen()`. It can initialize, recover, rotate, open,
authenticate, restart, and shut down against the temporary PostgreSQL adapter.
It imports neither the human Auth0 clients/JWKS strategy nor `McpModule` or the
web application. This is not the Step 07 MCP server, Step 08 browser/session
product, or Step 09 installer/supervisor.

One PR is safer than a second main-line implementation PR because the public
GraphQL/REST/MCP shapes remain unchanged, each internal checkpoint is green,
and the final supported preview needs the state, composition, restart, registry,
and gate changes together. The hosted issuer migration is an independently
reviewable checkpoint but is not independently deployed from this branch.

### Product-line disposition

The branch policy in [`../orchestration.md`](../orchestration.md) remains
authoritative. This work is not a fix to the deployed hosted-v1 product:

- `hosted-v1-maintenance` receives no commit, migration, configuration change,
  or security-remediation claim from Step 03;
- issuer-aware identity and frozen historical-link dispositions exist only in
  `main`'s retained hosted-baseline adapter as a prerequisite for the local-
  first principal contract;
- no backport or cherry-pick is authorized by this plan;
- any future production remediation must originate in a separately planned
  hosted-maintenance change and decide its own rollout and compatibility path.

This explicit main-line-only divergence is recorded in LM-015. It is why the
PR is classified `local-only`, despite exercising the hosted-baseline adapter
that remains on `main` for compatibility evidence.

## Required Reading And Entry Evidence

The required repository, important-doc, Step 01/02, interface-evolution,
identity, authorization, reset, composition, packaging, restart, and migration-
gate reading and source inspection were completed before the first edit. The
preflight established:

| Check | Result |
| --- | --- |
| Step 02 landing | PR #161 human-merged at `6b420ed24e9dd344af8990c9045832990ae1b5ec`; final tested head `00e4240564b3b63997d63cc581c6e52fbba0f613`; standard CI [35318582335](https://github.com/loyalagents/context-router/actions/runs/35318582335) and dedicated gate [35318582309](https://github.com/loyalagents/context-router/actions/runs/35318582309) passed |
| Branch/history | Exact requested branch from the exact merge; `HEAD`, local `main`, `origin/main`, and both merge bases matched; repository was non-shallow |
| Worktree | Clean before activation; existing user work preserved |
| Ownership | `/root` is sole writer; discovery and review agents are read-only |
| Conflicts | No writer owned identity, composition, generated contracts, lockfile, or gate hotspots; `.github/workflows/ci.yml` remains out of scope |
| Step 06 | Inactive; no overlap or ownership agreement exists |

The activation command used exact Node 24.21.0, pnpm 10.25.0, Python 3.12.8,
and a uniquely owned loopback-only PostgreSQL 15.15 test container:

```sh
MIGRATION_GATE_BASE_SHA=6b420ed24e9dd344af8990c9045832990ae1b5ec \
MIGRATION_GATE_PYTHON_BIN=/Users/lucasnovak/.pyenv/versions/3.12.8/bin/python \
MIGRATION_TEST_ADMIN_URL=postgresql://postgres:postgres@127.0.0.1:57511/postgres \
pnpm migration:gate
```

| Phase | Result |
| --- | --- |
| `contract-baseline` | passed in 27,933 ms |
| `documentation` | passed in 1,314 ms |
| `backend-unit-build` | passed in 20,338 ms |
| `backend-database` | passed in 48,775 ms |
| `local-orchestrator` | passed in 6,310 ms |
| `eval-fixtures` | passed in 47,284 ms |
| `eval-deterministic-scenarios` | passed in 7,892 ms |
| `web-production-build` | passed in 28,205 ms |
| `harbor-static` | passed in 2,484 ms |
| `restart-smoke` | passed in 56,078 ms |
| `packaged-composition-smoke` | passed in 176,141 ms |
| `repository-integrity` | passed in 2,075 ms |

The gate performed its base comparison, reported caller integrity true, passed
12/12 phases, and took 461,692 ms. Earlier attempts stopped only on local
prerequisites; no product or contract phase failed. The successful container
used the already cached image and a private tmpfs, then was stopped and auto-
removed. No shared database, download, or broad cleanup was used.

## Current Evidence And Constraints

- `User.userId` is already the opaque primary key used by preferences, grants,
  audit, access history, and GraphQL. A repository-wide rename is unnecessary.
- `ExternalIdentity` lacks issuer and is unique only by provider/subject. Auth
  synchronization resolves it before email, but then links a matching email
  without checking `email_verified`; retry repeats that fallback.
- Prisma and GraphQL require non-null unique `User.email`. M2M compatibility
  uses `@m2m.local`; profile email is editable memory and not account identity.
- Common GraphQL/REST guards hardcode Passport strategy `jwt`. Auth0 clients and
  JWKS are eagerly composed by the hosted root.
- Existing general e2e overrides guards and therefore cannot prove local auth.
- Reset preserves `User` and `ExternalIdentity`, but no test covers external
  local state.
- The Step 02 package already seals the relocatable backend output and runs
  hosted restart/package evidence. Step 03 adds ordinary backend entrypoints;
  it does not add a native launcher, compiler, Python broker, loader parser,
  alternate package root, or absolute build-host path.
- The aggregate gate already has little job-time margin. Local restart evidence
  must run inside the existing `restart-smoke` phase and timeout, not in a new
  workflow job or unbudgeted dispatcher.

## Scope

1. Characterize current hosted/public identity, M2M, reset, GraphQL, REST, MCP,
   OAuth/DCR, grant, restart, and package behavior.
2. Bind common human guards to one stable provider-neutral Passport name, with
   exactly one hosted or local implementation per explicit composition root.
3. On `main` only, make hosted external identity issuer-aware and require a
   verified email plus a frozen operator-approved tuple before binding an
   existing historical user. Preserve successful public shapes.
4. Add a canonical private local identity state, explicit initialize/recover/
   rotate/open commands, crash-safe file publication, a dedicated direct-
   PostgreSQL advisory session, and exact state-to-database reconciliation.
5. Add a local Nest root and non-listening preview using real guards, a fixed
   unavailable model adapter, and no Auth0/MCP/web composition.
6. Add real-process restart/recovery/no-Auth0 evidence inside the existing gate
   phase and update registry, fixtures, operator docs, and outbound inventory.
7. Sanitize new/touched identity and database startup diagnostics.

## Non-Goals

- Any change to `hosted-v1-maintenance` or claim that deployed hosted production
  is remediated
- SQLite, a second application database, or generic repository/unit-of-work
  abstraction owned by Steps 04–05
- Local model execution owned by Step 06
- Local MCP transport/OAuth/grant redesign owned by Step 07
- Browser sessions, cookies, UI cutover, debug-token removal, or final
  `user(id)` evolution owned by Step 08 and LM-008
- Native launch guards, runtime-closure attestation, Python brokers, custom
  binary parsers, compiler/toolchain packaging, PID/mount namespaces, process
  supervision, signing, installers, final data paths, keychain, backup UI, or
  updates owned by Step 09
- LAN listeners or pairing owned by Step 10
- Destructive identity reset, account recovery UI, multi-user IAM, or a broad
  `User`/Prisma cleanup
- Changes to `.github/workflows/ci.yml` or `pnpm-lock.yaml`

## Contracts And Consumers

| Surface | Step 03 contract |
| --- | --- |
| Human identity | `User.userId` remains the stable opaque principal. Email, subject suffixes, MCP keys, hostnames, OS users, paths, and row order never derive it. |
| Hosted external identity | `provider + canonical issuer + subject`; exact identity wins. Legacy rows use an explicit sentinel and mapped claim. |
| Email/profile | Public non-null email remains. Verified email is one-time binding evidence only with an exact frozen disposition, never ongoing auth/authorization. Local uses a non-routable `.invalid` compatibility value and never seeds profile email. |
| Local credential | Independent 256-bit bearer stored only in private state; it is not an MCP/browser/database credential. |
| GraphQL/REST | Exact schema/routes/envelopes remain; `me` remains current principal and `user(id)` remains self-only, including cross-user rejection. |
| MCP/OAuth/DCR | Hosted contracts, client keys, scopes, grants, audit, and M2M compatibility remain. Local preview does not compose `McpModule`. |
| Web/session | Hosted web/Auth0/debug-token surfaces remain; local preview has no web/session process. |
| Model | Hosted provider remains. Local root binds both AI ports to a fixed unavailable/no-I/O adapter solely to satisfy existing consumers/schema. |
| Storage | PostgreSQL remains temporary. One dedicated non-pooled `pg.Client` serializes local identity mutation; Steps 04–05 must preserve equivalent fencing when replacing it. |
| Process/package | Existing hosted entrypoint remains default. New self-locating compiled Node CLI entrypoints live inside the ordinary Step 02 backend closure and are relocatable with the package. |
| Network | Hosted listeners unchanged. Local preview has no HTTP/MCP listener; its only socket is the explicitly validated direct TLS PostgreSQL connection. |

Known consumers are the hosted bootstrap and smokes; GraphQL resolvers/guards
and generated schema; REST controllers; dashboard/profile generated types; web
Auth0 middleware/routes; `test-auth.sh`; MCP guard/controller/client/grant/
access/audit services; reset; seed; test launchers; env examples, Compose and
Cloud Run configuration; eval/local-orchestrator fixtures; Step 02 packaging;
operator docs; the human and JSON v2 registries; and the migration gate. Unknown
external GraphQL/REST/MCP consumers retain the Step 01 compatibility assumption.

## Design

### 1. Narrow human-authentication seam

Define one stable human Passport strategy name, `human`. Common GraphQL,
optional-GraphQL, and REST guards use it. The hosted root registers the renamed
Auth0 JWT implementation; the local root registers the local bearer strategy.
MCP auth remains hosted-specific and its M2M path still calls the hosted auth
service. Request/use-case contracts remain `request.user: User`; no resolver or
domain service receives provider claims or the local credential.

`AppModule` remains the hosted default. Add a separate `LocalApplicationModule`
that explicitly lists shared application modules and local adapters. Provider-
graph tests prove exactly one `human` strategy per root and forbid Auth0 human,
JWKS, `McpModule`, and hosted model providers in the local graph.

### 2. Main-only hosted identity hardening

Add non-null `ExternalIdentity.issuer`. The migration adds it nullable, backfills
existing rows with reserved sentinel
`urn:context-router:legacy-issuer`, makes it `NOT NULL` with no default, replaces
the old unique pair with `(provider, issuer, providerUserId)`, and preserves IDs,
metadata, timestamps, and FKs. New issuer-less writes fail.

Hosted resolution order is fixed:

1. exact canonical configured/token issuer plus subject;
2. one sentinel subject, transactionally claimed only when
   `AUTH0_LEGACY_ISSUER` exactly equals the configured and validated issuer and
   no exact/conflicting row exists;
3. one eligible verified-email candidate with zero external identities and an
   exact frozen link disposition;
4. creation of a new opaque principal/exact identity only when no candidate
   exists. Ineligible, ambiguous, denied, undispositioned, or conflicting rows
   fail and never fall through to creation.

`AUTH0_ISSUER` becomes an explicit hosted-baseline value with no domain-derived
fallback. Its bytes must already be the canonical WHATWG serialization of an
HTTPS URL with an ASCII lower-case host, no userinfo, query, or fragment, no
default port, and exactly `/` as its path. `AUTH0_DOMAIN` must be the same host
and supplies only the JWKS hostname. JWT `iss` must byte-equal that canonical
issuer. `AUTH0_LEGACY_ISSUER` uses the identical grammar and is conditional:
omission is accepted only when the startup snapshot contains zero sentinel
rows; when any sentinel row exists it is required, must be non-empty, and must
byte-equal `AUTH0_ISSUER`, otherwise startup and claim both fail closed. If it is
present with zero sentinel rows it must still be canonical and equal (stale but
non-authoritative); an explicitly empty or unequal value is always invalid.
Every hosted-baseline environment fixture/example and the operator migration
guide must carry the applicable explicit issuer, legacy-issuer, and link-claims
values; local configuration rejects and never reads them.

Incoming JWT and Auth0 Management `{email,email_verified}` pairs are evaluated
independently. A present email is eligible only when the same source says
`email_verified === true`; two sources must agree on canonical email and status.
The linking grammar is ASCII-only, trims only HT/LF/VT/FF/CR/SP at both edges,
preserves local-part bytes/case, lowercases ASCII domain letters only, and
rejects quoted/comment/domain-literal/EAI/control/invalid dot/label forms. The
database lookup uses byte-deterministic `COLLATE "C"` plus ASCII `TRANSLATE`,
returns at most two rows, and post-validates with the same canonicalizer.
Reserved/synthetic `unknown@example.com`, sample seed addresses, `@m2m.local`,
`.invalid`, and legacy `missing-<uuid>@unknown.local` values can never link.

#### Frozen historical-link dispositions

Hosted startup on `main` requires `AUTH0_IDENTITY_LINK_CLAIMS`, including exact
empty value `{"version":1,"dispositions":[]}`. It is canonical compact ASCII
JSON, at most 30 KiB and 256 entries. Entries are bytewise sorted by unique row
digest and are exactly either `["<rowDigest>","deny"]` or
`["<rowDigest>","link","<identityDigest>"]`; identity digests are unique.
Strict parse plus canonical reserialization must byte-equal the input.

Both 43-character unpadded-base64url digests use:

`H(label, fields) = base64url(SHA-256(U32BE(label.length) || label || Σ(U32BE(field.length) || field)))`

over UTF-8 bytes. The row digest covers the exact `User.userId` and canonical
email key under label `context-router/auth0-link-row/v1`; the identity digest
covers literal `auth0`, canonical issuer, and exact subject under label
`context-router/auth0-link-identity/v1`. The mapping of unique row to unique
identity is the approved tuple; config contains no raw PII.

While every writer is drained, an offline command reads an absolute, no-follow,
owner-only mode-`0600` canonical intent file beneath an owner-only parent. The
file is at most 256 KiB/256 entries and has exact canonical JSON entries
`{userId,email,decision}` for deny or
`{userId,email,decision,issuer,subject}` for link, bytewise sorted by user ID.
It enumerates every user with an
eligible non-reserved email and zero identities and requires exactly one link or
deny per row, with no extra/missing/duplicate entry. Ambiguous-email groups may
only be denied. A link issuer must equal configured issuer and its subject must
not already exist as exact or mapped legacy identity. The tool rechecks the DB,
emits only the digest config/counts/digest, and never logs or artifacts raw
intent. Over-limit or unresolved cohorts stop for review.

A successful link atomically inserts the identity with the exact semantic JSONB
marker `{contextRouterIdentityLinkClaim:{version:1,rowDigest,identityDigest}}`.
The reserved key is rejected in pre-existing data and by generic metadata/
unlink helpers. Before listener admission, a consistent read-only preflight
classifies every disposition exactly once as pending (one eligible zero-identity
row) or consumed (the user's sole identity with matching issuer/subject and
marker), covers every pending row and marker, and rejects drift. The serializable
link transaction rechecks candidate bytes, zero identities, both digests,
manifest digest, and uniqueness. Exact issuer/subject is the only ongoing login
authority after consumption.

Verified email is therefore one element of explicit one-time operator binding
authority, not sufficient authentication. A wrong approved tuple can misbind;
removing config does not unlink it. Suspected misbinding stops writers and uses
the verified full-backup rule below or a separately reviewed repair.

When no verified contact exists, new account email is
`<sha256-hex(principalId UTF-8)>@principal.invalid`. It is non-routable,
unverified, excluded from linking/profile memory, and not a principal source.
Hosted first-login profile seeding remains create-only and provider-specific.
Touched identity/Prisma diagnostics become fixed and cause-free; query/parameter
logging is disabled. Pinned public error classes/status and MCP wire fixtures
remain unchanged.

#### Migration admission and rollback

Before any database is migrated to this `main` adapter, operators stop all old
writers, audit legacy multiplicity, confirm `AUTH0_LEGACY_ISSUER`, complete and
accept the full link/deny cohort, freeze identical config for every replica, and
take/verify a backup. Only the new binary starts; its pre-listen preflight must
pass before traffic. Old/new writers never overlap.

There is no in-place old-binary rollback. Restore the exact verified backup with
writers stopped only when no post-migration write must be retained (or the
operator explicitly discards all of them), then verify old schema/ledger and
single-issuer provenance. Otherwise roll forward. Re-forward repeats the full
drain/audit/config/backup/migrate/admit sequence. This is evidence for future
`main` deployments only and does not deploy or remediate `hosted-v1-maintenance`.

### 3. Local configuration and database peer boundary

The supported product entry is the compiled, self-locating Node CLI with exactly
one subcommand: `initialize`, `recover-initialize`, `rotate`,
`recover-rotation`, or `preview`. No credential is accepted on argv. It reads a
narrow explicit snapshot containing:

- `LOCAL_IDENTITY_STATE_ROOT`: required absolute path;
- `DATABASE_URL`: required, bounded URL for literal `127.0.0.1`, explicit port
  and database, with user/password but no alternate host, socket, query, or
  fragment; schema is fixed to `public`;
- `LOCAL_DATABASE_TLS_CA_PEM`: required bounded one-certificate PEM.

The local parser never calls dotenv or reads cwd, package-root, `HOME`, XDG,
`.env`, `.pgpass`, Auth0, Vertex, Node-option, or cloud values. It constructs
both the dedicated `pg.Client` and local Prisma pool with direct TLS,
`rejectUnauthorized: true`, IP-SAN verification for `127.0.0.1`, the supplied
CA, bounded connect/query/statement/lock timeouts, and no proxy/pool-discovery
logic. The test database enables TLS directly; no terminator is introduced.
Only that loopback database socket is allowed. The credential-free
`databaseTargetId` hashes protocol, host, port, decoded database/schema, and CA
SPKI digest; it excludes username/password and binds state to one target.

`DATABASE_URL` contains a database secret in the initial Node environment and
driver memory; Step 03 does not claim otherwise. It is never logged, included in
errors/artifacts, or copied to local identity state. The local human credential
never appears in argv or environment. Same-UID/root/debugger/process-memory and
OS compromise are outside this preview boundary; Step 09 owns stronger process,
keychain, and launch isolation.

### 4. Canonical private state and crash protocol

Step 03 supports the POSIX semantics exercised by the existing macOS gate host
and pinned Ubuntu runner; this is preview evidence, not final OS/distribution
support. An absent state root may be created only beneath an existing current-
UID-owned mode-`0700` parent. An existing root must be the current UID's mode-
`0700` real directory. The absolute ancestry is a trust contract, not merely a
leaf-mode check: every component is a real non-symlink directory owned by root
or the current UID and is not group/other-writable, except that a root-owned
sticky directory may contain the next current-UID-owned real directory. No
component owned by another UID is accepted. This permits conventional `/tmp`
or runner-temporary anchors only through sticky-entry ownership while proving
that another UID cannot rename or replace the trusted child entry. The full
ancestry is lstat-checked before and after canonicalization and around every
pathname mutation; parent/root `(dev,ino)` identities are pinned for the
operation. Final files use `O_NOFOLLOW`, are current-UID-owned regular one-link
mode `0600`, and are revalidated around reads/writes. Unsafe, non-POSIX, group/
other-accessible, replaced, or ambiguous paths fail. These ancestry and pinned-
identity rules exclude cross-UID rebinding; same-UID, root, and kernel TOCTOU
remain explicitly outside scope.

The canonical `identity.json` is at most 1 KiB, UTF-8, no BOM, one final LF,
fixed key order, no whitespace/unknown/duplicate keys, and exactly:

```json
{"schemaVersion":1,"databaseTargetId":"<43-char-base64url>","principalId":"<43-char-base64url>","credential":"<43-char-base64url>","generation":1}
```

Principal and credential are independent 32-byte CSPRNG values encoded as
unpadded base64url. Generation is a safe positive integer. Parsing never repairs
or rewrites normal state. At successful rest exactly this one file exists.

Mutation uses only same-directory artifacts:

- `identity.operation.json`: non-secret operation, target ID, nonce, base
  generation/digest, and candidate basename as applicable;
- `identity.pending-<nonce>.json`: complete proposed first state;
- `identity.rotate-<nonce>.json`: complete proposed next generation;
- `identity.stage-operation-<nonce>.tmp`: a per-attempt operation-record
  staging inode, and `identity.stage-<nonce>-candidate.tmp`: the one candidate
  staging inode named by the winning published operation.

Names/nonces are fixed-format and unguessable; unknown/extra artifacts fail.
No record or candidate is ever written under its published basename. The
writer exclusively creates a fresh unguessable operation stage, writes complete
bytes, checks file fsync, then races a same-directory no-clobber hardlink to the
fixed `identity.operation.json`. A winner must immediately prove the stage and
published record have the same pinned `(dev,ino)`, exact canonical bytes, link
count, owner, type, and mode before any candidate or database work. A loser
unlinks and fsyncs only its own nonce stage; it never touches another pathname.
Thus database locks for different targets cannot create a shared-root ABA. An
explicit recovery with no published operation may win the same fixed link with
a canonical no-mutation recovery record, verify its ownership identically, and
then durably remove bounded fixed-format orphan operation stages; a paused live
contender can only lose its later link and fail before mutation. If a published
operation already exists, recovery does no cleanup until the matching database
lock and target checks establish ownership of that operation's recovery path.
The complete operation record is durably published before candidate staging.
After checked directory fsync it unlinks its operation stage and checks a second
directory fsync. Candidate staging/publication uses the same complete-write,
file-fsync, no-clobber-hardlink, post-link same-inode/exact-byte verification,
directory-fsync, exact-stage-unlink, directory-fsync sequence. No database
mutation begins until the complete candidate basename is durably published and
verified. First canonical publication likewise uses a no-clobber hardlink from
the complete candidate to `identity.json`, followed by post-link same-inode/
byte verification, directory fsync, exact candidate unlink, and another
directory fsync. Rotation uses atomic same-directory rename of the complete
published candidate over the verified canonical file and directory fsync.
Every syscall result is checked. Process-crash consistency is claimed;
hardware/filesystem durability qualification and platform-specific full-sync
policy remain Step 09.

Normal open refuses any operation record/temp or malformed/insecure state. It
never creates or repairs. Explicit recovery accepts only these shapes:

- one or more bounded fixed-format operation-record stages with no published
  operation/candidate and an otherwise absent or target-matching ready canonical
  state: publish and verify a fresh no-mutation recovery record as the fixed
  root mutex, validate/remove the orphan stages durably, remove that recovery
  record durably, and retry; no database mutation can precede operation
  publication;
- a published no-mutation recovery record with zero or more remaining bounded
  operation-record stages and an otherwise absent or target-matching ready
  canonical state: revalidate the record, configured target, ancestry, pinned
  root, and matching database lock; remove only snapshotted fixed-format orphan
  stages one at a time with checked directory fsync, then remove the recovery
  record last with checked directory fsync. A crash after any removal restarts
  this same monotonically smaller shape, including the zero-stage terminal
  shape;
- one published operation plus its exact same-inode operation-record stage:
  unlink only the redundant stage durably after target/lock/ownership checks,
  then continue from the published operation; a distinct operation stage is an
  orphan removed only while the verified published operation holds the root;
- one published operation plus its candidate staging inode but no published
  candidate: validate both exact names and metadata, remove the unpublished
  stage and operation durably, and retry; by ordering no database mutation can
  have preceded candidate publication;
- a published operation/candidate plus its exact same-inode staging hardlink:
  unlink only the redundant stage durably, then continue the corresponding
  published-candidate recovery below;
- operation record only plus zero users: remove it durably, then initialization
  may retry;
- initialize record plus one complete candidate and zero users: resume the same
  candidate through DB commit/publication;
- initialize record plus candidate and the exact sole matching user: treat DB
  commit as successful and publish that candidate;
- canonical file plus initialize record and optional candidate hardlink to the
  same inode/bytes plus exact user: finish exact cleanup;
- rotation record plus the exact old canonical state, no candidate/stage, and
  the exact sole matching user: candidate publication never completed, so keep
  the old credential and durably remove the rotation record;
- rotation record plus old canonical and complete proposed generation: discard
  the uncommitted candidate and keep the old credential;
- rotation record plus canonical generation `base + 1` matching the recorded
  proposed digest: keep the new credential and finish cleanup.

Any partial/corrupt stage is removable only in the pre-mutation shapes above,
while a verified published operation owns the fixed root mutex and publication
ordering proves that stage never authorized database mutation. A
partial/corrupt published record or candidate, a staging inode after a shape in
which mutation may have occurred unless it is the verified same inode, missing
records, multiple candidates, wrong target/principal/email/generation/digest, a
different user, extra identities, or unsafe metadata fail without deletion or
replacement. Recovery cleanup is itself ordered and restartable, so a crash at
every stage-create/write/fsync/link/directory-fsync/unlink boundary converges to
one of these same enumerated shapes. In every successful cleanup path all
staging/candidate artifacts are unlinked and directory-fsynced before the
published operation record is removed and directory-fsynced; no path removes
the root mutex first.

### 5. Database serialization and identity mutation

Every initialize/recover/rotate command creates one dedicated non-pooled
`pg.Client`. That exact session calls the supported two-key form
`pg_try_advisory_lock($1::int, $2::int)` with two fixed signed 32-bit constants;
`busy` is immediate and fixed. The session is the sole local identity-row
mutator and remains open until file cleanup completes.
The order is database advisory lock, state-root operation record, then DB/file
work. Same-database different roots serialize on the advisory key; same-root
different databases race on the exclusive operation record and target ID, so at
most one can mutate. A fresh client proves lock release after success, error,
timeout, cancellation, signal, and killed-session tests.

Initialization fsyncs the complete candidate before the transaction. Inside one
transaction on the dedicated session it accepts only zero users or the exact
sole candidate user from a prior ambiguous commit, requires no external
identity, and inserts an explicit principal with deterministic compatibility
email when empty. It never selects the first user. After acknowledged commit it
publishes state. A lost/timeout response during or after `COMMIT` is always
`recovery required`; it never deletes the candidate/record or retries with a new
principal. Any deadline destroys/closes that client, issues no later query, and
leaves only an enumerated recoverable shape.

Rotation verifies the exact ready state and sole DB user while holding both
locks, but changes only the file credential and generation. The principal,
compatibility email, user row, and database target remain fixed. Reset never
touches this state.

Unit tests use injected storage/database clocks and fault adapters from test
code for every syscall/query/commit boundary. Production packages contain no
test environment/argv branch or test resource. Representative packaged-process
tests kill real commands after a durable candidate becomes observable and then
inspect whether the DB transaction was zero or exact; both real shapes must
recover. Separate real fixtures exercise exact committed-before-publication and
ready-before-cleanup recovery. Rotation kills after its candidate appears and
may leave only the enumerated old/new outcome. No native dispatcher, proxy,
namespace, or hidden control channel is added.

### 6. Local auth and non-listening composition

The local Passport strategy accepts one Bearer value, opens and validates ready
state for each request, compares exact decoded length with constant-time bytes,
loads the exact principal, then rereads/revalidates the canonical file before
return. Any operation artifact, state digest/generation change, wrong target,
or missing/mismatched user fails. The second validated read is the
authentication linearization point: a rotation durably completed before it
rejects the old credential, while an overlapping request may succeed with the
old credential only when it linearizes before rotation. Every request begun
after completed rotation rejects the old credential; a fresh request with the
new credential succeeds. The raw credential may exist only in the private
file, request header/parser/comparison memory, and the one complete owner-only
candidate during mutation. It never enters logs, errors, argv, environment,
profile memory, DB rows, external-identity metadata, journals, GraphQL/REST
bodies, or retained test artifacts.

`LocalApplicationModule` composes Prisma, users, preferences, grants, reset,
workflows/resolvers needed for exact SDL, the transport-independent MCP access-
history GraphQL module, local auth, and fixed unavailable AI ports. It does not
import Auth0 human modules, `McpModule`, hosted Vertex adapters, or web/session
code. `preview` creates the real app, calls `init()`, emits one fixed non-secret
readiness record, owns no HTTP/MCP listener, handles SIGINT/SIGTERM with bounded
`close()`, and otherwise waits. Missing Auth0 never selects local; only the
explicit CLI entrypoint does.

Real integration invokes the GraphQL schema directly and constructs a REST
guard execution context without `supertest` or `listen(0)`. Correct/missing/
wrong bearer, `me`, same/cross `user(id)`, REST auth, schema equality, unavailable
model calls, MCP absence, and reset preservation all use the real local module.
DNS/socket tripwires prove no Auth0/JWKS/Management/Authentication/Vertex call;
the validated database connection is the sole socket.

### 7. Packaging, restart, gate, and cleanup

The new admin/preview entrypoints compile into `dist` and resolve modules/
resources relative to their own packaged location. Step 02's existing package
manifest automatically seals them with the rest of the backend closure. Tests
launch a copied package from hostile cwd/HOME with package-root/cwd `.env`
canaries and prove relocation, no dotenv read, hosted default-entrypoint
preservation, and no source-tree fallback. No compiled absolute path or runtime
toolchain prerequisite is added.

The human-readable and executable contract registry move atomically from v1 to
v2. In `local-migration-contract-baseline.json`, top-level `version` becomes
`2` and singular `supportedMode` is replaced by the exact ordered
`supportedModes: ["hosted-baseline","local-identity-preview"]`; all existing
contract/capability arrays remain and Step 03 adds only explained identity,
configuration, package, consumer, and outbound records. The checker accepts a
v1 singular-mode document only as the merge-base comparison input, requires v2
and the array for the current tree, rejects duplicate/unknown/inactive modes,
and verifies every listed mode against the active gate manifest. It continues
to fingerprint and diff preserved public contracts rather than treating the
version bump as permission for drift.

The gate phase manifest/schema also move atomically from `schemaVersion: 1` to
`schemaVersion: 2`. Its existing record shapes remain; `supportedModes` becomes
the exact ordered active records for `hosted-baseline` and
`local-identity-preview`, each with empty successors and required
`contract/build/state/restart/integrity` classes. The v2 runner replaces the
v1 hosted-only command-policy special case with one exact allowlisted mode/
phase matrix while retaining the same 12 phase IDs, order, commands, owners,
timeouts, and predecessor graph:

| Existing phase | v2 modes |
| --- | --- |
| `contract-baseline`, `documentation`, `backend-unit-build`, `backend-database` | `hosted-baseline`, `local-identity-preview` |
| `local-orchestrator`, `eval-fixtures`, `eval-deterministic-scenarios`, `web-production-build`, `harbor-static` | `hosted-baseline` |
| `restart-smoke`, `packaged-composition-smoke`, `repository-integrity` | `hosted-baseline`, `local-identity-preview` |

Schema, runner, manifest, command-policy, registry, and their fixtures/tests
land together. Tests reject v1 as the current manifest, either mode omitted or
reordered, local mode on an unrelated phase, missing local core evidence, any
command substitution/addition, and any hosted phase loss. The merge-base v1
files remain readable only by the explicit comparison path; there is no mixed-
version runtime state.

The existing `restart-smoke` phase runs hosted evidence first and then one
bounded local lifecycle: initialize, preview/auth integration, close, second
preview with the same principal, rotate/recover, and cleanup. It must remain
inside the existing 600-second phase timeout, the unchanged 94-minute sum of
manifest phase timeouts, the 103-minute cooperative gate deadline, the
108-minute dedicated-workflow gate step, and the 165-minute workflow job; no
workflow step/job, timeout increase, phase, or aggregate gate is added. Unit/
integration suites cover exhaustive injected failures; the real packaged smoke
covers representative kill after durable initialization candidate with
observed zero/exact DB state, exact committed-before-publication recovery
fixture, rotation old/new outcome, steady preview termination, and restart.

The outer gate—not a child—allocates the unique TLS test database, private state
parent/root, and process group. It keeps a sanitized lifecycle journal of exact
database name, canonical root identity, and PIDs/process group; validates that
child reports cannot expand ownership; and after success, failure, SIGTERM, or
timeout independently verifies no process/listener, database, or owned file
remains. Cleanup removes only exact recorded resources and fails on identity
drift or unknown entries. Tests exercise cleanup cancellation and timeout. No
mount, namespace, shared DB, broad temp/home, or user state is a cleanup target.

Registry/baseline/docs distinguish Auth0 removed from the local human path from
Auth0 retained by `main`'s hosted baseline and hosted MCP compatibility. They
record the provider-neutral principal, main-only issuer/link policy, local state
format/commands, database target/lock, non-listening preview, separate MCP/
browser credentials, same-UID limitation, and Step 09 deferrals.

## Checkpoints

### Checkpoint 1: Activation, characterization, and consumer inventory

**Outcome.** Commit this approved plan/status plus passing characterization for
hosted exact identity, `me`, self-only `user(id)`, REST guards, M2M, reset,
GraphQL SDL, MCP/client/grant fixtures, package default, and consumers. No
product behavior changes.

**Tests.** Characterization is green by definition. Record the future red
signals—hardcoded `jwt`, no issuer, unverified/undispositioned email binding, no
local composition/state—as assertions introduced only in their owner checkpoint.

**Runtime/validation/rollback.** Hosted baseline unchanged. Run focused unit,
contract, schema, MCP, reset, and package-default tests. Reverting this
docs/tests-only checkpoint has no persisted-state effect. Registry/gate remains
v1/hosted-only.

### Checkpoint 2: Provider seam and main-only hosted adapter

**Outcome.** Change common guards to `human`; retain hosted JWT/M2M behind that
name; add issuer migration/repositories; strict hosted config; frozen link/deny
audit, marker, preflight, and serializable policy; unique `.invalid` fallback;
sanitized touched logging. Update every main-line env example/fixture/smoke.

**Tests first.** Observe red provider-graph/guard tests, genuine pre-Step03-
schema migration fixture, issuer/legacy conflicts, strict claim parser/digest
vectors, audit/preflight/marker cases, complete verified/unverified/source/
canonicalization/reserved/collision matrix, recycled-email wrong-subject
rejection, same/distinct-subject races, profile create/link/exact behavior,
logging canaries, and old-writer rejection. Then implement in small focused
changes with targeted green runs.

**Runtime/validation.** `main` hosted baseline remains the only runtime. Run
unit, serial real-PostgreSQL integration, Prisma generate/migrate, GraphQL/
REST/MCP/grant/reset contracts, backend build, hosted restart, and an actual
backup-restore/re-forward fixture. The marker survives reset. Public schema and
wire fixtures do not drift.

**Rollback/security.** Old binary requires full verified backup restore under
the no-retained-write rule; otherwise roll forward. No row merge/delete or
marker edit is authorized. Registry records a main-only correction and the
production-line non-disposition; gate topology is unchanged.

### Checkpoint 3: Private state and admin CLI

**Outcome.** Add local config, target ID, canonical state parser/store, operation
records/candidates, dedicated pg advisory session, initialize/recover/rotate/
open CLI, deterministic `.invalid` email, deadlines, and fixed diagnostics.

**Tests first.** Observe red unit/integration tests for format/size/mode/type/
symlink/owner/unsafe-ancestry/extra-artifact failures, injected adversarial
parent rename/rebind and pinned-inode drift; CSPRNG independence; fsync/
publication order and every staging create/write/fsync/link/post-link-verify/
directory-fsync/unlink crash; the exact different-database shared-root orphan-
stage/link interleaving; recovery-record cleanup with every remaining orphan
count including zero; rotation-record-before-candidate recovery; zero-user/
candidate, matching-user/commit ambiguity, wrong-user/target, ready convergence,
partial writes, every operation-record shape, old/new rotation, manual-clock
deadlines, same-root and different-root contention, second-client exclusion,
killed backend/session, and fresh-client lock release.
Then implement the smallest state/DB pieces and run each focused suite green.

**Runtime/validation.** The packaged CLI is executable but not a supported gate
mode yet. Run unit fault injection, real direct-TLS PostgreSQL integration,
concurrent processes, package relocation/closure, and backend build. Successful
state has exactly one canonical file; failures mutate neither a wrong DB nor an
unowned path.

**Rollback/security.** Code rollback leaves the explicit state root untouched.
Recovery is only through named commands and enumerated shapes; no destructive
reset exists. Human credential canaries cover outputs/logs/errors/argv/env/DB/
metadata/journals/artifacts while permitting private-file and comparison memory.
Registry/gate is prepared but not activated.

### Checkpoint 4: Real local composition and authentication

**Outcome.** Add `LocalApplicationModule`, local `human` strategy, unavailable
model adapter, non-listening preview lifecycle, direct GraphQL/REST integration,
Auth0/Vertex isolation, rotation-race behavior, and reset preservation.

**Tests first.** Observe red composition/provider-import tests and real-module
correct/missing/wrong bearer, `me`, same/cross `user(id)`, REST guard, exact SDL,
unavailable-model, no-MCP, no-listener, DNS/socket-tripwire, per-request reread,
completed-before-linearization and overlapping rotation outcomes, signal/close,
and reset-byte-stability tests. Then implement and keep hosted suites green.

**Runtime/validation.** The local preview is functionally complete but not
registered until Checkpoint 5. Run focused unit/in-process integration, hosted
and local schema comparison, real database/state tests, backend build, hosted
restart, and packaged preview smoke.

**Rollback/security.** Stopping/removing the preview code preserves state and
DB. No listener or anonymous local-user bypass exists. Local human and MCP
credentials reject one another by composition. Gate/registry remains inactive.

### Checkpoint 5: Restart/gate/docs, final review, and PR closeout

**Outcome.** Integrate bounded local lifecycle into the existing restart phase;
atomically migrate the contract registry and gate manifest/schema/checker/
runner/command policy to the exact v2 shapes and phase map in Section 7; update
identity/reset/operator/outbound docs; add outer lifecycle-journal validation;
run fresh base-to-HEAD reviews and final evidence; mark implemented pending
human merge and make the single draft PR ready.

**Tests first.** Observe red active-mode/registry/runner/cleanup/doc assertions
for missing local mode, wrong phase/timeout, hosted phase loss, source-tree
fallback, v1-current/mixed-version acceptance, command-policy drift, dotenv/
Auth0 leakage, absent recovery commands, and ownership-journal tampering. Add
real packaged two-generation/recovery/rotation/termination smoke and
representative kill cases, then make the smallest manifest/wrapper/docs changes
green.

**Runtime/validation.** Both `hosted-baseline` and non-listening
`local-identity-preview` are supported on `main`; only hosted remains reachable.
Run the full matrix below, exact-base aggregate gate, standard CI and dedicated
workflow on the reviewed head. Record durations, URLs, skips, limitations, and
cleanup. A human owns merge.

**Rollback/security.** Revert manifest/registry/docs/code together if evidence
cannot remain active; never delete supplied state. Final review covers
architecture, tests/recovery, compatibility, security/privacy, and
maintainability. Material deviations return to plan review.

## Validation Matrix

| Surface | Required evidence |
| --- | --- |
| Unit/architecture | Auth guard seam, explicit roots, config, state parser/protocol, deadlines, fixed diagnostics, provider/import boundaries |
| Hosted identity | Serial real-PostgreSQL issuer/legacy/link/deny integration; strict claim/audit/preflight/marker; concurrency; genuine old-schema migration; backup restore/re-forward |
| Local state/DB | Real TLS PostgreSQL; dedicated-session exclusion/release; concurrent processes; every crash/recovery shape; wrong target/user zero mutation; rotation old/new; checked fsync order |
| Local real composition | No-listener direct GraphQL/REST guard evidence for bearer, `me`, self-only `user(id)`, exact SDL, reset preservation, unavailable model, MCP/Auth0 absence |
| Contracts | GraphQL, REST, MCP, OAuth/DCR, client/grant/audit fixtures unchanged except explained registry/config additions |
| Package/build | Prisma generate/migrate, backend build, affected web build, seed typecheck; relocated Step 02 package contains local entrypoints and no test resources/source fallback/absolute build path |
| Restart | Hosted restart retained; local initialize/two previews/rotate/recover; representative process kills; no listener/orphan; principal stable; credential old/new behavior exact |
| Gate/cleanup | Existing 12 phases/order/timeouts retained; local work stays in restart phase; outer sanitized journal proves exact process/database/state cleanup on pass/fail/SIGTERM/timeout |
| Hygiene/remote | `git diff --check`, strict Markdown links, clean scoped status, base-to-HEAD review, exact-base full gate, applicable final-head CI and dedicated workflow |

Representative commands will use exact Node/pnpm and isolated test DB inputs:

```sh
pnpm --filter backend exec jest --selectProjects unit --runInBand \
  src/modules/auth/auth.service.spec.ts \
  src/modules/auth/local-identity-state.service.spec.ts \
  test/contracts/identity-composition.spec.ts

pnpm --filter backend test:db:up
pnpm --filter backend test:db:migrate
pnpm --filter backend exec jest --selectProjects integration --runInBand \
  test/integration/hosted-identity.repository.spec.ts \
  test/integration/local-identity.repository.spec.ts
pnpm --filter backend test:e2e:tests-only
pnpm --filter backend build
pnpm --filter web build
pnpm --filter backend typecheck:seed
node scripts/check-contract-baseline.mjs
node scripts/check-markdown-links.mjs

MIGRATION_GATE_BASE_SHA=6b420ed24e9dd344af8990c9045832990ae1b5ec \
MIGRATION_GATE_PYTHON_BIN=/Users/lucasnovak/.pyenv/versions/3.12.8/bin/python3.12 \
MIGRATION_TEST_ADMIN_URL=postgresql://postgres:postgres@127.0.0.1:5433/postgres \
pnpm migration:gate
```

Exact filenames may narrow during tests-first implementation, but no required
behavior may be dropped. The expensive aggregate gate runs at activation and
final closeout, plus only when a gate-specific checkpoint needs it.

## Conflict Surfaces And Sole-Writer Policy

`/root` is sole writer. Review agents do not edit, stage, commit, branch, or
mutate external state. Hotspots are:

- common human guards; hosted/local auth modules and composition roots;
- hosted config/Auth0/external-identity/user services and diagnostics;
- Prisma schema, one migration, generated client/schema fixture;
- new local state/config/admin/preview entrypoints and tests;
- Step 02 backend package closure and existing restart/gate manifests/scripts;
- identity/reset/operator docs and human/JSON registries.

No `.github/workflows/ci.yml`, lockfile, web-auth, MCP transport, model runtime,
or broad storage abstraction edit is authorized. An unexpected dependency,
public break, second listener, native helper, or new workflow job stops for
scope review.

## Privacy And Security

- Principal and credential are independent 256-bit values. Credential compare
  is constant-time after exact encoding/length checks and state is reread before
  successful return.
- The raw local credential is intentionally present only in canonical/candidate
  private file bytes and request/comparison memory. Leak tests exclude those
  legitimate boundaries and require absence from every observable diagnostic,
  response, process/config surface, DB/metadata row, journal, and artifact.
- Database password is an explicit infrastructure secret in local Node env and
  pg/Prisma memory. It is not conflated with the human credential and never
  logged/artifacted. Direct verified TLS to literal loopback prevents disclosure
  to an untrusted local listener under the stated OS boundary.
- Local preview has no browser or listener, so Host/Origin/CSRF/rebinding policy
  is not applicable. Adding one is material re-review.
- Private parent/root modes protect against other OS users. Same UID, root,
  debugger, malicious dependency/runtime, kernel, and hardware power-loss
  compromise remain outside Step 03; Step 09 owns stronger launch/runtime,
  keychain, signing, data-location, and durability policy.
- Hosted exact issuer/subject remains ongoing auth. Verified email plus the
  operator disposition is acknowledged one-time binding authority; email alone
  and subsequent email are not auth/authorization.
- Fixed errors/log events never include raw token claims, emails, subjects,
  principals, credentials, database URLs, Auth0 SDK/Prisma causes, SQL, or
  parameters. Public MCP error/challenge bodies remain pinned.

## Rollback And Recovery

Hosted migration rollback follows the stopped-writer full-backup rule in
Section 2; removing claim config never unlinks a consumed identity. The deployed
hosted-v1 maintenance line is unaffected.

Local recovery is non-destructive: normal open never repairs; named recovery
accepts only enumerated operation/candidate/DB shapes; rotation preserves
principal; reset preserves exact state bytes; corrupt/conflicting state stops.
Restoring an old state backup may resurrect an old bearer, so keep preview
offline and rotate under both locks before reuse. Code rollback stops preview
and leaves state untouched. Step 03 ships no delete/reinitialize command.

Test/gate cleanup targets only its journaled database, private temp root, and
process group. It never traverses a home/workspace root or user-supplied state.

## Risks And Resolved Questions

| Risk/question | Resolution |
| --- | --- |
| Main change could be mistaken for hosted production remediation | PR is `local-only`; hosted-v1-maintenance is explicitly unchanged, no backport is authorized, and future remediation requires separate hosted planning. |
| Email recycling could claim history | Full drained cohort gets an explicit unique link tuple or deny; preflight, marker, and serializable recheck reject email-only/wrong-subject claims. |
| Operator approves wrong tuple | This residual authority is explicit; removal does not unlink; stop writers and use verified backup or reviewed repair. |
| File and DB cannot commit atomically | Complete candidate is durable first; dedicated session commits exact user; publication follows; explicit recovery distinguishes zero/exact/wrong DB state. |
| Advisory lock/session disappears | One direct dedicated client is sole mutator; timeout/death stops later queries; durable candidate/record permits recovery; fresh client proves release. |
| Same root is pointed at another DB | Credential-free target ID plus exclusive operation record fails before wrong-target mutation. |
| Concurrent initializers create duplicates | One global advisory key per DB plus exclusive root record; transaction accepts only zero or exact candidate user. |
| Rotation crashes | Atomic replacement leaves complete old or new state; record/digest selects discard-old-candidate or accept-new cleanup. |
| Local app accidentally reaches Auth0/model/MCP | Separate root, import/provider assertions, absent human Auth0 config, unavailable model adapter, and DNS/socket tripwire. |
| Step 03 becomes an installer/runtime-security project | It uses ordinary relocatable Node package output; native guards, closure attestation, supervision, signing, final paths, and keychain remain Step 09. |
| Gate budget is exhausted | Reuse existing restart phase/job and timeout; no dispatcher/job added; record actual duration and fail if existing budget is exceeded. |

No open design choice may be decided ad hoc during implementation. A new
dependency, listener, public schema change, native helper, destructive recovery,
different state protocol, hosted-v1 change, second PR, or gate budget increase
returns to plan review.

## Independent Plan Review

All reviews are read-only. Earlier findings remain recorded even though the
superseded design was replaced.

| Wave/dimension | Finding and disposition | Status |
| --- | --- | --- |
| Discovery | Architecture, consumers, tests/recovery, and security discovery informed the first draft. | Complete |
| First review waves | Findings on manifest cycles, runtime closure, child descriptors/liveness, compiler ordering, test-profile exclusion, guard config ingress, digest-before-parser, and email-binding authority were resolved in the superseded native design. | Superseded |
| Fresh security on checksum `3916590244 244927` | Approved the corrected security contracts, but that checksum is invalidated by the architecture rewrite. Proportionate invariants were retained here. | Renew review |
| Fresh architecture on checksum `3916590244 244927` | Blocked shared-production branch treatment, Step 09 native/process overreach, non-relocatable launcher, and oversized checkpoint. Disposition: explicit main-only/non-production policy; remove native/Python/loader/proxy design; use relocatable Node CLI; split green checkpoints. | Resolved; renew review |
| Fresh compatibility on checksum `3916590244 244927` | Blocked missing hosted-production disposition and false standard-CI/Python premise. Disposition: explicit no-backport policy; native profile removed; real workflow boundary stated. | Resolved; renew review |
| Fresh tests/recovery on checksum `3916590244 244927` | Blocked contradictory credential claim, unbudgeted dispatcher/cleanup ownership, and all-at-once checkpoint. Disposition: exact legitimate credential boundary, no dispatcher, outer journal, dedicated pg/file protocol, smaller checkpoints. | Resolved; renew review |
| Narrow architecture on checksum `4197020148 49050` | Blocked partial direct-written artifacts and an impossible claim that every overlapping rotation rejects. Disposition: every record/candidate now uses no-clobber publication from enumerated staging shapes with crash-boundary recovery; authentication has an explicit second-read linearization point. | Resolved; renew review |
| Narrow compatibility on checksum `4197020148 49050` | Blocked undefined legacy-issuer startup semantics and underspecified two-mode registry/gate migration. Disposition: exact canonical/conditional fail-closed issuer rules, required fixture/docs migration, exact v1-to-v2 registry/manifest shapes, phase map, command-policy changes, and unchanged nested timeout budgets. | Resolved; renew review |
| Renewed architecture on checksum `4105571263 56116` | Blocked a cross-database shared-root ABA through the fixed operation stage and the nonexistent two-`int64` advisory overload. Disposition: per-attempt stages, fixed no-clobber published root mutex, mandatory post-link inode/byte verification, owned orphan cleanup, exact adversarial interleaving test, and PostgreSQL's two-`int32` form. | Resolved; renew review |
| Renewed security on checksum `4105571263 56116` | Blocked cross-UID parent-entry replacement outside the mode-0700 leaf. Disposition: explicit root/current-UID protected ancestry with only root-owned sticky-anchor exception, pinned parent/root identities around pathname mutation, and adversarial rebind tests; same-UID/root remain declared Step 09 limits. | Resolved; renew review |
| Renewed tests/recovery on checksum `2538770170 58824` | Blocked omitted recovery-record cleanup and pre-candidate rotation crash states plus unspecified cleanup order. Disposition: both states are explicit and restartable, artifacts are durably removed before the fixed operation record, and every omitted crash boundary has a named fault test. | Resolved; renew review |
| Architecture/scope/maintainability | Approved on substantive checksum `392828203 60296`; final status-only metadata change reverified. | **APPROVED** |
| Testing/persistence/concurrency/recovery/gate | Approved on substantive checksum `392828203 60296`; final status-only metadata change reverified. | **APPROVED** |
| Compatibility/consumers/interface evolution | Approved on substantive checksum `392828203 60296`; final status-only metadata change reverified. | **APPROVED** |
| Security/privacy/credentials/local threats | Approved on substantive checksum `392828203 60296`; final status-only metadata change reverified. | **APPROVED** |

Material plan changes after approval renew affected dimensions. Ordinary
implementation corrections within these contracts do not invalidate unrelated
approvals.

## Exit Criteria

- Stable opaque principal semantics pass in hosted and local roots; no email,
  subject suffix, client key, machine/path, or first-row derivation exists.
- Hosted issuer/legacy/frozen-link policy passes real migration, concurrency,
  preflight, rollback, public-contract, and no-production-backport checks.
- Local initialize/restart/recovery/rotation/concurrency/wrong-target/reset pass
  with real TLS PostgreSQL and leave exactly one canonical private state file.
- Correct/missing/wrong/rotated local bearer exercises the real local strategy
  and guards; `me` and self-only `user(id)` retain exact shapes.
- Local startup/import/invocation evidence proves no human Auth0, JWKS,
  Management/Authentication API, hosted model, MCP server, web process, or
  listener.
- Hosted GraphQL/REST/MCP/OAuth/DCR/client/grant/restart/package evidence remains
  green; local credential never authenticates MCP.
- New entrypoints are relocatable ordinary Step 02 package contents with no
  source fallback, absolute build path, native helper, or runtime toolchain.
- Existing aggregate gate retains all 12 phases/order/timeouts, records and
  cleans exact resources, and passes on the exact reviewed head locally and in
  the dedicated workflow.
- Canonical docs/registry say Step 03 is implemented pending human merge. The
  single PR is ready for human review and is not auto-merged.
