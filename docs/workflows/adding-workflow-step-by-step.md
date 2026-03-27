# Adding a Workflow: Step by Step

This guide walks through adding a new AI-backed workflow end to end. It uses a hypothetical "category suggestion" workflow as the running example — given a preference value, suggest which category it belongs to. Adapt the specifics to your domain.

## Prerequisites

Read [adding-workflows.md](adding-workflows.md) first for principles and tradeoffs. This doc is the mechanical "how"; that doc is the "why."

## Step 1: Define the Workflow's Input and Output Types

Create the workflow file and start with the interfaces. These are the contract — everything else follows from them.

```
src/modules/workflows/preferences/category-suggestion/category-suggestion.workflow.ts
```

```typescript
import { WorkflowInput } from '../../shared/workflow.interface';

export interface CategorySuggestionWorkflowInput extends WorkflowInput {
  value: string;
  currentSlug?: string;
}

export interface CategorySuggestionWorkflowOutput {
  suggestedCategory: string;
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
  reasoning: string;
}
```

Every workflow input extends `WorkflowInput` (which provides `userId`). The output is what the caller gets back — keep it typed and specific. Don't pass raw AI output through.

## Step 2: Define the Zod Schema for the AI Response

This is the shape you tell the model to return. It's often close to your output type but not identical — the workflow may transform, enrich, or filter the AI response before producing its output.

```
src/modules/workflows/preferences/category-suggestion/category-suggestion.schema.ts
```

```typescript
import { z } from 'zod';

export const CategorySuggestionResponseSchema = z.object({
  suggestedCategory: z.string(),
  confidence: z.enum(['HIGH', 'MEDIUM', 'LOW']),
  reasoning: z.string(),
});

export type CategorySuggestionResponse = z.infer<typeof CategorySuggestionResponseSchema>;
```

Keep the schema as the minimum viable contract. Only require what the workflow needs to proceed. The `AiStructuredOutputPort` uses this schema for both Zod validation and correction-retry prompts.

## Step 3: Write the Prompt Builder

Pure function. No injected services. Takes data, returns a string.

```
src/modules/workflows/preferences/category-suggestion/category-suggestion.prompt.ts
```

```typescript
export function buildCategorySuggestionPrompt(
  categoriesJson: string,
  value: string,
  currentSlug?: string,
): string {
  const context = currentSlug
    ? `\nThe value is currently stored under slug "${currentSlug}".`
    : '';

  return `You are a preference categorization assistant. Given a preference value and a list of available categories, suggest the best category.

Available categories:
${categoriesJson}
${context}
Preference value: "${value}"

Task:
- Suggest the single best category for this value.
- Return ONLY a category that exists in the list above.
- Indicate your confidence: HIGH (obvious match), MEDIUM (reasonable but ambiguous), LOW (best guess).

Respond with JSON only (no markdown code blocks):
{
  "suggestedCategory": "category_name",
  "confidence": "HIGH" | "MEDIUM" | "LOW",
  "reasoning": "Brief explanation"
}`;
}
```

Include explicit instructions to return only known values — the model respects these most of the time, and the workflow's validation catches the rest. Always tell the model to respond with JSON only and no markdown fences (the port strips fences as a fallback, but explicit instruction reduces the need).

## Step 4: Write the Unit Tests

Tests come before the workflow implementation. Mock `AiStructuredOutputPort` and any data services. Test the workflow's behavior, not the AI's.

```
src/modules/workflows/preferences/category-suggestion/category-suggestion.workflow.spec.ts
```

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { Logger } from '@nestjs/common';
import { CategorySuggestionWorkflow } from './category-suggestion.workflow';
import { AiStructuredOutputPort } from '../../../../domains/shared/ports/ai-structured-output.port';
import { PreferenceSchemaSnapshotService } from '../../../preferences/preference-definition/preference-schema-snapshot.service';

