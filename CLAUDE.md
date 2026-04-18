Before starting always read `README.md`, run `./print-repo-structure.sh`, read `docs/README.md` to get a sense of the documents available in this repo, and read every file in `docs/IMPORTANT/` to understand what is going on. Then read `docs/current/`, `docs/useful/`, and `docs/plans/active/` as needed for your task.

Currently the repo is a `pnpm` workspace monorepo with a frontend app and a backend app.

When adding/changing backend behavior: write or update tests first; don't change tests unless requirements changed; run targeted tests after each change; keep edits small and incremental; stop when tests are green and summarize what changed.

When making plans for the backend: please make plans with checkpoints in mind. Checkpoints are areas where we can run tests and update our progression in our plan.
