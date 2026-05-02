# Memory Demo Scaling Update Implementation Summary

- Status: implemented
- Date: 2026-05-02

## What Changed

- Migrated the memory-demo scenario manifest to convention-based IDs.
- Expanded `examples/memory-demo/README.md` into a contributor guide with:
  - demo behavior rules
  - fixture authoring steps
  - preference slug provenance
  - expected output rules
  - manual scenario run steps
  - a copyable coding-agent prompt
- Added local agent instructions through `examples/memory-demo/AGENTS.md` and a short Claude pointer.
- Added reusable templates for forms, users, variants, and scenarios.
- Added lightweight JSON schemas for scenario and field manifests.
- Added `pnpm demo:memory:verify` backed by a dependency-free verifier script.
- Updated demo planning TODOs with deferred follow-up work.

## Verification

- `pnpm demo:memory:verify`
- Parsed all JSON files under `examples/memory-demo`.
- Checked verifier failure output against temp-copy fixtures for one broken form reference, one missing HTML field ID, and one invalid expected-output shape.

## Known Follow-Ups

- Add a seed runner for `seed-preferences.json`.
- Add browser automation for static forms.
- Add a second-run scenario where MCP already has all values.
- Add a permission-denied scenario.
- Consider scaffolding, inventory generation, form generation, expected-output helpers, and stricter verifier checks once more scenarios exist.
