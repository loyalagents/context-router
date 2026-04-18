# Workflows

- Status: current
- Read when: changing AI-backed workflows or adding a new workflow-backed MCP tool
- Source of truth: `apps/backend/src/modules/workflows/**`, `apps/backend/src/domains/shared/ports/ai-structured-output.port.ts`, `apps/backend/test/e2e/workflows.e2e-spec.ts`
- Last reviewed: 2026-04-18

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

## Execution Pattern

The workflow pattern is:

1. Load typed data from the backend
2. Build a prompt from a stable snapshot
3. Call the structured AI port with a Zod schema
4. Validate or filter hallucinated output
5. Return typed results to the caller

Permission-grant filtering happens before prompt construction when workflows operate on definition slugs.

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
- The only structured AI implementation today is Vertex AI.
