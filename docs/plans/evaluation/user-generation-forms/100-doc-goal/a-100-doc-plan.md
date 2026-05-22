# 100-Document Realistic Corpus Plan

- Status: planning
- Date: 2026-05-21
- Read when: deciding how to use `examples/eval/` for a large realistic
  synthetic user corpus

## Summary

The current eval framework should be kept, but it should not be treated as a
turnkey 100-document generator yet.

Recommended direction:

- Use agents to draft realistic document prose in small batches.
- Use the eval framework to constrain the facts, organize the files, validate
  fixture consistency, and evaluate downstream scenarios.
- Add only the framework pieces needed to make 100-doc review reliable.
- Defer a fully deterministic 100-doc template generator until repeated
  document types prove they are worth templating.

The immediate goal is not "scripts generate perfect realistic documents." The
immediate goal is "agents can generate many documents without uncontrolled fact
drift, missing coverage, or unreviewable folders of random files."

## What The Framework Already Provides

The framework is already useful as rails around agent-generated documents:

- `profile.yaml` is the source of truth for facts. Agents should only use facts
  from the profile unless a document is explicitly stale, conflicting,
  irrelevant, or third-party.
- `manifest.json` organizes each corpus by document path, category, expected
  use, freshness, authority, and declared `factKeys[]`.
- `pnpm eval:validate` catches schema errors, missing files, stale generated
  seeds, invalid fact keys, null facts declared as present, scenario reference
  errors, field-map coverage gaps, and malformed snapshots.
- `scenario.json` ties one user, corpus, and form together.
- `expected/filled-form.json` snapshots evaluate whether known profile-backed
  memory can fill a form deterministically.

Concrete example:

```text
users/samir-desai/profile.yaml
  -> declares workAuthorization.uscisANumber = "123456789"

users/samir-desai/corpora/template-smoke/manifest.json
  -> declares which document contains workAuthorization.uscisANumber

scenarios/samir-desai-i9-template-smoke/expected/filled-form.json
  -> proves the I-9 runner fills both USCIS/A-number fields correctly
```

## What Is Missing For The 100-Doc Goal

The current framework is not yet enough for hands-off 100-document realistic
corpus generation:

- Scaffold currently renders one document per eligible template; the template
  library is intentionally small.
- Current validation trusts manifest `factKeys[]`; it does not parse document
  prose to prove the prose contains only those facts.
- There is no corpus plan/policy file describing target counts by category,
  relevance, freshness, conflict type, or noise.
- There is no review report showing "expected 100 docs, got 100 docs, with 60
  relevant, 25 noise, 10 stale/conflicting, 5 partial."
- The runner does not ingest documents; it hydrates backend memory directly
  from `profile.yaml` and generated seed preferences.
- There is no extraction snapshot contract yet.

That means a pure "ask an agent for 100 docs" approach is fast but risky, while
a pure "build deterministic templates for everything first" approach is slow
and likely over-engineered.

## Target Corpus Shape

Create a new realistic corpus for one user under the existing tree:

