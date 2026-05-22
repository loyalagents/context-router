# 100-Document Realistic Corpus Plan (Revised)

- Status: planning
- Date: 2026-05-21
- Read when: deciding how to produce a large realistic synthetic user corpus
  in `examples/eval/`
- Supersedes: `a-100-doc-plan.md` and `c-100-doc-plan.md`

## Provenance

This is a synthesis of two earlier drafts:

- `a-100-doc-plan.md` contributed the concrete category distribution, the
  agent prompt contract, the `corpus-plan.json` policy file, and the
  batch-of-15-25 generation rhythm.
- `c-100-doc-plan.md` contributed the central sequencing rule: prose-level
  validation is a prerequisite, not a post-hoc audit.

Where the two disagreed, this plan resolves it. The disagreements and
resolutions are recorded in the "Decisions" section so the reasoning is not
lost.

## Summary

Keep the eval framework as deterministic rails. Use an LLM — one isolated
call per document — to draft realistic document prose. Add the framework pieces that let a 100-document corpus be
*verified*, not just *organized*, and add them **before** the corpus is
generated.

The immediate goal: agents can generate many documents without uncontrolled
fact drift, missing coverage, or unreviewable folders of random files — and the
framework can *prove* that mechanically.

## What The Framework Already Provides

The framework is already useful as rails around agent-generated documents:

- `profile.yaml` is the source of truth for facts.
- `manifest.json` inventories each corpus by path, category, expected use,
  freshness, authority, detail tier, and declared `factKeys[]`.
- `pnpm eval:validate` catches schema errors, missing files, stale generated
  seeds, invalid fact keys, null facts declared as present, scenario reference
  errors, field-map coverage gaps, and malformed snapshots.
- `scenario.json` ties one user, corpus, and form together.
- `expected/filled-form.json` snapshots evaluate whether known profile-backed
  memory can fill a form.

## The Gap That Sequencing Must Close

The validator checks manifest *metadata*. It never opens a document body to
confirm a fact value is actually written there. The `validate.mjs` document
checks — `DOCUMENT_DUPLICATE_ID`, `DOCUMENT_INVALID_PATH`,
`DOCUMENT_PATH_MISSING`, `DOCUMENT_NOISE_EXPECTED_USE`,
`DOCUMENT_IGNORE_FACT_KEYS`, `DOCUMENT_TEMPLATE_MISSING`,
`DOCUMENT_UNLISTED_FILE` — none read text.

With templates that was safe; the renderer guaranteed placement. With
agent-written bodies it is not. A 100-document corpus whose `factKeys[]` are
self-reported by the generating agent and never machine-checked against the
prose is unverified. Therefore prose validation lands in Batch 1, before any
realistic corpus is generated.

## Target Corpus Shape

Create a new realistic corpus for one user under the existing tree:

```text
examples/eval/users/<userId>/corpora/realistic/
  corpus-plan.json
  manifest.json
  validation-report.json
  documents/
    identity/
    address-contact/
    work-authorization/
    hr-onboarding/
    employer-context/
    payroll-tax/
    partial-conflicting/
    noise/
```

The corpus id is `realistic`, matching Elena's existing corpus. Corpus ids do
not carry version suffixes; schema versions live in `schemaVersion` fields.

First target: one user, one primary form. I-9 is safest — its field map and
runner scenario already exist.

Recommended distribution (adopted from `a-100-doc-plan.md`):

| Category | Count | Expected Use |
| --- | ---: | --- |
| identity | 15 | mostly `extract` or `corroborate` |
| address-contact | 15 | mostly `extract` or `corroborate` |
| work-authorization | 12 | mostly `extract` or `corroborate` |
| hr-onboarding | 12 | mixed `extract`, `corroborate`, `guardrail` |
| employer-context | 8 | mostly `guardrail` or out-of-scope context |
| partial-conflicting | 18 | stale, partial, or conflicting guardrails |
| noise | 20 | `ignore` |

This totals 100. `payroll-tax` is omitted for an I-9-only target; add a small
`payroll-tax` slice (and reduce `noise` accordingly) when a W-4 form target is
introduced.

## Pipeline

```text
profile.yaml + form + corpus-plan.json
  -> manifest skeleton    (per-document specs incl. brief)        [human/agent]
  -> document bodies      (eval:generate: one isolated LLM call    [script]
                           per manifest entry)
  -> validation           (facts present/absent IN PROSE)         [script]
  -> commit corpus as a fixture
  -> eval scenario + runner
```

Scripts are the reliability layer; the LLM is the variety layer. The
corpus-plan and manifest skeleton are reviewable before any prose exists. The
bodies are generated once, validated, committed, and regenerated only
deliberately. The committed corpus is the stable fixture.

