# Realistic User Form Corpus Brainstorm

## Scope

This is a synthesis after reading the current eval planning docs, the
`examples/eval/scripts` generation/validation workflow, the existing realistic
brainstorm files in this folder, and the latest generated `alex-i9-test`
realistic corpus.

The current system has the right correctness rails:

- `profile.yaml` is the source of truth.
- `corpus-plan.json` declares intended fact placement and forbidden facts.
- `manifest.json` is generated from the plan.
- `eval:generate` writes preview documents one isolated call at a time.
- `eval:validate` checks schemas, inventory, declared fact presence, forbidden
  fact absence, structured file parseability, and corpus truth reporting.
- `eval:repair-generation` can repair deterministic document failures without
  weakening validation.

The realism problem is not that the rails are wrong. The problem is that the
model is being asked to write eval-shaped fact carriers instead of source
artifacts from a coherent user file bundle.

## Current Diagnosis

The latest Alex I-9 corpus is fact-correct enough to validate, but it does not
feel like a set of files someone actually has.

Concrete symptoms:

- The files are short. Several are under a page, and the JSON/YAML exports are
  only a few fields deep.
- Most documents start with a clean title and then list exactly the facts the
  validator needs.
- The style is repetitive: bold labels, tidy sections, no messy envelope,
  footer, revision, page, scan, routing, or system noise.
- The prompt literally starts with "synthetic eval fixture document" and says
  "Place every listed fact key somewhere in the body." That instruction leaks
  into the shape of the writing even when the words do not appear in the body.
- `plan-corpus.mjs` gives each archetype only a one-sentence `texture`, so the
  model has no rich source genre to imitate.
- The validator's thinness floor is a correctness safety net, not a realism
  threshold: `hero` can pass at 120 non-whitespace chars, `medium` at 60, and
  `brief` at 20.
- Source semantics are sometimes wrong. For Alex, a birth-record summary cannot
  plausibly carry "alien authorized to work" status. That belongs in an I-9
  draft, HR review, EAD/I-94/passport upload receipt, or other
  work-authorization artifact.
- Some documents sound too official. A generated "Official Driving Record
  Transcript" with certification language is more brittle and less believable
  than a captured ID image OCR/export or employee-upload metadata.
- The lease introduces a management-office phone number even though the corpus
  is intentionally testing missing user phone. Until validation distinguishes
  source-only phones from user phones, generated source phone numbers should be
  redacted or omitted.
- Stale and noise documents are too disconnected from the user's file bundle.
  They are valid guardrails, but not very realistic as files the user would
  have saved next to onboarding documents.

The main script-level root causes are:

- `I9_ARCHETYPES` are title/texture/fact lists, not source-artifact specs.
- `buildBrief()` repeats validator-facing language into the plan brief.
- `buildDocumentPrompt()` foregrounds eval vocabulary and fact-key placement.
- There is no deterministic non-canonical "world" that lets the model add
  consistent surrounding details safely.
- Validation catches factual failures but has only minimal realism warnings.

## Comparison To Existing Brainstorms

The existing brainstorms are mostly aligned. I would treat their consensus as
the baseline:

- De-eval the prompt.
- Invert fact-to-document: generate complete source artifacts that happen to
  contain facts, not fact checklists with wrappers.
- Add compact per-archetype source specs.
- Add a seeded artifact/source world for non-canonical details.
- Keep deterministic validation as the hard correctness gate.
- Add realism lint/review after prompt and source-spec improvements.
- Replace or reframe the birth-record/work-authorization document for
  non-citizen profiles.
- Prefer native file formats and captured artifact genres over generic Markdown.

Where I would sharpen the prior notes:

- Start with a smaller source-spec contract than the largest proposed versions.
  The first useful change is not a giant schema; it is enough structure for the
  model to know source family, capture mode, native signals, safe details,
  risky details, timeline anchor, and natural length.
- Do not add adjacent-person SSNs, DOBs, phone numbers, or extra addresses yet.
  Adjacent people are a strong realism lever, but they need explicit
  `adjacentPersonFacts` or `decoyFacts` validation so we can tell intentional
  extraction challenges from accidental leaks.
- Avoid source phone numbers for now. The Alex lease warning shows that
  source-only phone values collide with the current missing-phone heuristic.
  Use redacted source phones until the plan/validator can mark them as
  source-only.