describe('CategorySuggestionWorkflow', () => {
  let workflow: CategorySuggestionWorkflow;
  let mockAiPort: jest.Mocked<AiStructuredOutputPort>;
  let mockSnapshotService: jest.Mocked<PreferenceSchemaSnapshotService>;

  beforeEach(async () => {
    mockAiPort = {
      generateStructured: jest.fn(),
      generateStructuredWithFile: jest.fn(),
    };
    mockSnapshotService = { getSnapshot: jest.fn() } as any;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CategorySuggestionWorkflow,
        { provide: 'AiStructuredOutputPort', useValue: mockAiPort },
        { provide: PreferenceSchemaSnapshotService, useValue: mockSnapshotService },
      ],
    }).compile();

    workflow = module.get(CategorySuggestionWorkflow);
    jest.spyOn(Logger.prototype, 'log').mockImplementation();
    jest.spyOn(Logger.prototype, 'debug').mockImplementation();
  });

  afterEach(() => jest.restoreAllMocks());

  it('should return suggested category for a valid AI response', async () => {
    // Mock data and AI response, assert workflow output
  });

  it('should reject a hallucinated category not in the snapshot', async () => {
    // AI returns a category that doesn't exist — workflow should handle it
  });

  it('should propagate errors from AI port', async () => {
    mockAiPort.generateStructured.mockRejectedValue(new Error('AI failed'));
    await expect(workflow.run({ userId: 'u1', value: 'test' })).rejects.toThrow('AI failed');
  });
});
```

Key test cases to always include:
- **Happy path**: valid AI response, correct output.
- **Hallucination filtering**: AI returns an identifier that doesn't exist in the database. Verify the workflow handles it (drops, clears, or rejects).
- **Edge cases**: empty input, single item, no matches.
- **Error propagation**: AI port throws, workflow surfaces it.

Run your tests: `pnpm --filter backend exec jest src/modules/workflows/preferences/category-suggestion/category-suggestion.workflow.spec.ts --runInBand`

## Step 5: Implement the Workflow

Now fill in the workflow class. Follow the pattern: load data, call AI, validate, return.

```typescript
import { Injectable, Inject } from '@nestjs/common';
import { WorkflowInput, IWorkflow } from '../../shared/workflow.interface';
import { WorkflowStepRecorder } from '../../shared/workflow-step-recorder';
import { AiStructuredOutputPort } from '../../../../domains/shared/ports/ai-structured-output.port';
import { PreferenceSchemaSnapshotService } from '../../../preferences/preference-definition/preference-schema-snapshot.service';
import { CategorySuggestionResponseSchema } from './category-suggestion.schema';
import { buildCategorySuggestionPrompt } from './category-suggestion.prompt';

@Injectable()
export class CategorySuggestionWorkflow
  implements IWorkflow<CategorySuggestionWorkflowInput, CategorySuggestionWorkflowOutput>
{
  constructor(
    @Inject('AiStructuredOutputPort')
    private readonly aiStructuredPort: AiStructuredOutputPort,
    private readonly snapshotService: PreferenceSchemaSnapshotService,
  ) {}

  async run(input: CategorySuggestionWorkflowInput): Promise<CategorySuggestionWorkflowOutput> {
    const recorder = new WorkflowStepRecorder('CategorySuggestionWorkflow');

    // Step 1: Load known categories
    const snapshot = await recorder.record('loadCategories', 'db', () =>
      this.snapshotService.getSnapshot(input.userId),
    );
    const knownCategories = new Set(snapshot.definitions.map((d) => d.category));

    // Step 2: AI categorization
    const categoriesJson = JSON.stringify([...knownCategories]);
    const prompt = buildCategorySuggestionPrompt(
      categoriesJson, input.value, input.currentSlug,
    );

    const aiResult = await recorder.record('aiCategorization', 'ai', () =>
      this.aiStructuredPort.generateStructured(
        prompt,
        CategorySuggestionResponseSchema,
        { operationName: 'categorySuggestion.categorize' },
      ),
    );

    // Step 3: Validate — ensure the suggested category actually exists
    const validatedCategory = await recorder.record('validation', 'validation', async () => {
      if (!knownCategories.has(aiResult.suggestedCategory)) {
        return { ...aiResult, suggestedCategory: 'unknown', confidence: 'LOW' as const };
      }
      return aiResult;
    });

    recorder.logSummary();
    return validatedCategory;
  }
}
```

Points to follow:
- Inject `AiStructuredOutputPort` via the string token `'AiStructuredOutputPort'`.
- Wrap every step in `recorder.record(name, kind, fn)`. Use `'db'` for data loads, `'ai'` for model calls, `'validation'` for post-processing.
- Validate the AI result against known data. Never pass AI identifiers through to the output without checking.
- Call `recorder.logSummary()` before returning.
- Pass `operationName` to `generateStructured` — it appears in error logs and makes debugging easier.

Run your tests again. They should pass.

## Step 6: Register in the Workflows Module

Add the workflow to `src/modules/workflows/workflows.module.ts`:

```typescript
import { CategorySuggestionWorkflow } from './preferences/category-suggestion/category-suggestion.workflow';

