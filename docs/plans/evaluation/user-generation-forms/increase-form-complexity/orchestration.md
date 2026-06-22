# Increase Form Complexity Orchestration

- Status: temporary orchestration plan; packet-small live vertical slice
  complete, packet-medium fixture implemented and live run pending
- Last updated: 2026-06-22
- Scope: checkpoints for building a more complex dossier first, then evaluating
  multiple forms from that same dossier

## Goal

Build a harder live-system evaluation without making the runner complicated.

The work splits into two phases:

1. Make a more complex dossier.
2. Evaluate multiple forms from the same dossier.

The first phase is the larger one. It creates the context size, realism, and
cross-form facts that make the evaluation meaningful.

The target result path is live open-schema evaluation. Known-schema ingestion is
useful as a stepping stone and debugging aid, but it is not the primary
benchmark result. The deterministic `eval:run` path should not be used to judge
this work because it hydrates memory from fixture truth and does not ingest the
corpus documents.

The headline comparison is open-to-open:

```text
stored-memory path:
  docs -> live open-schema extraction/storage in DB -> fill form from memory

direct no-memory baseline:
  docs -> model fills form directly from docs, no DB memory
```

Known-schema can help get fixtures working, but results should compare the
open-schema stored-memory path against the open direct/no-memory baseline.

## Current Implementation Status

The first fixture slice, the `packet-small` fixture slice, and the
`packet-medium` fixture are implemented.
See `first-few-steps/implementation-summary.md` and
`small-packet/implementation-summary.md` for the file-level summaries. See
`medium-packet/implementation-summary.md` for the packet-medium fixture summary.

Completed:

- chose the new-hire packet forms: I-9, W-4, and direct deposit;
- added the official SF 1199A direct-deposit fixture;
- added minimal field maps for W-4 and SF 1199A;
- created the `maya-chen-newhire` packet subject;
- made Maya a truth-only open-schema packet profile with no
  `seedPreferences[]`;
- added form-ready address facts: `address.current.streetLine` and
  `address.current.cityStateZip`;
- made profile-only users validate before they have corpora;
- kept seed-backed fixture loading strict for profiles that still declare
  `seedPreferences[]`;
- removed unrelated FAFSA/SF-86 generated-manifest churn from this slice;
- planned and implemented `packet-small` for `maya-chen-newhire`;
- added 8 hand-authored realistic packet-small documents;
- added one-form scenarios for I-9, W-4, and SF 1199A direct deposit;
- expanded open-schema storage-map coverage for packet-specific address, tax,
  and banking facts;
- added `eval:e2e-mcp-packet` so MCP open-schema ingestion runs once and then
  fills all packet forms from the same shared memory;
- ran the live `packet-small` MCP stored-memory path and direct open-schema
  no-memory baselines;
- implemented `packet-medium` as a 30-document, 68 KB corpus with obvious stale
  and other-person challenge documents;
- added one-form `packet-medium` scenarios for I-9, W-4, and SF 1199A direct
  deposit;
- validated `packet-medium` with zero errors and four expected phone-distractor
  warnings.

Packet-small result:

```text
artifact root: /private/tmp/packet-small-clear-email-domains-20260622T010738Z
MCP shared memory: 24/24 known facts recovered, 2/2 missing facts absent
MCP forms:         I-9 12/12, W-4 6/6, direct deposit 9/9
Direct forms:      I-9 12/12, W-4 6/6, direct deposit 9/9
```

Interpretation: packet-small is a clean vertical slice. On this small corpus,
stored MCP memory and direct no-memory form filling are tied on form accuracy.
The stored-memory path shows the stronger packet-level memory signal because one
shared memory snapshot recovered all 24 known packet facts before filling all
three forms.

Remaining for packet-medium live evaluation:

- run the live `packet-medium` MCP stored-memory path;
- run the direct open-schema no-memory baselines for all three packet-medium
  forms;
- compare packet-small and packet-medium.

## Phase 1: Make A More Complex Dossier

### Checkpoint 1: Choose The Form Packet

Start with a narrow new-hire packet:

- I-9;
- W-4;
- direct deposit.

I-9 already exists and has a field map. W-4 already has a PDF fixture but needs
a minimal field map. Direct deposit needs a new form fixture.

Exit criteria:

- packet forms are chosen;
- direct-deposit approach is chosen;
- no runner changes yet.

### Checkpoint 2: Add Direct Deposit Form

Status: complete for the first slice.

