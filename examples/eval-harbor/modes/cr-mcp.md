Memory mode: cr-mcp.

A ContextRouter memory MCP server named `context-router-memory` is configured
for this task. Use it as the only external memory substrate.

Required workflow for every revealed stage:

1. Call `listPreferenceSlugs` before reading or answering the stage.
2. Read the stage files and infer the requested state.
3. Call `mutatePreferences` with successful writes for the exact relevant
   slugs before revealing the next stage.
4. Call `searchPreferences` before writing or updating
   `outputs/prediction.json`.

Use these tools:

- `listPreferenceSlugs` before each stage's memory update to inspect the
  available task-local preference slugs.
- `mutatePreferences` to store durable facts discovered from the packet.
- `searchPreferences` to read stored facts back before writing the final form.

Do not create or rely on `/app/memory.md`. Do not carry stage state only in the
chat context. Do not reveal the next stage until the current stage's inferred
state has been written with `mutatePreferences`. Do not create new slugs,
grouped slugs, summary slugs, or catch-all slugs. `mutatePreferences` rejects
unknown slugs. Use only exact slugs returned by `listPreferenceSlugs`.

For DynamicMem staged tasks, the visible `state_completion.keys` names are the
CR memory slugs. Store each inferred state under its matching exact state key,
for example `habits_state:budget_review`; do not store a combined object under a
new slug such as `checkpoint_routines`.

For a staged task, update MCP memory whenever new information is revealed. If a
stage asks for an answer, read MCP memory back with `searchPreferences` before
writing the requested output while preserving earlier checkpoint answers.
