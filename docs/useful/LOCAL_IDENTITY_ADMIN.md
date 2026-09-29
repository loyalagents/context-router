# Local Identity Administration

- Status: useful
- Read when: initializing, rotating, recovering, or backing up the single-user local identity
- Source of truth: `apps/backend/src/local-identity.ts`, `apps/backend/src/local-identity-postgres-reference.ts`, `apps/backend/src/config/local-database.config.ts`, `apps/backend/src/bootstrap/local-identity-preview.ts`, `apps/backend/src/infrastructure/storage/sqlite/`, and `apps/backend/src/modules/auth/local-identity-*.ts`
- Last reviewed: 2026-09-23

## Select Fresh Local State

The default `local-identity` command uses a file-backed SQLite database on the pinned Node 24.21.0 runtime. It needs no PostgreSQL server, Docker, Auth0 or hosted model. Hosted `main.js` and existing hosted workflows remain unchanged. The older PostgreSQL preview is available only through the explicit reference command below; there is no automatic import, reuse, deletion or reinterpretation of its state.

Build the backend and choose two **fresh**, distinct, canonical absolute paths below a trusted current-user-owned `0700` parent. They must not be equal or nested inside one another. Replace the example parent with an existing private canonical directory; resolve symlinked ancestors before selecting roots.

```sh
pnpm --filter backend prisma:generate
pnpm --filter backend build
export LOCAL_DATABASE_ROOT=/absolute/private-parent/local-data
export LOCAL_IDENTITY_STATE_ROOT=/absolute/private-parent/local-identity
pnpm --filter backend local-identity initialize
pnpm --filter backend local-identity preview
```

These two roots are the only local database selection inputs. The command does not load `.env`, select a store from `DATABASE_URL`, or fall back to PostgreSQL. Initialization alone may create a new database. Preview, rotation and identity recovery require the existing compatible database; missing, empty, foreign, newer-schema or corrupt state fails closed. The database has its own random durable target identifier, preserved by a valid offline move or matching-pair restore. A running connection also pins the current root and main-file identity and rejects replacement.

Successful quiescent identity state is exactly `identity.json` (`0600`) inside its `0700` root. SQLite's `database.sqlite` and rollback journal belong in the separate `0700` database root; files are private `0600`. Unknown entries, symlinks, unexpected hard links, foreign ownership and permissive modes are rejected. Never add database or backup files to the strict identity root.

## Commands And Catalog Startup

The four identity administration commands remain `initialize`, `rotate`, `recover-initialize`, and `recover-rotation`. Successful output is one fixed JSON record containing only type, version, operation, `ok` status and generation. `preview` emits the fixed readiness record and waits for a signal. Failures use fixed diagnostics without credentials, principals, paths, SQL or causes.

Initialization creates one random principal and credential, then seeds the canonical catalog only. Every preview startup verifies the same identity and repeats catalog seeding, preserving active catalog IDs and per-entry partial progress. Neither path creates sample users. **An initialization error during catalog seeding can occur after identity was committed.** Preserve the database and identity artifacts. Once the catalog failure is corrected, run verified `preview` to finish the catalog; do not delete state or initialize a new principal. Failed startup never emits readiness. Catalog entries are separate committed operations; startup does not hold one catalog-wide transaction or promise that concurrent previews all succeed. Ordinary database lock contention fails immediately with zero native busy wait and no hidden adapter retry; this is not a total native or filesystem I/O deadline.

The SQLite-only command `recover-database-bootstrap` handles interrupted creation of the database before identity initialization:

```sh
pnpm --filter backend local-identity recover-database-bootstrap
```

It emits its own fixed database-bootstrap result (`none` or `recovered`), not an identity generation record. It requires all original preview/admin processes terminated and reaped, plus empty identity state. With no bootstrap residue it performs no initialization. It can complete a single valid closed bootstrap stage or reconcile its proven same-inode published pair; partial, multiple, unrelated, unsafe or incompatible stages remain untouched and fail. It never opens a canonical file while a transient publication hard link remains, never invents a principal, and never repairs arbitrary empty or unknown databases.

Concurrent fresh initializers can both fail, or one can publish first. An invocation that has committed and normally closed its own complete unpublished bootstrap stage removes only that original private one-link stage when it discovers a competing entry, then reports fixed failure. It does not require the winner's identity root to remain empty. Partial, replaced, linked, sidecar-bearing or uncertain stages are preserved; failed publication does not authorize cleanup. After all original processes exit and are reaped, retry a clean empty root or verify the published winner; use named recovery for retained bootstrap residue.

## Recovery Requires Termination And Reaping

Do not recover while an original administrative process is running or stopped. A timeout, sent kill signal, lost worker reply or newly available database lock does not establish that the original process can no longer finish an in-flight filesystem operation.

1. Identify every original administrator using either the database or identity root.
2. Terminate those exact processes.
3. Wait for and observe each exact process exit; a `SIGSTOP` process is still alive. The originals must be **terminated and reaped**.
4. Run the matching named command with the same two roots (or the explicit reference configuration below).

```sh
pnpm --filter backend local-identity recover-initialize
pnpm --filter backend local-identity recover-rotation
```

For ordinary rotation without residue:

```sh
pnpm --filter backend local-identity rotate
```

Rotation preserves the principal, target, account email and all provider bindings; it changes only bearer and generation. Recovery retains the original complete candidate when reconciling empty or exact database ownership. Pre-mutation orphan/stage cleanup follows its separate proven artifact ordering and does not impose a new universal empty-user condition. A successful `recover-initialize` with `generation: null` means no identity was committed and the identity root remains empty. Wrong targets, corrupt published artifacts, unknown inode relationships, wrong generations, multiple principals or foreign binding owners fail unchanged. Never delete or edit artifacts to bypass those checks.

