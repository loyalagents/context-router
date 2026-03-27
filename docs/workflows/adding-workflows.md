# Adding Workflows to the Repo

## One Sentence

A workflow is a typed, deterministic data transform — typed input in, typed output out — where every AI response is validated against ground truth before it reaches the caller.


## One Paragraph

The core abstraction is `IWorkflow<TInput, TOutput>`: an `@Injectable()` NestJS service with a single `run()` method. What we build are **strict workflows**: deterministic sequences with fixed steps, single AI calls, read-only data access, and two layers of validation (structural via Zod, semantic against the database). Any caller — MCP tool, GraphQL resolver, cron job, or another workflow — injects the service and calls `run()`. The workflow doesn't know or care who called it. Alongside this, we provide shared infrastructure: an `AiStructuredOutputPort` for getting typed data from a language model (parsing, retries, correction), a `WorkflowStepRecorder` for observability (all workflows should use it), and an MCP tool registry for exposing workflows over MCP. The AI port and MCP registry are optional — not every workflow needs AI or MCP exposure. The contract that matters is: typed input, validated output, no surprises.

```
                    ┌───────────┐  ┌────────────┐  ┌───────────┐
                    │ MCP Tool  │  │  GraphQL   │  │  Another  │
                    │           │  │  Resolver  │  │  Workflow  │  ... any caller
                    └─────┬─────┘  └─────┬──────┘  └─────┬─────┘
                          │              │               │
                          └──────────────┼───────────────┘
                                         │ workflow.run(typedInput)
                                         ▼
              ┌─────────────────────────────────────────────────────────┐
              │  Strict Workflow                                        │
              │                                                        │
              │  Implements IWorkflow<TInput, TOutput>                    │
              │  Fixed steps, deterministic, read-only, validated       │
              │                                                        │
              │  e.g. current workflows:                                │
              │  ┌──────────┐   ┌──────────┐   ┌──────────────────┐   │
              │  │ 1. Load  │──▶│ 2. AI    │──▶│ 3. Validate      │   │
              │  │    data  │   │    call   │   │    against DB    │   │
              │  └──────────┘   └──────────┘   └──────────────────┘   │
              │  (steps vary per workflow)│
              │                                                        │
              │  ──▶ typed, validated output                           │
              └──────────┬─────────────────┬───────────────────────────┘
                         │                 │
            (if needed)  │    (if needed)  │
                         ▼                 ▼
                 ┌──────────────┐  ┌──────────────────────────┐
                 │   Database   │  │  AI Structured Output    │
                 │   (Prisma)   │  │  Port                    │
                 └──────────────┘  │                          │
                                   │  prompt ──▶ model        │
                                   │    ──▶ parse + validate  │
                                   │    ──▶ retry on failure  │
                                   │    ──▶ typed result      │
                                   └──────────────────────────┘
```

## One Page

### Strict Workflows: What We Build and Why

We build **strict workflows**. The `IWorkflow` interface allows anything inside `run()`, but what we actually build — and what contributors should build by default — follows a disciplined set of conventions:

| Constraint | What it means | Why it matters |
|---|---|---|
| **Fixed step sequence** | Steps and their order are hardcoded. Every run executes the same steps. | Testability — mock inputs produce deterministic outputs. Debuggability — the step log tells you exactly what happened. |
| **Single AI call** | One prompt, one response. Port retries are for parse failures, not for refining answers. | Cost predictability. No unbounded loops. Easy to test with a single mock return value. |
| **Read-only** | Workflows query data and return results. No mutations. | Caller trust — calling `run()` has no side effects. Any caller (query resolver, another workflow) can invoke it safely. |
| **Two-layer validation** | Zod validates shape (in the port). The workflow validates meaning (against database state). | AI output is untrusted. Zod catches "this isn't valid JSON." The workflow catches "this slug doesn't exist." The worst case is an empty result, never a corrupt one. |
| **Pure prompt builders** | A plain function: data in, string out. No injected services, no side effects. | Reviewable, diffable, testable independently of the workflow. |
| **Hallucination-safe** | Every identifier the AI returns is checked against a known set. Unknown values are dropped. | The output only contains things that provably exist in the system. |

**Why strictness matters:**

- **Testability** is the biggest win. Fixed steps + mocked AI port = deterministic tests. Every edge case (hallucinated slugs, empty results, duplicates) can be tested with a three-line mock setup. Non-deterministic or branching workflows would require probabilistic assertions or complex mocking.
- **Caller trust** is second. Code that calls `run()` knows what it's getting: no side effects, no writes, predictable execution. This compounds when workflows compose — a workflow calling another workflow inherits the callee's guarantees.
- **Safety against AI unpredictability** is third. The model can hallucinate, repeat itself, return wrong ordering, or ignore instructions entirely. Two-layer validation means the damage is bounded: bad AI output produces empty or reduced results, never corrupt data.

### Validation: The Most Important Pattern

Validation happens at two distinct levels and both are required:

**Inside the AI port (structural).** Before the workflow ever sees the response, the `AiStructuredOutputPort` validates that raw model output is parseable JSON conforming to the Zod schema. If it fails, the port retries with a correction prompt. The workflow only receives data that has passed structural validation.

