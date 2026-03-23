# Agent/Workflow Architecture for Context Router

## Context

The Context Router backend has a sophisticated MCP tool layer and a proven multi-step AI pipeline (document analysis via `PreferenceExtractionService`). The next evolution is generalizing that pattern into a first-class **agent layer** — NestJS services that combine data retrieval with structured AI invocations to answer complex questions. Two immediate use cases drove this design:

1. **Smart Search**: Replace the current keyword-matching search (`searchCatalog` does slug prefix + description substring matching) with a natural-language search that asks the AI which preference definitions are relevant to a given query.
2. **Schema Consolidation**: Analyze a user's preference definitions and identify semantic duplicates or overlaps, returning advisory groupings for cleanup.

This document is the canonical architecture reference. Other draft documents (`adding-agent-modules-2.md`, feedback files) are superseded by it.

---

## Guiding Principles

- **Workflow over autonomy**: Each agent executes a fixed sequence of steps (load data → call AI once → validate → return). The AI does not choose which tools to call. Introduce a subagent only when the same reasoning block is reused across two or more agents.
- **Slugs only from the AI**: The AI receives a catalog of known slugs in its prompt. It returns only slug strings, never preference values or IDs. All returned slugs are validated against ground truth before use. Hallucinated slugs are silently discarded.
- **Read-heavy, write-never**: Agents do not write to the database. Writes happen only through existing services (`PreferenceService`, `PreferenceDefinitionService`).
- **Internal-first, MCP-only for v1**: Agents are internal workflow services. MCP, GraphQL, and web routes can expose them through thin adapters — but **v1 adds MCP adapters only**. GraphQL resolvers and frontend integration are deferred until there is a concrete product need. The internal-first design ensures those can be added later without restructuring agents.
- **One structured-output pattern**: Migrate `PreferenceExtractionService` to the new port so the repo has a single approach to structured AI output.
- **Existing patterns, not frameworks**: No LangChain or similar. Build on the port/adapter AI abstraction, Zod validation, and NestJS DI already in place.

---

## Repo Structure: Before and After

### Before

```
apps/backend/src/
├── domains/shared/ports/
│   └── ai-text-generator.port.ts
├── infrastructure/vertex-ai/
│   └── vertex-ai.service.ts
├── mcp/
│   ├── mcp.module.ts
│   ├── mcp.service.ts              ← growing switch statement
│   └── tools/
│       ├── preference-definition.tool.ts
│       ├── preference-list.tool.ts
│       ├── preference-mutation.tool.ts
│       └── preference-search.tool.ts
└── modules/
    └── preferences/
        └── document-analysis/
            └── preference-extraction.service.ts  ← raw-string AI output

AGENTS.md   (empty)
```

### After

```
apps/backend/src/
├── domains/shared/ports/
│   ├── ai-text-generator.port.ts              (unchanged)
│   └── ai-structured-output.port.ts           [NEW]
├── infrastructure/vertex-ai/
│   ├── vertex-ai.service.ts                   (unchanged)
│   └── vertex-ai-structured.service.ts        [NEW]
├── (modules/vertex-ai/)
│   └── vertex-ai.module.ts                    [MODIFIED: add VertexAiStructuredService provider + 'AiStructuredOutputPort' export]
├── mcp/
│   ├── mcp.constants.ts                       [NEW]
│   ├── mcp.module.ts                          [MODIFIED: +AgentsModule, split mutation tool, +2 agent tools]
│   ├── mcp.service.ts                         [MODIFIED: switch → registry]
│   └── tools/
│       ├── base/
│       │   └── mcp-tool.interface.ts          [NEW]
│       ├── preference-definition.tool.ts      [MODIFIED: implement McpToolInterface (add descriptor, requiresAuth, execute())]
│       ├── preference-list.tool.ts            [MODIFIED: implement McpToolInterface (add descriptor, requiresAuth, execute())]
│       ├── preference-mutation.tool.ts        (unchanged — unregistered provider, holds business logic; .tool.ts suffix is legacy naming only, not a registered MCP tool — rename to preference-mutation.service.ts in a future cleanup)
│       ├── preference-suggest.tool.ts         [NEW — thin adapter, delegates to PreferenceMutationTool]
│       ├── preference-delete.tool.ts          [NEW — thin adapter, delegates to PreferenceMutationTool]
│       ├── preference-search.tool.ts          [MODIFIED: implement McpToolInterface (add descriptor, requiresAuth, execute())]
│       ├── smart-search.tool.ts               [NEW]
│       └── schema-consolidation.tool.ts       [NEW]
└── modules/
    ├── agents/
    │   ├── agents.module.ts                   [NEW]
    │   ├── shared/
    │   │   ├── agent.interface.ts             [NEW]
    │   │   └── agent-step-recorder.ts         [NEW]
    │   └── preferences/
    │       ├── preference-search/
    │       │   ├── preference-search.agent.ts         [NEW]
    │       │   ├── preference-search.prompt.ts        [NEW]
    │       │   └── preference-search.schema.ts        [NEW]
    │       └── schema-consolidation/
    │           ├── schema-consolidation.agent.ts      [NEW]
    │           ├── schema-consolidation.prompt.ts     [NEW]
    │           └── schema-consolidation.schema.ts     [NEW]
    └── preferences/
        ├── preference-definition/
        │   ├── preference-definition.module.ts              [MODIFIED: add PreferenceSchemaSnapshotService to providers + exports]
        │   └── preference-schema-snapshot.service.ts        [NEW]
        └── document-analysis/
            └── preference-extraction.service.ts  [MODIFIED: migrate to AiStructuredOutputPort, use PreferenceSchemaSnapshotService]

apps/backend/test/e2e/
├── mcp.e2e-spec.ts                            (unchanged)
└── agents.e2e-spec.ts                         [NEW]

AGENTS.md                                      [MODIFIED: populated]
docs/agents/adding-agent-modules.md            [MODIFIED: full architecture doc]
docs/MCP_INTEGRATION.md                        [MODIFIED: note on tools delegating to agents]
```

