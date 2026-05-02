# Memory Demo Agent Instructions

Read `examples/memory-demo/README.md` before changing fixtures in this directory.

Rules for this directory:

- Keep all fixture data synthetic and non-sensitive.
- Prefer existing preference slugs from `apps/backend/src/config/preferences.catalog.ts`.
- Do not edit backend or web app code for fixture-only changes.
- Do not add MCP seed automation, browser automation, scaffolding, catalogs, or generated forms unless the task explicitly asks for that.
- Use the documented conventions: scenario IDs come from directory names, scenario manifests use `formId`, `userId`, and `userVariant: "simple"`, and prompts live at `scenarios/<scenarioId>/start/prompt.md`.
- Every user must have `profile.json` and `simple/` with only `local-memory.md` and `seed-preferences.json`. Ignore system dotfiles such as `.DS_Store`.
- `realistic/` is optional and can contain arbitrary synthetic source data, but scenarios should not point at it yet.
- Run `pnpm demo:memory:verify` after changing fixtures and fix all verifier errors.