```text
examples/eval/users/<userId>/corpora/realistic-v1/
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

For the first 100-doc corpus, use one user and one primary form target. I-9 is
the safest first target because the field map and runner scenario already
exist.

Recommended initial distribution:

| Category | Count | Expected Use |
| --- | ---: | --- |
| identity | 15 | mostly `extract` or `corroborate` |
| address-contact | 15 | mostly `extract` or `corroborate` |
| work-authorization | 12 | mostly `extract` or `corroborate` |
| hr-onboarding | 12 | mixed `extract`, `corroborate`, `guardrail` |
| employer-context | 8 | mostly `guardrail` or out-of-scope context |
| partial-conflicting | 18 | stale, partial, or conflicting guardrails |
| noise | 20 | `ignore` |

This gives 100 documents total, with enough irrelevant and conflicting material
to make the corpus realistic without making the first pass unreviewable.

## Agent Generation Workflow

Generate in small batches instead of one large prompt.

1. Create or pick the target user profile.
   - `profile.yaml` must contain every canonical current fact the corpus may
     use.
   - Null facts should be explicit when the system must leave fields blank.
   - Add stale or historical facts only if the profile has a clear namespace
     for them, such as `address.previous` or `identity.formerNames`.

2. Add a corpus plan before generating documents.
   - Preferred path:
     `examples/eval/users/<userId>/corpora/realistic-v1/corpus-plan.md`
   - The plan should list document batches, target counts, allowed fact keys,
     disallowed/inapplicable facts, and intended challenge types.

3. Generate documents in batches of 15-25.
   - Batch 1: identity and address-contact current high-authority docs.
   - Batch 2: work authorization and HR onboarding docs.
   - Batch 3: employer-context and partial-conflicting docs.
   - Batch 4: noise docs.
   - Batch 5: review/repair pass only.

4. For each generated document, update `manifest.json`.
   - Every real fact-bearing document lists concrete profile leaf fact keys.
   - Noise documents use `factKeys: []` and `expectedUse: "ignore"`.
   - Stale/conflicting docs use `freshness: "stale"` or `"mixed"` and
     `expectedUse: "guardrail"` unless they intentionally contain current
     useful facts.

5. Run validation after every batch.
   - Use:
     ```bash
     pnpm eval:validate --user <userId> --corpus realistic-v1 --write-report
     ```
   - Repair only issues listed in `validation-report.json`.

6. Add one scenario after the corpus validates.
   - Start with the known-memory form-fill runner, not document ingestion.
   - Example:
     ```text
     scenarios/<userId>-i9-realistic-v1/
       scenario.json
       start/prompt.md
       expected/filled-form.json
     ```

## Prompt Contract For Agents

Each document-generation batch should include this contract:

```text
You are generating synthetic eval fixture documents.

Use only facts from profile.yaml unless the requested document is explicitly
noise, stale, conflicting, partial, redacted, or third-party context.

Do not invent canonical current facts. Do not invent phone numbers, IDs,
addresses, employers, dates, immigration numbers, or tax values.

For every document you create, return:
- relative path under documents/
- title
- category
- expectedUse
- authority
- freshness
- concrete profile factKeys present in the document
- a short note explaining why the document exists

Noise documents must have no canonical user fact values and should be marked
expectedUse: ignore.

Stale or conflicting documents must clearly indicate why they should not
override current facts.
```

This keeps the agent creative about prose while forcing it to return the
metadata the framework can validate.

## Framework Changes Needed Next

### Batch A: Corpus Plan And Distribution Validation

Add a small optional corpus policy file and validation checks.

Proposed file:

```text
users/<userId>/corpora/<corpusId>/corpus-plan.json
```

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
    "current-fact",
    "noise",
    "stale-address",
    "former-name",
    "third-party-context",
    "redacted-id"
  ]
}
```

Validator additions:

- If `corpus-plan.json` exists, check actual document count equals target.
- Check category counts match the plan.
- Check `noise` documents have `expectedUse: "ignore"` and no `factKeys[]`.
- Check `partial-conflicting` documents are not marked as high-authority
  current extract docs.
- Add warning-level, not hard-error, checks for document length by category.

This gives immediate value for 100-doc review without needing a generator.

### Batch B: Agent Batch Intake Checklist

Add docs and maybe a lightweight script for reviewing agent-generated batches.

Minimum deliverable:

- `examples/eval/PLAYBOOK.md` section: "Adding A 100-Doc Realistic Corpus".
- A reusable prompt file under the plan directory or eval docs.
- A checklist:
  - all files are under `documents/`
  - manifest lists every file
  - no unlisted files
  - noise has no fact keys
  - null facts are not claimed
  - stale docs are clearly stale
  - validation report is clean

Optional script:

```bash
pnpm eval:validate --user <userId> --corpus realistic-v1 --write-report
```

No new command is required if the existing validator plus corpus-plan checks are
enough.

### Batch C: First 100-Doc Corpus