**Summary**: 19 new files, 8 modified files (code), 3 modified docs (`AGENTS.md`, `adding-agent-modules.md`, `MCP_INTEGRATION.md`), 0 deleted files, 0 schema migrations. Modified files: `mcp.module.ts`, `mcp.service.ts`, `vertex-ai.module.ts`, `preference-definition.module.ts`, `preference-extraction.service.ts`, plus the three existing tool files updated to implement `McpToolInterface` (`preference-definition.tool.ts`, `preference-list.tool.ts`, `preference-search.tool.ts`). `preference-mutation.tool.ts` is kept as an unregistered provider unchanged; `preference-suggest.tool.ts` and `preference-delete.tool.ts` are new thin adapters wrapping it.

**Recommended follow-up** (post-v1): Agent output types currently return repo types (`EnrichedPreference[]`), and `fetchPreferences` fetches all active preferences then filters in memory. Both are consistent with the existing `searchPreferences` tool's approach, but should be addressed once agents have a second consumer (e.g. GraphQL):
- Add dedicated agent DTOs to decouple agents from repository join shapes
- Add slug-targeted read methods (e.g. `findActiveByDefinitionSlugs(userId, slugs, locationId?)`) to avoid fetching all preferences and filtering in TS

**Recommended pre-step** (before implementation): The README still documents a root `src/` app layout from before the monorepo split. Consider a brief docs cleanup pass so contributors know where agent code belongs. This is not a blocking checkpoint — it predates this architecture change.

---

## New Port: `AiStructuredOutputPort`

**File**: `apps/backend/src/domains/shared/ports/ai-structured-output.port.ts`

```typescript
export interface AiStructuredOptions {
  retries?: number;
  operationName?: string;  // used for logging/tracing (e.g. 'preferenceSearch.slugIdentification')
  // future (requires VertexAiService per-call model support): modelId, temperature, maxOutputTokens
}

export interface AiStructuredOutputPort {
  generateStructured<T>(
    prompt: string,
    schema: z.ZodType<T>,
    options?: AiStructuredOptions,
  ): Promise<T>;

  generateStructuredWithFile<T>(
    prompt: string,
    file: FileInput,
    schema: z.ZodType<T>,
    options?: AiStructuredOptions,
  ): Promise<T>;
}
```

**DI token**: `'AiStructuredOutputPort'`

**Implementation** (`vertex-ai-structured.service.ts`): Wraps `VertexAiService.generateText()` and `generateTextWithFile()`. Handles markdown fence stripping, `JSON.parse`, Zod `.safeParse()`, and a single correction retry — consolidating the logic currently scattered in `PreferenceExtractionService.parseAiResponse()`.

**Retry policy**: `options.retries` defaults to `1` (one correction attempt). On parse or Zod failure, the service builds a correction prompt containing the original prompt, the invalid output, and the parse/Zod error messages, then calls `generateText` once more. If the correction also fails, it throws a descriptive error. Callers can set `retries: 0` to disable. Blind retry (resending the same prompt without error context) is not used — it adds latency and cost without giving the model new signal.

**NestJS binding** — `apps/backend/src/modules/vertex-ai/vertex-ai.module.ts` is **modified**. The alias token must be registered in `providers` using `useExisting` (not `useClass` in exports — that would create a second instance):