- Do not make every document long. Make every document naturally complete for
  its genre. An SSN card OCR note can be shorter than an offer packet, but it
  should still include capture/source metadata and realistic transcript shape.
- Avoid fake certification language unless the fixture explicitly needs it.
  "Captured upload OCR" and "portal export" are safer than "official
  certified record."
- Make provenance partly metadata, not only body text. Real files carry clues
  in filenames, folder placement, received/exported timestamps, and email
  envelopes.

## Recommended Model

Add three layers between `profile.yaml` and document generation:

1. `artifactWorld`
   Deterministic, seeded, non-canonical context shared across the corpus.

2. `sourceSpec`
   Per-document artifact instructions derived from the I-9 archetype and the
   relevant world slice.

3. `factContract`
   Canonical facts, forbidden facts, intentionally missing facts, and later
   decoy or adjacent-person facts.

The model prompt should lead with `sourceSpec` and only then state the
`factContract`. The validator can still own correctness after generation.

## Fact Zones

Use explicit zones so realism metadata cannot blur into user truth:

- `canonicalFacts`: profile facts this document is expected to contain.
- `forbiddenFacts`: profile facts this document must not contain.
- `intentionallyMissingFacts`: null profile facts that must not be invented.
- `sourceFacts`: non-canonical metadata from `artifactWorld`, such as source
  systems, export IDs, filenames, task IDs, timestamps, and coordinator names.
- `decoyFacts`: stale, sample, redacted, or otherwise non-authoritative values
  planned as future extraction challenges.
- `adjacentPersonFacts`: facts belonging to clearly named non-user people.

Only `canonicalFacts` may become form-fill or memory ground truth. `sourceFacts`,
`decoyFacts`, and `adjacentPersonFacts` exist to make artifacts plausible and
eventually harder to extract from, but they need collision checks and validation
support before they contain sensitive identifiers.

## Artifact World

Create a deterministic artifact world from `userId + corpusId`.

V1 decision: store a small `artifactWorld` in `corpus-plan.json`. It is
plan-owned, deterministic, reviewable before model calls, and available to
generation, repair, promotion, and future realism lints. Keep `manifest.json` as
the smaller inventory projection; do not copy `artifactWorld` into the manifest.

For I-9, a small v1 world is enough:

```json
{
  "schemaVersion": 1,
  "seed": "alex-i9-test__realistic",
  "timeline": {
    "offerSentAt": "2026-05-22T09:13:00-07:00",
    "offerAcceptedAt": "2026-05-24T16:02:00-07:00",
    "onboardingInviteAt": "2026-05-27T08:44:00-07:00",
    "i9DraftSavedAt": "2026-06-03T14:18:00-07:00",
    "identityUploadAt": "2026-06-03T14:27:00-07:00",
    "addressProofExportAt": "2026-06-04T18:06:00-07:00",
    "staleRecordAt": "2024-11-15T10:20:00-08:00",
    "noiseReceivedAt": "2026-05-30T07:19:00-07:00"
  },
  "employer": {
    "hrCoordinator": "Maya Chen",
    "onboardingSystem": "Northstar Onboard",
    "recruitingInbox": "people-ops@cascadiahiring.example.test",
    "workerId": "CHR-20491",
    "officeLabel": "Portland Operations Hub"
  },
  "housing": {
    "propertyManager": "Evergreen Residential Services",
    "residentPortal": "ResidentLink",
    "leaseAccountId": "RL-49382"
  },
  "utility": {
    "provider": "Willamette Utility Services",
    "exportId": "WUS-EXP-20260604-1842",
    "serviceAccountSuffix": "4821"
  },
  "identityCapture": {
    "uploadBatchId": "UPL-6F91A",
    "licenseImageName": "IMG_4471_license_front.jpg",
    "ssnImageName": "IMG_4472_ssn_card.jpg"
  }
}
```

Rules:

- Values in `artifactWorld` are not profile truth.
- World values must not equal current profile facts unless copied through
  `factContract`.
- Collision checks should go beyond exact string equality where practical:
  normalized string equality, digit-only identifier collisions, email local-part
  or domain collisions, phone-like shapes when user phone is intentionally
  missing, and address-like strings containing the current street/unit/city.
