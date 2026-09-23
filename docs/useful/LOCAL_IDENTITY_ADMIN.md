# Local Identity Administration

- Status: useful
- Read when: initializing, rotating, or recovering the single-user local identity
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

The administrative commands are `initialize`, `rotate`,
`recover-initialize`, and `recover-rotation`.
Successful output contains only the operation and generation; failures use a
fixed diagnostic and do not print credentials, principals, URLs, SQL, or
causes.

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
