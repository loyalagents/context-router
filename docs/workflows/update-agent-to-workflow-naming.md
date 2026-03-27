# Plan: Rename "Agent" to "Workflow" Throughout Backend

## Context

The agentic workflow layer was built under `src/modules/agents/` with names like `IAgent`, `AgentStepRecorder`, `PreferenceSearchAgent`, etc. These are actually **workflows**, not agents. The docs already acknowledge this rename is planned. This PR performs the rename with no behavioral changes. The one type-level change is renaming the `'subagent'` step-kind literal to `'subworkflow'` — this has no runtime impact (unused today) but keeps the contract consistent.

## Approach

Use `git mv` for all file/directory renames (preserves git history), then update file contents, running tests at checkpoints. End with a grep-based sweep to catch any stragglers.

---

### Step 1: Directory & file renames (`git mv`)

From `apps/backend/`:

```
# Directory
git mv src/modules/agents src/modules/workflows

# Files within
git mv src/modules/workflows/agents.module.ts src/modules/workflows/workflows.module.ts
git mv src/modules/workflows/shared/agent.interface.ts src/modules/workflows/shared/workflow.interface.ts
git mv src/modules/workflows/shared/agent-step-recorder.ts src/modules/workflows/shared/workflow-step-recorder.ts
git mv src/modules/workflows/preferences/preference-search/preference-search.agent.ts src/modules/workflows/preferences/preference-search/preference-search.workflow.ts
git mv src/modules/workflows/preferences/preference-search/preference-search.agent.spec.ts src/modules/workflows/preferences/preference-search/preference-search.workflow.spec.ts
git mv src/modules/workflows/preferences/schema-consolidation/schema-consolidation.agent.ts src/modules/workflows/preferences/schema-consolidation/schema-consolidation.workflow.ts
git mv src/modules/workflows/preferences/schema-consolidation/schema-consolidation.agent.spec.ts src/modules/workflows/preferences/schema-consolidation/schema-consolidation.workflow.spec.ts

# E2E test
git mv test/e2e/agents.e2e-spec.ts test/e2e/workflows.e2e-spec.ts
```

Files NOT renamed (no "agent" in their names/content): `*.prompt.ts`, `*.schema.ts`

No `tsconfig.json` or `jest.config.js` changes needed — both use wildcards.

---

### Step 2: Update shared contracts

**`workflow.interface.ts`** (was `agent.interface.ts`):
- `AgentInput` → `WorkflowInput`
- `AgentStep` → `WorkflowStep`
- `IAgent` → `IWorkflow`
- `'subagent'` step kind → `'subworkflow'` (type-level only, unused at runtime — keeps contract consistent with rename)

**`workflow-step-recorder.ts`** (was `agent-step-recorder.ts`):
- `AgentStepRecorder` → `WorkflowStepRecorder`
- Import `WorkflowStep` from `./workflow.interface`

---

### Step 3: Update PreferenceSearchWorkflow

**`preference-search.workflow.ts`**:
- `PreferenceSearchAgent` → `PreferenceSearchWorkflow`
- `PreferenceSearchAgentInput` → `PreferenceSearchWorkflowInput`
- `PreferenceSearchAgentOutput` → `PreferenceSearchWorkflowOutput`
- Update imports + `implements IWorkflow`, `new WorkflowStepRecorder(...)`

**`preference-search.workflow.spec.ts`**: update class refs + describe block

---

### Step 4: Update SchemaConsolidationWorkflow

Same pattern as Step 3 for `schema-consolidation.workflow.ts` and `.spec.ts`.

---

### Step 5: Update WorkflowsModule

**`workflows.module.ts`** (was `agents.module.ts`):
- `AgentsModule` → `WorkflowsModule`
- Update imports to reference new workflow filenames

---

### CHECKPOINT 1: Unit tests
```bash
cd apps/backend && pnpm test:unit
```

---

### Step 6: Update external consumers (3 files)

**`src/mcp/mcp.module.ts`**:
- `AgentsModule` → `WorkflowsModule`, update import path

**`src/mcp/tools/smart-search.tool.ts`**:
- `PreferenceSearchAgent` → `PreferenceSearchWorkflow`
- `this.agent` → `this.workflow`, update import path

**`src/mcp/tools/schema-consolidation.tool.ts`**:
- `SchemaConsolidationAgent` → `SchemaConsolidationWorkflow`
- `this.agent` → `this.workflow`, update import path

---

### Step 7: Update E2E test content

**`test/e2e/workflows.e2e-spec.ts`**:
- `describe('Agent MCP Tools (e2e)')` → `describe('Workflow MCP Tools (e2e)')`
- Clean up residual "agent" wording in test data/comments (e.g. `'agent-user-b@example.com'` → `'workflow-user-b@example.com'`, `'Agent'` firstName → `'Workflow'`, comment references)

---

### CHECKPOINT 2: Full test suite (requires DB)
```bash
cd apps/backend && pnpm test:e2e
```
This runs `test:db:up`, `test:db:migrate`, then `test:e2e:tests-only`. It validates NestJS DI wiring is correct (module imports, provider/export names all match) and the full MCP-to-workflow integration.

If DB is already running, can run layers independently:
```bash
pnpm test:unit                    # no DB needed
pnpm test:integration             # needs DB
pnpm test:e2e:tests-only          # needs DB
```