- Use reserved domains and synthetic institution names.
- Prefer IDs, timestamps, system names, file names, source names, redacted
  fields, and workflow statuses over new personal identifiers.
- Keep the world small and reviewable. It should support source texture, not
  become a second profile.
- The world collision check is an authoring guard, not the leakage guarantee.
  The real backstop remains body-level validation of declared and forbidden
  facts after generation. Longer, richer documents will create more leakage
  surface, so do not loosen those validator checks to make realism easier.

## Source Spec Shape

Replace one-line `texture` with compact specs. A v1 source spec can be:

```json
{
  "artifactType": "onboarding-portal-field-export",
  "sourceFamily": "hr-onboarding",
  "captureMode": "yaml-export",
  "sourceSystemRef": "employer.onboardingSystem",
  "timelineRefs": ["onboardingInviteAt", "i9DraftSavedAt"],
  "nativeSignals": [
    "export metadata",
    "workflow status",
    "task IDs",
    "created and updated timestamps",
    "redacted internal IDs"
  ],
  "safeDetailMenu": [
    "HR coordinator name",
    "worker ID",
    "provisioning status",
    "onboarding task names",
    "portal status labels"
  ],
  "riskyDetailMenu": [
    "new user phone number",
    "extra immigration identifiers",
    "compensation details",
    "extra user addresses"
  ],
  "lengthTarget": {
    "minChars": 900,
    "maxChars": 2400
  }
}
```

The plan does not need to dump a huge world object into every document. It can
store a compact `sourceSpec` on each document and a shared `artifactWorld` at
the corpus-plan level.

Treat `riskyDetailMenu` as an avoid list, not inspiration. It is there so the
prompt can explicitly say which tempting details must not be invented.

## Native Signals

`DOCUMENT_NATIVE_SIGNAL_MISSING` needs a small catalog before implementation.
Suggested v1 mapping:

- email: `From`, `To`, `Date`, `Subject`, signature/footer, and optionally
  quoted context.
- portal export: export ID, exported/generated timestamp, source system, status,
  and nested fields.
- OCR transcript: upload filename, capture/upload timestamp, confidence markers,
  and extracted-text blocks.
- saved form field export: form version, field IDs, saved timestamp, workflow
  status, and native blank/null state.
- support ticket: ticket ID, status, requester/assignee, and event log.
- upload receipt: upload batch ID, filename, document category, processing
  status, and reviewer/system notes.

Keep this mapping in the archetype/source-spec catalog so prompts and lints use
the same expectations.

## Prompt Reframe

The current prompt should stop saying:

- synthetic eval fixture
- place every listed fact key
- profile slice
- canonical current facts, in body-facing prose
- validator
- benchmark

The model still needs exact facts and constraints. The fix is to keep the body
assignment artifact-first:

1. Output rules.
2. Artifact identity, source family, and capture mode.
3. Native signals required for this file type.
4. Allowed source-world details.
5. Person details that must be true wherever this artifact mentions them.
6. Facts that must not appear.
7. Intentionally missing facts and how this artifact should represent blanks,
   nulls, or redactions.

Suggested body-facing language:

```text
Write the captured body of this source artifact.
Return only the artifact body.

The person details below are true details for the employee/person when this
artifact mentions them. Include every required detail in a natural place for
this artifact's source and format.

The artifact may include only the source metadata and incidental details listed
in the source spec. Do not add new personal facts for the user.

Do not mention generation, evaluation, fixtures, fact keys, validators, profile
data, benchmark data, or synthetic data.
```

It is acceptable for internal structured sections to keep machine-readable names
such as `factKeys`, `forbiddenFactKeys`, or `profile`. Tests should distinguish
body-facing instruction prose from structured contract JSON. The key regression
to prevent is the writing assignment saying "synthetic eval fixture" or "place
every listed fact key."

Add a small negative prompt test set early:

- body-facing prose does not contain "synthetic eval fixture document"
- body-facing prose does not ask to "place every listed fact key"
- body-facing prose does not foreground "validator", "canonical facts",
  "profile slice", or "benchmark"
- structured sections still expose required and forbidden values for review and
  repair

## I-9 Ten-Pack Rewrite