```typescript
@Module({
  providers: [
    VertexAiService,
    VertexAiStructuredService,
    { provide: 'AiStructuredOutputPort', useExisting: VertexAiStructuredService },
    // existing 'AiTextGeneratorPort' alias unchanged
  ],
  exports: [
    VertexAiService,
    VertexAiStructuredService,
    'AiStructuredOutputPort',
    // existing exports unchanged
  ],
})
```

Any module that needs the structured output port imports `VertexAiModule` — no second instance is created.

**v2 shape note**: The two-method design (`generateStructured` / `generateStructuredWithFile`) mirrors the existing `AiTextGeneratorPort` pattern. A future iteration should consolidate to a single method with a request object — `generateStructured({ prompt, schema, files?, operationName, retries })` — which eliminates the need for separate overloads and extends more cleanly as new options arise.

**Migration**: `PreferenceExtractionService` is updated to inject `'AiStructuredOutputPort'` and call `generateStructuredWithFile()`, removing its inline parsing logic. This is the first checkpoint.

---

## Agent Base Contracts

**File**: `apps/backend/src/modules/agents/shared/agent.interface.ts`

Agents follow the existing backend service style: **throw on failure, return typed data on success**. This is consistent with `PreferenceService`, `PreferenceDefinitionRepository`, and the rest of the codebase, which return domain data or throw NestJS exceptions — never success/error envelopes. MCP tool adapters catch exceptions and map them to MCP error responses.

```typescript
export interface AgentInput {
  userId: string;
}

export interface AgentStep {
  name: string;
  kind: 'db' | 'ai' | 'validation' | 'subagent';
  durationMs: number;
  summary?: string;
}

export interface IAgent<TInput extends AgentInput, TOutput> {
  run(input: TInput): Promise<TOutput>;
}
```

`AgentStep[]` is collected internally by `AgentStepRecorder` and logged at debug level — it is not part of the return type. This keeps tracing as an observability concern separate from the agent's public contract.

**File**: `apps/backend/src/modules/agents/shared/agent-step-recorder.ts`

A small utility that agents construct at the start of `run()` and call `recorder.record(name, kind, fn)` — executes `fn`, measures duration, pushes to the internal steps array, and logs at completion. Steps are not returned to callers.

---

## MCP Tool Registry

**Problem**: `mcp.service.ts` has a hard-coded `switch` for dispatch and a parallel array for tool descriptors. Each new tool requires touching two separate blocks. A registry replaces both, but NestJS has no mechanism to auto-inject "all classes implementing an interface" — an explicit token is required.

### `McpToolInterface`

**File**: `apps/backend/src/mcp/tools/base/mcp-tool.interface.ts`

```typescript
export interface McpToolInterface {
  descriptor: Tool;                              // MCP Tool type from @modelcontextprotocol/sdk
  requiresAuth: boolean;                         // false for public tools (e.g. listPreferenceSlugs)
  execute(args: unknown, context?: McpContext): Promise<CallToolResult>;
}
```

**One class, one tool name.** Each `McpToolInterface` implementation exposes exactly one descriptor and one execute method. The current `preference-mutation.tool.ts` bundles `suggestPreference` and `deletePreference` in a single class — this is split into `preference-suggest.tool.ts` and `preference-delete.tool.ts`, each implementing the interface cleanly.

The shared business logic (`suggest()`, `delete()`) stays in `preference-mutation.tool.ts`, which is kept as an unregistered NestJS provider (not added to the `MCP_TOOLS` array). Both `PreferenceSuggestTool` and `PreferenceDeleteTool` inject `PreferenceMutationTool` and delegate to it. No business logic moves; only the MCP adapter boundary is split.

`requiresAuth: boolean` replaces the current special-case that runs `listPreferenceSlugs` before the auth check. Each tool declares its own auth requirement; `McpService` reads this when dispatching instead of hard-coding it.

`context` is optional because public tools (`requiresAuth: false`) may be called without authentication. However, `McpService` always passes context when it is available — even for public tools. This preserves the existing "public but user-aware" behavior of `listPreferenceSlugs`, which currently returns user-owned definitions alongside GLOBAL ones when a user is authenticated.

### `MCP_TOOLS` injection token

The string token is exported from a single constants file to prevent typos and allow the compiler to catch mismatches:

**File**: `apps/backend/src/mcp/mcp.constants.ts`
```typescript
export const MCP_TOOLS = 'MCP_TOOLS';
```

Both `McpModule` and `McpService` import from this file rather than repeating the raw string.

**In `McpModule`**, an explicit array provider is declared:

