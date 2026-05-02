# Memory Demo Scaling Update

## Summary
Update `examples/memory-demo` so a colleague or coding agent can add scenarios without reverse-engineering the fixture. This pass should stay small: conventions, docs, templates, lightweight schema/help, and a simple offline verifier. Do not add MCP seed automation, browser automation, scaffolding, catalogs, or generated forms yet.

## Key Changes
- Simplify `scenarios/<scenarioId>/start/scenario.json` to convention-based fields:
  ```json
  {
    "description": "Fill a conference registration form for Alex Rivera.",
    "formId": "conference-registration",
    "userId": "alex-rivera",
    "userVariant": "simple"
  }
  ```
  The scenario directory name is the canonical scenario ID. The prompt is always `start/prompt.md`. Form, profile, seed preferences, and local memory paths are resolved from `formId`, `userId`, and `userVariant`.

- Rewrite `examples/memory-demo/README.md` as the human-facing guide:
  - explain what the demo proves: MCP memory first, local fallback only for missing values, durable backfill, no invented values
  - explain how `forms/`, `users/`, and `scenarios/` scale independently
  - include step-by-step “how to add a form/user/variant/scenario”
  - document valid preference slug provenance: prefer existing backend catalog slugs from `apps/backend/src/config/preferences.catalog.ts`; do not invent new slugs unless the demo explicitly needs future user-defined schema behavior
  - document expected output relationship: `final-preferences = seed-preferences + written-preferences`, with written values replacing seed values for duplicate slugs
  - add a concrete “how to manually run a scenario” section that describes current manual steps and clearly labels any MCP seeding/browser steps that are not automated yet
  - include a copyable `Example Coding-Agent Prompt` telling an agent to read the README, create only synthetic fixtures, avoid backend/web edits, run `pnpm demo:memory:verify` during development, and fix verifier errors

- Add local agent guidance:
  - add `examples/memory-demo/AGENTS.md` with concise rules for coding agents working in this folder
  - add `examples/memory-demo/CLAUDE.md` only as a short pointer to `AGENTS.md` if needed for Claude compatibility; avoid duplicating the full instructions

- Add minimal templates under `examples/memory-demo/templates/`:
  - form template with `form.html` and `fields.json`
  - user template with `profile.json`, one variant, `seed-preferences.json`, `local-memory.md`, and a short variant `README.md`
  - scenario template with `start/scenario.json`, `start/prompt.md`, and placeholder expected JSON files
  - templates must use obvious placeholders like `REPLACE_WITH_FORM_ID`, and `fields.json` should show examples of `profile`, `mcp-memory`, and `freeform`

- Add lightweight JSON Schema support:
  - `schemas/scenario.schema.json`
  - `schemas/fields.schema.json`
  Add `$schema` references where useful. Keep schemas structural only; cross-file consistency belongs to the verifier.

- Add a dependency-free verifier at `examples/memory-demo/scripts/verify.mjs`, wired from root `package.json`:
  ```json
  "demo:memory:verify": "node examples/memory-demo/scripts/verify.mjs"
  ```

## Verifier Behavior
- Discover real scenarios from `scenarios/*/start/scenario.json`; ignore `templates/`.
- Validate required scenario fields: `description`, `formId`, `userId`, `userVariant`.
- Resolve and check conventional paths for form HTML, fields manifest, profile, seed preferences, local memory, prompt, and expected outputs.
- Check every `fields.json` field ID exists as an HTML element ID in `form.html`.
- Check `filled-form.json` has exactly the form field IDs.
- Check profile-backed fields reference real top-level profile keys.
- Check MCP-backed fields declare at least one memory slug.
- Check preference expected files are arrays of `{ "slug": string, "value": any }`.
- Do not enforce backend slug catalog membership, deep HTML semantics, or complex preference merge correctness in this pass.

## Planning Docs
- Update `docs/plans/demo/updating-demo-folders/implementation-plan.md` with this revised plan.
- At implementation closure, add `docs/plans/demo/updating-demo-folders/implementation-summary.md` covering changed behavior, files touched, verification run, and known follow-ups.
- Update `docs/plans/demo/TODO.md` to carry forward deferred work:
  - seed runner for `seed-preferences.json`
  - browser automation for static forms
  - second-run scenario where MCP already has all values
  - permission-denied scenario
  - optional scenario scaffolding script
  - optional `CATALOG.md` or generated inventory after more scenarios exist
  - optional form generation from `fields.json`
  - optional expected-output helper or verifier `--fix`
  - optional stricter verifier checks, including slug catalog membership and final-preference merge validation

## Test Plan
- Run `pnpm demo:memory:verify`.
- Confirm the migrated `conference-registration` scenario passes.
- Confirm templates are ignored by scenario discovery.
- Confirm JSON files with `$schema` still parse normally.
- Confirm verifier error messages are actionable by testing one broken reference, one missing HTML field ID, and one invalid expected output shape.
- No backend, frontend, database, Auth0, MCP, or Vertex tests are required for this fixture/docs pass.

## Assumptions
- Conventions are preferred over path configuration for v1.
- The first pass should optimize for colleague and coding-agent authoring, not full demo automation.
- README remains the human guide; local agent files are short instruction entrypoints.
- Valid demo slugs should come from the backend preference catalog by default, but enforcement is deferred.
- All demo data remains synthetic and non-sensitive.
