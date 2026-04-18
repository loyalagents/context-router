# Locking Strategy

- Status: active-plan
- Read when: working on concurrency, retry behavior, Cloud Run contention, or race-condition follow-up
- Source of truth: `apps/backend/src/modules/auth/auth.service.ts`, `apps/backend/src/modules/preferences/location/**`, `apps/backend/src/modules/preferences/preference/**`
- Last reviewed: 2026-04-18

## Current Protection

The backend already has race-condition mitigation in a few key places:

- auth user creation uses transactions plus retry handling for unique-constraint conflicts
- external identity linking is handled idempotently
- M2M user creation uses retry-based conflict handling
- location writes have an upsert path

## Remaining Follow-Up

- add operational monitoring for retry rates and `P2002` spikes
- load test concurrent auth and preference flows before depending on this under heavier production load
- review database connection-pool sizing for the Cloud Run deployment shape
- revisit advisory locks, Redis locks, or idempotency keys only if contention data shows the current approach is insufficient

## Success Criteria

- conflicts are handled without user-visible failures in the common auth paths
- retry exhaustion is observable and alertable
- concurrency regressions are covered by targeted tests or load-testing playbooks