Create the first actual corpus using the hybrid workflow.

Recommended first target:

- User: Samir or a new I-9 user with richer profile facts.
- Corpus: `realistic-v1`.
- Form: `i-9`.
- Scenario: `<userId>-i9-realistic-v1`.

Implementation steps:

1. Expand profile only where needed for realistic docs.
2. Add `corpus-plan.json`.
3. Generate 15-25 docs at a time with an agent.
4. Commit each batch only after validation passes.
5. Add or update the scenario snapshot after all docs validate.

Acceptance criteria:

- Exactly 100 documents.
- Full validation passes.
- Corpus report is committed.
- At least 20 documents are true noise.
- At least 10 documents are stale, partial, or conflicting.
- The known-memory I-9 runner scenario passes.

### Batch D: Optional Document-Text Audit

After the first 100-doc corpus exists, add light document-body checks.

Useful checks:

- Warn if a null profile value appears literally in document text.
- Warn if a non-noise document is very short for its category.
- Warn if the same phrase appears across too many docs.
- Warn if a document declares a fact key but none of its known string values
  appear in the document.
- Warn if an ignored/noise document contains obvious current user identifiers,
  such as legal name or current email.

Keep these as warnings first. Large realistic corpora will have exceptions, and
false positives are acceptable while tuning.

### Batch E: Extraction Evaluation

Only after realistic corpora exist, design the ingestion/extraction eval.

New snapshot type, separate from `filled-form`:

```text
expected/extracted-facts.json
```

It should compare extracted facts against profile truth:

- correct current facts
- missing facts
- false positives
- stale facts incorrectly treated as current
- null facts incorrectly invented
- ignored/noise facts incorrectly extracted

Do not block the 100-doc corpus work on this. The corpus itself is valuable
before ingestion scoring exists.

## Decision Points

Recommended decisions for the next implementation batch:

- Build `corpus-plan.json` and distribution validation first.
- Do not build a deterministic 100-doc generator first.
- Do not add document ingestion to the runner first.
- Use agents to create the first `realistic-v1` corpus in batches.
- Treat document-body semantic checks as warnings until the first corpus shows
  which checks are reliable.

## Suggested Batch Order

1. **100-Doc Corpus Plan Contract**
   - Add optional `corpus-plan.json` schema and validator support.
   - Add playbook instructions and generation prompt contract.
   - No actual 100-doc corpus yet.

2. **First Realistic 100-Doc Corpus**
   - Pick one user.
   - Add `realistic-v1` with exactly 100 docs generated in agent batches.
   - Commit manifest, report, and known-memory scenario snapshot.

3. **Document-Body Warning Checks**
   - Add lightweight warnings for obvious contradictions, thin docs, repeated
     boilerplate, and noise docs leaking current facts.

4. **Extraction Snapshot Design**
   - Define `expected/extracted-facts.json`.
   - Keep scoring separate from form-fill snapshots.

5. **Document-Ingestion Runner**
   - Ingest or analyze corpus documents.
   - Compare extracted facts to profile truth.
   - Later, optionally run form-fill from extracted memory.

## What Success Looks Like

Near-term success:

- A reviewer can inspect a 100-doc corpus by reading `profile.yaml`,
  `corpus-plan.json`, `manifest.json`, and `validation-report.json`, instead of
  opening every file first.
- Agents can generate documents creatively without inventing uncontrolled
  canonical facts.
- The corpus validates after each small batch.
- Known-memory form-fill snapshots still pass.

Long-term success:

- The same corpus can test both extraction quality and form-fill quality.
- The framework can distinguish "system failed to extract the fact" from
  "system knew the fact but filled the form incorrectly."
- Reusable templates are added only after repeated hand/agent-generated
  document types prove stable enough to automate.

## Non-Goals For The Next Batch

- No real LLM calls inside repo scripts.
- No UI/browser automation.
- No W-4 expansion unless chosen as a separate form-map batch.
- No full deterministic 100-doc generator.
- No document-ingestion runner until the first realistic corpus exists.
