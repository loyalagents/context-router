# Docs Guide

- Status: reference
- Read when: adding or changing docs
- Current entry points: [application](current/LOCAL_APPLICATION.md), [work portfolio](plans/README.md)

This file is for doc writers. For agent startup, follow `AGENTS.md`.

## Folder Layout

| Path | Purpose |
| --- | --- |
| `docs/IMPORTANT/` | Tiny startup pack. Every agent should read these files every time. Keep them short and stable. |
| `docs/useful/` | Sanitized runbooks and operational references that are useful on demand but not worth loading at every startup. |
| `docs/current/` | Canonical docs for implemented systems where prose still adds value beyond reading the code directly. |
| `docs/plans/README.md` | Canonical priorities and task routing; priority is separate from parallel-work eligibility. |
| `docs/plans/active/` | Currently coordinated outcome briefs and reviewed implementation plans. A brief is not blanket execution approval. |
| `docs/plans/backlog/` | Wanted but unactivated stabilization/features; one canonical brief per outcome. |
| `docs/evidence/` | Frozen test inputs and historical machine receipts that still have consumers; not an archive of all planning prose. |

## Writing Rules

- Keep `docs/IMPORTANT/` to a few short files. If a document feels long, it does not belong there.
- Prefer one canonical doc per topic. Replace or merge overlapping docs instead of letting duplicates accumulate.
- Do not keep large repo trees or code-derived inventories in prose when a script or the code itself is a better source of truth.
- Sanitize brittle or sensitive values. Do not commit passwords, raw client IDs, fixed IPs, or environment-specific secrets into repo docs.
- Delete superseded docs instead of building a large archive inside the repo. Git history is the archive.
- Keep active and backlog status explicit. Once shipped, distill lasting behavior into
  `docs/current/` or runbooks and delete superseded prose. Preserve referenced frozen
  machine evidence byte-for-byte and update its readers if its location changes.
- Do not equate a merged PR, test pass or closed program with all manual/platform/
  distribution acceptance. Keep failures, untested cases and scoped exceptions visible.
- Historical protected registry ownership is not current task activation. Use the
  [closeout mapping](current/LOCAL_MIGRATION_CLOSEOUT.md#remaining-decision-ownership).

## Useful Runbooks

- [Contributor and hosted development](useful/HOSTED_DEVELOPMENT.md) — toolchain,
  retained hosted environment, commands and testing; not installed-app prerequisites.
- [Interface evolution](useful/INTERFACE_EVOLUTION.md) — additive transitions,
  consumer inventory, compatibility windows and explicit removal gates.

- [Installed Mac pilot](useful/INSTALLED_MAC_APP.md) — menu, model, installed CLI,
  private storage, backup/restore, replacement and removal of the local candidate.

- [Storage boundaries](current/STORAGE_BOUNDARIES.md) — application-owned persistence,
  transaction lifetimes, SQLite local and PostgreSQL reference adapters, and local identity coordination.

- [Agent workflow and model selection](useful/AGENT_WORKFLOW.md) — risk-based
  agent roles, effort settings, parallelism, review, and speed/assurance tradeoffs.
- [Local identity administration](useful/LOCAL_IDENTITY_ADMIN.md) — initialize,
  rotate, perform terminate-and-reap recovery, understand matching-pair backup, and run the non-listening SQLite preview or explicit PostgreSQL reference.

- [Manual local model preview](useful/LOCAL_MODEL.md) — pinned manual runtime, private sessions, explicit SQLite integration, capabilities, limits and recovery.

- [Local dashboard](useful/LOCAL_UI.md) — manual production launch, browser unlock/session, shared MCP administration, history clear and selected local AI.
