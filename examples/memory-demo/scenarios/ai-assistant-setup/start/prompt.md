# AI Assistant Setup Task

Fill the AI assistant setup form for Maya Chen.

Use the scenario manifest to find the form, field manifest, user profile, seed preferences, and local memory file.

The expected files under `../expected/` are verifier outputs. Do not read or use expected files while filling the form.

Required behavior:

1. Retrieve relevant preferences from MCP before reading local fallback memory.
2. Use profile data for identity, organization, and role fields.
3. If MCP does not contain a value needed by the form, read only the local memory file listed in the scenario.
4. Backfill durable missing preferences through MCP before using them in the form.
5. Do not invent missing values.
6. Leave optional fields blank when there is no supported value.