## Batches

Each batch is executed per the `orchestration-plan.md` workflow rule: its own
subdir, `implementation-plan.md`, `implementation-summary.md`, and a status
table update.

### Batch 1 — Verification Foundation (prerequisite)

Goal: the framework can verify a 100-document agent-written corpus before one
exists. This batch merges `a-`'s corpus-plan contract with `c-`'s prose checks,
because both are pure validator and schema work, both need no corpus, and both
are prerequisites.

Work:

- **`corpus-plan.json` schema and distribution validation.**
  Minimum shape:

  ```json
  {
    "schemaVersion": 1,
    "targetDocumentCount": 100,
    "categoryCounts": {
      "identity": 15,
      "address-contact": 15,
      "work-authorization": 12,
      "hr-onboarding": 12,
      "employer-context": 8,
      "partial-conflicting": 18,
      "noise": 20
    },
    "challengeTags": [
      "current-fact", "noise", "stale-address",
      "former-name", "third-party-context", "redacted-id"
    ]
  }
  ```

  Validator additions, gated on `corpus-plan.json` existing: actual document
  count equals target; per-category counts match the plan; `noise` documents
  have `expectedUse: "ignore"` and empty `factKeys[]`; `partial-conflicting`
  documents are not marked high-authority current `extract` docs.

- **Per-document `brief` field on `manifest.json` documents.**
  Optional string, one to three sentences. It is the per-document writing spec
  the agent generates against. Schema-extension only in this batch.

- **Prose-level fact checks.** Build a fact-value matcher: given a fact key and
  its profile value, detect whether a normalized form appears in document
  text, with per-type variants — dates (`1994-07-18`, `07/18/1994`,
  `July 18, 1994`), names (`First Middle Last`, `Last, First`, `First Last`),
  SSN, postal code, plain scalars. New checks:

  | Code | Meaning | Severity |
  | --- | --- | --- |
  | `DOCUMENT_FACT_VALUE_MISSING` | a declared `extract` factKey's value is absent from the body | error (after calibration) |
  | `DOCUMENT_MISSING_FACT_PRESENT` | an `intentionallyMissing` fact value appears in a body | error (after calibration) |
  | `DOCUMENT_UNDECLARED_FACT` | a profile fact value appears in a body but is not in that doc's `factKeys[]` | warning |
  | `DOCUMENT_THIN` / `DOCUMENT_BOILERPLATE` | length or repetition outside `detailTier` norms | warning |

  Severity rule (resolves the `a-` vs `c-` disagreement): the two integrity
  checks ship as **warnings during this batch** while the matcher is tuned,
  then are **promoted to errors** at the end of the batch once they pass clean.
  The drift and style checks stay warnings. A check that can never fail is not
  a gate.

- **Calibrate against Elena's existing `corpora/realistic/`.** That corpus is
  100 genuine hand-authored documents — the ground-truth fixture. If the new
  checks cannot pass it, the matcher is wrong, not the corpus. Fix the matcher.

Checkpoints:

1. `corpus-plan.json` schema, `brief` field, and distribution checks
   implemented; schema tests added.
2. Fact matcher and prose checks implemented; unit tests in `validate.test.mjs`.
3. `pnpm eval:validate --user elena-marquez --corpus realistic` passes with all
   new checks on.
4. Integrity checks promoted from warning to error; `pnpm eval:verify` green.

Verification: `pnpm eval:test`, `pnpm eval:validate`.

Files: `examples/eval/schemas/manifest.schema.json`, new
`examples/eval/schemas/corpus-plan.schema.json`,
`examples/eval/scripts/validate.mjs`,
`examples/eval/scripts/validate.test.mjs`,
`examples/eval/scripts/shared.mjs` (matcher).

Risk: matcher false negatives could block valid corpora. Mitigation: warnings
during calibration; promote to error only after Elena's corpus passes clean.

### Batch 2 — Playbook And Corpus Plan For The Target User

Goal: everything needed to generate the corpus exists except the bodies.

Work:

- Pick the user. Samir (the existing second I-9 user) or a new user with a
  richer profile. Expand `profile.yaml` only where realistic documents need
  facts it does not yet declare; keep null facts explicit.
- Author `corpus-plan.json` for the target user.
- Author the `manifest.json` skeleton: every `documents[]` entry stubbed with
  id, path, category, title, `brief`, `detailTier`, `authority`, `freshness`,
  `expectedUse`, and intended `factKeys[]`. The `brief` is per document, so a
  batch of 20 identity documents is 20 distinct specs, not one prompt — this is
  what prevents within-category sameness.
