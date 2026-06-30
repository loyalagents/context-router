Memory mode: cr-mcp.

A ContextRouter memory MCP server named `context-router-memory` is configured
for this task. Use it as the only external memory substrate.

Use these tools:

- `listPreferenceSlugs` to inspect available task-local preference slugs.
- `mutatePreferences` to store durable facts discovered from the packet.
- `searchPreferences` to read stored facts back before writing the final form.

Do not create or rely on `/app/memory.md`. For a staged task, update MCP memory
whenever new information is revealed. If a stage asks for an answer, read MCP
memory back and update the requested output while preserving earlier checkpoint
answers.
