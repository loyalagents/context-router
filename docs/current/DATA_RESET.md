# Data Reset

- Status: current
- Read when: changing reset modes, demo cleanup, memory lifecycle, audit
  retention, permission grants, or reset UI
- Source of truth: `apps/backend/src/modules/reset/**`,
  `apps/backend/test/e2e/reset.e2e-spec.ts`, and
  `apps/web/app/dashboard/preferences/components/MemoryResetPanel.tsx`
- Last reviewed: 2026-09-22

## Reset modes and safety semantics

The authenticated GraphQL mutation
`resetMyMemory(mode: ResetMemoryMode!)` operates only on the current user's
data. It returns the selected mode and per-table deletion counts.

| Mode | Deleted | Preserved | Audit result |
| --- | --- | --- | --- |
| `MEMORY_ONLY` | Every preference row, including active, suggested, rejected, location-scoped, and `profile.*` memory | Definitions, locations, existing mutation history, MCP access history, permission grants, `User`, and `ExternalIdentity` | Adds one aggregate `PREFERENCES_RESET` event with `subjectSlug: "*"` and the deleted preference count |
| `DEMO_DATA` | Everything in `MEMORY_ONLY`, plus the user's audit events, MCP access events, owned definitions, and locations | Permission grants, `User`, and `ExternalIdentity` | No reset event survives because mutation history is deleted |
| `FULL_USER_DATA` | Everything in `DEMO_DATA`, plus the user's permission grants | `User` and `ExternalIdentity` | No reset event survives |

Despite its name, `FULL_USER_DATA` deliberately preserves account and external
identity rows so the current login remains usable. Any provider bindings owned
by that principal are retained with the account.

Every mode runs in one Prisma transaction and deletes preferences before owned
definitions. Before an advanced reset deletes definitions, it checks for a
reference from another user's preference. A cross-user reference raises a
conflict and rolls back the entire reset, including preference deletion.

The advanced modes intentionally trade auditability for a clean demo state.
Callers must not describe them as leaving a durable record of the destructive
action.

## Feature gate and UI

`MEMORY_ONLY` is always available to an authenticated user. `DEMO_DATA` and
`FULL_USER_DATA` require `ENABLE_DEMO_RESET=true` in the backend process; the
backend is the enforcement point.

The web process uses its own copy of the flag only to decide whether to render
the advanced buttons. The dashboard presents confirmation copy, displays the
returned counts after success, and reloads the current page. Hiding a button is
not authorization and cannot enable a mode that the backend has disabled.

## Known limitations

- Advanced modes remove the user's audit and access history without a surviving
  reset event.
- A shared reference to a user-owned definition prevents an advanced reset;
  there is no automatic detach or reassignment.
- The feature is named for demo cleanup and is not a general account-deletion
  or regulatory-erasure workflow.
- `User` and `ExternalIdentity` are retained in all modes.