---

### Step 8: Update documentation

**File renames** (via `git mv`, from repo root):
```
git mv docs/agents docs/workflows
git mv docs/workflows/adding-agent-modules.md docs/workflows/adding-workflow-modules.md
git mv docs/workflows/adding-agent-modules-v1-summary.md docs/workflows/adding-workflow-modules-v1-summary.md
```

**Content updates — symbols, file paths, and code examples**:
- **`docs/workflows/adding-workflows.md`** — remove the "naming note" (rename is done); update code example symbols (`AgentStepRecorder` → `WorkflowStepRecorder`, `IAgent` → `IWorkflow`, etc.)
  - Note: the "When a Workflow Becomes an Agent" section (line ~148) uses "agent" deliberately to contrast with "workflow" — leave that prose as-is
- **`docs/workflows/adding-workflow-step-by-step.md`** — extensive updates needed:
  - Headings: "Define the Agent's Input and Output Types" → "...Workflow's..." (line 9), "Implement the Agent" → "Implement the Workflow" (line 162)
  - Code examples: all import paths (`modules/agents/` → `modules/workflows/`), type names (`AgentInput`, `IAgent`, `AgentStepRecorder`), class names (`CategorySuggestionAgent` → `CategorySuggestionWorkflow`), file names (`.agent.ts` → `.workflow.ts`, `.agent.spec.ts` → `.workflow.spec.ts`)
  - Prose: "the agent's validation", "agent should handle it", "agent surfaces it", etc. → "the workflow's...", "workflow should..."
  - Commands: `agents.e2e-spec.ts` → `workflows.e2e-spec.ts`
  - Checklist items (line ~379): "Agent input/output types", "Agent validates", "Agent uses AgentStepRecorder", "Agent is registered in agents.module.ts" → workflow equivalents
- **`docs/workflows/adding-workflow-modules.md`** — update all references
- **`docs/workflows/adding-workflow-modules-v1-summary.md`** — update references

---

### Step 9: Final grep sweep

Run a grep to verify no stragglers remain. The pattern covers all symbols in the rename map:
```bash
rg -n 'IAgent\b|AgentInput\b|AgentStep|AgentStepRecorder|AgentsModule|PreferenceSearchAgent|SchemaConsolidationAgent|modules/agents|\.agent\.(ts|spec)|subagent|adding-agent-modules' apps/backend/src apps/backend/test docs/workflows --glob '!update-agent-to-workflow-naming.md'
```

The `--glob '!update-agent-to-workflow-naming.md'` excludes the migration plan file itself (which lives under `docs/workflows/` after Step 8 and legitimately contains old names in its rename map).

Expected: zero matches. Any hits indicate missed renames — fix before committing.

---

### CHECKPOINT 3: Final full test run
```bash
cd apps/backend && pnpm test:unit && pnpm test:integration && pnpm test:e2e
```

---

## Complete rename map

| Old | New |
|-----|-----|
| `src/modules/agents/` | `src/modules/workflows/` |
| `agents.module.ts` | `workflows.module.ts` |
| `agent.interface.ts` | `workflow.interface.ts` |
| `agent-step-recorder.ts` | `workflow-step-recorder.ts` |
| `*.agent.ts` | `*.workflow.ts` |
| `*.agent.spec.ts` | `*.workflow.spec.ts` |
| `agents.e2e-spec.ts` | `workflows.e2e-spec.ts` |
| `docs/agents/` | `docs/workflows/` |
| `adding-agent-modules.md` | `adding-workflow-modules.md` |
| `adding-agent-modules-v1-summary.md` | `adding-workflow-modules-v1-summary.md` |
| `IAgent` | `IWorkflow` |
| `AgentInput` | `WorkflowInput` |
| `AgentStep` | `WorkflowStep` |
| `'subagent'` (step kind) | `'subworkflow'` |
| `AgentStepRecorder` | `WorkflowStepRecorder` |
| `AgentsModule` | `WorkflowsModule` |
| `PreferenceSearchAgent` | `PreferenceSearchWorkflow` |
| `PreferenceSearchAgentInput` | `PreferenceSearchWorkflowInput` |
| `PreferenceSearchAgentOutput` | `PreferenceSearchWorkflowOutput` |
| `SchemaConsolidationAgent` | `SchemaConsolidationWorkflow` |
| `SchemaConsolidationAgentInput` | `SchemaConsolidationWorkflowInput` |
| `SchemaConsolidationAgentOutput` | `SchemaConsolidationWorkflowOutput` |
| `this.agent` (MCP tools) | `this.workflow` |

## Files NOT changed
- `tsconfig.json` — `@modules/*` wildcard covers both
- `jest.config.js` — wildcard globs cover renamed files
- `app.module.ts` — doesn't import AgentsModule directly
- `AGENTS.md` / `CLAUDE.md` — unrelated to workflow module naming
- `*.prompt.ts`, `*.schema.ts` — no "agent" terminology in content
- `docs/workflows/adding-workflows.md` "When a Workflow Becomes an Agent" section — deliberate conceptual use of "agent"

## Verification
Run the full test suite (`cd apps/backend && pnpm test:unit && pnpm test:integration && pnpm test:e2e`). All existing unit, integration, and e2e tests should pass unchanged in behavior. The final grep sweep (Step 9) ensures no textual stragglers remain.
