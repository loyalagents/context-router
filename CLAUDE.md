Before starting always look at the README.md and run ./print-repo-structure.sh to understand what is going on.

Currently the repo is a monolith with a FE app and a BE app.

When adding/changing backend behavior: write or update tests first; don’t change tests unless requirements changed; run targeted tests after each change; keep edits small and incremental; stop when tests are green and summarize what changed.