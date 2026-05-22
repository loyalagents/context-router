# Plan: A Repeatable Path To 100 Realistic Documents Per User

- Status: plan
- Read when: planning how to generate large realistic document corpora for eval users
- Source of truth while drafting: `docs/plans/evaluation/user-generation-forms/brainstorm.md`, `TODO.md`
- Last reviewed: 2026-05-21

## Goal

Establish a repeatable, reviewable pipeline that produces a 100+ document
realistic corpus for any eval user — varied enough to be a real extraction
benchmark, verified enough to trust, and cheap enough to run per new user.

## Problem Being Solved

Two corpora exist for `elena-marquez`:

- `corpora/realistic/` — 100 hand-authored documents across 8 categories. High
  quality, but produced by the slow manual loop (`brainstorm.md:21-28`). Not
  repeatable for new users.
- `corpora/template-smoke/` — scaffold-generated, deterministic, but
  structurally samey (`TODO.md:26-31`). Good for plumbing regression, weak as an
  extraction benchmark.

`samir-desai` has only a `template-smoke` corpus. There is no repeatable way to
give him — or any future user — a realistic 100-doc corpus without re-running
the hand-authoring loop.

The fix is not "templates vs. coding agents." It is: keep the deterministic
rails (profile, manifest, validator, runner), and move *document-body
authorship* to an agent that writes each document against a per-document spec,
then mechanically verify the result.

## Strategy

Target pipeline:

```text
profile.yaml + forms + corpus policy
  -> corpus plan       (per-document specs, diversity-enforced)   [script]
  -> document bodies   (one agent-written file per spec)          [agent]
  -> validation        (facts present/absent IN PROSE)            [script]
  -> commit corpus as a fixture
  -> eval scenario + runner
```

Division of labor is unchanged from `brainstorm.md`: scripts are the
reliability layer, the agent is the variety layer.

| Layer | Owner | Deterministic |
| --- | --- | --- |
| Corpus plan (manifest specs) | script | yes |
| Document bodies | agent | no |
| Validation | script | yes |
| Committed corpus | fixture | yes (once committed) |

Reproducibility note: the *generator* is no longer deterministic, and that is
acceptable. The corpus plan is deterministic and reviewable before any prose
exists; the bodies are generated once, validated, committed, and regenerated
only deliberately. The committed corpus is the stable fixture. `brainstorm.md`
already endorses committing generated output rather than regenerating it per
run.

## Non-Goals

- No backend product feature. This stays local fixture/script infrastructure.
- Not removing templates. `template-smoke` (Tier 1) keeps using them.
- Not byte-deterministic body generation.
- Not an automated repair loop. Repair stays report-driven and manual or
  agent-assisted.
- W-4 and other forms are out of scope until the I-9 path is solid.

## Prerequisite Insight: The Validator Must Read Prose

Today the validator checks manifest *metadata* (`factKeys[]`, paths, schema)
but never opens a document body to confirm a fact value is actually written
there. The `validate.mjs` document checks are `DOCUMENT_DUPLICATE_ID`,
`DOCUMENT_INVALID_PATH`, `DOCUMENT_PATH_MISSING`,
`DOCUMENT_NOISE_EXPECTED_USE`, `DOCUMENT_IGNORE_FACT_KEYS`,
`DOCUMENT_TEMPLATE_MISSING`, and `DOCUMENT_UNLISTED_FILE` — none read text.

With templates that was safe; the renderer guaranteed fact placement. With
agent-written bodies it is not. Strengthening the validator to read prose is
the gate that makes the whole approach trustworthy, and it must land first.

## Phases / Batches

Each phase below should be executed as its own batch per the
`orchestration-plan.md` workflow rule (own subdir, `implementation-plan.md`,
`implementation-summary.md`, status table update). This file is the
initiative-level plan, not a substitute for those.

### Phase A — Validator Prose Checks (the prerequisite)

Goal: the validator confirms required facts appear in document text, and
intentionally-missing facts do not.

Work:

