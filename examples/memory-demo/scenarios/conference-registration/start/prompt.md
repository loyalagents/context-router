# Conference Registration Task

Fill the conference registration form for Alex Rivera.

Use the scenario manifest to find the form, field manifest, user profile, seed preferences, local memory file, and expected output files.

Required behavior:

1. Retrieve relevant preferences from MCP before reading local fallback memory.
2. Use profile data for identity fields.
3. If MCP does not contain a value needed by the form, read only the local memory file listed in the scenario.
4. Backfill durable missing preferences through MCP before using them in the form.
5. Do not invent missing values.
6. Leave optional fields blank when there is no supported value.
