# Legacy Doc Triage

- Status: current
- Read when: auditing the 2026-04 docs cleanup or wondering where a removed legacy doc went
- Source of truth: this cleanup pass plus the current canonical docs tree
- Last reviewed: 2026-04-18

This is a one-time ledger for the legacy `docs/` cleanup. Future work should use the new canonical locations instead of reviving the deleted files below.

| Legacy path | Disposition | Replacement |
| --- | --- | --- |
| `docs/AUTHORIZATION_TODO.md` | deleted | distilled into `docs/current/MCP_AUTHORIZATION.md` |
| `docs/FILE_UPLOAD_PLAN.md` | deleted | relevant current state captured in `docs/IMPORTANT/CURRENT_STATE.md` |
| `docs/LOCKING_TODO.md` | deleted | distilled into `docs/plans/active/LOCKING_STRATEGY.md` |
| `docs/MCP_INTEGRATION.md` | deleted | split into `docs/current/MCP_AUTHORIZATION.md` and `docs/useful/MCP_LOCAL_SETUP.md` |
| `docs/MCP_WITH_AUTH_PLAN.md` | deleted | lasting behavior captured in `docs/current/MCP_AUTHORIZATION.md` |
| `docs/PREFERENCES_MVP_STRICT_IMPLEMENTATION.md` | deleted | lasting schema behavior captured in `docs/current/PREFERENCE_SCHEMA.md` |
| `docs/PRISMA_COMMANDS.md` | moved and rewritten | `docs/useful/PRISMA_COMMANDS.md` |
| `docs/UPDATE_SCHEMA_MANAGEMENT.md` | deleted | lasting schema behavior captured in `docs/current/PREFERENCE_SCHEMA.md` |
| `docs/auth-rules/v1/auth-plan-v1.md` | deleted | superseded by current MCP authorization docs and code |
| `docs/auth-rules/v1/first-pass-agent-based-perms.md` | deleted | superseded by current MCP authorization docs and code |
| `docs/auth-rules/v1/gates-workshop-2026-handoff.md` | deleted | historical handoff, no longer canonical |
| `docs/auth-rules/v1/mcp-client-policy-merge-guide.md` | deleted | historical merge guide, no longer canonical |
| `docs/auth-rules/v2/implementation-plan.md` | deleted | lasting behavior captured in `docs/current/MCP_AUTHORIZATION.md` |
| `docs/auth-rules/v2/permission-grants-summary.md` | deleted | rewritten as `docs/current/MCP_AUTHORIZATION.md` |
| `docs/mcp-connections.md` | moved and rewritten | `docs/useful/MCP_LOCAL_SETUP.md` |
| `docs/mcp_modify_schema.md` | deleted | lasting schema behavior captured in `docs/current/PREFERENCE_SCHEMA.md` |
| `docs/personal-slug-planning.md` | deleted | lasting schema behavior captured in `docs/current/PREFERENCE_SCHEMA.md` |
| `docs/workflows/adding-workflow-modules-v1-summary.md` | deleted | rewritten as `docs/current/WORKFLOWS.md` |
| `docs/workflows/adding-workflow-modules.md` | deleted | rewritten as `docs/current/WORKFLOWS.md` |
| `docs/workflows/adding-workflow-step-by-step.md` | deleted | condensed into the "Adding a New Workflow" section of `docs/current/WORKFLOWS.md` |
| `docs/workflows/adding-workflows.md` | deleted | rewritten as `docs/current/WORKFLOWS.md` |
