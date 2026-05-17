# Demo TODO

- Add a reset-and-seed demo scenario once the desired demo dataset is stable.
- Add stable Search Lab demo presets backed by seeded preference values once the desired demo dataset is stable.
- Consider location-aware exact-search snapshot refresh in Search Lab if location-specific comparison becomes important.
- Track future fixture and scenario work in `docs/plans/evaluation/user-generation-forms/orchestration-plan.md`.
- Consider a stronger confirmation UX for advanced reset modes if this becomes visible outside local/demo environments.
- Run a manual smoke test against a real Auth0-backed demo account with `ENABLE_DEMO_RESET=true` in both backend and web.
- Decide whether production-grade advanced resets need a separate retained operator log, since `DEMO_DATA` and `FULL_USER_DATA` remove preference audit history completely.
- Revisit cross-user location reference handling if future import/admin tooling can create location references outside the owning user.
