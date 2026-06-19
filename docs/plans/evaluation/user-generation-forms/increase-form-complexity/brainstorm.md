# Increase Evaluation Context Complexity Brainstorm

- Status: temporary brainstorm
- Last updated: 2026-06-19
- Scope: concise synthesis for making form evaluation harder by increasing
  context size, improving document realism, and reusing one dossier across
  multiple forms while keeping the implementation simple

## Summary

The highest-leverage direction is a shared dossier eval:

```text
one synthetic user profile
  -> one larger, realistic document corpus
  -> one ingestion/memory setup
  -> several normal one-form scenarios
```

This makes the model handle more context and more realistic evidence without
requiring a complex new runner. Each form can still be evaluated separately.
The multi-form behavior comes from sharing the same user, corpus, and memory
setup.

There are two useful tracks:

- Context-only expansion: grow an existing I-9 corpus while preserving the same
  expected I-9 output. This isolates the effect of more context.
- Packet expansion: create one richer dossier that can fill I-9, W-4, and
  direct deposit from the same memory. This tests reusable memory.

## Keep-It-Simple Rules

- Keep `profile.yaml` as the only canonical truth file.
- Add difficulty through corpus data first: more documents, longer documents,
  stale facts, other-person facts, blank-form samples, and realistic boilerplate.
- Reuse the existing V2 `manifest.json` shape: `forms[]`, document roles,
  source specs, fact contracts, challenge tags, and intentionally missing facts.
- Add multiple one-form scenarios that point to the same user and corpus before
  adding any new multi-form runner concept.
- Map only a small field subset when adding a form. Skip signatures,
  attestations, employer-only fields, certification boxes, and ambiguous fields.
- Change one difficulty knob at a time so regressions are explainable.

## Context Size Ladder

| Tier | Shape | Purpose |
| --- | --- | --- |
| current | Existing 10-document Alex I-9 corpus, about 22 KB | Baseline realistic fixture. |
| `realistic-medium` | 20-30 docs, roughly 50-100 KB | More context with mostly benign distractors and same target truth. |
| `realistic-large` | 40-60 docs, roughly 150-300 KB | Stale facts, conflicts, other-person facts, repeated sections. |
| `packet-medium` | 25-40 docs, 2-3 forms | Same dossier fills several forms from one memory setup. |
| `stress` | 75-100+ docs or one very large form | Optional context-limit testing after lower tiers are stable. |

For every tier, record document count, byte count, and estimated token count.
When only adding distractors, keep expected form output unchanged.

## First Packet Recommendation

Start with a new-hire packet:

- I-9: already mapped and useful as the anchor.
- W-4: already has a PDF fixture; add a minimal field map.
- Direct deposit: add a small direct-deposit form fixture.

Direct deposit can be either:

- a simple synthetic payroll direct-deposit form, easiest for a first pass; or
- official SF 1199A, more realistic but potentially more PDF-mapping work.

The first pass should map only obvious fields:

- identity and address fields;
- SSN where appropriate;
- W-4 filing status and simple withholding fields;
- direct-deposit bank name, routing number, account number, account type, and
  account holder name.

## User Strategy

Prefer a new synthetic user for the packet.

Why:

- Alex remains a stable I-9 comparison.
- Tax, banking, payroll, and direct-deposit facts can be added freely.
- The packet can be tuned around multi-form reuse instead of preserving a
  previously useful fixture.

Extending Alex is still useful for a context-only I-9 expansion because it keeps
the existing I-9 expected output comparable.

## Profile Facts To Add

For the new-hire packet, keep the profile narrow:

- identity: legal name, first/middle/last, middle initial, other last names,
  date of birth, SSN;
- contact and address: email, phone or intentional null, current address;
- work authorization: I-9 citizenship/status and relevant identifiers;
- employment: employer, title, worker id, start date, work email;
- tax: filing status, multiple-jobs flag, dependents, other income, deductions,
  extra withholding, exemption claim;
- banking: institution name, routing number, account number, account type,
  account holder name.

Do not add signatures, certifications, or current-form legal attestations as
durable profile facts unless the eval explicitly needs to test them.

## Document Families

Use source-native document shapes instead of generic prose.

High-signal extraction docs:

- driver-license OCR transcript;
- SSN card OCR transcript;
- work-authorization upload receipt;
- payroll profile export;
- W-4 setup export or draft;
- direct-deposit setup confirmation;
- bank letter or voided-check OCR transcript.

Corroborating docs:

- offer email;
- HR onboarding profile export;
- employee profile export;
- lease or utility bill for address;
- payroll welcome email.

Noise and instruction docs:

- employee handbook excerpt;
- benefits overview;
- blank W-4 instruction packet;
- sample direct-deposit packet;
- company "how to complete your I-9" guide.