1. Driver license

   Use uploaded ID image OCR or HR document-upload metadata, not a fake certified
   DMV transcript. Include upload filename, capture timestamp, scan confidence,
   issuing state, class, restrictions, and document status. Keep name, DOB, and
   current address exact.

2. SSN card

   Use card OCR/transcription plus upload metadata. Keep it compact but
   source-like. Avoid claims such as "this number has been established for..."
   unless the source artifact would really say that.

3. Work authorization support

   This is a fixed slot with status-based variants, not a count change. The
   corpus should still produce 10 documents after selection, but
   `buildCorpusPlan()` and its tests need to treat slot 003 as conditional.

   Suggested v1 matrix:

   - `U.S. citizen`: birth record, passport-note artifact, or citizenship
     document upload can support name/DOB/citizenship.
   - `noncitizen national`: passport or citizenship-status upload/review note.
   - `lawful permanent resident`: permanent resident card upload receipt or LPR
     HR review.
   - `alien authorized to work`: I-94, EAD, foreign passport upload receipt, or
     HR work-authorization review.
   - unknown/other: conservative HR review note that includes only declared
     non-null facts.

   Do not make a birth record carry work authorization status for Alex-style
   profiles.

4. Lease/address proof

   Make it a resident portal export or lease packet excerpt. Include account
   ID, property manager, lease status, term/renewal status, export timestamp,
   notice preference, and maybe a ledger or resident profile block. Redact any
   source phone until source-only phone metadata is supported.

5. Utility account export

   Keep JSON, but make it nested and vendor-like: export metadata, service
   agreement, account status history, service location, mailing/contact
   preferences, billing cycle, redacted account suffixes, and source timestamps.

6. I-9 Section 1 draft

   Make it an HRIS saved field export rather than polished Markdown. Include
   workflow status, form version, saved timestamp, field IDs, native blank/null
   phone state, attestation status, and signature-pending cue.

7. Offer letter

   Use a copied email body or offer packet excerpt. Add headers, letter date,
   acceptance deadline, contingency language, reporting context, orientation
   timing, coordinator signature, and work-email provisioning note. Most of
   these details should come from `artifactWorld`, not one-off inline invention.

8. Onboarding profile

   Expand YAML/JSON with source-system metadata, worker profile status, created
   and updated timestamps, worker ID, task status list, provisioning status, and
   audit fields. Avoid a bare `employee_profile` object. A body-language lint
   must not flag legitimate HRIS keys like `employee_profile` just because they
   contain the common word "profile."

9. Stale address artifact

   Use an old HR contact-card export, returned-mail ticket, or superseded
   address-update email. It should clearly say old/superseded/inactive and
   contain stale values only if the plan declares them as decoys later.

10. Noise artifact

   Make it a plausible unrelated file from the same broad life context: copied
   apartment newsletter email, community event message, benefits webinar invite,
   or portal announcement. Include headers, received timestamp, footer, sender,
   and unsubscribe/legal text. It should not read like generic filler.

## Length And Density

Current length thresholds are too low for realism. Keep `DOCUMENT_THIN` as a
validator warning, but start by using `sourceSpec.lengthTarget` as a generation
target. Turn stronger length checks into warning-only lints only after reviewing
a few generated corpora.

Suggested initial targets:

- `hero`: 1200-3500 chars, unless the artifact is a structured export with
  equivalent nested density.
- `medium`: 600-1800 chars.
- `brief`: 250-900 chars.

Exceptions should be source-specific. A card OCR artifact can be brief; an offer
letter, lease packet, or I-9 draft should not be.

For JSON/YAML, also consider structural density: key count, nested object count,
and presence of metadata/status/history sections.

Longer documents increase the surface area for accidental forbidden-shaped
values. Expect more `eval:repair-generation` cycles after raising length
targets, and do not loosen deterministic forbidden-fact checks to compensate.

Add a fact-density warning later. If canonical facts make up a large share of
visible text, the document will feel fake even if it passes a length threshold.
This also discourages padding just to hit a character range.

## Representation Variety

Make seeded surface variation a design goal. Real corpora repeat the same fact
in different forms:

- DOB: `03/14/1992`, `14 Mar 1992`, `1992-03-14`
- name: `Alex Jordan Rivera`, `RIVERA, ALEX J.`, `Alex Rivera`
- unit: `Apt 5C`, `Unit 5C`, `#5C`
- state: `OR`, `Oregon`

