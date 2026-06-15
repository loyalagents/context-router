# MCP Scoring Brainstorm

- Status: brainstorming
- Last updated: 2026-06-14
- Scope: evaluating Codex/Claude Code style agents using MCP/tool access as an
  end-to-end eval runner

## Goal

Design an evaluation path where an MCP-capable agent can do the work a user or
product flow would do:

```text
fixture user + corpus documents
  -> agent receives task and tool access
  -> agent uploads/reads documents and writes backend memory
  -> exporter snapshots stored-preferences.json
  -> form runner or agent fills the form
  -> scorer writes database/form/combined reports
```

The purpose is to evaluate whether an agent such as Claude Code or Codex can
use the available tools to complete the user's real goal: produce correct active
memory and, ultimately, correctly filled forms.

## Schema Modes

The MCP runner should support both schema modes.

### Closed / Known Schema

Known-schema MCP evaluation starts with target definitions already available.
This measures whether the agent can:

- understand the corpus documents
- choose the right existing memory slots
- write correct active values
- avoid writing intentionally missing values
- support successful form fill

This is comparable to the known-schema backend ingestor, but the producer is an
agent using tools instead of the product upload flow.

### Open Schema

Open-schema MCP evaluation starts without eval-specific target definitions. The
agent must decide whether to create definitions/slugs and then write values.

This measures agent-driven schema discovery:

- can the agent identify useful facts from documents?
- can it create definitions that are useful enough for downstream form fill?
- can it avoid overfitting to weird one-off slugs?
- can it avoid hallucinating values for facts that are absent?

Open schema should still be scored primarily by task success, not by exact slug
string matching. Slug quality is important, but it is secondary to whether the
system can store usable values and fill the form.

## Form Fill Decision

We need to decide who fills the form in the MCP eval.

### Option A: Backend Fills The Form

Flow:

```text
MCP agent writes memory
  -> exporter snapshots memory
  -> backend form-fill endpoint fills form from active memory
  -> form scorer evaluates filled-form.json
```

Pros:

- isolates the agent's job to document understanding, schema creation, and
  memory writing
- tests whether agent-created memory is useful to the existing product form-fill
  path
- reuses the current form-fill scorer
- easier to compare against known-schema backend ingestion

Cons:

- does not measure whether the agent itself can fill forms
- failures may come from backend form-fill behavior rather than agent memory
  quality

### Option B: Agent Fills The Form

Flow:

```text
MCP agent reads documents / writes memory
  -> agent fills the form directly through tools or a form API
  -> form scorer evaluates filled-form.json
```

Pros:

- evaluates the full agent workflow a user may actually delegate
- can test whether the agent uses memory, documents, or both to complete the
  form
- useful for comparing Claude/Codex behavior directly

Cons:

- harder to attribute failures: the issue could be memory writing, form
  interpretation, tool use, PDF handling, or direct reasoning
- may bypass backend memory if the agent fills directly from documents
- requires a clear artifact contract for how agent-filled forms become
  `filled-form.json`

### Likely First Cut

Start with **backend fills the form** after the MCP agent writes memory. This
keeps attribution clearer:

```text
agent document/tool work
  -> stored active memory
  -> backend form fill
  -> deterministic scorer
```

Then add an agent-filled-form variant once the memory-writing eval is stable.

## Scoring Shape

The same scorer stack should be reused wherever possible.

### Database Score

Primary question: did the agent create active stored memory that contains the
expected values and avoids absent values?

For known schema:

- use the accepted slug map for strict correctness
- value recovery and strict slug/value correctness are both meaningful

For open schema:

- primary automated score should emphasize value recovery and abstention
- slug correctness should be diagnostic at first
- accepted aliases can count as correct
- novel slugs should be surfaced for human or LLM review

Useful classifications:

- expected value found anywhere in active memory
- expected value found under accepted/canonical slug
- expected value found under a novel slug
- accepted slug populated with wrong value
- intentionally missing value absent
- intentionally missing value hallucinated anywhere
- intentionally missing accepted key populated

### Form Score

Primary question: did the final form contain the correct values and blanks?

The form score should remain the most important headline metric because the user
ultimately cares about correct form completion.

For MCP/open-schema work, form success may be a better signal than exact schema
success. If the agent creates `employee.full_name` instead of
`profile.full_name`, but the backend can fill the form correctly from it, that is
useful. If the form cannot be filled, the schema may not be useful enough even if
the stored value is correct.

## Artifact Needs

Existing artifacts:

- `stored-preferences.json`
- `database-score-report.json`
- `filled-form.json`
- `form-fill-score-report.json`
- `combined-score-report.json`
- `evaluation-run.json`

Likely new or extended artifacts:

- `mcp-agent-run.json`
  - model/agent name
  - prompt/task
  - schema mode
  - tool list
  - reset/setup settings
  - documents provided
  - high-level action log or references to tool logs
  - exported artifact paths
- definition/schema snapshot for open-schema scoring
  - slug
  - display name
  - description
  - value type
  - owner/backend user

For open-schema scoring, slug meaning may live in the definition name or
description, not only in the slug string. The exporter may need to include
definition metadata or write a companion schema artifact.

## Runner Responsibilities

The MCP runner should handle repeatable setup and artifact boundaries, not judge
the model inline.

Possible runner flow:

```text
load fixture
  -> reset/isolate backend user
  -> choose schema mode
  -> optionally create known-schema definitions
  -> give agent task, document paths, and tool access
  -> wait for agent completion
  -> export stored preferences
  -> optionally run backend form fill
  -> score database/form/combined
  -> write mcp-agent-run.json
```

The scorer should stay deterministic. Any LLM judging of novel slugs should be a
separate diagnostic layer, not hidden inside the primary score.

## Open Questions

- Should the first MCP eval require the agent to write backend memory, or can it
  fill the form directly from documents?
- Should the MCP task expose the target form upfront, or only the documents and
  a general "prepare this user's memory" instruction?
- Should the agent be allowed to inspect existing form field maps?
- Should the first open-schema score count novel but useful slugs as correct, or
  only as "value recovered under novel slug"?
- Do we need a deterministic definition exporter before starting open-schema
  MCP scoring?
- How much tool logging should be preserved for review without making artifacts
  too large?

## Recommended Next Step

Start with a known-schema MCP runner that asks the agent to populate memory from
the generated corpus, then let the backend fill the form. This reuses the
current scorer and gives a clean comparison against the known-schema backend
ingestor.

After that, run the same shape in open-schema mode and decide how much slug
review automation is needed based on real agent-created definitions.
