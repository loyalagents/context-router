# REPLACE_WITH_SCENARIO_TITLE

Fill the REPLACE_WITH_FORM_NAME form for REPLACE_WITH_SYNTHETIC_USER_NAME.

Use the scenario manifest to find the form, field manifest, user profile, seed preferences, and local memory file. Scenarios currently use the user's `simple/` memory baseline.

The expected files under `../expected/` are verifier outputs. Do not read or use expected files while filling the form.

Required behavior:

1. Retrieve relevant preferences from MCP before reading local fallback memory.
2. Use profile data for identity and profile-backed fields.
3. If MCP does not contain a value needed by the form, read only the local memory file listed by convention.
4. Backfill durable missing preferences through MCP before using them in the form.
5. Do not invent missing values.
6. Leave optional fields blank when there is no supported value.
