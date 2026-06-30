Memory mode: cr-mcp.

A ContextRouter memory MCP server named `context-router-memory` is configured
for this task. Use it as the only external memory substrate.

Use these tools:

- `listPreferenceSlugs` to inspect available task-local preference slugs.
- `mutatePreferences` to store durable facts discovered from the packet.
- `searchPreferences` to read stored facts back before writing the final form.

Do not create or rely on `/app/memory.md`. For a single-step task, write memory
through MCP, read it back, and then write the final output to the path required
by the task instruction. For a multi-step task, update MCP memory during
ingestion steps and write the final output only when the current step asks for
it.
