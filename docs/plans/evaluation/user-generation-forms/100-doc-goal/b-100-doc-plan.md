# Revised 100-Document Realistic Corpus Plan

- Status: planning
- Date: 2026-05-21
- Read when: choosing the next practical path toward 100+ realistic documents
  per eval user

## Summary

Use the existing eval framework as fixture rails, but do not try to build a
perfect deterministic 100-document generator first.

Recommended path:

1. Add a corpus plan/spec layer.
2. Add high-confidence document-body validation.
3. Generate a 10-20 document pilot with an agent.
4. Tune validation from real outputs.
5. Scale to a full 100-document corpus in small batches.
6. Add document-ingestion evaluation later, after the corpus exists.

This keeps momentum while avoiding two traps:

- trusting unconstrained agent prose
- spending too long building an over-complete generator before any realistic
  corpus exists

## Position

The framework should continue to be the reliability layer:

- `profile.yaml` owns canonical facts.
- corpus plans define intended distribution and per-document specs.
- `manifest.json` inventories committed documents.
- `pnpm eval:validate` catches drift and review blockers.
- scenarios and snapshots evaluate downstream behavior.

Agents should be the variety layer:

- write realistic document bodies
- vary tone, structure, format, and noise
- repair documents from validator reports

For v1, "agent" means an interactive coding agent such as Codex or Claude Code
working in the repo. It does not mean a repo script that calls an LLM API.

Committed fixtures are the reproducible artifact. The agent generation process
does not need to be byte-deterministic for v1.

## Generation Mode Decision

Start with coding-agent generation, supported by scripts, not script-called LLM
generation.

The intended split:

```text
script creates corpus-plan.json
coding agent writes document files from the plan
coding agent updates manifest.json
script validates and reports problems
coding agent repairs only reported problems
```

Do not ask the agent to "make 100 realistic documents" freeform. Ask it to
work through bounded plan entries:

```text
Generate documents 001-020 from corpus-plan.json.
Use only the listed factKeys and the relevant profile slice.
Write files under documents/.
Update manifest.json.
Run validation and fix only validation-reported issues.
```

Why not an API script first:

- It adds API keys, provider SDKs, retries, rate limits, cost controls, and
  prompt-version management before the workflow is proven.
- It makes regeneration feel easy, even though the desired artifact is the
  reviewed committed corpus.
- It hides judgment calls that are easier to inspect in an interactive
  coding-agent loop.

An API-backed `eval:generate` command can come later, after the corpus plan,
prompt contract, validator checks, and repair loop have worked on at least one
full corpus.

## What I Would Change From `c-100-doc-plan.md`

I agree with the core direction in `c-100-doc-plan.md`: scripts create the
spec, agents write prose, scripts validate the result.

The changes I would make:

- Do not require a comprehensive prose matcher before corpus-plan work begins.
  Build high-confidence checks first, then improve them from a pilot corpus.
- Do not jump straight from validator work to 100 generated documents. Generate
  10-20 pilot documents first.
- Do not build API-based `eval:generate` in the first round. Use coding-agent
  generation until the workflow proves useful.
- Keep `brief` and distribution policy in `corpus-plan.json` first. Do not
  commit generation-only prompt text into `manifest.json` until we know it is
  valuable there.
- Treat fuzzy document-body checks as warnings before making them hard errors.

## Target End State

For a user such as `samir-desai`, the realistic corpus should look like:

```text
examples/eval/users/samir-desai/corpora/realistic-v1/
  corpus-plan.json
  manifest.json
  validation-report.json
  documents/
    identity/
    address-contact/
    work-authorization/
    hr-onboarding/
    employer-context/
    partial-conflicting/
    noise/
```

The first 100-document corpus should target I-9 because the field map and
runner already exist.

Recommended distribution:

| Category | Count | Role |
| --- | ---: | --- |
| identity | 15 | current and corroborating identity facts |
| address-contact | 15 | current and stale address/contact material |
| work-authorization | 12 | I-9 status and identifier support |
| hr-onboarding | 12 | employee onboarding context |
| employer-context | 8 | mostly non-user or Section 2 guardrails |
| partial-conflicting | 18 | stale, partial, redacted, or conflicting docs |
| noise | 20 | irrelevant docs that should be ignored |

## Phase 1: Corpus Plan Contract

Goal: make the 100-document corpus reviewable before prose exists.

Add optional:

```text
users/<userId>/corpora/<corpusId>/corpus-plan.json
```