```typescript
{
  provide: MCP_TOOLS,   // imported from mcp.constants.ts
  useFactory: (
    prefList: PreferenceListTool,
    prefSearch: PreferenceSearchTool,
    prefSuggest: PreferenceSuggestTool,
    prefDelete: PreferenceDeleteTool,
    prefDef: PreferenceDefinitionTool,
    smartSearch: SmartSearchTool,
    consolidation: SchemaConsolidationTool,
  ): McpToolInterface[] => [prefList, prefSearch, prefSuggest, prefDelete, prefDef, smartSearch, consolidation],
  inject: [PreferenceListTool, PreferenceSearchTool, PreferenceSuggestTool, PreferenceDeleteTool, PreferenceDefinitionTool, SmartSearchTool, SchemaConsolidationTool],
}
```

Note `provide: MCP_TOOLS` (the imported constant from `mcp.constants.ts`), not the raw string `'MCP_TOOLS'`.

`McpService` injects `@Inject(MCP_TOOLS) private readonly tools: McpToolInterface[]` and builds a `Map<string, McpToolInterface>` from it on construction. On startup it validates for duplicate tool names and throws immediately if any are found — silent overwriting in the map would be a hard-to-diagnose runtime bug. `ListToolsRequestSchema` iterates `tools.map(t => t.descriptor)`. `CallToolRequestSchema` looks up by name and calls `.execute()`, checking `requiresAuth` before passing context.

---

## `PreferenceSchemaSnapshotService`

**File**: `apps/backend/src/modules/preferences/preference-definition/preference-schema-snapshot.service.ts`

Lives in the `preference-definition` module — not in `AgentsModule` — so that both `DocumentAnalysisModule` and `AgentsModule` can import it through the existing `PreferenceDefinitionModule` without inverting the dependency direction. Agents depend on preferences; preferences do not depend on agents.

`apps/backend/src/modules/preferences/preference-definition/preference-definition.module.ts` is **modified** to add `PreferenceSchemaSnapshotService` to both `providers` and `exports`. The current module only provides/exports the repository and service — without this explicit addition, DI will fail for any module that tries to inject the snapshot service.

A shared read-model service used by all AI consumers that need to describe the preference catalog to an LLM. Eliminates duplication across `PreferenceExtractionService` (which currently builds this by hand in `buildExtractionPrompt()`), `PreferenceSearchAgent`, and `SchemaConsolidationAgent`.

**Method signature**: `getSnapshot(userId: string, scope?: 'PERSONAL' | 'ALL'): Promise<PreferenceSchemaSnapshot>`

Responsibilities:
- When `scope` is absent (or `'ALL'`): call `defRepo.getAll(userId)` — returns GLOBAL + user-owned definitions (used by `PreferenceSearchAgent` and `PreferenceExtractionService`)
- When `scope` is `'PERSONAL'`: call `defRepo.getByScope('PERSONAL', userId)` — returns user-owned definitions only (used by `SchemaConsolidationAgent` default case)
- Return a typed AI-safe snapshot DTO (slugs, descriptions, valueTypes, options — no sensitive internals) plus a pre-formatted JSON string for prompt injection
- This is a read-only service; no writes, no side effects

`defRepo.getByScope()` already exists in `apps/backend/src/modules/preferences/preference-definition/preference-definition.repository.ts` — use it directly rather than filtering `getAll()` results.

`PreferenceExtractionService` is updated in Checkpoint 1 to use this service instead of its inline catalog-building logic. Both new agents call it in their first step.

---

## `PreferenceSearchAgent`

**Files**:
- `modules/agents/preferences/preference-search/preference-search.agent.ts`
- `modules/agents/preferences/preference-search/preference-search.prompt.ts`
- `modules/agents/preferences/preference-search/preference-search.schema.ts`

**Purpose**: Accept a natural-language query and return the semantically relevant preference definitions and matching user preference values.

**Input**:
```typescript
interface PreferenceSearchAgentInput extends AgentInput {
  naturalLanguageQuery: string;
  locationId?: string;
  includeSuggestions?: boolean;
  maxResults?: number;   // caller-supplied limit; agent applies it if present, no default
}
```

**Output**:
```typescript
interface PreferenceSearchAgentOutput {
  matchedDefinitions: Array<{ slug: string; description: string; category: string }>;
  matchedActivePreferences: EnrichedPreference[];     // ACTIVE rows for matched slugs; may be a subset of matchedDefinitions
  matchedSuggestedPreferences: EnrichedPreference[];  // SUGGESTED rows; empty when includeSuggestions is false
  queryInterpretation: string;
}
```

**Behavioral notes**:
- `matchedDefinitions` is always populated from the validated slug set, regardless of whether the user has any preference rows. Callers see the full picture: "here are the relevant definitions, here's what you've set."
- `matchedSuggestedPreferences` is always present in the output (may be empty). This mirrors the existing `searchPreferences` tool's `active`/`suggested` separation.

