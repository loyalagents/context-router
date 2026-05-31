# User Generation Forms TODO

This file tracks weaknesses in the current eval fixture approach and possible
future improvements. It is intentionally separate from the batch summaries so
follow-up work does not get lost after a batch is marked complete.

## Current Strengths

- The fixture tree has a stable home at `examples/eval/`.
- `profile.yaml` is the source of truth for user facts.
- Generated seed preferences are deterministic and validate against the backend
  preference catalog.
- Template scaffold generation is repeatable, cheap, and safe to review.
- Fixture validation catches schema, reference, field-map, corpus inventory,
  seed, coverage, and snapshot-shape problems.
- The current runner gives deterministic backend form-fill snapshots without
  real LLM calls, Auth0, UI automation, deployed services, or document-analysis
  ingestion.

## Current Weaknesses

- Scaffolded corpora can feel samey across users because the template library is
  still small.
- Users targeting the same form usually get the same document archetypes, with
  facts and seeded phrasing changed but similar structure.
- Template-smoke corpora are good for plumbing and regression checks, but they
  are too regular to measure serious AI extraction quality.
- Current generated documents often place facts in predictable headings,
  sections, and wording.
- The validator checks declared coverage and consistency, not whether document
  prose is genuinely realistic or hard to parse.
- The current deterministic runner hydrates backend memory directly from
  `profile.yaml` and generated seeds. It does not test whether an AI can extract
  facts from documents.
- Corpus documents are not ingested through the document-analysis path.
- There is no extraction-result snapshot contract yet.
- There is no benchmark tiering by difficulty, document realism, or ambiguity.
- There is no formal measure for stale, conflicting, partial, redacted, noisy,
  or adversarial documents.
- Only I-9 currently has a field map, so multi-form generality is still mostly
  theoretical.

## Extraction Experimentation Notes

The current scaffolded documents are useful as a deterministic baseline, but
they should not be treated as a full extraction benchmark.

They are helpful for:

- proving fixture plumbing works
- proving the expected fact keys are represented somewhere
- checking that validation catches fixture drift
- creating stable downstream form-fill snapshots
- detecting regressions in simple, known cases

They are weak for:

- measuring real AI extraction quality
- testing robustness against varied writing styles
- testing layout and formatting noise
- testing stale or conflicting documents
- testing missing or ambiguous facts
- testing whether the model can reject irrelevant documents
- testing whether the model can distinguish user facts from employer,
  household, third-party, or historical facts

## Recommended Benchmark Tiers

### Tier 1: Template Smoke

Purpose:

- Confirm scripts, schemas, field maps, scaffold, validator, and runner still
  work.

Properties:

- small corpus
- deterministic template output
- mostly direct fact placement
- low ambiguity

This is the current baseline.

### Tier 2: Realistic Deterministic

Purpose:

- Test extraction and form-fill behavior against a larger but still fully
  reproducible corpus.

Potential improvements:

- more templates per category
- more varied deterministic phrasing
- more document formats
- more realistic document lengths
- stale address and identity records
- intentionally irrelevant documents
- partial documents with useful headers but missing key facts

### Tier 3: Adversarial Extraction

Purpose:

- Test whether an extraction flow can avoid common mistakes.

Possible cases:

- old address vs current address
- former name vs current legal name
- employer business address vs user home address
- emergency contact facts vs user facts
- redacted IDs
- near-duplicate dates
- phone numbers present only in stale documents
- fake sample IDs that must be ignored
- documents that mention a fact but explicitly say it is not current

### Tier 4: Polished Or Messy Documents

Purpose:

- Test realism beyond deterministic templates while preserving reviewability.

Possible approaches:

- manually curated messy documents
- optional LLM-polished documents committed as fixtures
- scanned/OCR-like text artifacts
- emails with signatures and quoted history
- JSON/YAML exports with extra unrelated fields

Any LLM polish should preserve profile facts, avoid introducing new canonical
facts, and pass validation before output is accepted.

### Tier 5: Document-Ingestion Eval Runner

Purpose:

- Actually measure document extraction quality.

Possible flow:

```text
profile.yaml ground truth
  -> corpus documents
  -> document ingestion / extraction
  -> extracted preferences or facts
  -> compare extracted output to expected profile-backed facts
  -> optionally run form-fill from extracted memory
```

This should be separate from the current deterministic hydration runner. The
current runner answers "can known memory fill the form?" An ingestion runner
would answer "can the system extract the right memory from documents?"

