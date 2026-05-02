# Engineering Stack Overview

Signal Harbor's platform engineering group maintains the internal operations
dashboard, event ingestion services, and reliability tooling used by product
teams.

## Primary Stack

The team spends most of its application time in TypeScript. The main dashboard
is React, shared service code runs on Node.js, and product-facing workflow data
is stored in PostgreSQL. Some legacy jobs still use Python, but Maya does not
consider that the primary stack for new assistant examples.

## Services

- `ops-dashboard`: React application for release and incident visibility.
- `event-router`: Node.js service for internal event routing.
- `review-indexer`: background job that summarizes pull request activity.
- `workflow-store`: PostgreSQL-backed service for workflow state.

## Tooling Notes

CI runs unit tests, lint checks, and a staging deploy smoke test. Terraform is
owned by the infrastructure team. Observability is split across logs, traces,
and a metrics dashboard.

## Open Architecture Questions

- Whether review summaries should be generated at merge time or on demand.
- Whether internal workflow data should be archived after 18 or 24 months.
- Whether the assistant should pull context from release docs automatically.
