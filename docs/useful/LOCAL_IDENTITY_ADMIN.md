# Local Identity Administration

- Status: useful
- Read when: initializing, rotating, or recovering the single-user local identity
- Source of truth: `apps/backend/src/local-identity.ts`,
  `apps/backend/src/bootstrap/local-identity-preview.ts`,
  `apps/backend/src/modules/auth/local-identity-*.ts`, and
  `apps/backend/src/config/local-identity.config.ts`
- Last reviewed: 2026-09-22

## Scope

Step 03 intentionally starts identity data from a clean slate. It does not
preserve historical users or infer identity from email. Hosted and future
human identity providers bind through the provider-neutral tuple
`(provider, issuer, subject)`; the local identity is a separate single-user
composition with its own random principal and credential.

Build the backend before running the supported compiled command:

```sh
pnpm --filter backend build
pnpm --filter backend local-identity initialize
```

The command reads exactly these inputs:

- `LOCAL_IDENTITY_STATE_ROOT`: absolute private state directory beneath a
  trusted current-user-owned `0700` parent.
- `DATABASE_URL`: direct TLS PostgreSQL URL for literal `127.0.0.1`, including
  an explicit port, database, user, and password.
- `LOCAL_DATABASE_TLS_CA_PEM`: one CA certificate whose server certificate
  verifies the loopback IP SAN.

The exactly four administrative commands are `initialize`, `rotate`,
`recover-initialize`, and `recover-rotation`. `preview` is a separate runtime
entrypoint, not an administrative mutation.
Successful output is one fixed JSON record containing only the record type,
version, operation, `ok` status, and generation; failures use a fixed diagnostic
and do not print credentials, principals, URLs, SQL, or causes.

## Recovery Is Break-Glass

Never start either recovery command while the original administrative process
is running or stopped. A lost database session does not prove that the process
cannot still complete an in-flight filesystem syscall.

Before recovery:

1. Identify the exact original administrative process and every other
   administrative process using the same state root.
2. Terminate them.
3. Wait for and observe each exact process exit. A sent signal or a stopped
   (`SIGSTOP`) process is not sufficient; the processes must be reaped.
4. Only then run the matching named recovery command with the same state root,
   database target, and CA.

```sh
pnpm --filter backend local-identity recover-initialize
pnpm --filter backend local-identity recover-rotation
```

For a normal credential rotation, with no recovery artifacts present, run:

```sh
pnpm --filter backend local-identity rotate
```

Rotation preserves the principal, database target, account email, and every
provider binding attached to that principal. It changes only the local bearer
and generation.

The recovery command takes the database advisory lock and validates the durable
operation/candidate protocol. It fails closed on a wrong target, corrupt or
unknown artifact, unrecognized inode relationship, wrong principal, multiple
users, or provider binding owned by another principal. Do not manually delete
or edit state artifacts to bypass a failure.

After initialization or rotation succeeds, the state root contains exactly
`identity.json`, owned by the current UID with mode `0600`; the directory is
mode `0700`. A successful `recover-initialize` with `generation: null` instead
means no database identity was committed and the pre-initialization state root
remains empty.

## Run The Non-Listening Preview

After `initialize` succeeds, start the preview with the same three explicit
inputs:

```sh
pnpm --filter backend local-identity preview
```

The process preflights the canonical state and exact database ownership,
initializes the real local Nest composition with `init()`, verifies state and
database again, emits only the fixed readiness record, and waits for
`SIGINT`/`SIGTERM`. It never calls `listen()` and has no HTTP, GraphQL-over-the-
network, MCP, OAuth, web, or model endpoint. Shutdown is bounded and returns
the conventional signal exit code.

After a successful quiescent operation, the raw bearer exists only in the
current-UID-owned `0600` `identity.json`. During an administrative operation,
private `0600` candidate or stage artifacts can transiently contain the proposed
credential; a crash can leave those artifacts for the matching recovery command
to reconcile. Never copy any state artifact into argv, environment variables,
logs, issue text, or command output. Final state location, keychain integration,
backup/restore, and an explicit destructive identity reset belong to Step 09.
Another process with the same UID, root access, a debugger, or a compromised
runtime/kernel/hardware remains outside this preview's protection boundary.