**Zod schema** (in `preference-search.schema.ts`):
```typescript
export const RelevanceResponseSchema = z.object({
  relevantSlugs: z.array(z.string()),
  queryInterpretation: z.string(),
});
```

**Workflow** (4 steps, all via `AgentStepRecorder`):

| Step | Kind | Action |
|------|------|--------|
| `loadCatalog` | `db` | `preferenceSchemaSnapshotService.getSnapshot(userId)` — returns typed DTO and prompt-ready JSON; same data `PreferenceExtractionService` builds inline today |
| `aiSlugIdentification` | `ai` | `aiStructuredPort.generateStructured(prompt, RelevanceResponseSchema)` — AI receives catalog JSON + query, returns slug strings only |
| `slugValidation` | `validation` | Filter `relevantSlugs` against a `Set` of known slugs from step 1. Discard hallucinated values silently. |
| `fetchPreferences` | `db` | `preferenceService.getActivePreferences(userId, locationId)`, filter to validated slugs → `matchedActivePreferences`. If `includeSuggestions`, also call `getSuggestedPreferences(userId, locationId)` and filter → `matchedSuggestedPreferences`. `matchedDefinitions` is assembled from step 1 regardless of whether any preference rows exist. |

**Result-limit policy**: The agent accepts an optional `maxResults` in its input and applies it to `matchedActivePreferences` and `matchedSuggestedPreferences` if present. `matchedDefinitions` is never capped — it is lightweight slug/description metadata. The agent itself has no knowledge of `mcp.tools.preferences.maxSearchResults`. `SmartSearchTool` reads that config value and passes it as `maxResults` when calling the agent — keeping MCP-specific config out of the agent layer. A future GraphQL caller could pass a different limit or omit it entirely.

**Security**: The AI receives catalog slug/description pairs only — no user preference values. It cannot access preferences directly.

---

## `SchemaConsolidationAgent`

**Files**:
- `modules/agents/preferences/schema-consolidation/schema-consolidation.agent.ts`
- `modules/agents/preferences/schema-consolidation/schema-consolidation.prompt.ts`
- `modules/agents/preferences/schema-consolidation/schema-consolidation.schema.ts`

**Purpose**: Analyze preference definitions and return advisory consolidation groups. No writes.

**Input**:
```typescript
interface SchemaConsolidationAgentInput extends AgentInput {
  scope?: 'PERSONAL' | 'ALL';
}
```

**Output**:
```typescript
interface SchemaConsolidationAgentOutput {
  totalDefinitionsAnalyzed: number;
  consolidationGroups: ConsolidationGroup[];
  summary: string;
}

interface ConsolidationGroup {
  slugs: string[];
  reason: string;
  suggestion: 'MERGE' | 'RENAME' | 'DELETE_ONE' | 'REVIEW';
  recommendedSlug?: string;
  slugScopes: Record<string, 'GLOBAL' | 'USER'>;  // maps each slug to its ownership — GLOBAL items are advisory only
}
```

**Workflow** (3 steps):

| Step | Kind | Action |
|------|------|--------|
| `loadDefinitions` | `db` | `preferenceSchemaSnapshotService.getSnapshot(userId, scope)` — returns DTO with scoping applied. Short-circuit if < 2 defs: **return empty `consolidationGroups` immediately, do not throw** — having few definitions is a valid no-op, not a failure. |
| `aiConsolidationAnalysis` | `ai` | `aiStructuredPort.generateStructured(prompt, ConsolidationResponseSchema)` — AI receives definitions as JSON array |
| `groupValidation` | `validation` | Filter every group's `slugs` against known set. Drop groups with < 2 survivors. Clear invalid `recommendedSlug`. Populate `slugScopes` from the loaded definitions map (namespace `"GLOBAL"` vs `"USER:<id>"`). |

---

## New MCP Tools

The legacy `searchPreferences` tool is left unchanged for compatibility. New tools sit alongside it.

### `smartSearchPreferences`
```
description: Natural-language preference search. Understands intent rather than keywords.
inputSchema: { query: string (required), locationId?: string, includeSuggestions?: boolean }
annotations: { readOnlyHint: true }
```
Delegates to: `PreferenceSearchAgent.run(...)`

### `consolidateSchema`
```
description: Identifies duplicate or overlapping personal preference definitions. Advisory only — no changes made.
inputSchema: { scope?: 'PERSONAL' | 'ALL' }
annotations: { readOnlyHint: true }
```
Delegates to: `SchemaConsolidationAgent.run(...)`

---

## `AgentsModule`

**File**: `apps/backend/src/modules/agents/agents.module.ts`