The packet uses the official SF 1199A direct-deposit form. The first map is
narrow and intentionally scores only the first copy of the repeated form pages.

Original options considered:

- Simple synthetic payroll direct-deposit PDF: fastest and easiest to map.
- Official SF 1199A: more realistic and easy to source, but potentially more
  PDF-field cleanup.

Either is acceptable for the first pass. If using an official form, keep the
field map narrow and do not attempt to fill certification or agency-only fields.

Map only obvious fields in v1:

- account holder name;
- address if present;
- bank name;
- account type.

Routing number and account number remain in the profile, but the official SF
1199A exposes them as one-character boxes. The v1 field map skips those boxes
until there is a digit-position renderer or explicit form-ready digit facts.

Skip signatures, certifications, agency/employer-only fields, and ambiguous
payment identifiers.

Exit criteria:

- form fixture exists;
- fields are enumerable by the backend `pdf-lib` path used by
  `pnpm eval:manifests`;
- generated field manifest exists;
- minimal `field-map.json` exists;
- focused form validation passes.

### Checkpoint 3: Create A New User

Status: complete for the first slice.

Create a new synthetic new-hire user for the packet.

Why:

- Alex can remain a stable I-9 realistic baseline.
- The new user can include tax and banking facts without changing existing
  comparisons.
- The dossier can be designed around reuse across forms from the start.

Exit criteria:

- new user id is chosen;
- first packet user is `maya-chen-newhire`;
- profile owner is known before adding facts or documents;
- Alex remains available as a stable I-9 realistic baseline.

### Checkpoint 4: Extend Profile Facts

Status: complete for the first slice.

Add only facts required by the first packet. The user still needs the normal
base I-9/profile facts: identity, contact, current address, work authorization,
and employment. The new blocks below are additions for W-4 and direct deposit,
not the whole profile.

Suggested new areas:

```yaml
tax:
  filingStatus:
  multipleJobs:
  dependentsUnder17:
  otherDependents:
  otherIncome:
  deductions:
  extraWithholding:
  exemptionClaim:

banking:
  institutionName:
  routingNumber:
  accountNumber:
  accountType:
  accountHolderName:
```

Maya also uses form-ready address facts for simple field mapping:

```yaml
address:
  current:
    streetLine:
    cityStateZip:
```

Keep durable facts in `profile.yaml`. Use nulls for intentionally missing facts.
Do not add signatures or legal attestations unless a specific scenario is
testing explicit current-form consent.

Intentionally missing values are existing eval behavior, not new functionality.
Use this packet to preserve and exercise that behavior. For example, the new
user can have `contact.phone: null`, the manifest can declare the phone as
intentionally missing, and the corpus can include HR, bank, payroll, sample, and
support phone-number distractors. Expected behavior is that the form field stays
blank rather than borrowing a non-user phone number.

Keep W-4 computed fields simple for now. If a W-4 field requires a calculated
value, such as a dependent count converted into a dollar credit amount, either
skip that field in v1 or store the exact form-ready value explicitly. Do not add
derived-value scorer complexity for the first packet.

Exit criteria:

- profile validates;
- seed preferences are omitted for open-schema packet fixtures, or regenerate
  deterministically if an optional known-schema seed bridge is used;
- intentionally missing facts are explicit.

### Checkpoint 5: Add Minimal Field Maps

Status: complete for the first slice.

Keep mapping narrow.

I-9:

- reuse the existing map.

W-4:

- map employee name, address, SSN, and filing status;
- skip signature, employer-only, worksheet, computed, and ambiguous
  certification fields.

Direct deposit:

- map account holder, bank name, account type, address, nullable phone, and
  payee/person-entitled name;
- defer routing number and account number because SF 1199A uses split
  one-character boxes;
- skip signature and certification fields.

Exit criteria:

- form validation passes for each mapped form;
- skipped fields have intentional skip reasons;
- no attempt is made to map every field.

### Checkpoint 6: Add Document Generation Logic

This is the main difficulty step. The goal is to create dossier documents, not
more forms.

Add source families or realistic generation specs for:

- payroll profile export;
- tax-withholding setup export;
- direct-deposit confirmation;
- voided-check OCR transcript;
- bank letter;
- employee handbook excerpt;
- benefits overview;
- company directory;
- sample blank W-4;
- sample direct-deposit packet;
- stale recruiter export;
- other-employee payroll sample.

Each document should have a clear role:

- `extract`: primary evidence for a fact;
- `corroborate`: repeats a known fact;
- `ignore`: realistic noise or instructions;
- `stale`: old value that should not win;
- `other-person`: facts owned by someone else.