- Build a fact-value matcher: given a fact key and its profile value, detect
  whether a normalized form appears in document text. It needs per-type
  variants — dates (`1994-07-18`, `07/18/1994`, `July 18, 1994`), names
  (`Elena Sofia Marquez`, `Marquez, Elena`, `Elena Marquez`), SSN, postal code,
  and plain scalars.
- New checks:
  - `DOCUMENT_FACT_VALUE_MISSING` — a `factKeys[]` entry with
    `expectedUse: extract` whose value is not found in the body. Error.
  - `DOCUMENT_MISSING_FACT_PRESENT` — an `intentionallyMissing` fact value
    found in any body. Error.
  - `DOCUMENT_UNDECLARED_FACT` — a profile fact value appears in a body but is
    not in that document's `factKeys[]`. Warning (drift detector).
  - `DOCUMENT_THIN` / `DOCUMENT_BOILERPLATE` — length and repetition warnings
    by `detailTier`, already requested in `TODO.md`.
- Calibrate against Elena's existing `corpora/realistic/` — 100 genuine
  documents is the ground-truth fixture. If the new checks cannot pass that
  corpus, the matcher is wrong, not the corpus. Expect to fix the matcher, not
  the documents.

Checkpoints:

1. Matcher and checks implemented; unit tests added to `validate.test.mjs`.
2. `pnpm eval:validate --user elena-marquez --corpus realistic` passes with
   prose checks on.
3. `pnpm eval:verify` green.

Verification: `pnpm eval:test`, `pnpm eval:validate`.

Files: `examples/eval/scripts/validate.mjs`, `examples/eval/scripts/validate.test.mjs`,
likely `examples/eval/scripts/shared.mjs` for the matcher.

Risk: the matcher is the hard part. Mitigation: start with errors only for
high-confidence types (scalars, SSN, postal, email), keep dates and names as
warnings until the matcher proves out on Elena's corpus.

### Phase B — Corpus Plan Stage

Goal: produce a reviewable 100-entry manifest *spec* before any body is
written.

The current manifest is generated *from* template selection. For agent corpora
the manifest must be authorable *first*, as the spec the agent writes against.
Two additions:

- A per-document `brief` field: one to three sentences telling the agent what
  the document is, its angle, which facts to weave in and how (in a header
  versus in running prose), and what to leave out. This is the per-document
  prompt.
- A corpus `policy` block: target count, category distribution, format mix
  (`md`, `txt`, `json`, `yaml`), detail-tier mix, authority and freshness mix,
  noise ratio, conflict ratio.

Add `eval:plan` (or a `--plan-only` scaffold mode) that, given `profile.yaml`
plus `--form` plus policy, emits a manifest skeleton with the distribution
enforced and `brief` fields stubbed. A human or agent then fills the briefs.
Diversity is enforced here, structurally — this is what kills the "samey"
failure mode, not more templates.

Checkpoints:

1. Plan schema defined; `manifest.schema.json` updated; schema test added.
2. `eval:plan` emits a 100-entry skeleton for `samir-desai` with enforced
   distribution.
3. Skeleton passes structural validation with no bodies yet.

Files: `examples/eval/schemas/manifest.schema.json`, new
`examples/eval/scripts/plan.mjs` and `plan.test.mjs`, root `eval:plan` script,
`examples/eval/scripts/validate.mjs` for plan-shape checks.

Risk: brief authoring is itself work. Mitigation: `eval:plan` derives sensible
default briefs per (category, archetype); humans or agents only edit the ones
that need nuance.

### Phase C — Agent-Driven Body Generation

Goal: turn a 100-entry plan into 100 written, validated document files.

The loop is a script; the per-document writing is the agent. For each manifest
entry the generator assembles a tight prompt — the entry's spec (`category`,
`title`, `brief`, `factKeys`, `detailTier`, `authority`, `freshness`,
`expectedUse`), the *slice* of `profile.yaml` holding only those facts, the
corpus `intentionallyMissing` list, and a short category style guide — and
produces one body file in the entry's format.

Two interchangeable execution modes; pick per run:

