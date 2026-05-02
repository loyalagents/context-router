# Demo TODO

- Add a reset-and-seed demo scenario once the desired demo dataset is stable.
- Add a memory-demo seed runner for `seed-preferences.json`.
- Add browser automation for static memory-demo forms.
- Add a second-run memory-demo scenario where MCP already has all values and local fallback is not needed.
- Add a memory-demo permission-denied scenario to prove hidden MCP preferences are not used.
- Define a future realistic memory-demo scenario mode for arbitrary synthetic client-like source data.
- Consider a memory-demo scenario scaffolding script once multiple examples exist.
- Consider a `CATALOG.md` or generated inventory after more forms, users, and scenarios exist.
- Consider generating form HTML from `fields.json` if form/field drift becomes common.
- Consider an expected-output helper or verifier `--fix` mode for `final-preferences.json`.
- Consider stricter memory-demo verifier checks, including preference slug catalog membership and final-preference merge validation.
- Consider a stronger confirmation UX for advanced reset modes if this becomes visible outside local/demo environments.
- Run a manual smoke test against a real Auth0-backed demo account with `ENABLE_DEMO_RESET=true` in both backend and web.
- Decide whether production-grade advanced resets need a separate retained operator log, since `DEMO_DATA` and `FULL_USER_DATA` remove preference audit history completely.
- Revisit cross-user location reference handling if future import/admin tooling can create location references outside the owning user.