```typescript
@Module({
  imports: [
    VertexAiModule,              // provides 'AiStructuredOutputPort'
    PreferenceDefinitionModule,
    PreferenceModule,
  ],
  providers: [PreferenceSearchAgent, SchemaConsolidationAgent],
  exports:   [PreferenceSearchAgent, SchemaConsolidationAgent],
})
export class AgentsModule {}
```

`McpModule` imports `AgentsModule`. New tool classes are added to `McpModule`'s providers.

---

## How to Add a Future Agent (Checklist)

1. **Create agent directory**: `src/modules/agents/<domain>/<agent-name>/`
   - `<agent-name>.agent.ts` — implements `IAgent<Input, Output>`, uses `AgentStepRecorder`
   - `<agent-name>.prompt.ts` — exports the prompt builder function
   - `<agent-name>.schema.ts` — exports the Zod response schema

   > **Checkpoint A**: App compiles.

2. **Register in `AgentsModule`**: Add to `providers` and `exports`. Add any new module imports needed.

3. **Create thin MCP tool**: `src/mcp/tools/<name>.tool.ts` implementing `McpToolInterface`. Provide `descriptor` and `execute(args, context)`. Call `agent.run(...)` inside a try/catch — on success serialize the result as MCP content; on exception set `isError: true` and include the error message. Do not add business logic here.

4. **Register in `McpModule`**: Add tool to `providers`. It auto-registers in the registry in `McpService`.

   > **Checkpoint B** (run from `apps/backend/`): `pnpm test -- --testPathPattern=mcp.e2e` passes. New tool appears in tools list.

5. **Write e2e test** in `test/e2e/agents.e2e-spec.ts`. Use `createTestApp()` and configure `mocks.structuredAi.generateStructured` per test. Cover: happy path, hallucinated slug filtering, empty result, port throws validation error (not non-JSON parsing — that belongs in the port integration tests), any domain-specific short-circuits.

   > **Checkpoint C** (run from `apps/backend/`): `pnpm test -- --testPathPattern=agents.e2e` is green.

6. **Update docs**: Add a paragraph to `AGENTS.md`. Update `docs/agents/adding-agent-modules.md` if the architecture changed.

---

## Testing Strategy

**Mock pattern**: `createTestApp()` in `test/setup/test-app.ts` is extended to add `mocks.structuredAi` alongside the existing `mocks.vertexAi` — extend the existing return shape, don't rewrite it. The `'AiStructuredOutputPort'` override is wired inside `createTestApp()`, not in individual e2e files. Individual tests configure behavior via `mocks.structuredAi.generateStructured.mockResolvedValue(...)`.

The real helper returns `{ module, setTestUser, registerMcpUser, mocks }` — `mocks.structuredAi` is added to the existing `mocks` object.

**E2E test cases for `smartSearchPreferences`**:
1. Happy path — mock returns two valid slugs; assert `matchedDefinitions` contains both regardless of whether the user has preference rows for them
2. Definitions without preference rows — mock returns a slug the user has never set; assert slug appears in `matchedDefinitions` but not in `matchedActivePreferences`
3. `includeSuggestions: true` — mock returns a valid slug; seed one ACTIVE and one SUGGESTED preference for that slug; assert both appear in their respective output arrays
4. Hallucinated slugs — mock returns a non-existent slug; assert it is absent from all output arrays, no error
5. Empty result — mock returns `{ relevantSlugs: [], queryInterpretation: "..." }`; assert response contains empty `matchedDefinitions`, `matchedActivePreferences`, and `matchedSuggestedPreferences` arrays
6. Port throws validation error — `mocks.structuredAi.generateStructured` rejects with an error; assert MCP tool returns `isError: true` (MCP tool catches the thrown exception; agent itself just throws)
7. User scoping — seed preferences for user A and user B; assert user A's call returns only user A's preference rows
8. Truncation via MCP adapter — set `mcp.tools.preferences.maxSearchResults` to 2 in test config; seed 5 active preferences for matching slugs; mock `mocks.structuredAi.generateStructured` returning all 5 valid slugs; assert MCP response contains only 2 preferences (verifies `SmartSearchTool` reads config, passes `maxResults: 2` to agent, and agent truncates correctly)

**E2E test cases for `consolidateSchema`**:
1. Happy path — two similar user-owned definitions seeded; mock returns a consolidation group with both; assert group present, both `slugScopes` values are `'USER'`
2. Short-circuit — one definition seeded; assert AI not called, empty groups returned
3. Slug validation — mock returns a group with a non-existent slug; assert it is silently dropped
4. `ALL` scope with GLOBAL definitions — seed one GLOBAL def and one user def; mock returns a group containing both; assert group is present and `slugScopes` correctly marks the global one as `'GLOBAL'` (advisory)