Suggested shape:

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
  "documents": [
    {
      "id": "001",
      "path": "documents/identity/001-driver-license-transcript.md",
      "category": "identity",
      "title": "Driver License Transcript",
      "format": "md",
      "expectedUse": "extract",
      "authority": "high",
      "freshness": "current",
      "detailTier": "hero",
      "factKeys": [
        "identity.legalName",
        "identity.dateOfBirth",
        "address.current.street",
        "address.current.city",
        "address.current.state",
        "address.current.postalCode"
      ],
      "challengeTags": ["current-fact", "identity-document"],
      "brief": "Create a DMV-style transcript with current legal name, DOB, and current address in structured lines. Do not include phone, email, or work authorization facts."
    }
  ]
}
```

Validator additions:

- If `corpus-plan.json` exists, validate its schema.
- Check `targetDocumentCount` matches `documents.length`.
- Check planned category counts match the plan.
- Check planned paths are unique and under `documents/`.
- Check planned `factKeys[]` resolve to concrete profile leaves, allowing null
  only when the document is explicitly testing absence.
- Check every manifest document has a matching plan entry, once bodies exist.

Why this comes first:

- The agent needs specs to write against.
- Reviewers can inspect the intended 100-doc mix before reading prose.
- Distribution is enforced structurally instead of hoping the agent remembers
  the mix.

## Phase 2: High-Confidence Prose Validation

Goal: catch obvious fact drift in agent-written documents without trying to
solve semantic document understanding in one batch.

Start with high-confidence checks only.

Hard errors:

- A document declares a high-confidence fact key in `factKeys[]`, but no known
  value variant appears in the body.
- A `noise` document contains high-confidence current identifiers.
- A document marked `expectedUse: "ignore"` declares `factKeys[]`.
- A document claims a null fact in `factKeys[]`.

High-confidence fact types:

- email
- SSN
- USCIS/A-number
- exact postal code
- exact street address
- full legal name
- employer work email

Warnings first:

- date variants
- first/last name separately
- state abbreviations
- city names
- common short values such as middle initials
- repeated boilerplate
- thin documents by category/detail tier
- undeclared profile values appearing in prose

Important null-fact handling:

- If a fact is `null`, there is no value to search for.
- For risky null fields, use pattern checks instead.
- Example: if `contact.phone` is intentionally missing, warn or error when a
  phone-number-like pattern appears in an extract document unless the document
  is explicitly stale, third-party, or guardrail.

Checkpoint:

- Calibrate against Elena's `realistic` corpus and current `template-smoke`
  corpora.
- Do not force every fuzzy matcher to pass immediately.
- Prefer warnings until false positives are understood.

## Phase 3: 10-20 Document Pilot

Goal: test the workflow before spending time on 100 documents.

Use one existing user, preferably Samir, and add:

```text
examples/eval/users/samir-desai/corpora/realistic-pilot/
```

Recommended pilot mix:

- 4 identity docs
- 4 address-contact docs
- 3 work-authorization docs
- 3 hr-onboarding docs
- 3 partial-conflicting docs
- 3 noise docs

Process:

1. Write `corpus-plan.json` for the pilot.
2. Ask a coding agent, such as Codex or Claude Code, to generate documents from
   the plan, one category at a time.
3. Give the agent only the relevant plan entries, profile slice, intentionally
   missing facts, and category style guidance.
4. Require the agent to update `manifest.json` with each file.
5. Run:
   ```bash
   pnpm eval:validate --user samir-desai --corpus realistic-pilot --write-report
   ```
6. Repair only validator-reported issues.
7. Review whether the docs feel realistic enough to scale.

Exit criteria:

- Pilot validates.
- Prose checks produce useful signal.
- False positives are understood and either fixed or demoted to warnings.
- The agent workflow is clear enough to repeat for the full corpus.

## Phase 4: Full 100-Document Corpus

Goal: scale the proven pilot process to a committed 100-doc fixture.

Corpus:

```text
examples/eval/users/samir-desai/corpora/realistic-v1/
```

Process:

1. Create `corpus-plan.json` with exactly 100 planned docs.
2. Generate documents with a coding agent in batches of 15-25.
3. Keep each agent request bounded to a contiguous range or one category.
4. Validate and repair after each batch.
5. Commit `manifest.json`, documents, and `validation-report.json` only once
   the full corpus validates.
6. Add a known-memory I-9 scenario:
   ```text
   examples/eval/scenarios/samir-desai-i9-realistic-v1/
   ```
7. Generate the filled-form snapshot through:
   ```bash
   pnpm eval:run --scenario samir-desai-i9-realistic-v1 --update-snapshots
   pnpm eval:run --scenario samir-desai-i9-realistic-v1
   ```

Acceptance criteria:

- Exactly 100 documents.
- Full validation passes.
- At least 20 documents are `noise` with `expectedUse: "ignore"`.
- At least 10 documents are stale, conflicting, partial, redacted, or guardrail
  documents.
- Known-memory I-9 runner scenario passes.
- No real LLM calls are added to repo scripts.

## Phase 5: Optional API Generation

Only after the coding-agent workflow works, consider an API-backed generator.

Do not start here.

Reasons to defer:

- It adds API keys, SDK dependencies, retries, rate limits, and costs.
- Prompt versioning becomes part of fixture generation.
- It increases surface area before we know the human/agent loop is effective.

When it is worth adding:

- The corpus-plan format is stable.
- The prompt contract has been tested on at least one full corpus.
- Most validation failures are predictable and repairable.

At that point, an `eval:generate` command could loop through plan entries and
call a provider, but generated files should still be committed and refreshed
only deliberately.

Even then, `eval:generate` should be a convenience wrapper around the proven
agent prompt contract. It should not invent a separate generation model, skip
manifest review, or bypass validation.

## Phase 6: Extraction Evaluation

Do not block the 100-doc corpus on this.

After realistic corpora exist, define a separate extraction snapshot:

```text
expected/extracted-facts.json
```

It should score:

- correct current facts
- missing current facts
- false positives
- stale facts incorrectly treated as current
- null facts incorrectly invented
- noise facts incorrectly extracted

Keep this separate from `filled-form` snapshots. The framework should be able
to answer two different questions:

- Did the system extract the right memory from documents?
- Given known memory, did the system fill the form correctly?

## Agent Prompt Contract

Use this contract for each coding-agent document-generation batch:

```text
You are generating synthetic eval fixture documents for examples/eval.

