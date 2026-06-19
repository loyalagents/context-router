# User Generation Forms TODO

- Status: active follow-up list
- Last updated: 2026-06-19
- Current state: [`SUMMARY.md`](SUMMARY.md)

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
- The deterministic `eval:run` path does not ingest corpus documents. Live
  known-schema ingestion exists, but there is still no extraction-result
  snapshot/scorer that directly compares extracted facts to profile-backed
  truth.
- There is no extraction-result snapshot contract yet.
- There is no benchmark tiering by difficulty, document realism, or ambiguity.
- There is no formal measure for stale, conflicting, partial, redacted, noisy,
  or adversarial documents.
- Only I-9 currently has a field map, so multi-form generality is still mostly
  theoretical.

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

### Tier 5: Extraction Scoring For Document Ingestion

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
current runner answers "can known memory fill the form?" An extraction-scored
ingestion flow would answer "can the system extract the right memory from
documents?"

## Potential Improvements

### Template Library And Form Coverage

- Add more templates per category so users targeting the same form do not get
  identical document shapes.
- Add more deterministic variation inside templates through seeded `choose()`
  calls.
- Add separate templates for stale, partial, conflicting, and irrelevant
  documents.
- Add work-authorization templates beyond the current I-9 starter set.
- Add tax templates only when W-4 field-map work begins.
- Add field maps for forms beyond I-9 only when the existing I-9 path is less
  brittle.

### Corpus Configuration

- Support named corpus tiers such as `template-smoke`, `realistic`,
  `adversarial`, and `messy`.
- Make corpus size and difficulty explicit instead of relying only on `--count`.
- Track intended challenge types in the manifest, such as `stale-address`,
  `redacted-id`, `third-party-fact`, or `noise`.
- Keep profile facts authoritative; do not duplicate canonical facts into the
  manifest.
- Generate and review multiple realistic corpora per form/status branch. Keep
  Alex as the alien-authorized I-9 corpus, then add or refresh corpora for U.S.
  citizen, noncitizen national, lawful permanent resident, and
  missing/ambiguous work-authorization cases.

### Realistic Corpus Generation

- Use V2 `manifest.json` as the canonical authored contract for large
  AI-authored realistic corpora.
- Have `pnpm eval:plan-corpus` write or update the V2 manifest directly; do
  not reintroduce a separate planning projection file.
- Generate and review a small preview set before producing a committed
  100-document corpus.
- Record the generation model, call count, validation status, and snapshot
  review notes in the implementation summary for any AI-authored corpus.
- Consider adding a command-backed generation provider after the first Vertex
  path proves useful. The provider should use a stable stdin/stdout contract so
  Claude CLI, Codex CLI, or another local tool can be swapped in without
  changing V2 manifest semantics.
- Build a small sanitized source exemplar library for each realistic artifact
  family, such as OCR transcript, uploaded card receipt, resident portal export,
  utility JSON export, copied email, onboarding YAML export, stale ticket, and
  newsletter noise.
- Add source-family-specific prompt templates so generated artifacts use
  source-native structure, common labels, appropriate density, and realistic
  failure modes instead of generic prose.
- Add a realism-focused repair mode after the correctness repair loop is
  stable. It should preserve validated facts while improving document genre,
  source voice, density, native signals, and incidental context.

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
- Add deterministic nested field/value proof for generated structured exports,
  especially native I-9 YAML records where values appear under nested
  `field_id` / `value` shapes.
- Add source-fact ownership metadata or lint support so validators can
  distinguish canonical user facts from source-owned values such as office
  phones, account numbers, ticket IDs, support emails, and system identifiers.
- Add warning-level realism lint coverage for source-native structure, such as
  structured export blocks, raw email headers, OCR field blocks, and ticket
  event logs.
- Harden stale and conflicting cue validation without blocking legitimate
  guardrail documents.
- Add warning-level rules before introducing new hard errors.

### Extraction Evaluation

- Define an extraction snapshot shape before adding an ingestion runner.
- Compare extracted facts against `profile.yaml` ground truth.
- Decide how to score null facts, intentionally missing facts, arrays, dates,
  and stale/conflicting facts.
- Keep extraction scoring separate from form-fill scoring at first.
- Record false positives separately from missing facts; hallucinated facts are
  usually more dangerous than omissions.
- Add an extraction snapshot and scoring stage for document-ingestion runs only
  after corpus truth and extraction contracts are stable.

### Review Workflow

- Keep generated deterministic corpora committed when they are canonical
  fixtures.
- Use snapshot updates only through supported runner commands.
- Review diffs at the field/fact level, not only at the file level.
- Add a manual realism scorecard for promoted corpora with per-document notes on
  native source shape, plausible length, density, formatting, incidental
  metadata, contradiction clarity, and whether a real user might plausibly have
  the file.
- Prefer small batches: one new user, one new form map, or one new runner
  capability at a time.

## Suggested Future Batch Order

1. Generate and validate a Samir realistic corpus using the unified V2
   manifest flow, then scale toward 100 documents after a small preview passes.
2. Design an extraction snapshot contract.
3. Add extraction scoring for document-ingestion runs that compares extracted
   facts to profile-backed ground truth.
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