Adversarial docs:

- stale recruiter export with old address or email;
- old benefits profile with stale phone;
- other employee sample W-4;
- company directory with manager and HR phone numbers;
- support ticket that mentions the user plus non-user identifiers.

## Realism Notes

Good fixture docs should look like the systems that produced them:

- OCR transcript: filename, capture time, crop regions, confidence scores,
  redaction flags, status, extracted text blocks.
- Portal export: account id, export timestamp, nested fields, internal codes,
  null fields, audit metadata.
- Email: sender, recipients, date, subject, quoted thread, signature block.
- Ticket: requester, assignee, ticket id, status, update log, stale values,
  final resolution.
- Statement or bank letter: institution name, statement period, masked account,
  address block, transaction-like or account-summary rows.

Public forms and sample templates are useful as structure references. Copy
layout, labels, section order, and density; do not copy real personal data.
All canonical values should still come from `profile.yaml`.

## Difficulty Knobs

Add these independently:

- Volume: more documents with the same truth.
- Length: longer documents with realistic boilerplate.
- Density: more facts per document.
- Sparsity: one critical fact appears only once.
- Recency: old value plus current value.
- Authority: low-authority mention versus high-authority source.
- Ownership: user fact versus spouse, manager, landlord, HR, or other employee
  fact.
- Shape: scalar versus array, full name versus split name, masked versus
  unmasked identifiers, date format variants.
- Derivation: middle name to middle initial, address parts to one field,
  citizenship status to checkbox.
- Missingness: true null surrounded by phone-like, date-like, and id-like
  distractors.
- Form reuse: same fact needed by several forms under different labels.
- Instruction noise: blank forms, instructions, policies, and sample values
  that should not become user memory.
- Order sensitivity: same corpus with shuffled document order.

## Packet Ideas After New Hire

Housing and income packet:

- Forms: rental application, SNAP/benefits first pages, optionally W-4.
- Useful facts: current and prior addresses, landlords, rent amounts,
  employment, income, household members, vehicles, emergency contact,
  references, benefits flags.
- Main value: household and third-party attribution.

Student-aid packet:

- Forms: FAFSA subset, rental or campus housing, optionally SNAP.
- Useful facts: student identity, school list, dependency status, parent or
  spouse facts, income, assets, benefits, household size.
- Main value: very large realistic form context, but should come later.

Security-dossier stress:

- Forms: SF-86, mostly as a stress and abstention target.
- Useful facts: residence history, employment history, education, foreign
  travel, relatives, financial/legal history.
- Main value: extreme context size; not a good first correctness benchmark.

## Measurement

Keep final form correctness as the headline. Add diagnostics that explain why a
form did or did not work:

- active-memory value recovery;
- shared-fact correctness across forms;
- recovered-but-derived values;
- recovered-but-different-shape values;
- intentionally missing abstention;
- stale-value false positives;
- other-person false positives;
- overfill and hallucinated skip fields;
- duplicate or low-quality schema definitions;
- unscored active preferences;
- runtime and model cost;
- document count, byte count, and estimated token count.

Direct Vertex/open-schema baselines are useful at every tier. They help
separate storage failures from raw model/context failures.

## Suggested First Slice

Create one `packet-medium` new-hire corpus before attempting a 100-document
benchmark.

```text
user: new synthetic new-hire user
corpus: packet-medium
forms: i-9, fw4, direct-deposit
documents: 25-35
target size: 60-120 KB
```

Steps:

1. Add or choose the direct-deposit form.
2. Add a minimal W-4 field map and direct-deposit field map.
3. Create the new user profile with tax and banking facts.
4. Create or generate the packet corpus.
5. Add three one-form scenarios:
   - `*-i9-packet-medium`
   - `*-fw4-packet-medium`
   - `*-direct-deposit-packet-medium`
6. Run all three against the same ingested memory setup.
7. Add a lightweight packet comparison report only after the separate form runs
   are stable.

## Avoid For Now

- Mapping all FAFSA or SF-86 fields before the small packet works.
- Adding scanned binary/image OCR as the first complexity jump.
- Introducing a new multi-form scenario schema before shared one-form scenarios
  prove useful.
- Generating 100 documents in one pass.
- Mixing many new forms, many new facts, and new scorer behavior in one batch.
- Letting public sample values or blank-form examples count as user evidence.

## Open Questions

- Should direct deposit use a simple synthetic PDF first, official SF 1199A
  first, or both in separate tiers?
- Should W-4 tax choices be explicit profile facts or derived from a small tax
  profile?
- Should context size reporting start with bytes only, then add estimated
  tokens later?
- Should blank form instructions be included in the corpus as noise, or only in
  the form-fill prompt path?
- Should packet-level reporting live in `compare-runs` or as a separate small
  summary script?