@Module({
  imports: [VertexAiModule, PreferenceDefinitionModule, PreferenceModule],
  providers: [PreferenceSearchWorkflow, SchemaConsolidationWorkflow, CategorySuggestionWorkflow],
  exports: [PreferenceSearchWorkflow, SchemaConsolidationWorkflow, CategorySuggestionWorkflow],
})
export class WorkflowsModule {}
```

The workflow must be in both `providers` and `exports` so the MCP module can inject it.

## Step 7: Create the MCP Tool

```
src/mcp/tools/category-suggestion.tool.ts
```

```typescript
import { Injectable, Logger } from '@nestjs/common';
import { Tool, CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { McpContext } from '../types/mcp-context.type';
import { McpToolInterface } from './base/mcp-tool.interface';
import { CategorySuggestionWorkflow } from '@modules/workflows/preferences/category-suggestion/category-suggestion.workflow';

@Injectable()
export class CategorySuggestionTool implements McpToolInterface {
  private readonly logger = new Logger(CategorySuggestionTool.name);

  readonly descriptor: Tool = {
    name: 'suggestCategory',
    description: 'Suggests the best category for a preference value.',
    inputSchema: {
      type: 'object',
      properties: {
        value: {
          type: 'string',
          description: 'The preference value to categorize',
        },
        currentSlug: {
          type: 'string',
          description: 'The current slug, if re-categorizing an existing preference',
        },
      },
      required: ['value'],
    },
    annotations: {
      readOnlyHint: true,
    },
  };

  readonly requiresAuth = true;

  constructor(private readonly workflow: CategorySuggestionWorkflow) {}

  async execute(args: unknown, context?: McpContext): Promise<CallToolResult> {
    const params = args as { value: string; currentSlug?: string };

    try {
      const result = await this.workflow.run({
        userId: context!.user.userId,
        value: params.value,
        currentSlug: params.currentSlug,
      });

      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    } catch (error) {
      this.logger.error(
        `Category suggestion failed for user ${context?.user?.userId}: ${error.message}`,
        error.stack,
      );
      return {
        content: [
          { type: 'text', text: JSON.stringify({ error: error.message }, null, 2) },
        ],
        isError: true,
      };
    }
  }
}
```

The tool class pattern is always the same:
- `descriptor`: MCP tool schema with `name`, `description`, `inputSchema`, and `annotations`.
- `requiresAuth`: `true` for any tool that accesses user data.
- `execute`: cast args, call `workflow.run()`, wrap result in `CallToolResult`. Catch errors and return `isError: true`.
- Set `readOnlyHint: true` in annotations if the tool doesn't write data.

## Step 8: Register the Tool in the MCP Module

In `src/mcp/mcp.module.ts`, add the tool to providers and to the `MCP_TOOLS` factory:

```typescript
import { CategorySuggestionTool } from './tools/category-suggestion.tool';

// In providers array:
CategorySuggestionTool,

// In the MCP_TOOLS factory:
{
  provide: MCP_TOOLS,
  useFactory: (list, search, definition, suggest, del, smartSearch, consolidation, catSuggest) =>
    [list, search, definition, suggest, del, smartSearch, consolidation, catSuggest],
  inject: [
    PreferenceListTool, PreferenceSearchTool, PreferenceDefinitionTool,
    PreferenceSuggestTool, PreferenceDeleteTool, SmartSearchTool,
    SchemaConsolidationTool, CategorySuggestionTool,
  ],
},
```

Both arrays (factory params and inject) must include the new tool. `McpService.onModuleInit()` will pick it up and register it in the dispatch map. If the tool name collides with an existing one, the app fails to start with a clear error.

## Step 9: Add E2E Tests

Add tests in `test/e2e/workflows.e2e-spec.ts` (or a new e2e spec file). These test the full path: MCP request → tool dispatch → workflow → mocked AI → response.

```typescript
describe('suggestCategory', () => {
  it('happy path — returns suggested category', async () => {
    mocks.structuredAi.generateStructured.mockResolvedValue({
      suggestedCategory: 'food',
      confidence: 'HIGH',
      reasoning: 'Value mentions dietary needs',
    });

    const res = await mcpPost('suggestCategory', { value: 'I am vegetarian' });
    const body = parseToolResult(res);

    expect(body.suggestedCategory).toBe('food');
    expect(body.confidence).toBe('HIGH');
  });
});
```

Run: `pnpm --filter backend exec jest test/e2e/workflows.e2e-spec.ts --runInBand`

## Checklist

Before opening a PR, verify:

- [ ] Workflow input/output types are defined and exported
- [ ] Zod schema matches the prompt's JSON instructions
- [ ] Prompt builder is a pure function with no injected dependencies
- [ ] Workflow validates every AI-generated identifier against database state
- [ ] Workflow uses `WorkflowStepRecorder` for all steps
- [ ] Workflow is registered in `workflows.module.ts` (providers + exports)
- [ ] MCP tool implements `McpToolInterface` with descriptor, requiresAuth, execute
- [ ] Tool is registered in `mcp.module.ts` (providers + MCP_TOOLS factory)
- [ ] Unit tests cover: happy path, hallucination filtering, edge cases, error propagation
- [ ] E2E tests cover the MCP round-trip with mocked AI
- [ ] All existing tests still pass: `pnpm --filter backend exec jest --runInBand`