The SQLite administrator owns a dedicated worker connection with an actual main-database EXCLUSIVE lock, retained across commit through filesystem publication and cleanup. Other local database readers/writers are excluded during that operation. Parent deadlines reject and latch the handle; they do not interrupt arbitrary native or kernel I/O or acknowledge native release. Only actual worker exit proves its native ownership ended. An ambiguous commit or failed release remains recovery-required, with artifacts preserved and same-process reacquisition forbidden.

## Engine Admission And Files

The selected mode is rollback `DELETE` with `FULL` synchronization. A safe ordinary hot rollback journal may be replayed by SQLite before logical schema/target admission; this intrinsic crash recovery can change physical bytes without being application reset authority. Unsafe journal metadata and a possible embedded super-journal footer are rejected before open, without following any embedded path. Unknown/non-recovery negative states are preserved.

A rollback journal that disappears between directory enumeration and metadata inspection is accepted as an absent optional entry. All other journal metadata errors and changes during strict descriptor/content inspection remain failures; this does not add SQL retries or hot-journal deletion authority.

Existing WAL/SHM files are rejected. A sidecar-free foreign WAL-format header can cause SQLite's first schema read to create empty engine WAL/SHM files before its mode is known. The adapter rejects non-DELETE mode before configured settings and never converts the file. Normal actual close removes those engine-created empty sidecars, preserving main/identity bytes and the final entry set. Crash or uncertain close may leave them; later admission preserves and rejects them. Do not manually remove journals or sidecars.

Never open/read/copy/fsync/close the live main database through raw filesystem descriptors while any same-process SQLite connection exists, including a worker: on POSIX, that close can cancel process advisory locks. Path metadata checks are different. Do not rename or unlink a live database. Use SQLite's backup mechanism for an open source; raw file copying is limited to confirmed-closed, distinct backup/bootstrap copies under the internal protocol.

## Matching-Pair Backup And Restore

Step 05 implements and tests the adapter-private `SqliteBackup` mechanism; it does not add a supported backup CLI or final backup UI. Step 09 owns that product workflow and hardware qualification. The mechanism requires all original preview/admin processes terminated and reaped and a canonical-only identity state, then holds the same validated database owner through SQLite backup, exact identity-byte copy and durable no-clobber completion. A database-only snapshot is not a credential-consistent backup. Never copy a live main file while omitting its journal.

A complete bundle contains private `data/database.sqlite`, `identity/identity.json` and `complete.json`. Incomplete/ambiguous artifacts are preserved, not treated as permission to reset or delete source data. Restore accepts only a completed bundle and a **new absent destination**, leaves source/bundle unchanged, and validates the copy's schema, target, integrity, foreign keys and exact principal. The destination identity root remains empty until every check and source-envelope recheck succeeds; only then are exact canonical identity bytes published while ownership remains held. Before publication, ordinary preview refuses the destination. A later failure can be acknowledgement ambiguity of an already validated pair.

Restoring an older pair restores its old bearer and generation. After successful restore, rotate the restored identity when old backup credentials must be invalidated. No target, principal or credential is regenerated silently. Code rollback preserves SQLite state; earlier Step 04 binaries cannot read it. Restore compatible code before reuse instead of downgrading schema or running hosted migrations against local files.

## Non-Listening Preview And Protection Boundary

Preview preflights identity and exact database ownership, seeds the catalog, initializes the real local Nest composition with `init()`, verifies again, and emits readiness. It never calls `listen()` and exposes no HTTP, GraphQL-over-network, MCP, OAuth, web or model endpoint. `SIGINT`/`SIGTERM` closes the application with the conventional signal exit code. The additive `preview-model` command selects the [manual local model integration](LOCAL_MODEL.md), while ordinary `preview` stays no-model. Both preserve this non-listening lifecycle; application readiness does not certify inference readiness. HTTP/MCP/UI listeners remain later migration work.

The bearer remains in private canonical/candidate files and parent authentication memory; never place those bytes in argv, environment variables, logs, issues or command output. The fixed worker protocol carries bounded identity/configuration data, never credential bytes, arbitrary SQL or row metadata. Same UID, root, debugger, compromised runtime/kernel/hardware, network filesystems, Windows and hardware power-loss guarantees are outside this macOS/Linux preview evidence.

## Retained PostgreSQL Reference

Existing PostgreSQL preview state stays on its original database and identity root. Select the explicit command; do not point the SQLite command at that state. Its inputs remain `LOCAL_IDENTITY_STATE_ROOT`, a direct TLS `DATABASE_URL` for literal `127.0.0.1` with explicit port/database/user/password, and `LOCAL_DATABASE_TLS_CA_PEM` whose server certificate verifies that IP SAN.

```sh
pnpm --filter backend local-identity:postgres-reference initialize
pnpm --filter backend local-identity:postgres-reference preview
pnpm --filter backend local-identity:postgres-reference rotate
pnpm --filter backend local-identity:postgres-reference recover-initialize
pnpm --filter backend local-identity:postgres-reference recover-rotation
```

Use `initialize` only for fresh reference state. The reference retains its four identity commands, TLS validation, advisory-lock coordination and process/recovery tests; it has no SQLite bootstrap-recovery command. Both previews are non-listening. The gate retains reference evidence and independently requires SQLite source and relocated-package restart evidence.
