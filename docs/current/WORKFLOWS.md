# Workflows

- Status: current
- Read when: changing AI-backed workflows or adding a new workflow-backed MCP tool
- Source of truth: `apps/backend/src/modules/workflows/**`,
  `apps/backend/src/domains/shared/ports/ai-structured-output.port.ts`,
  `apps/backend/src/mcp/tools/smart-search.tool.ts`,
  `apps/backend/test/e2e/workflows.e2e-spec.ts`, and
  `apps/backend/test/e2e/smart-search-graphql.e2e-spec.ts`
- Last reviewed: 2026-09-22

## What Exists

The backend has a first-class workflow layer for AI-assisted, structured operations.

Current workflows:

- `PreferenceSearchWorkflow`, surfaced through `smartSearchPreferences`
- `SchemaConsolidationWorkflow`, surfaced through `consolidateSchema`

Supporting pieces:

- `AiStructuredOutputPort` for Zod-validated structured AI responses
- `VertexAiStructuredService` as the current implementation
- `PreferenceSchemaSnapshotService` for prompt-ready schema snapshots
- `WorkflowStepRecorder` for per-step timing and summaries
- `WorkflowsModule` for wiring workflows into the backend

These usable AI surfaces belong to the hosted composition. The Step 03 local
identity preview binds both AI ports to a fixed unavailable adapter that makes
no model call, and it has no listener. That preview proves composition only;
Step 06 owns a usable local model runtime.

## Execution Pattern

The workflow pattern is:

1. Load typed data from the backend
2. Build a prompt from a stable snapshot
3. Call the structured AI port with a Zod schema
4. Validate or filter hallucinated output
5. Return typed results to the caller

When a caller supplies permission-grant filtering, as the MCP surfaces do, it
happens before prompt construction. The workflow layer itself does not impose
MCP grants on every caller.

## Surfaces and Authorization

`PreferenceSearchWorkflow` is shared by the MCP `smartSearchPreferences` tool
and the authenticated GraphQL `smartSearchPreferences` query. Its core pipeline
is:

1. Load a schema snapshot through the caller's slug-access filter.
2. Ask the structured model for an ordered list of relevant slugs.
3. Remove unknown and duplicate slugs while preserving model order.
4. Load global or location-merged active preferences and, when requested,
   suggestions for those slugs.
5. Sort preference rows by model relevance and cap preference rows. Definition
   results are not subject to that preference-row cap.

The two surfaces deliberately supply different authorization contexts:

- MCP supplies the real client key and an
  `McpAuthorizationService.filterByTargetAccess` filter. Capability policy,
  static target rules, and database grants narrow the schema before the prompt;
  after the workflow loads matching values, the tool filters returned
  definitions and preference rows again before exposing the result. Normal MCP
  authentication and access logging apply.
- GraphQL supplies the authenticated dashboard user, a synthetic
  `__dashboard__` client key, and a pass-through slug filter. It is current-user
  scoped but does not apply MCP client policies or permission grants and does
  not create MCP access events.

`/dashboard/search-lab` uses both exact and smart search. Exact search filters
the already-loaded GraphQL catalog/preferences in the browser by slug prefix,
category, or description. Smart search calls the GraphQL workflow surface and
can include suggestions and an optional location. `Run Both` compares these
paths and displays the model's query interpretation.

First-party GraphQL user scoping and MCP client-grant authorization are
different boundaries; documentation and tests should not imply that one
enforces the other.

## Adding a New Workflow

Use the existing workflows as the template:

1. Define typed workflow input and output.
2. Define the Zod schema for the AI response.
3. Write a pure prompt-builder function.
4. Write workflow unit tests before implementation.
5. Implement the workflow class using `WorkflowStepRecorder`.
6. Register it in `WorkflowsModule`.
7. Add a thin MCP tool or other caller if the workflow needs an external surface.
8. Add e2e coverage for the exposed surface.

## Current Constraints

- Workflow outputs still use some repository-flavored shapes, especially for matched preference rows.
- The current prompt-building path depends on the schema snapshot service rather than a more generic request-object abstraction.
- Vertex AI is the only usable hosted structured-AI provider today. The local
  identity preview deliberately binds both AI ports to a fixed unavailable
  adapter and performs no model I/O.
