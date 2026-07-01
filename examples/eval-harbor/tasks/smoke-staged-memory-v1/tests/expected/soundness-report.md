# Smoke Staged Memory Soundness

This task is intentionally tiny. It validates that Harbor can run a live Codex
agent through a staged `U -> U -> U -> T` workflow, that source facts are only
visible during update stages, and that the downstream task is answered from
retained session context.

- Stage 1 exposes only legal-name evidence.
- Stage 2 exposes only current-city evidence.
- Stage 3 exposes only payroll account-last-four evidence.
- Stage 4 exposes only the downstream question and output contract.

The expected answer set is fully covered by visible evidence from stages 1-3.