Defer explicit `conflict` documents until after the first packet works. Stale
and other-person cases are enough for the first realistic challenge tier.

Exit criteria:

- 25-35 planned documents;
- manifest fact contracts are explicit;
- challenge tags identify stale, other-person, missingness, and instruction
  noise cases;
- plan-only validation passes before bodies are generated.

### Checkpoint 7: Build The Packet Corpus

Status: complete for `packet-small`; fixture complete for `packet-medium`.
Packet-medium live evaluation remains pending.

Generate or author the document bodies in small batches.

Build two tiers for the same user and forms:

```text
corpus: packet-small
forms: i-9, fw4, direct-deposit
documents: 6-10
size: small enough to inspect by hand
purpose: control run for form maps, profile facts, and live ingestion plumbing
```

```text
corpus: packet-medium
forms: i-9, fw4, direct-deposit
documents: 25-35
size: 60-120 KB
purpose: harder open-schema dossier with realistic noise and stale/other-person
         challenge cases
```

The small corpus isolates field-map and ingestion issues from context-size
issues. If `packet-small` fails, fix the fixture or runner path before making
the medium corpus harder.

Review for:

- fact correctness;
- realistic source shape;
- missing and stale facts behaving as intended;
- intentionally missing facts staying absent from user-owned evidence;
- sample/blank forms not introducing user facts;
- other-person facts being plausible but attributable.

Exit criteria:

- `packet-small` validates and is easy to inspect;
- `packet-medium` validates; done;
- `validation-report.json` is regenerated if this becomes a committed fixture;
- document count and byte count are recorded for each corpus; done for
  `packet-medium` in `medium-packet/implementation-summary.md`.

## Phase 2: Evaluate Multiple Forms From The Same Dossier

### Checkpoint 8: Add Separate One-Form Scenarios

Status: complete for `packet-small` and `packet-medium`.

Do not start with a new multi-form scenario format.

Create separate scenarios that share the same user and corpus:

```text
<user>-i9-packet-small
<user>-fw4-packet-small
<user>-direct-deposit-packet-small
<user>-i9-packet-medium
<user>-fw4-packet-medium
<user>-direct-deposit-packet-medium
```

Each scenario remains normal:

```text
same user
same corpus
one form
one score report
```

Exit criteria:

- each scenario validates;
- each scenario can be run independently;
- expected snapshots or output artifacts follow the existing eval conventions.

### Checkpoint 9: Run The Shared-Memory Evaluation

Status: complete for `packet-small`; pending live run for `packet-medium`.

The intended behavior is:

```text
reset packet user memory
live open-schema ingest packet-small once
  -> fill I-9
  -> fill W-4
  -> fill direct deposit
  -> run direct no-memory baseline for each form

reset packet user memory
live open-schema ingest packet-medium once
  -> fill I-9
  -> fill W-4
  -> fill direct deposit
  -> run direct no-memory baseline for each form
```

This must use the live ingestion/form-fill path, not deterministic `eval:run`.
The deterministic runner does not read the documents and would not exercise the
larger dossier.

Known-schema can be run first as a stepping stone if it helps debug the
fixtures. The result to show should be open-schema.

The first implementation can be manual orchestration or a thin wrapper around
existing live eval commands. The wrapper should ingest once, keep the backend
memory for the same user, then call form fill once per form. Re-ingesting per
form is acceptable as a fallback, but the preferred signal is one memory setup
reused across all forms.

Start with one run per corpus (`N=1`). Label early numbers as directional until
repeat runs are added later. Reset memory before each full corpus run, but keep
memory intact across the three form fills inside a run.

Direct baseline warning: the current direct no-memory path has an evidence cap
around 200K characters. This is not blocking for `packet-small` or the planned
60-120 KB `packet-medium`, but any future larger corpus must warn or fail
clearly before comparing stored-memory results against a truncated direct
baseline. Otherwise the stored-vs-direct delta is confounded by baseline
truncation.

Packet-small address caveat: W-4 and direct deposit use form-ready composite
address facts (`address.current.streetLine` and
`address.current.cityStateZip`). Open-schema database scoring now derives these
composites from active atomic address components when needed. Form scoring stays
strict, so missing apartment text or malformed `City, ST ZIP` still counts as a
form-fill error.

Packet-small live result:

