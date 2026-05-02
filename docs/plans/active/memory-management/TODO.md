# Memory Management TODO

- Status: follow-up
- Last reviewed: 2026-05-02

## Profile Memory Follow-Ups

- No known blocking follow-ups remain for the profile slug unification shipped in this pass.
- Revisit whether additional profile fields should become core definitions, such as `profile.pronouns`, `profile.timezone`, or `profile.locale`.
- Decide whether profile-specific UI should support bulk import/export once `profile.*` is fully established as normal memory.
- Consider whether account email and `profile.email` need explicit UI copy or help text after user testing.

## Demo Follow-Ups

- Keep demo scenarios aligned with MCP memory rather than local profile fixtures.
- Add richer demo coverage for profile fields beyond forms, such as assistants addressing users by `profile.full_name`.
- If older archived demo planning docs are used again, update their examples to avoid reintroducing `profile.json`.

## Authorization And Audit

- Revisit default permission grants for `profile.*` before production use.
- Consider whether more profile slugs should be marked sensitive after real audit-history usage.

## Tooling

- Add a small fixture helper for constructing `profile.*` seed preferences if memory-demo user fixtures grow.