Use profile.yaml as the only source of canonical current facts.

Do not invent current facts. Do not invent phone numbers, IDs, addresses,
employers, dates, immigration numbers, or tax values.

For stale, conflicting, partial, redacted, third-party, or noise documents,
make the document clearly signal why it should not override current profile
facts.

For each document, produce:
- file path under documents/
- document body
- manifest metadata
- concrete profile factKeys present in the body
- expectedUse
- freshness
- authority
- challengeTags

Noise documents must not contain high-confidence current identifiers such as
legal name, email, SSN, USCIS/A-number, current street address, or work email.
```

Preferred invocation style:

```text
Generate documents 021-040 from
examples/eval/users/samir-desai/corpora/realistic-v1/corpus-plan.json.

Use only the relevant entries and profile facts.
Write the document bodies.
Update manifest.json.
Run pnpm eval:validate --user samir-desai --corpus realistic-v1 --write-report.
Fix only validation-reported issues.
```

## Practical Next Batch

The next implementation batch should be:

**Corpus Plan Contract + High-Confidence Prose Validation**

Scope:

- Add `corpus-plan.json` schema and validator support.
- Add high-confidence prose checks for email, SSN, USCIS/A-number, postal code,
  street address, legal name, and work email.
- Add warning-level checks for thin docs and obvious boilerplate.
- Document the agent prompt contract in `examples/eval/PLAYBOOK.md`.
- Document that initial document generation should be done by Codex/Claude Code
  in bounded batches, not by a repo script that calls an LLM API.
- Do not generate the 100-doc corpus yet.
- Do not add API-based generation yet.
- Do not add document-ingestion evaluation yet.

Verification:

```bash
pnpm eval:test
pnpm eval:validate
pnpm eval:verify
```

Optional calibration:

```bash
pnpm eval:validate --user elena-marquez --corpus realistic --write-report
```

## Risks

- Prose matcher false positives could block valid documents.
  - Mitigation: use warnings first for fuzzy checks.
- Agents may still write plausible but wrong prose.
  - Mitigation: batch generation, high-confidence value checks, and
    report-driven repair.
- Corpus planning may become too detailed.
  - Mitigation: keep v1 plan fields close to existing manifest fields plus
    `brief` and `challengeTags`.
- Review cost may still be high.
  - Mitigation: validate after 15-25 document batches, not after all 100.

## Definition Of Done For The 100-Doc Initiative

- A 100-document `realistic-v1` corpus exists for one user.
- It was produced through a corpus plan and agent-written body batches.
- Full validation passes.
- The corpus has meaningful relevant, irrelevant, stale, partial, and
  conflicting documents.
- A known-memory form-fill scenario runs against the corpus.
- The process is documented well enough that the next user's corpus is a repeat
  workflow, not a fresh research project.
