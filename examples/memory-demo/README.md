# Memory Demo Fixtures

Static fixtures for demoing and testing MCP memory retrieval, local fallback, and form filling.

- `forms/` contains reusable forms an agent can fill.
- `users/` contains synthetic user profiles and memory variants.
- `scenarios/` ties a form, user, prompt, and expected outputs into one demo contract.

The intended agent behavior is: retrieve relevant preferences from MCP first, read local fallback memory only for missing values, backfill durable preferences through MCP, then fill the form without inventing values.