```text
artifact root: /private/tmp/packet-small-clear-email-domains-20260622T010738Z
MCP shared memory: 24/24 known facts recovered, 2/2 missing facts absent
MCP forms:         I-9 12/12, W-4 6/6, direct deposit 9/9
Direct forms:      I-9 12/12, W-4 6/6, direct deposit 9/9
```

Direct extraction recovered all known packet facts for I-9 and direct deposit.
The W-4 direct extraction recovered 22/24 known packet facts, missing
`banking.accountNumber` and `identity.middleInitial`; those misses did not
affect the W-4 form score because the mapped W-4 fields do not use those facts.

Exit criteria:

- `packet-small` open-schema run completes; done;
- `packet-medium` open-schema run completes;
- direct no-memory baseline input size is checked against the evidence cap, or
  documented as safely below it;
- all three forms are filled from the same memory setup for each corpus; done
  for `packet-small`;
- direct no-memory baseline outputs exist for each form and corpus; done for
  `packet-small`;
- per-form stored-memory and direct-baseline score reports exist for each
  corpus; done for `packet-small`;
- failures can be traced to extraction, memory storage, or form-fill behavior.

### Checkpoint 10: Add Packet-Level Reporting

Status: complete enough for packet-medium. `eval:e2e-mcp-packet` writes one
packet artifact, per-scenario score paths, and a concise `qualitySummary` so
`status: pass` is not mistaken for perfect scoring.

Keep per-form reports and add a small overall packet summary. The packet summary
should not replace per-form scores; it should make cross-form results easier to
read.

Use simple scoring first:

```text
overall packet score = average of per-form scores
```

Do not pool all mapped fields into one giant score for v1. Pooling would
overweight repeated identity fields such as name, SSN, and address. If needed,
add shared-fact versus form-specific diagnostics later.

Useful packet metrics:

- I-9 score;
- W-4 score;
- direct-deposit score;
- overall packet score as the average of the three per-form scores;
- direct no-memory baseline score per form;
- stored-memory versus direct-baseline delta per form;
- overall stored-memory versus direct-baseline delta;
- one shared open-schema memory/database score per corpus;
- intentionally missing abstention;
- stale-value false positives;
- other-person false positives;
- hallucinated skip fields;
- compact error summary by form, with links or paths to detailed per-field
  score reports;
- document count, byte count, estimated token count;
- runtime and model cost.

Score decomposition should stay simple:

- memory/database score runs once per corpus because the stored dossier is
  shared;
- form-fill score runs once per form;
- direct no-memory baseline score runs once per form;
- detailed per-field reports remain the source of truth for tracing exactly
  what went wrong.

Packet-small reporting caveats learned from the first run:

- `status: pass` means the pipeline completed, not that every field was correct.
- `sourceSlugAgreementRate` is diagnostic only for open-schema runs; correct
  values can cite novel active slugs.
- SF 1199A split account/routing digit boxes are intentionally skipped/not
  scored in v1.

Exit criteria:

- packet summary includes both per-form scores and an overall score;
- packet summary includes stored-memory versus direct-baseline deltas;
- packet summary compares `packet-small` and `packet-medium`;
- per-field score artifacts remain available for debugging;
- the output is small enough to review in PRs.

## Suggested Order

1. Done: create the new user profile with base, tax, and banking facts.
2. Done: add direct deposit form fixture and minimal field map.
3. Done: add W-4 minimal field map.
4. Done: plan, author, and validate `packet-small`.
5. Done: add one-form scenarios for `packet-small`.
6. Done: run live open-schema and direct no-memory baseline on `packet-small`.
7. Done: add packet `qualitySummary` reporting cleanup.
8. Done: checkpoint packet-small changes.
9. Done: plan `packet-medium`.
10. Done: author `packet-medium` documents.
11. Done: validate `packet-medium`.
12. Done: add one-form scenarios for `packet-medium`.
13. Next: run the shared-memory open-schema eval and direct no-memory baseline.
14. Add packet-level reporting with per-form, overall, and stored-vs-direct
    scores.

## Deferred Work

- Full FAFSA mapping.
- SF-86 correctness benchmark.
- Scanned-image OCR fixtures.
- New multi-form scenario schema.
- Large 100-document corpus generation.
- Explicit conflict documents before stale and other-person challenge cases are
  stable.
- Repeat-run variance reporting beyond single-run directional numbers.
- More complex overall scoring beyond averaging per-form scores.
- Future large tiers over the direct baseline's evidence cap; these need an
  explicit warning/failure or a revised baseline before stored-vs-direct
  comparisons are meaningful.