The generator should choose representation styles per source family from a
seeded set, and the validator must accept only declared deterministic variants.
This improves realism and exercises normalization without making fact matching
fuzzy or nondeterministic.

## Native Format Fidelity

Markdown should not be the default for every human-readable file.

Good source shapes for this workflow:

- copied email body with `From`, `To`, `Date`, `Subject`, and quoted context
- raw portal export
- HRIS YAML/JSON export
- OCR/plaintext transcript
- saved form field export
- upload receipt
- support ticket
- returned-mail note
- resident portal account export
- newsletter email

For `.txt`, avoid Markdown headings and bullets. For `.json` and `.yaml`, make
exports look like actual system data, not a hand-written fixture object.

## Realism Lints

Add advisory warnings before any LLM realism judge.

High-value deterministic lints:

- `DOCUMENT_EVAL_LANGUAGE`: body contains eval-context phrases such as
  `synthetic`, `fixture`, `fact key`, `validator`, `benchmark`, or
  `profile slice`. Do not ban common standalone words like `profile`,
  `canonical`, or `fact`; real HRIS exports can legitimately contain profile
  fields.
- `DOCUMENT_SOURCE_METADATA_MISSING`: current extract/corroborate docs lack
  date/source/export/status/capture metadata.
- `DOCUMENT_NATIVE_SIGNAL_MISSING`: source spec says email/export/OCR/upload
  receipt but body lacks the expected native signal.
- `DOCUMENT_SOURCE_PHONE_PRESENT`: source-only phone-like value appears before
  source-only phone metadata is supported. This can be a warning distinct from
  missing user phone.
- `DOCUMENT_FACT_DENSITY_HIGH`: canonical fact strings account for too much of
  the body.
- `DOCUMENT_TITLE_FIRST_LINE_REPEATED`: too many docs start with their manifest
  title.
- `DOCUMENT_MARKDOWN_PATTERN_OVERUSED`: too many docs use the same bold-label
  Markdown skeleton.
- `DOCUMENT_STALE_CUE_MISSING`: stale/guardrail doc lacks old/superseded/do not
  use/inactive cues.
- `CORPUS_SECTION_SKELETON_REPEATED`: several documents share the same heading
  sequence.
- `CORPUS_SOURCE_FAMILY_LOW_VARIETY`: too many docs share one artifact type or
  capture mode.

Keep these warning-level until they are calibrated against multiple generated
corpora. Each lint should have a crisp, testable measure before it ships; noisy
warnings train contributors to ignore the report. The lints are the durable
automated floor for future generations. A committed realistic fixture is only a
frozen exemplar.

## Decoys And Adjacent People

Adjacent people are a strong later lever: HR coordinators, recruiters, property
managers, co-tenants, emergency contacts, support agents, and email senders make
documents feel real and test attribution.

Do not add sensitive adjacent facts until the contract supports them.

Needed metadata first:

- `sourceFacts`: non-canonical source metadata.
- `decoyFacts`: stale/sample/redacted values that must not become current user
  truth.
- `adjacentPersonFacts`: facts belonging to clearly named non-user people.
- collision checks so none equal profile current facts.
- validation that adjacent/decoy values are clearly attributed and not listed as
  current `factKeys[]`.

Before that lands, use names and reserved-domain emails freely, but avoid
adjacent SSNs, DOBs, personal phone numbers, and extra addresses.

## Provenance

Real files carry provenance outside the body. Add plan or manifest fields later:

- `originalFilename`
- `filedUnder`
- `capturedAt`
- `modifiedAt`
- `sourceEnvelope` for email-like files: `from`, `to`, `subject`, `receivedAt`

This would let ingestion and review see realistic file-level clues without
forcing every body to include a fake `Report ID` line.

For v1, provenance should live in `sourceSpec` only and be rendered into bodies
when appropriate. Sidecar provenance is dormant until an import or ingestion
path consumes it, so do not build a larger sidecar contract before there is a
reader.

## Schema And Snapshots