- Coding-agent mode: a playbook plus the plan; an agent (Claude Code) loops the
  entries. Fine for the first corpus.
- API mode: an `eval:generate` script using the Claude API (Anthropic SDK, with
  prompt caching on the shared profile and style-guide context) — one command,
  repeatable. The long-term path.

Make the per-document writer pluggable so the loop, manifest wiring, and
validation are identical either way.

After generation: run the Phase A validator. Patch only flagged files
(report-driven repair). Commit when green.

Checkpoints:

1. Category style guides written; generation prompt assembled and reviewed on
   roughly 5 documents.
2. Full `samir-desai/corpora/realistic/` (100 documents) generated.
3. `pnpm eval:validate --user samir-desai --corpus realistic` passes with prose
   checks.
4. Corpus committed; user `README.md` updated.

Files: new `examples/eval/scripts/generate.mjs` (loop and validation wiring),
category style guides under `examples/eval/style-guides/`, the generated corpus
under `examples/eval/users/samir-desai/corpora/realistic/`, and a generation
playbook doc.

Risk: hallucinated or wrong fact values. Mitigation: the Phase A validator is
the gate — nothing commits until prose checks pass. Risk: cost. Mitigation:
about 100 small calls per corpus, one-time per user; prompt-cache the shared
context.

### Phase D — Scenario And Eval Runner Wiring

Goal: the new realistic corpus feeds a real eval scenario.

Work:

- Add a `samir-desai` I-9 realistic scenario (`scenario.json`,
  `start/prompt.md`).
- Run `eval:run`; review and commit expected snapshots deliberately.

Checkpoints:

1. Scenario created and validates.
2. `pnpm eval:run --scenario <id>` produces a reviewed snapshot.

Files: `examples/eval/scenarios/samir-desai-i9-realistic/`, runner config if
needed.

### Phase E — Adversarial Tier (optional, later)

Once realistic generation is proven, extend the plan policy with conflict and
stale specs (`TODO.md` Tier 3): old versus current address, former versus
current name, employer versus home address, redacted IDs. This requires a
manifest `conflictsWith` or stale-value field and a validator rule that the
*wrong* value is the one present in that document and the canonical value is
absent from it. Track as a separate batch.

## Sequencing And Why

A before B and C is non-negotiable: without prose validation, agent-written
bodies are unverifiable and the whole thing collapses back into "trust the
agent." B before C: the agent needs a spec to write against. D after C: a
runner needs a corpus. This mirrors `brainstorm.md`'s own "build the validator
before the generator" rule, re-applied to document bodies.

## Definition Of Done

- `eval:validate` verifies fact values in document prose.
- `eval:plan` emits a diversity-enforced 100-entry corpus spec from a profile.
- A new user (`samir-desai`) has a 100-document `realistic` corpus produced
  without hand-authoring, passing all validation.
- The corpus feeds a committed eval scenario.
- The path is documented well enough that the next user's corpus is a repeat,
  not a research project.

## Risks And Rollback

- Matcher false negatives could block valid corpora. Rollback: demote new
  checks to warnings via a flag; keep metadata checks authoritative until the
  matcher is trusted.
- Agent corpora drift in tone across users. Mitigation: shared category style
  guides; the plan, not the prose, owns structure.
- If agent generation proves unreliable even with validation, fall back to
  Phases A and B as a quality boost to the *existing* manual loop — those
  phases stand on their own.

## Open Questions

- Does the prose matcher live in `shared.mjs` for reuse by a future ingestion
  runner?
- Should `brief` fields be committed long-term, or stripped after generation to
  keep manifests lean?
- Coding-agent mode versus an `eval:generate` API script — build both, or
  commit to the API script after the first corpus?
- Should `realistic` corpora be regenerated on a cadence, or frozen as
  committed fixtures until a deliberate refresh?

## Per-Batch Workflow Reminder

Per `orchestration-plan.md`, each phase here becomes its own batch: create the
subdir, write `implementation-plan.md`, execute, write
`implementation-summary.md`, update the orchestration status table. Add a row
to the orchestration status table for this initiative when Phase A begins.
