# Memory Demo TODO

## Near-Term

- Add a runner script to seed `seed-preferences.json` into MCP.
- Extend verifier coverage for `filled-form.json`, `written-preferences.json`, and `final-preferences.json` if more scenarios expose gaps.
- Add browser automation for the static form.
- Add a second-run scenario where MCP already has all values and local fallback is not needed.

## Realistic Data

- Populate `users/alex-rivera/realistic/` with synthetic local files derived from the simple fixture.
- Keep `simple/` as the runnable baseline with only `local-memory.md` and `seed-preferences.json`.
- Keep realistic files plausible but non-sensitive.
- Consider notes, conference emails, travel preference snippets, and profile exports.
- Define a future scenario mode before pointing scenarios at `realistic/`.

## Future Scenarios

- Add a travel booking or reimbursement form.
- Add a permission-denied scenario to prove hidden MCP preferences are not used.
- Consider job, rental, and medical forms only after sensitivity and redaction rules are clearer.
