Before starting always look at the README.md and run ./print-repo-structure.sh to understand what is going on.

Currently the repo is a monolith with a FE app and a BE app.

When adding/changing backend behavior: write or update tests first; don't change tests unless requirements changed; run targeted tests after each change; keep edits small and incremental; stop when tests are green and summarize what changed.

When making plans for the backend: please make plans with checkpoints in mind. Checkpoints are ares where we can run tests and update our progression in our plan.