## Potential Improvements

### Template Library

- Add more templates per category so users targeting the same form do not get
  identical document shapes.
- Add more deterministic variation inside templates through seeded `choose()`
  calls.
- Add separate templates for stale, partial, conflicting, and irrelevant
  documents.
- Add work-authorization templates beyond the current I-9 starter set.
- Add tax templates only when W-4 field-map work begins.

### Corpus Configuration

- Support named corpus tiers such as `template-smoke`, `realistic`,
  `adversarial`, and `messy`.
- Make corpus size and difficulty explicit instead of relying only on `--count`.
- Track intended challenge types in the manifest, such as `stale-address`,
  `redacted-id`, `third-party-fact`, or `noise`.
- Keep profile facts authoritative; do not duplicate canonical facts into the
  manifest.

### Realistic Corpus Generation

- Use V2 `manifest.json` as the canonical authored contract for large
  AI-authored realistic corpora.
- Have `pnpm eval:plan-corpus` write or update the V2 manifest directly; do
  not reintroduce a split `corpus-plan.json` projection step.
- Generate and review a small preview set before producing a committed
  100-document corpus.
- Record the generation model, call count, validation status, and snapshot
  review notes in the implementation summary for any AI-authored corpus.
- Consider adding a command-backed generation provider after the first Vertex
  path proves useful. The provider should use a stable stdin/stdout contract so
  Claude CLI, Codex CLI, or another local tool can be swapped in without
  changing corpus-plan semantics.

### File Format Expansion

- Consider richer text-like fixture formats after the first 100-document corpus
  works, such as `.ics`, `.eml`, `.csv`, `.tsv`, `.vcf`, `.toml`, `.ini`, and
  HTML-like exports.
- Before those formats become ingestion eval fixtures, update all relevant
  surfaces deliberately: eval schemas, validator text extraction, generator
  output rules, local-orchestrator discovery, backend upload MIME allow-list,
  and document-analysis MIME normalization.
- If visual or binary formats are added later, treat them as a separate OCR or
  scanned-document tier rather than mixing them into the first text fixture
  corpus.

### Validation

- Add optional warnings for thin documents by category and detail tier.
- Add checks for repeated boilerplate when documents are generated from
  templates.
- Add semantic consistency checks for common derived fields, such as full name
  vs first/middle/last name.
- Add checks for accidentally declaring ignored/noise document facts.
- Add checks that intentionally missing facts are not present in document text,
  not only absent from manifest `factKeys[]`.
- Add warning-level rules before introducing new hard errors.

### Extraction Evaluation

- Define an extraction snapshot shape before adding an ingestion runner.
- Compare extracted facts against `profile.yaml` ground truth.
- Decide how to score null facts, intentionally missing facts, arrays, dates,
  and stale/conflicting facts.
- Keep extraction scoring separate from form-fill scoring at first.
- Record false positives separately from missing facts; hallucinated facts are
  usually more dangerous than omissions.

### Review Workflow

- Keep generated deterministic corpora committed when they are canonical
  fixtures.
- Use snapshot updates only through supported runner commands.
- Review diffs at the field/fact level, not only at the file level.
- Prefer small batches: one new user, one new form map, or one new runner
  capability at a time.

## Suggested Future Batch Order

1. Generate and validate a Samir realistic corpus using the unified V2
   manifest flow, then scale toward 100 documents after a small preview passes.
2. Design an extraction snapshot contract.
3. Add a document-ingestion eval runner that compares extracted facts to
   profile-backed ground truth.
4. Add richer text-like file formats once the first text corpus is stable.
5. Add a command-backed generation provider if Vertex-only generation is too
   limiting.
6. Add W-4 field mapping and tax templates after the I-9 path is less brittle.

## Open Questions

- How many templates per form are needed before generated users stop feeling
  obviously samey?
- Should corpus difficulty live in the manifest, scaffold CLI flags, or named
  corpus IDs?
- How strict should validation be about document-body text versus manifest
  metadata?
- Should LLM-polished documents be one-off committed artifacts, or should there
  eventually be a repeatable polish command?
- Should Vertex remain the only first-party generation backend, or should a
  command adapter become a supported alternative?
- Which non-`md`/`txt`/`json`/`yaml` file formats are worth supporting before
  the document-ingestion runner exists?
- What is the first extraction snapshot shape that is useful without becoming a
  full scoring framework?
- Should extraction evaluation score profile facts directly, backend preference
  slugs, or both?