**Port integration test** (`test/integration/vertex-ai-structured.spec.ts`): This is the correct layer for parsing/validation failures. Test cases: valid JSON returned typed, markdown fences stripped and parsed, non-JSON response throws a parse error, Zod validation failure triggers retry, exhausted retries throw a descriptive error. Uses a mock of `VertexAiService.generateText` — no live GCP calls.

---

## Implementation Checkpoints

All test commands run from `apps/backend/` (`cd apps/backend && pnpm test -- --testPathPattern=...`).

| Checkpoint | What changes | Test command |
|---|---|---|
| 1 — AI primitives + snapshot | `ai-structured-output.port.ts`, `vertex-ai-structured.service.ts`, `PreferenceSchemaSnapshotService`, migrate `PreferenceExtractionService` (both AI output parsing → port and prompt-building → snapshot service) | `--testPathPattern=vertex-ai-structured` + `--testPathPattern=document-analysis` |
| 2 — Agent layer | `agents.module.ts`, shared contracts, both agent classes with prompt/schema files, agent unit specs | Unit tests green: hallucinated slug filtering, `includeSuggestions` output split, <2 defs short-circuit, `maxResults` truncation — following the `preference-extraction.service.spec.ts` pattern |
| 3 — MCP integration | `mcp.constants.ts`, `mcp-tool.interface.ts`, `MCP_TOOLS` token, registry in `McpService`, add `preference-suggest.tool.ts` and `preference-delete.tool.ts` (keeping `preference-mutation.tool.ts` as a shared non-registered provider), existing tools implement interface, 2 new agent-backed tools | `--testPathPattern=mcp.e2e` |
| 4 — E2E + docs | `agents.e2e-spec.ts`, `AGENTS.md`, `docs/agents/`, `docs/MCP_INTEGRATION.md` | `--testPathPattern=agents.e2e` |
| 5 — V1 summary | `docs/agents/adding-agent-modules-v1-summary.md` — what CP1–CP4 delivered, key decisions made during implementation, known limitations/tech debt, concrete v2 roadmap | N/A (doc only) |

---

## Critical Files

| File | Why |
|------|-----|
| `apps/backend/src/modules/vertex-ai/vertex-ai.module.ts` | Add `VertexAiStructuredService` + `useExisting` alias provider; export token |
| `apps/backend/src/modules/preferences/preference-definition/preference-definition.module.ts` | Add `PreferenceSchemaSnapshotService` to providers and exports |
| `apps/backend/src/mcp/mcp.service.ts` | Replace switch with registry; add new tool descriptors |
| `apps/backend/src/mcp/mcp.module.ts` | Import `AgentsModule`; register `PreferenceSuggestTool`, `PreferenceDeleteTool`, `SmartSearchTool`, `SchemaConsolidationTool` providers; update `MCP_TOOLS` factory |
| `apps/backend/src/modules/preferences/document-analysis/preference-extraction.service.ts` | Migrate to `AiStructuredOutputPort`; reference for prompt/Zod patterns |
| `apps/backend/test/e2e/mcp.e2e-spec.ts` | Template for `agents.e2e-spec.ts` |
| `apps/backend/test/setup/test-app.ts` | Add `mocks.structuredAi` |

---

## Manual Verification (MCP-only)

Since v1 is MCP-only, manual testing goes through the MCP transport. Automated e2e tests mock the AI — this section covers live verification with a real Vertex AI connection.

**Setup**: Start the backend locally with Vertex AI credentials configured (`GCP_PROJECT_ID`, `VERTEX_REGION`, `VERTEX_MODEL_ID` in `.env`). The backend exposes an MCP endpoint at `POST /mcp`.

**Test `smartSearchPreferences`**:
1. Seed some preference definitions and active preferences for a test user (via DB seed or MCP `createPreferenceDefinition` + `suggestPreference` / approve flow)
2. Connect an MCP client (e.g. Claude Desktop, or `curl` against `/mcp`)
3. Call `smartSearchPreferences` with a natural language query like "what are my food preferences?" against seeded data
4. Verify: response contains relevant definitions, `matchedActivePreferences` are for the correct user, `queryInterpretation` is sensible, hallucinated slugs (if any) are absent

**Test `consolidateSchema`**:
1. Create several user-owned definitions with overlapping names/descriptions (e.g. `food.dietary_restrictions` and `food.diet_requirements`)
2. Call `consolidateSchema` with `scope: 'PERSONAL'`
3. Verify: response groups the overlapping definitions, `slugScopes` shows `'USER'` for all, `suggestion` is reasonable

**Test legacy compatibility**:
1. Call `searchPreferences` (keyword tool) and verify it still works unchanged
2. Call `listPreferenceSlugs` and verify all tools (including new ones) appear in the tools list

---

## Next Steps (post-v1)

