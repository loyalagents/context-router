# Hosted Identity Migration

- Status: current for the `main` hosted-baseline adapter
- Read when: preparing the Step 03 external-identity issuer migration or
  recovering that migration
- Source of truth:
  `apps/backend/prisma/migrations/step03_20260922_external_identity_issuer/migration.sql`,
  `apps/backend/src/modules/auth/hosted-identity-audit.cli.ts`, and
  `apps/backend/src/modules/auth/hosted-identity-admission.service.ts`
- Last reviewed: 2026-09-22

This is a future `main` migration procedure, not a production remediation.
The deployed `hosted-v1-maintenance` line is unchanged. Do not backport or
cherry-pick this migration; a production fix requires a separate reviewed
maintenance decision.

## Required configuration

`AUTH0_ISSUER` is the exact canonical HTTPS issuer, including its final `/`.
`AUTH0_DOMAIN` is exactly that issuer's host and is used only for JWKS. Set
`AUTH0_AUDIENCE` explicitly. When any pre-Step03 Auth0 identity exists,
`AUTH0_LEGACY_ISSUER` is required and must byte-equal `AUTH0_ISSUER`.

`AUTH0_LEGACY_ISSUER` is an operator assertion about the issuer that created
the historical Auth0 subjects; it is not inferred from a subject string. Prove
it from the historical deployment configuration and change records before the
audit. Stop if that provenance cannot be established. Omission is allowed only
when the drained database has zero pre-Step03 Auth0 identity rows. An empty or
unequal value is always invalid; a stale value that remains configured when the
count is zero must still exactly equal `AUTH0_ISSUER`.

Every new replica also requires the same exact
`AUTH0_IDENTITY_LINK_CLAIMS`. Even an empty cohort uses the explicit compact
value:

```text
{"version":1,"dispositions":[]}
```

Do not assume that empty value is safe for an existing database. Generate and
approve it with the audit below. The audit command intentionally does not read
`AUTH0_IDENTITY_LINK_CLAIMS`, because it produces that value.

Update the active ignored runtime file before booting the `main` adapter. This
commonly means `apps/backend/.env`, `apps/backend/.env.prod`,
`apps/backend/.env.prod.old`, or root `cloudrun.env`. These files contain local
or operator-owned secrets and must not be committed. Tracked example files are
templates, not active configuration.

## Drained-writer audit

1. Build and stage the new artifact, but do not start it.
2. Stop every old backend, job, console, and other database writer. Keep them
   stopped through audit, backup, migration, and new-binary admission.
3. Independently inspect the old identity ledger for duplicate Auth0 subjects
   and prepare one explicit decision for every user that has zero identities
   and an eligible, non-reserved email. Ambiguous canonical-email groups may
   only be denied. A link needs the exact configured issuer and exact proposed
   Auth0 subject.
4. Put the decisions in a compact UTF-8 JSON array with no BOM, whitespace, or
   final newline. Keys are exactly ordered as shown, entries are strictly sorted
   by UTF-8 user-ID bytes, and there are at most 256 entries:

   ```text
   [{"userId":"opaque-user-id","email":"account@example.test","decision":"deny"},{"userId":"second-opaque-id","email":"verified@example.test","decision":"link","issuer":"https://tenant.auth0.com/","subject":"auth0|exact-subject"}]
   ```

5. Store the intent at an absolute physical path beneath an immediate directory
   owned by the current UID with no group/other permission bits. The file must
   be a current-UID regular file with exact mode `0600`, one link, and no
   symlinked path component. On macOS, use the physical `/private/var/...` path
   rather than its `/var/...` alias.
6. With a read-only-capable connection to the drained database and the explicit
   Auth0 values above, run the compiled command from `apps/backend`:

   ```sh
   node dist/modules/auth/hosted-identity-audit.cli.js /absolute/physical/path/intent.json
   ```

The command supports the genuine pre-Step03 schema as well as a migrated
schema. It performs one consistent read-only snapshot, requires exact complete
cohort coverage, and fails on changed rows, ambiguous links, existing proposed
subjects, malformed consumed markers, or exact/sentinel subject conflicts.
Success writes one compact JSON object containing only the canonical digest
manifest, aggregate counts, and its digest. Errors are generic. Raw user IDs,
emails, subjects, the intent, and its path must not enter logs or retained
artifacts.

Have a second operator compare the counts and digest to the reviewed intent.
Parse the command's outer JSON object with a trusted JSON parser and take the
decoded string value of its `identityLinkClaims` property byte-for-byte for
`AUTH0_IDENTITY_LINK_CLAIMS`. The quotes inside that string are escaped only by
the outer JSON serialization; do not copy the visually escaped substring from
stdout. Freeze the identical decoded value for every new replica, and securely
remove the raw intent according to the operator's data handling policy.

## Backup, migrate, and admit

1. With writers still stopped, take a full database backup and verify a restore
   into an isolated target. Confirm the exact old schema and migration ledger,
   every user and external-identity row (including IDs, providers, subjects,
   metadata, and timestamps), related constraints and indexes, and unrelated
   application data. Confirm that `external_identities.issuer` is absent.
   Record backup integrity and restore evidence outside application logs.
2. Apply the checked-in Prisma migrations with the new artifact. The issuer
   migration maps existing identities to the reserved sentinel, makes `issuer`
   non-null with no default, and replaces provider/subject uniqueness with
   provider/issuer/subject uniqueness. An old writer's issuer-less insert must
   now fail.
3. Start only the new binary with the frozen configuration. Its bootstrap
   preflight must complete before any listener accepts traffic. It verifies the
   entire pending/consumed manifest, marker integrity, DB-wide email ambiguity,
   and exact/sentinel subject conflicts.
4. Admit traffic only after every replica passes the same preflight. Keep the
   backup until the rollout's separately approved retention point.

Never overlap old and new writers, and never start an old binary against the
migrated schema.

## Failure and rollback

If no post-migration write must be retained—or the operator explicitly accepts
discarding all such writes—stop all writers and restore the exact verified full
backup. Verify the exact old schema and migration ledger, absence of the
`issuer` column, and equality of user, identity, constraint, index, and
unrelated-data evidence. Re-run the drained audit and require the same counts
and digest before starting the old binary.

There is no in-place old-binary rollback. If any post-migration write must be
kept, roll forward with the new binary or a separately reviewed repair. A later
re-forward repeats the complete drain, audit, config approval, fresh verified
backup, migration, and admission sequence; do not reuse stale audit output.

A suspected wrong tuple is authentication authority, not ordinary profile
data. Stop writers and use the verified-backup rule or a separately reviewed
exact repair. Removing the claims configuration does not unlink a consumed
identity, and application reset modes preserve both identity rows and their
link markers.
