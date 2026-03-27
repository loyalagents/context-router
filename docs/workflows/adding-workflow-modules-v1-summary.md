# Workflow Architecture v1 — Delivery Summary

## What was delivered

CP1–CP4 implemented a first-class workflow layer in the Context Router backend. Two workflows are live behind MCP tools, the AI infrastructure is generalized, and the MCP dispatch is registry-based.

### CP1 — AI Primitives + Snapshot Service

- **`AiStructuredOutputPort`** — New port interface for Zod-validated structured AI output. Single implementation: `VertexAiStructuredService`, which handles markdown fence stripping, JSON parsing, Zod validation, and correction retry.
- **`PreferenceSchemaSnapshotService`** — Shared read-model that provides typed definition snapshots and prompt-ready JSON. Used by both workflows and the migrated `PreferenceExtractionService`.
- **`PreferenceExtractionService` migration** — Moved from raw `AiTextGeneratorPort` + inline parsing to `AiStructuredOutputPort` + snapshot service. All parsing concerns (fences, newlines, JSON.parse, Zod) now live in the port infrastructure layer.
- **14 integration tests** for the structured output port (`vertex-ai-structured.spec.ts`).

### CP2 — Workflow Layer

- **`PreferenceSearchWorkflow`** — 4-step workflow: load catalog → AI slug identification → hallucinated slug filtering → fetch preferences. Returns `matchedDefinitions`, `matchedActivePreferences`, `matchedSuggestedPreferences`, `queryInterpretation`.
- **`SchemaConsolidationWorkflow`** — 3-step workflow: load definitions (short-circuits if <2) → AI consolidation analysis → group validation with `slugScopes` population.
- **Shared contracts** — `IWorkflow<TInput, TOutput>` interface, `WorkflowStepRecorder` utility for observability.
- **`WorkflowsModule`** — Imports `VertexAiModule`, `PreferenceDefinitionModule`, `PreferenceModule`; provides and exports both workflows.
- **18 unit tests** across both workflows (9 each).

### CP3 — MCP Registry + Tools

- **`McpToolInterface`** — Common interface (`descriptor`, `requiresAuth`, `execute()`) for all MCP tools.
- **`MCP_TOOLS` injection token** — Factory-based array provider collecting all tool implementations.
- **`McpService` rewrite** — Replaced hardcoded tool descriptors and switch statement with Map-based registry. Duplicate tool name detection on startup.
- **3 existing tools refactored** — `PreferenceListTool`, `PreferenceSearchTool`, `PreferenceDefinitionTool` now implement `McpToolInterface`.
- **4 new tools** — `PreferenceSuggestTool`, `PreferenceDeleteTool` (thin adapters over `PreferenceMutationTool`), `SmartSearchTool`, `SchemaConsolidationTool` (workflow-backed).
- **24 existing e2e tests** continue passing.

### CP4 — E2E Tests + Docs

- **`workflows.e2e-spec.ts`** — 12 e2e tests: 8 for `smartSearchPreferences` (happy path, no preference rows, includeSuggestions, hallucinated slugs, empty result, port error, user scoping, truncation) and 4 for `consolidateSchema` (happy path with slugScopes, short-circuit, hallucinated slug drop, ALL scope with GLOBAL+USER).
- **Architecture doc updated** — Checkpoint table marked complete, repo structure tree corrected.

## Key decisions made during implementation

1. **`OnModuleInit` for tool map construction** — The `McpService` builds its `Map<string, McpToolInterface>` in `onModuleInit()` rather than the constructor, ensuring all providers are fully resolved before validation.

2. **Per-tool try/catch rather than centralized** — Each tool's `execute()` method has its own try/catch returning `CallToolResult`. This keeps error handling co-located with the tool and removes the need for a catch-all in `McpService`.

3. **`preference-mutation.tool.ts` kept as unregistered provider** — Rather than rewriting the shared suggest/delete logic, we kept it as an injectable service and created two thin adapter tools. The `.tool.ts` suffix is legacy naming; a future rename to `.service.ts` is recommended.

4. **`AGENTS.md` left as Codex instructions only** — Architecture documentation lives in `docs/workflows/`, not in the AI coding agent instruction file.

5. **Snapshot service in `PreferenceDefinitionModule`, not `WorkflowsModule`** — Maintains the correct dependency direction: workflows depend on preferences, not the reverse. Both `DocumentAnalysisModule` and `WorkflowsModule` import it through `PreferenceDefinitionModule`.

6. **`SourceType.INFERRED` not `AI_INFERRED`** — Discovered during e2e test writing that the Prisma enum uses `INFERRED`, not `AI_INFERRED`.

## Test coverage

| Suite | Count | Command |
|-------|-------|---------|
| Port integration (`vertex-ai-structured`) | 14 | `pnpm test --testPathPattern=vertex-ai-structured` |
| Workflow unit (preference-search) | 9 | `pnpm test --testPathPattern=preference-search.workflow` |
| Workflow unit (schema-consolidation) | 9 | `pnpm test --testPathPattern=schema-consolidation.workflow` |
| MCP e2e | 24 | `pnpm test --testPathPattern=mcp.e2e` |
| Workflow e2e | 12 | `pnpm test --testPathPattern=workflows.e2e` |
| Extraction service (migrated) | existing | `pnpm test --testPathPattern=document-analysis` |

All commands run from `apps/backend/`.

## Known limitations / tech debt

1. **Workflow outputs use `EnrichedPreference[]`** — Repo join shape leaks into workflow outputs. Should add dedicated workflow DTOs before adding a second consumer (GraphQL).
2. **`fetchPreferences` loads all then filters** — `getActivePreferences(userId)` returns every active preference; the workflow filters to matched slugs in memory. Add `findActiveByDefinitionSlugs(userId, slugs, locationId?)` for efficiency.
3. **`preference-mutation.tool.ts` naming** — Still has `.tool.ts` suffix despite not being a registered MCP tool. Rename to `.service.ts` in a cleanup pass.
4. **No config-level truncation e2e test** — The truncation test verifies the workflow respects `maxResults` but doesn't override `MCP_TOOLS_PREFERENCES_MAX_SEARCH_RESULTS` in the test env (defaults to 100). A tighter test would set it to 2 and assert capping.
5. **Single AI model** — `AiStructuredOptions` has a placeholder for `modelId` but `VertexAiService` doesn't support per-call model selection yet.

## v2 roadmap

Ordered by value:

1. **Workflow DTO layer + slug-targeted queries** — Decouple from `EnrichedPreference[]`; add `findActiveByDefinitionSlugs()` to the preference repository.
2. **GraphQL + Frontend integration** — `SmartSearchResolver`, `SchemaConsolidationResolver` injecting workflows directly (not via MCP). Web UI for visual testing and product use.
3. **Request-object port shape** — Consolidate `generateStructured` / `generateStructuredWithFile` into a single method with a request object.
4. **Per-call model selection** — Extend `VertexAiService` to accept `modelId` per call, then add to `AiStructuredOptions`.
5. **Observability** — Expose `WorkflowStepRecorder` data through structured logging or tracing, beyond the current debug-level logs.
