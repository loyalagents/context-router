# Brainstorming Notes: Full-Auto Preference Writes, MCP Shape, And Permissions

## Context

We want to push the preference system beyond the current review-first model.

The motivating product idea is:

- the machine should be able to find many preferences
- it should not be necessary for the user to manually review every single one
- machine-written values should stay visibly machine-written
- preference and definition changes should be auditable

At the same time, some design points are still unresolved:

- whether full-auto should use a new MCP tool or reuse existing ones
- how permissions should separate read, suggest, write, and definition changes
- whether an agent should be able to voluntarily lower its own power during a task

This document is a thinking artifact, not a final plan.

## Current Repo Behavior

Today the preference system is mostly optimized for human review:

- MCP suggestion flow is suggestion-first
- human GraphQL/manual flows can write active values directly
- unknown slugs trigger definition creation as a separate step, not an automatic one
- permission grants currently understand `READ` and `WRITE`, with slug and wildcard targets

The current system is therefore clean for “propose then review,” but awkward for “find a bunch of preferences and apply many of them automatically.”

## What We Already Think We Want

- Machine-written active preferences should remain labeled as machine-written.
- Future full-auto behavior should have an audit trail.
- It is acceptable for the machine to modify definitions as well as values.
- We do not want to treat “global” definitions as inherently special in the permission model.
- The permission system probably needs to evolve beyond the current coarse `READ` / `WRITE`.
- The endpoint and permission design still needs more discussion before implementation.

## Why This Ties Closely To Audit Log Work

Full-auto behavior will be much easier to trust if the system can answer:

- what changed
- who changed it
- why it changed
- whether the change came from a human, an MCP client, or a future workflow
- how to inspect or undo the change later

Because of that, the audit groundwork is a prerequisite or near-prerequisite for serious full-auto behavior.

See:

- `docs/preference-extraction/audit-log/audit-log-rough-plan.md`

## Open Design Area 1: MCP Tool Shape

### Question

Should full-auto behavior be exposed as:

- a new MCP tool
- an expanded version of an existing MCP tool
- or one unified endpoint whose behavior depends on permissions and call options

### Why A Separate Tool Was Appealing

Potential upside:

- very crisp semantics
- easy to reason about in code and tests
- safe coexistence with the current suggestion-only flow

Potential downside:

- extra surface area
- the model has to decide which tool to call
- two tools may partially overlap and create confusion

### Why A Single Tool Is Appealing

Potential upside:

- less tool-selection burden on the AI
- simpler public surface
- behavior can be shaped by permissions or call-time intent

Potential downside:

- semantics get blurrier
- harder to explain errors and required permissions
- harder to keep behavior predictable if the same tool can suggest, write, or define

### A Promising Middle Ground

One direction worth more thought:

- keep one higher-level tool for mutation
- let permissions determine the maximum allowed behavior
- let the caller voluntarily choose a lower-power mode for the current task

Example mental model:

- the agent has `WRITE` and `DEFINE` on `food.*`
- for one task, it chooses “existing slugs only”
- for another task, it chooses “allow definition creation”

This could reduce tool-surface complexity while still preserving control.

This area is not settled yet.

## Open Design Area 2: Permission Model

### Current State

Current grants are centered on:

- `READ`
- `WRITE`
- exact slugs and wildcard targets such as `food.*`

This is simple, but it does not distinguish:

- suggesting a value
- writing an active value
- creating or editing definitions

### Things We Like So Far

- a separate concept for definition mutation still feels useful
- slug and wildcard targets are still a good fit
- a future agent should probably be able to lower its own power temporarily without changing the user’s persisted grants

### Things That Still Feel Weird

- requiring both `SUGGEST` and `DEFINE` for one call can feel awkward
- if one call can both define and write, the required permission combination may be too subtle
- if one call can behave differently depending on whether a slug already exists, permission failures may be hard for the model to predict

### Candidate Permission Shapes

#### Option A: `READ`, `SUGGEST`, `WRITE`, `DEFINE`

Pros:

- very explicit
- easy to reason about per action
- safe coexistence of review-first and full-auto clients

Cons:

- more moving pieces
- combined flows may require multiple permissions

#### Option B: `READ`, `WRITE`, `DEFINE`

Idea:

- `WRITE` covers both suggestion and active-value mutation
- tool mode or policy decides whether the write lands as suggested vs active
- `DEFINE` is only about schema mutation

Pros:

- simpler than a four-action model
- definition mutation stays separate
- one endpoint can vary behavior without introducing a separate `SUGGEST` capability

Cons:

- “suggest-only agent” becomes harder to represent cleanly
- the system has to define whether suggest is just a low-power write mode

#### Option C: `READ`, `MUTATE`

Idea:

- one broad mutation capability
- call-level mode decides suggest/write/define behavior

Pros:

- very simple policy model

Cons:

- likely too coarse
- loses important distinction between value mutation and definition mutation
- reduces the usefulness of permission grants

### Current Lean

The most promising direction right now seems to be one of these:

- `READ`, `WRITE`, `DEFINE`
- or `READ`, `SUGGEST`, `WRITE`, `DEFINE`

We do not have enough clarity yet to pick between them.

## Temporary Power Reduction

This idea is worth preserving because it may solve some of the endpoint awkwardness.

The key distinction:

- persisted permissions should express what the user allows
- temporary lowering should express what the agent chooses to do for this task

That means temporary lowering probably should not be stored as a grant mutation.

Possible shapes:

- a call-level flag such as `allowDefinitionCreation: false`
- a mode field such as `mutationMode: "suggest_only" | "existing_only" | "allow_define"`
- a client-side/session-side constraint outside the DB grant model

Reasons this is attractive:

- the user can grant broad powers once
- the agent can still act conservatively task by task
- the model does not need to mutate permissions just to be safer for one run

Questions still open:

- should this lowering mechanism live in MCP tool input, MCP session state, or pure agent-side convention
- should tools/list reflect the lowered mode or only the user’s stored permissions

## Questions To Keep Digging Into

- Is one mutation tool better than multiple tools if permissions become richer?
- If one tool can do suggest/write/define, how should it explain what it actually did in the response?
- Is `DEFINE` enough as a distinct permission, or do we really need `SUGGEST` as well?
- What is the simplest permission model that still lets us support both review-first and full-auto agents?
- How should a temporary lower-power mode be expressed?
- If an agent has `DEFINE`, should the system allow it to edit any definition it can target, or only create missing slugs?
- If “global” is not special, what other constraint should prevent schema churn or accidental redefinition?
- Should a single call that creates a definition and writes a value log one semantic event, multiple low-level events, or both?

## What We Should Not Pretend Is Decided

- the final MCP endpoint shape
- the final permission enum
- the final semantics of temporary power reduction
- whether suggest and write should be separate permissions
- the exact interaction between tools/list visibility and permission tiers

## Likely Next Conversation

Before implementation planning, we should have a focused follow-up discussion on:

- one tool vs multiple tools
- whether the permission model should be 3 tiers or 4 tiers
- where temporary lowering belongs
- what minimal guarantees full-auto must have before it is acceptable

Once that conversation is clearer, this document can turn into a real implementation plan.

