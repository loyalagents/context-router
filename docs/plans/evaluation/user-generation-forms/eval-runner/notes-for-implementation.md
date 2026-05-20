# Eval Runner Notes For Implementation

- Status: pre-plan notes
- Date: 2026-05-20
- Scope: Batch 4, `eval-runner/`

## Goal

Build a simple, realistic, and extensible local eval runner for scenarios in
`examples/eval/`.

The runner should test real form-fill behavior without turning the first version
into a broad UI automation or production deployment harness. The desired shape
is pragmatic: enough backend realism to catch product regressions, enough
determinism to make snapshots trustworthy, and enough structure to add more
snapshot types later.

## Settled Decisions

### Runner Boundary

Use a standalone local CLI:

```bash
pnpm eval:run --scenario <scenarioId>
pnpm eval:run --scenario <scenarioId> --update-snapshots
```

The CLI should use an extracted backend test-app harness and call the backend
form-fill path. It should not use the dashboard UI, a real deployed backend, or
real Auth0/JWT tokens.

Preferred execution path:

```text
scenario fixture
-> validate scenario
-> boot backend test app/harness
-> create isolated test user
-> hydrate eval facts as backend-visible active preferences
-> install deterministic AI/form-fill adapter behavior
-> POST /api/form-fill/pdf with examples/eval/forms/<formId>/form.pdf
-> normalize response into snapshots
-> compare or update expected snapshots
-> close app and clean up state
```

Rationale:

- Fixture-only execution would only test fixture coherence, not product
  behavior.
- UI execution is too brittle and slow for the first runner.
- The backend already has e2e test infrastructure for the form-fill REST
  endpoint, including auth guard overrides and mocked AI services.
- Calling the backend through the test-app path exercises real PDF extraction,
  active-memory lookup, prompt construction, action validation, and PDF filling
  without real auth or browser complexity.

### Auth

Use the existing backend test guard override pattern. Do not use real JWTs,
Auth0, or local dev auth tokens.

The current backend test helper overrides `JwtAuthGuard`, `GqlAuthGuard`,
`OptionalGqlAuthGuard`, and `McpAuthGuard`, then injects the current test user
with `setTestUser(testUser)`. The eval runner should reuse or extract this
pattern rather than inventing a separate auth path.

### State Isolation

Use isolated backend test state for every run.

Preferred approach:

- reset/seed the test database the same way backend e2e tests do
- create a fresh backend test user for the scenario run
- close the test app after the run

Do not use shared local dev state. Eval results should be repeatable and should
not depend on data left over from prior manual testing.

### First Scenario

Start with:

```text
examples/eval/scenarios/elena-marquez-i9-template-smoke/
```

This scenario is small, deterministic, scaffold-owned, and easier to debug than
the 100-document realistic corpus.

After the runner works, add:

```text
examples/eval/scenarios/elena-marquez-i9-section1/
```

as a second checkpoint or follow-up.

### Snapshot V1

Use `filled-form.json` as the first snapshot type.

This should be a normalized JSON artifact derived from the form-fill response
summary, not raw PDF bytes. It should focus on stable, reviewable form-fill
behavior such as filled fields, skipped fields, warnings, source slugs, and
confidence where relevant.

Do not make raw filled PDF bytes the first snapshot. PDF output is useful later,
but it is harder to diff deterministically.

### Future Snapshot Types

Keep the runner structured around typed artifacts so more snapshots can be added
without redesigning the CLI.

Future candidates:

- `written-preferences.json`
- `final-preferences.json`
- diagnostics or trace output
- parsed filled-PDF verification

Do not require `written-preferences.json` in V1. Form fill should normally read
memory rather than write memory. Add written/final preference snapshots when the
runner starts testing ingestion, extraction, or preference-write behavior.

### Snapshot Update Workflow

Use explicit snapshot updates only:

```bash
pnpm eval:run --scenario <scenarioId> --update-snapshots
```

Normal `eval:run` should fail when expected snapshots are missing or stale. It
should never auto-update snapshots by default.

### Memory Hydration

Use eval-only active preferences from profile facts.

Preferred implementation:

- load `profile.yaml`, scenario, form field map, and generated seed preferences
- create backend-visible active preferences for scenario-relevant facts
- prefer user-owned preference definitions if the backend preference system
  supports them cleanly in the test harness
- keep this hydration deterministic and local to the eval runner

This is intentionally not real document-analysis ingestion in V1. The goal is
to make form fill read realistic backend memory state while keeping the eval run
deterministic and avoiding real LLM extraction.

Avoid expanding the product preference catalog as part of Batch 4 unless it
turns out to be the smallest clean path. The existing global catalog does not
currently include all I-9 facts such as address, DOB, SSN, and citizenship
status.

### AI Behavior

Do not call a real LLM.

Use deterministic test adapter behavior at the AI boundary. The runner should
produce repeatable form-fill actions from hydrated scenario facts and field-map
expectations, then let the real backend validator and PDF filler accept or
reject those actions.

This keeps the run deterministic while still exercising the backend form-fill
pipeline after the AI boundary.

## Outstanding Questions And Chosen Answers

- Should the runner call backend code at all?
  - Yes. The runner should evaluate product form-fill behavior, not just fixture
    consistency.

- Should it call backend services directly, GraphQL, REST, or UI?
  - Use the backend test-app/API path. Seed/hydrate state through backend/test
    helpers and call the real form-fill REST endpoint. Avoid UI in V1.

- Will auth be painful?
  - It should not be. Reuse the backend test guard override pattern instead of
    real tokens.

- What should the first snapshot be?
  - `filled-form.json`.

- Would `written-preferences.json` ever be useful?
  - Yes, but only once the runner tests ingestion or preference-writing
    behavior. It is not required for V1 form-fill.

- Should the first scenario be small or realistic?
  - Start with `template-smoke`; add the realistic Elena scenario once the
    runner path is stable.

- Should the runner use only seed preferences or seed plus corpus?
  - Use deterministic eval hydration from profile facts into backend-visible
    active preferences. Do not run real document-analysis ingestion in V1.

- Should the runner support snapshot updates?
  - Yes, with explicit `--update-snapshots`; never auto-update by default.

## Planning Notes

The implementation plan should still verify the actual backend seams before
committing to details. In particular, checkpoint 1 should inspect how to extract
or reuse the backend test-app helper from a standalone Node CLI, because the
current helper is Jest-oriented.

If direct reuse of Jest-specific helpers is too awkward, prefer extracting a
small shared backend test harness over creating a parallel auth/test-app setup.

The plan should keep the first implementation narrow:

- one CLI
- one scenario
- one snapshot type
- deterministic AI behavior
- isolated backend state
- no UI
- no real LLM
- no scenario runner matrix yet
