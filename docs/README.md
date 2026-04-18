# Docs Guide

- Status: reference
- Read when: adding or changing docs
- Last reviewed: 2026-04-18

This file is for doc writers. For agent startup, follow `AGENTS.md`.

## Folder Layout

| Path | Purpose |
| --- | --- |
| `docs/IMPORTANT/` | Tiny startup pack. Every agent should read these files every time. Keep them short and stable. |
| `docs/useful/` | Sanitized runbooks and operational references that are useful on demand but not worth loading at every startup. |
| `docs/current/` | Canonical docs for implemented systems where prose still adds value beyond reading the code directly. |
| `docs/plans/active/` | Current design work, follow-up items, or unfinished implementation plans. |

## Writing Rules

- Keep `docs/IMPORTANT/` to a few short files. If a document feels long, it does not belong there.
- Prefer one canonical doc per topic. Replace or merge overlapping docs instead of letting duplicates accumulate.
- Do not keep large repo trees or code-derived inventories in prose when a script or the code itself is a better source of truth.
- Sanitize brittle or sensitive values. Do not commit passwords, raw client IDs, fixed IPs, or environment-specific secrets into repo docs.
- Delete superseded docs instead of building a large archive inside the repo. Git history is the archive.
- Put new design work in `docs/plans/active/` only while it is still relevant. Once shipped, either delete it or distill the lasting parts into `docs/current/`.