These are the recommended follow-ups from this plan, ordered by value:

1. **Agent DTO layer + slug-targeted queries** — Decouple agent outputs from `EnrichedPreference[]` repo shape; add `findActiveByDefinitionSlugs()` to avoid fetching all preferences and filtering in memory
2. **GraphQL + Frontend integration** — Surface agents through the web UI for easier testing and product use. No agent changes needed — internal-first design means this is purely additive:

   **Backend (GraphQL)**:
   - Add `SmartSearchResolver` in `src/modules/preferences/` (or a new `src/modules/agents-graphql/`) with a query like `smartSearchPreferences(query: String!, locationId: String, includeSuggestions: Boolean): SmartSearchResult`
   - Add `SchemaConsolidationResolver` with a query like `consolidateSchema(scope: ConsolidationScope): ConsolidationResult`
   - Define GraphQL output types (`SmartSearchResult`, `ConsolidationResult`, `ConsolidationGroup`) — these map directly from the agent output types
   - Resolvers inject agents directly (not via MCP), protected by `GqlAuthGuard` (same as existing resolvers like `VertexAiResolver`)

   **Frontend (Next.js)**:
   - Add GraphQL queries in `apps/web/lib/generated/graphql.ts` (via codegen)
   - Add a search UI component under `apps/web/app/dashboard/preferences/` — text input that calls `smartSearchPreferences`, displays matched definitions and preferences
   - Add a schema consolidation view under `apps/web/app/dashboard/schema/` — button to run analysis, display consolidation groups with suggested actions
   - Wire both through Apollo Client (already set up in `apps/web/lib/apollo-client.ts`)

   **Testing benefit**: The web UI provides a visual, interactive way to test agents against real data without needing an MCP client. This is the easiest path to manual verification once v1 agents are working
3. **Request-object port shape** — Consolidate `generateStructured` / `generateStructuredWithFile` into a single `generateStructured({ prompt, schema, files?, operationName, retries })` to avoid method proliferation
4. **Per-call model selection** — Extend `VertexAiService` to accept a `modelId` per call, then add `modelId` to `AiStructuredOptions`
5. **README docs cleanup** — Update root README to reflect monorepo layout and agent architecture

---

## `AGENTS.md` — Content to Populate

```markdown
# Agent Architecture — Context Router

Agents are deterministic, multi-step workflow services that combine DB reads with a
single structured AI invocation. They are plain NestJS @Injectable() classes.
No external orchestration framework. Business logic belongs in agents, not in MCP tool classes.

## Principles
- Agents are read-only. Writes always go through PreferenceService / PreferenceDefinitionService.
- AI receives only catalog slug metadata, never user preference values.
- All AI-returned slugs are validated against DB ground truth before use.
- One structured AI call per top-level agent. Add a subagent only when logic is reused in 2+ agents.
- Agents log internal steps via AgentStepRecorder (kind: db|ai|validation|subagent) for tracing — steps are not returned to callers.

## AI Port
Agents inject 'AiStructuredOutputPort'.
It handles JSON parsing, fence stripping, Zod validation, and retries internally.

## Directory
src/modules/agents/
├── agents.module.ts
├── shared/
│   ├── agent.interface.ts         — IAgent, AgentStep (no AgentResult wrapper — agents throw or return typed data)
│   └── agent-step-recorder.ts    — timing utility
└── preferences/
    ├── preference-search/         — PreferenceSearchAgent
    └── schema-consolidation/      — SchemaConsolidationAgent

## MCP Tool Registry
| MCP Tool                | Agent                      | Read-only |
|-------------------------|----------------------------|-----------|
| smartSearchPreferences  | PreferenceSearchAgent      | yes       |
| consolidateSchema       | SchemaConsolidationAgent   | yes       |

Legacy tool `searchPreferences` (keyword matching) is kept for compatibility.

## Adding a New Agent
1. Create src/modules/agents/<domain>/<name>/ with .agent.ts, .prompt.ts, .schema.ts
2. Register in AgentsModule
3. Create thin MCP tool implementing McpToolInterface in src/mcp/tools/
4. Register in McpModule (auto-registers in registry)
5. Write e2e test in test/e2e/agents.e2e-spec.ts
6. Update this file and docs/agents/adding-agent-modules.md

## PreferenceSearchAgent
Natural language → relevant definitions + matching user preference values.
Steps: loadCatalog (db) → aiSlugIdentification (ai) → slugValidation (validation) → fetchPreferences (db)

## SchemaConsolidationAgent
User definitions → advisory consolidation groups. No writes.
Steps: loadDefinitions (db) → aiConsolidationAnalysis (ai) → groupValidation (validation)
Short-circuits with empty result if fewer than 2 definitions exist.
```
