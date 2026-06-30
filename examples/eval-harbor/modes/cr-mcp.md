Memory mode: cr-mcp.

A ContextRouter memory MCP server named `context-router-memory` is configured
for this task. Use it as the only external memory substrate.

Use these tools:

- `listPreferenceSlugs` to inspect available task-local preference slugs.
- `mutatePreferences` to store durable facts discovered from the packet.
- `searchPreferences` to read stored facts back before writing the final form.

Do not create or rely on `/app/memory.md`. For a staged task, update MCP memory
during memory-management stages, read it back before downstream work, and write
the final output only when a revealed downstream stage asks for it.
