# Update Docker To Node 22

- Status: cleanup
- Last reviewed: 2026-05-10

The backend Dockerfile currently pins `pnpm@10.24.0` because `pnpm@latest`
requires Node 22+ and the image still uses `node:20-alpine`.

Long term, update both Docker stages to a Node 22 base image, verify backend
build/tests in that runtime, then switch the Dockerfile back from
`pnpm@10.24.0` to `pnpm@latest` or a repo-level `packageManager` pin that
tracks the supported Node runtime.
