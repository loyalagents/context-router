# Realistic Maya Chen Source Data

This optional folder contains a noisy synthetic source corpus derived from
`../simple/`. It is intended for future realistic parsing demos where an agent
has to recover profile and memory facts from ordinary workplace files.

Scenarios do not point at `realistic/` yet. Keep `../simple/` as the verified
machine-checkable baseline until realistic scenario mode exists.

## Corpus

- `profile-export.json`: account/profile export with product settings and stale fields.
- `assistant-onboarding-notes.md`: assistant rollout notes with response style preferences mixed into process notes.
- `team-communication-policy.md`: communication norms, meeting rules, and channel preferences.
- `engineering-stack-overview.md`: project architecture, ownership, and stack notes.
- `code-review-guidelines.md`: review workflow and coding-help preferences.
- `assistant-feedback-thread.txt`: chat-style feedback about assistant behavior.
- `project-kickoff-email.eml`: synthetic kickoff email with project context.
- `personal-tooling-export.yaml`: noisy local tooling and assistant preference export.
- `calendar-event.ics`: synthetic calendar event with role and company context.
- `workshop-intake.csv`: multi-person intake export with Maya's row among unrelated rows.

All data is synthetic and non-sensitive.
