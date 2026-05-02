# Assistant Pilot Notes

Project: internal assistant setup for Signal Harbor platform engineering.

Participants:

- Maya Chen, Engineering Manager
- Jonah Price, Staff Engineer
- Elena Ruiz, Engineering Program Manager

## Rollout Goals

The first assistant workflow should help with PR triage, release notes, and
lightweight technical planning. The team does not want the assistant making
direct production changes without review. It should ask before updating
runbooks that are owned by another team.

## Style Notes From Maya

Maya said the assistant should keep replies concise. She wants the answer to
start with the useful part, then include caveats only when they change the
decision. She specifically pushed back on long summaries of obvious context.

She is fine with a professional tone for customer-facing drafts, but for her
own engineering work she prefers direct, concise replies over enthusiastic
ones.

## Open Questions

- Whether incident timelines should be summarized from chat logs.
- Whether release checklists should be updated in-place or proposed as diffs.
- Whether the assistant should retain notes from one planning cycle to the next.

## Unrelated Setup Tasks

- Add the assistant to the staging workspace.
- Confirm repository access for the docs repo.
- Create sample prompts for release note cleanup.
- Prepare a short demo for managers in the next enablement meeting.