Persisting `sourceSpec` or `artifactWorld` changes `corpus-plan.json`, so the
first implementation must update `examples/eval/schemas/corpus-plan.schema.json`
and decide whether `schemaVersion` stays compatible or bumps. `manifest.json`
should remain a small projection and should not gain source-realism metadata in
the first pass.

Work-authorization slot selection is also a code/test change, not just prompt
copy. The count invariant should remain "10 documents after status-based slot
selection."

Realism can intentionally make extraction harder. When document ingestion
evaluation exists, a more realistic corpus may change expected outputs from
`correct` to `missing` or expose hallucinations. Those changes should go through
the existing deliberate snapshot-update path; they are not automatically corpus
bugs if the fixture is more faithful and validation still passes.

## Implementation Order

Checkpoint 1: source-spec, schema, and prompt reframe

- Add compact `sourceSpec` fields to the I-9 archetypes.
- Update corpus-plan schema/tests for plan-owned `sourceSpec`.
- Update `buildBrief()` so it describes the artifact, not the eval mechanics.
- Update `buildDocumentPrompt()` to lead with artifact identity and remove
  body-facing eval vocabulary.
- Add prompt tests that assert banned body-facing terms are absent from the
  assignment text and that required/forbidden facts still appear in structured
  prompt sections.
- Keep deterministic body validation unchanged.
- Acceptance: focused tests prove body-facing eval language is gone while
  required and forbidden fact values remain inspectable in prompt contracts.

Checkpoint 2: I-9 semantic fixes that do not require shared world richness

- Replace slot 003 based on `workAuthorization.citizenshipStatus`, preserving
  the 10-document count.
- Reframe driver license and SSN card as captured upload/OCR artifacts.
- Reframe I-9 draft as HRIS field export.
- Avoid source phone numbers unless redacted.
- Add tests for slot-003 selection across citizen, lawful-permanent-resident,
  and alien-authorized profiles.
- Generate an Alex preview and manually compare against the current output.
- Acceptance: plan-only validation works, slot selection is deterministic, and
  the preview no longer uses fake official certification language for the ID
  and SSN artifacts.

Checkpoint 3: persisted artifact world and richer document context

- Add a small deterministic `artifactWorld` builder.
- Store `artifactWorld` in `corpus-plan.json`; keep it out of `manifest.json`.
- Feed each document only the world slice it needs.
- Add collision checks against profile fact values using normalized and
  identifier-aware matching where practical.
- Use the world to enrich lease, offer-letter, onboarding, utility, upload, and
  noise artifacts.
- Acceptance: artifact-world output is deterministic, collision checks have
  focused tests, and at least three document families consume world values.

Checkpoint 4: realism lints

- Add warning-only lints for eval language, length by source spec, missing
  source metadata, stale cue, Markdown overuse, and repeated skeletons.
- Keep `eval:repair-generation` focused on deterministic errors unless a
  realism repair mode is explicitly added later.
- Acceptance: new lints are warning-only, covered by unit tests, and calibrated
  against at least two generated or committed corpora before becoming part of
  normal fixture review.

Checkpoint 5: review and fixture bar

- Generate a fresh 10-doc preview.
- Run deterministic validation.
- Manually grade each document for provenance, genre fidelity, native format,
  source semantics, incidental detail, timeline coherence, and restraint around
  canonical facts.
- Commit a canonical realistic fixture only after it is visibly better than the
  current Alex output.
- Optionally add an advisory discriminator score later, comparing generated
  documents to hand-authored exemplars. Keep it advisory only; never let it
  affect deterministic pass/fail.

Later:

- Add `decoyFacts` and `adjacentPersonFacts`.
- Add composite files and email threads.
- Add hand-authored exemplars or contrastive examples.
- Add an advisory `eval:review-realism` command.
- Add realism repair only after review output is stable.
- Add user-to-user archetype variety after the first ten-pack is credible; the
  fixed ten slots will become the next source of sameness across generated
  users.

## Bottom Line

The fastest path to more realistic form-evaluation corpora is not a realism
judge. It is to stop asking the model to write synthetic fact documents.

Give every document a source, capture mode, timeline position, safe surrounding
world, native format expectations, and natural length. Keep profile facts
separate from source metadata. Keep deterministic validation as the hard gate.
Then add advisory realism lints so future generations fail visibly when they
slide back into short, tidy, eval-shaped files.
