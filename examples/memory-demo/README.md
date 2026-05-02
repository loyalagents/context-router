# Memory Demo Fixtures

Static fixtures for demoing and testing MCP memory retrieval, local fallback memory, durable preference backfill, and form filling.

The intended agent behavior is:

1. Read user profile data from the fixture.
2. Retrieve relevant durable preferences from MCP before reading local fallback memory.
3. Read local fallback memory only for values that MCP does not already contain.
4. Backfill durable missing preferences through MCP before using them in the form.
5. Fill the form without inventing unsupported values.
6. Leave optional fields blank when there is no supported value.

## Directory Model

The demo scales by keeping reusable parts separate:

- `forms/<formId>/` contains one browser form and its field manifest.
- `users/<userId>/` contains one synthetic profile and one or more memory variants.
- `scenarios/<scenarioId>/` composes one form, one user, one variant, a prompt, and expected outputs.

Scenario manifests use stable IDs, not relative paths:

```json
{
  "description": "Fill a conference registration form for Alex Rivera.",
  "formId": "conference-registration",
  "userId": "alex-rivera",
  "userVariant": "simple"
}
```

The scenario directory name is the scenario ID. The prompt is always `scenarios/<scenarioId>/start/prompt.md`. The verifier resolves all other paths from `formId`, `userId`, and `userVariant`.

## Add A Form

1. Create `forms/<formId>/form.html`.
2. Create `forms/<formId>/fields.json`.
3. Add one field entry for every form control the agent should fill.
4. Make sure every `fields.json` field `id` exists as an HTML element `id` in `form.html`.

Field sources:

- `profile`: value comes from `users/<userId>/profile.json`; include `profilePath`.
- `mcp-memory`: value comes from MCP or local fallback memory; include `memorySlugs`.
- `freeform`: optional value supplied by the scenario or left blank.

## Add A User Or Variant

1. Create or reuse `users/<userId>/profile.json`.
2. Create `users/<userId>/<variant>/seed-preferences.json`.
3. Create `users/<userId>/<variant>/local-memory.md`.
4. Add a short `README.md` to explain what the variant represents.

Keep all user data synthetic and non-sensitive.

## Add A Scenario

1. Create `scenarios/<scenarioId>/start/scenario.json`.
2. Create `scenarios/<scenarioId>/start/prompt.md`.
3. Create expected outputs under `scenarios/<scenarioId>/expected/`:
   - `filled-form.json`
   - `written-preferences.json`
   - `final-preferences.json`
4. Run:

```bash
pnpm demo:memory:verify
```

Use `templates/` as the starting point for new fixtures.

## Preference Slugs

Prefer existing backend preference slugs from `apps/backend/src/config/preferences.catalog.ts`. Do not invent new slugs unless the scenario is explicitly about future user-defined schema behavior.

The verifier does not enforce catalog membership yet. It checks fixture shape and cross-file references only.

## Expected Outputs

`filled-form.json` should contain exactly one key for each field in the form manifest.

`written-preferences.json` should contain durable preferences the agent had to backfill from local memory through MCP.

`final-preferences.json` is the expected durable memory after the scenario:

```text
final-preferences = seed-preferences + written-preferences
```

If the same slug appears in both files, the value from `written-preferences.json` should win.

## Manual Scenario Run

Full demo automation is intentionally not part of this fixture pass. Today, a manual run is:

1. Start the backend and any MCP-enabled client you want to test.
2. Seed MCP for the test user from `users/<userId>/<variant>/seed-preferences.json`. This is currently manual; there is no repo-owned seed runner yet.
3. Open `forms/<formId>/form.html` in a browser.
4. Give the MCP-enabled agent `scenarios/<scenarioId>/start/prompt.md`.
5. Let the agent read the scenario manifest, profile, field manifest, and local memory only as instructed.
6. Compare the filled form to `expected/filled-form.json`.
7. Compare MCP writes to `expected/written-preferences.json`.
8. Compare final durable preferences to `expected/final-preferences.json`.

## Example Coding-Agent Prompt

```md
Read `examples/memory-demo/README.md` and `examples/memory-demo/AGENTS.md`.

Add a new memory-demo scenario for: <describe the scenario>.

Reuse existing forms and users where reasonable. If new fixtures are needed, create only synthetic, non-sensitive data using the documented folder conventions and templates. Prefer existing preference slugs from `apps/backend/src/config/preferences.catalog.ts`.

Do not edit backend or web app code. Do not add MCP seeding, browser automation, scaffolding, catalogs, or generated forms.

Run `pnpm demo:memory:verify` during development and fix all verifier errors. Return the changed files and any manual demo steps.
```