- Write the generation playbook: `examples/eval/PLAYBOOK.md` section "Adding A
  100-Doc Realistic Corpus", plus the agent prompt contract (below).

Checkpoints:

1. `corpus-plan.json` validates against its schema.
2. Manifest skeleton validates structurally; distribution checks pass; no
   bodies yet.
3. Playbook and prompt contract committed.

Files: `examples/eval/PLAYBOOK.md`, target user `profile.yaml`,
`users/<userId>/corpora/realistic/corpus-plan.json`,
`users/<userId>/corpora/realistic/manifest.json`.

### Batch 3 — Generate The First 100-Document Corpus

Goal: turn the skeleton into 100 written, validated documents.

Generation runs through a script — `eval:generate` — that makes **one isolated
LLM call per manifest entry**. Each call gets a fresh context: only that
document's manifest entry (including `brief`), the slice of `profile.yaml`
holding its facts, and the corpus `intentionallyMissing` list. No call sees the
other 99 documents. Isolation is the point — a single agent session writing all
100 accumulates its own output in context and converges on a house style, which
is the exact sameness this plan exists to fight.

#### Pluggable call backend

The script separates the **loop** (read manifest, build the per-document
prompt, write the file, track progress, run validation) from the **call
backend** (turn one prompt into one document body), behind a single interface:

```text
generateDocument(prompt, options) -> { text }
```

Two backends, selected at runtime with `--backend sdk|cli` (default `sdk`):

- `sdk` — direct Anthropic SDK call. Needs `ANTHROPIC_API_KEY`. Lighter per
  call (pure text completion), an explicit prompt-cache breakpoint on the
  shared profile/rules prefix, model and temperature pinned in the script.
- `cli` — shells out to `claude -p` (or `codex exec`) once per document. Uses
  existing Claude Code / Codex auth, no separate API key; carries the
  coding-agent harness per call.

The plan does not need to pick between them now. Both satisfy the two
requirements that matter — one isolated call per document, and a reproducible
command. What is ruled out either way is one agent session generating all 100
in sequence.

#### Loop behavior

- Iterate `manifest.documents[]` in id order; skip entries whose body file
  already exists unless `--regenerate` is passed.
- `--regenerate <ids>` re-runs only the listed document ids — for
  report-driven repair.
- `--limit <n>` generates only the first n missing entries — for tuning the
  prompt cheaply before a full run.
- Calls are independent, so concurrency is allowed; cap it to respect rate
  limits.
- The script writes each body file in the entry's declared format and nothing
  else. It does not edit the manifest — the Batch 2 skeleton is the input
  contract.
- After writing, the script runs `eval:validate --user <userId> --corpus
  realistic --write-report` and exits non-zero on failure, leaving files on
  disk for inspection.

#### Workflow

1. `pnpm eval:generate --user <userId> --corpus realistic --limit 5` — generate
   a handful, read them, tune the prompt by editing the script.
2. `pnpm eval:generate --user <userId> --corpus realistic` — generate the rest.
3. Read `validation-report.json`; fix flagged files by hand, or
   `pnpm eval:generate --regenerate <ids>` to re-roll them. Prose integrity
   checks are hard errors by now, so the corpus cannot be committed with
   undetected fact drift.
4. Commit when validation is green.

Because calls are isolated, generation order does not affect output; generating
in category waves is optional, not required.

Add the known-memory I-9 scenario after the corpus validates:
`scenarios/<userId>-i9-realistic/` with `scenario.json`, `start/prompt.md`, and
a reviewed `expected/filled-form.json`.

Acceptance criteria (adopted from `a-100-doc-plan.md`):

- Exactly 100 documents.
- Full validation passes, including prose integrity checks.
- `corpus-plan.json`, `manifest.json`, and `validation-report.json` committed.
- At least 20 documents are true noise.
- At least 10 documents are stale, partial, or conflicting.
- The known-memory I-9 runner scenario passes.

Files: new `examples/eval/scripts/generate.mjs` and its `sdk`/`cli` backends,
root `eval:generate` package script,
`users/<userId>/corpora/realistic/documents/**`, updated `manifest.json` and
`validation-report.json`, `scenarios/<userId>-i9-realistic/`, user `README.md`.

Risk: the `sdk` backend needs a key; the `cli` backend can invoke tools
unpredictably. Mitigation: the pluggable backend lets the operator pick per
environment, and Batch 1's validator gates the output regardless of backend.

### Batch 4 — Extraction Evaluation (deferred)