**Inside the workflow (semantic).** The workflow validates the *content* against database state. Zod can tell you "this is an array of strings" but not "these strings are real slugs that exist in the system." This is where hallucination filtering, deduplication, group membership checks, scope validation, and ordering all happen.

Zod validates shape. The workflow validates meaning. Both are required because the model can return perfectly structured nonsense.

### Recording Steps

Every workflow should use `WorkflowStepRecorder` for observability. Create a fresh recorder per `run()` call (so concurrent executions don't interleave), then wrap each step in `recorder.record(name, kind, fn)`:

```typescript
async run(input: MyWorkflowInput): Promise<MyWorkflowOutput> {
  const recorder = new WorkflowStepRecorder('MyWorkflow');

  const snapshot = await recorder.record('loadDefinitions', 'db', () =>
    this.snapshotService.getSnapshot(input.userId),
  );

  const aiResult = await recorder.record('aiCall', 'ai', () =>
    this.aiPort.generateStructured(prompt, schema),
  );

  const validated = await recorder.record('validateSlugs', 'validation', () =>
    this.filterHallucinatedSlugs(aiResult, snapshot),
  );

  recorder.logSummary();
  // => "Completed 3 steps in 1245ms: loadDefinitions → aiCall → validateSlugs"

  return validated;
}
```

Step kinds: `'db'`, `'ai'`, `'validation'`, `'subworkflow'`. The recorder doesn't control flow — you tell it what you did; it doesn't tell you what to do.

### Who Can Call a Workflow

A workflow is an `@Injectable()` NestJS service. Anything that can inject it can call `run()`.

- **MCP tools** — map MCP arguments to typed input, call `run()`, format output as `CallToolResult`. The tool handles transport (auth, error formatting); the workflow handles domain logic.
- **GraphQL resolvers** — map GraphQL arguments to typed input, map output to a GraphQL type. No changes to the workflow.
- **Other workflows** — inject and call `run()` as a sub-step. The step recorder's `'subworkflow'` kind tracks it.
- **Cron jobs, scripts, event handlers** — same pattern.

The MCP tool registry (`MCP_TOOLS` token + `McpService` dispatch map) is specifically for MCP exposure. Registration is explicit: add the tool class to `mcp.module.ts` providers and the `MCP_TOOLS` factory array. Duplicate names fail at startup.

### Safety and Composition

When workflows call other workflows, **safety guarantees compose downward**. A caller inherits the weakest guarantee of anything it calls.

If workflow A (read-only) calls workflow B (read-only), the chain is read-only. If workflow A calls workflow C (writes to DB), then A is also non-strict — it has side effects through C.

This is why separation matters. Keep the analysis as a strict, read-only workflow. Put the write in a separate workflow or in the caller. A caller that only needs analysis stays strict. A caller that needs action composes both explicitly.

### What Constraints Can Be Relaxed (and When)

The constraints are not all-or-nothing. Some are load-bearing; others can be relaxed for specific use cases.

**Always keep these:**
- Typed input and output — the `run()` contract. Without it, testing and composition break.
- Validate AI output against ground truth — whether one AI call or five, every identifier gets checked.
- Pure prompt builders — even with multiple prompts, each is a deterministic function of its inputs.
- Step recorder for observability — every workflow should record its steps. More steps means more need for visibility, not less.

**Can relax with justification:**
- **Single AI call** — a "plan then execute" workflow makes two calls: classify first, then do detailed work with targeted context. Cheaper and more accurate than one massive prompt for some use cases.
- **Read-only** — when workflows need to act (archive duplicates, apply inferred values). The constraint becomes: writes must be explicit, logged, and reversible where possible.
- **Fixed step sequence** — a workflow that branches based on the first AI call's classification. Still deterministic given the same AI response, but not the same steps every time.

The pattern: start with the strictest version that works. Relax one constraint at a time with a specific reason. "I need two AI calls because one prompt would be 10k tokens and accuracy drops" is a good reason. "It would be cool to loop" is not.

### When a Workflow Becomes an Agent

A workflow becomes an agent when the **model** decides what to do next. If the step sequence is determined by the code — even if it branches, loops, or calls sub-workflows — it's a workflow. If the model selects its own next action (tool use, chain-of-thought with action selection, "should I search again or return?"), that's an agent.

We are nowhere near that line, and we shouldn't cross it without a strong reason. Agents are harder to test, harder to predict cost for, and harder to debug. Most use cases that feel like they need an agent can be solved with small workflows composed by a caller.

### What Exists vs. What's Possible

**Exists and proven:**
- Two strict workflows (preference search, schema consolidation)
- `AiStructuredOutputPort` with Zod validation and correction retry
- `WorkflowStepRecorder` for step-level observability
- MCP tool registry with explicit registration
- Two-layer validation (structural + semantic)
- E2E and unit test patterns for mocked AI workflows

**Architecturally possible but unproven:**
- Multi-step AI calls (plan → execute)
- Workflow composition (workflow A calls workflow B)
- Write operations from within a workflow
- GraphQL or REST as transport surfaces
- Different AI providers behind the port
- Streaming responses

These are extension points, not established patterns. The architecture doesn't prevent them, but they haven't been built or validated. Treat them as future-capable, not as first-class guidance.

### Adding a New Workflow

For step-by-step instructions with code examples, see [adding-workflow-step-by-step.md](adding-workflow-step-by-step.md).
