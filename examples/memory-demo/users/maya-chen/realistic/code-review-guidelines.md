# Code Review Guidelines

Audience: platform engineering reviewers and assistant pilot participants.

## Review Priorities

Reviewers should focus on correctness, maintainability, operational impact, and
test coverage. Style comments are useful when they prevent confusion, but avoid
blocking a change on preference-only feedback.

## Assistant Coding Help

When Maya asks the assistant for coding help, she prefers direct explanations
with runnable examples. If there are multiple reasonable approaches, call out
the tradeoffs explicitly. Keep the ceremony low: do not spend half the answer
restating the prompt, and do not invent policy constraints that are not in the
repo.

## Pull Request Norms

- Keep PRs small enough to review in one sitting when possible.
- Include screenshots for UI changes.
- Include migration notes for schema changes.
- Tag the service owner if runtime behavior changes.

## Non-Preference Notes

- Branch names usually start with the ticket key.
- Review SLA is one business day for normal changes.
- Security-sensitive changes require an additional reviewer.