Only after a realistic corpus exists. Define a new snapshot type, separate from
`filled-form`: `expected/extracted-facts.json`, comparing extracted facts to
profile truth — correct current facts, missing facts, false positives, stale
facts treated as current, invented null facts, noise facts wrongly extracted.
Do not block the 100-doc corpus on this. Tracked as a separate batch.

## Per-Document Generation Prompt

`eval:generate` builds one prompt per manifest entry. The shared prefix — the
profile context and the rules below — is identical across all 100 calls and is
the prompt-cache breakpoint on the `sdk` backend. Only the per-document part
(the manifest entry and its `brief`) varies.

The shared rules:

```text
You are writing one synthetic eval fixture document.

Write the document body against the supplied manifest entry. Its `brief` is the
spec: what the document is, its angle, which facts to weave in and where, and
what to leave out. Match the entry's category, detailTier, authority, and
freshness. Output only the document body, in the entry's file format.

Use only facts from the supplied profile slice, unless the entry's category or
freshness marks it as noise, stale, conflicting, partial, redacted, or
third-party context.

Do not invent canonical current facts — no phone numbers, IDs, addresses,
employers, dates, immigration numbers, or tax values beyond the profile slice.

Place every fact key listed in the entry's `factKeys[]` somewhere in the body,
in natural prose or document structure, not all stacked in one header.

Do not write any value listed in the corpus `intentionallyMissing` set.

Noise documents must contain no canonical user fact values.
Stale or conflicting documents must make clear, in their own text, why they
should not override current facts.
```

The generator does not return metadata. The manifest entry already declares
`category`, `expectedUse`, `authority`, `freshness`, and intended `factKeys[]`,
authored in Batch 2. The generator's only job is the body; Batch 1's prose
checks then confirm the declared facts are present and the intentionally
missing ones are absent.

## Decisions

These resolve the `a-` versus `c-` disagreements:

- **Prose validation is a prerequisite, in Batch 1 — not a post-hoc audit.**
  `a-` deferred document-text checks to its Batch D, after the corpus is built.
  That commits 100 documents on unverified self-reported metadata. Rejected.
- **Integrity checks become hard errors after calibration.** `a-` kept all body
  checks as warnings indefinitely. `intentionallyMissing` leakage and absent
  declared facts are correctness bugs and must be able to fail the build.
- **Per-document `brief` field.** `a-` batched by category with one prompt per
  15-25 docs, which leaves within-batch sameness. The brief makes each document
  its own spec.
- **Calibrate on Elena's existing `realistic` corpus.** It is 100 genuine
  documents and the correct ground-truth fixture for the matcher.
- **One policy file: `corpus-plan.json`.** `a-` mentioned both `corpus-plan.md`
  and `corpus-plan.json`. The machine-readable `corpus-plan.json` holds policy;
  per-document briefs live in the manifest. No second plan file.
- **Corpus id is `realistic`, not `realistic-v1`.** Matches Elena's corpus;
  versioning belongs in `schemaVersion`.
- **No deterministic 100-doc template generator.** Both drafts agreed; kept.
- **Generation is a script with one isolated LLM call per document, not one
  agent session.** A single session writing all 100 accumulates its own output
  in context and converges on a house style — the sameness this plan exists to
  prevent. The script's call backend is pluggable (`sdk` or `cli`), so the
  API-key-versus-existing-auth choice is a runtime flag, not a plan commitment.

## Non-Goals

- No LLM calls in the validation, test, or CI path. `eval:validate`,
  `eval:test`, and CI stay deterministic and credential-free. `eval:generate`
  does call an LLM, but it is a local maintainer command, never run by CI; CI
  validates its committed output.
- No backend product feature; this stays local fixture and script
  infrastructure.
- No UI or browser automation.
- No W-4 expansion unless taken as a separate form-map batch.
- No document-ingestion runner until the first realistic corpus exists.

## Open Questions

- Does the prose matcher belong in `shared.mjs` for reuse by a future
  extraction runner?
- Are `brief` fields kept long-term, or stripped after generation to keep
  manifests lean?
- Should `realistic` corpora be frozen as committed fixtures until a deliberate
  refresh, or regenerated on a cadence?
- Is the `cli` backend worth maintaining long-term, or does `sdk` become the
  only supported path once an API key is provisioned?

## What Success Looks Like

Near-term: a reviewer inspects a 100-doc corpus by reading `profile.yaml`,
`corpus-plan.json`, `manifest.json`, and `validation-report.json` — not by
opening every file — and the validation report is trustworthy because it
checked the prose, not just the metadata.

Long-term: the same corpus tests both extraction quality and form-fill quality,
and the framework can distinguish "failed to extract the fact" from "knew the
fact but filled the form wrong."
