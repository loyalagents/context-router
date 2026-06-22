# Packet-Medium Implementation Plan

- Status: implementation plan
- Last updated: 2026-06-22
- Scope: harder shared-dossier packet for Maya Chen across I-9, W-4, and
  direct deposit

## Goal

Build `packet-medium` as the first harder context-size tier for the new-hire
packet evaluation.

The goal is not to add a more complex runner. The goal is to make the dossier
larger and more realistic while keeping the same open-schema comparison:

```text
stored-memory path:
  docs -> live open-schema extraction/storage in DB -> fill forms from memory

direct no-memory baseline:
  docs -> model fills each form directly from docs, no DB memory
```

`packet-small` already proves the plumbing works. `packet-medium` should test
whether that behavior holds when the model sees more context, more realistic
documents, and more distractors.

## Big Goals

- Increase context size with more documents and some larger documents.
- Make the dossier feel realistic enough to expose extraction and selection
  mistakes.
- Use one shared dossier to fill I-9, W-4, and direct deposit.
- Keep the implementation simple and extensible.

## Non-Goals

- Do not add a new multi-form scenario format.
- Do not add a new manifest schema version. `packet-medium` should stay on
  `schemaVersion: 2` and use the existing manifest fields.
- Do not add complex conflict scoring in this pass.
- Do not require online examples before v1.
- Do not map SF 1199A split routing/account digit boxes yet.
- Do not add repeat-run statistics yet. Use `N=1` and label results
  directional.
- Do not use known-schema as the headline result. It can remain a debugging
  aid, but the result should be open-schema stored memory versus direct
  open-schema no-memory.

## Corpus Shape

```text
user: maya-chen-newhire
corpus: packet-medium
manifest schemaVersion: 2
forms: i-9, fw4, direct-deposit-sf1199a-24
documents: 25-35
target source size: 60-120 KB
```

The planned size stays below the direct baseline's 200K-character evidence cap,
so stored-memory versus direct should remain fair for this tier.

Add three normal one-form scenarios:

```text
maya-chen-newhire-i9-packet-medium
maya-chen-newhire-fw4-packet-medium
maya-chen-newhire-direct-deposit-packet-medium
```

## Document Contract

Every document should have an explicit manifest contract. The manifest is the
source of truth for what a document is supposed to prove and what it must not
accidentally prove.

Use the existing V2 manifest fields exactly. Do not invent new role fields for
stale or other-person documents.

For each document, record:

- document id, title, file path, and source kind;
- `category`, using the current enum values such as `identity`,
  `address-contact`, `hr-onboarding`, `payroll-tax`, `work-authorization`,
  `employer-context`, `partial-conflicting`, or `noise`;
- `evaluationRole.detailTier`, `authority`, `freshness`, `expectedUse`, and
  `challengeTags`;
- `factContract.include` for current Maya profile facts that should appear in
  the document body;
- `factContract.forbid` for current Maya profile facts that must not appear in
  that document;
- intentionally missing facts, when the absence is part of the test;
- owner context through document content and `challengeTags`, such as
  `other-person` or `sample-packet`;
- source date or status cue when the document is stale or mixed.

This preserves the packet-small discipline: for each document, we know which
values are included and which values are intentionally not included.

Manifest field conventions:

```text
current Maya evidence:
  freshness: current
  expectedUse: extract or corroborate
  factContract.include: current profile fact keys

stale or superseded evidence:
  freshness: stale or mixed
  expectedUse: guardrail or ignore
  challengeTags: stale-address, stale-banking, stale-email, etc.
  factContract.include: usually empty unless the doc also proves current facts

other-person or sample evidence:
  category: noise
  freshness: unknown
  expectedUse: ignore
  challengeTags: other-person, sample-packet, sample-form, etc.
  factContract.include: empty
```

All `factContract.include` paths should already be leaf facts in
`profile.yaml`. Do not invent new fact keys to make a medium document pass.

## Stale Documents

Add support for stale or out-of-date documents in the corpus design now, but do
not turn stale handling into a new scorer yet.

For `packet-medium`, include a small number of stale documents, probably 3-5.
They should be recognizable both to humans and to models through document text
and manifest tags.

A stale document should have:

- `evaluationRole.freshness: "stale"` or `"mixed"`;
- `expectedUse: "guardrail"` or `"ignore"` unless it also contains current
  evidence that should be extracted;
- a descriptive challenge tag such as `stale-address`, `stale-banking`, or
  `stale-email`;
- an old source date;
- source-body language using validator-recognized stale cues such as `old`,
  `stale`, `superseded`, `inactive`, `outdated`, or `do not use`;
- old values that differ from current facts;
- old values kept out of `factContract.include`, because includes mean current
  Maya truth.

For v1, stale docs are a challenge case. They should test whether ingestion and
direct extraction prefer current evidence over old evidence. Later, if this
becomes important, stale-value false positives can become a dedicated metric.

Make stale ownership intentionally obvious in this first medium tier, for
example:

```text
Status: Superseded - old recruiter record. Do not use for current onboarding.
```

This is intentionally less subtle than a real stale artifact. Document that
simplification in `increase-form-complexity/TODO.md`, and add a short code
comment in any medium-packet fixture-generation helper that gets introduced.
The future version can make stale evidence more realistic once the obvious case
is working.

## Other-Person Documents

There is no first-class `owner` or `personScope` manifest field today. For v1,
track other-person documents with the existing fields:

```text
category: noise
freshness: unknown
expectedUse: ignore
challengeTags: other-person, sample-packet
factContract.include: []
```

Make other-person ownership intentionally obvious in the document body. This is
deliberate for the first medium run so failures are easy to interpret.

Example:

```text
Sample employee packet
Employee: Jordan Avery
Worker ID: PLC-SAMPLE-771
This is a sample record, not Maya Chen's onboarding record.
```

Start with one or two clearly named non-Maya people. More subtle ownership
boundaries can wait until the obvious case works and stale/other-person mistakes
show up as meaningful failure modes.

## Phone Distractors

`contact.phone` stays intentionally missing for Maya. `packet-medium` may
include a few fake phone numbers in support, bank, employer, stale, or
other-person documents if they are clearly not Maya's current contact phone.

The validator currently warns on phone-like text anywhere in a corpus where
`contact.phone` is intentionally missing. That warning is conservative and
acceptable for medium if reviewed. Do not add validator complexity just to avoid
these warnings.

If `intentionallyMissing[].withheldValue` is used for a fake Maya phone, that
exact value must never appear in a current Maya-owned document. A matching
withheld value in current evidence should remain an error.

## Online Inspiration

Skip online form/document inspiration for v1. Author documents from realistic
patterns already visible in packet-small and common onboarding workflows.

If the medium docs start to feel repetitive or unrealistic, use public examples
later only for document structure and wording patterns. Do not copy real
personal data, and do not make online sourcing a blocker for packet-medium.

## Proposed Document Set

This is a starting plan, not a rigid checklist. Keep the final corpus in the
25-35 document range and adjust while authoring if the manifest stays clear.

Identity and work authorization:

- current driver license OCR;
- current SSN card OCR;
- identity verification intake note;
- I-9 Section 1 draft/export;
- work authorization checklist or onboarding case note.

Address and contact:

- HR onboarding profile export;
- lease, mail, or address verification transcript;
- employee contact preferences export;
- emergency-contact setup export with no usable employee phone value.

Employment and company context:

- offer letter excerpt;
- onboarding assignment export;
- company directory profile;
- IT account provisioning export with work email only;
- payroll onboarding checklist.

W-4 and tax:

- W-4 withholding setup export;
- payroll tax profile export;
- W-4 review or approval note;
- W-4 instructions/help article;
- blank or sample W-4 packet.

Direct deposit and banking:

- direct-deposit portal confirmation;
- bank portal/account verification;
- voided-check OCR transcript or bank letter;
- payroll direct-deposit instructions;
- sample direct-deposit packet.

Corroborating current evidence:

- benefits enrollment profile;
- payroll preview export;
- employee self-service audit log;
- onboarding support ticket with current facts.

Stale or out-of-date evidence:

- stale recruiter export with old address or old email;
- stale payroll draft with prior bank-account suffix or old bank name;
- stale onboarding export with placeholder start date, old title, or old
  department;
- optional stale contact profile that still must not supply `contact.phone`.

Other-person, sample, and instruction noise:

- other-employee sample packet;
- other-employee direct-deposit sample;
- other-employee W-4/tax sample;
- support, employer, bank, or other-person phone distractors that are clearly
  not Maya's phone;
- employee handbook excerpt;
- onboarding FAQ or payroll support article.

## Checkpoint 1: Plan The Manifest Skeleton

Tasks:

- Create `examples/eval/users/maya-chen-newhire/corpora/packet-medium/`.
- Start from the packet-small manifest shape.
- Keep `schemaVersion: 2`.
- Add document ids, titles, roles, source dates, and planned fact contracts
  before writing all document bodies.
- Decide which docs are current evidence, stale evidence, other-person
  evidence, samples, and instructions.
- Use real manifest fields for role mapping: `category`,
  `evaluationRole.freshness`, `evaluationRole.expectedUse`,
  `evaluationRole.challengeTags`, `factContract.include`, and
  `factContract.forbid`.
- Create or update `increase-form-complexity/TODO.md` with deferred follow-ups,
  including making stale and other-person cues subtler later.
- If implementation adds a fixture-generation helper or authoring script, add a
  short code comment near the stale/other-person fixture definitions explaining
  that these cues are intentionally obvious for v1.
- Run plan-only validation:

  ```bash
  pnpm eval:validate --user maya-chen-newhire --corpus packet-medium --plan-only
  ```

Exit criteria:

- The corpus has a clear 25-35 document plan.
- Stale and other-person challenge docs are tagged explicitly.
- Each planned doc has included and excluded fact intent.
- Plan-only validation passes.

## Checkpoint 2: Author Documents In Batches

Tasks:

- Author documents in batches of about 8-10 docs.
- Validate after each batch instead of waiting for the full corpus.
- Prefer realistic plain text, OCR text, exported profile text, support ticket
  text, and checklist text over elaborate generation logic.
- Keep `contact.phone` intentionally missing from user-owned evidence unless
  the expected truth changes.
- Keep fake phone numbers, stale values, and other-person values attributable so
  the model has a fair reason to ignore them.
- Use accepted stale cue words such as `old`, `stale`, `superseded`,
  `inactive`, `outdated`, or `do not use`; do not widen the validator regex in
  this pass.
- Keep other-person cues obvious for v1. Prefer an explicit sample employee
  name and worker id over ambiguous ownership.

Exit criteria:

- Document bodies match their fact contracts.
- Current facts are findable in current or corroborating docs.
- Stale, sample, and other-person facts are plausible but clearly not current
  Maya facts.
- Any phone-related validation warnings are expected, reviewed, and recorded in
  the implementation summary.

## Checkpoint 3: Add Packet-Medium Scenarios

Tasks:

- Add one-form scenario directories for I-9, W-4, and direct deposit.
- Point all three scenarios at `user: maya-chen-newhire` and
  `corpus: packet-medium`.
- Reuse the existing form maps, scoring, skip sets, and open-schema storage map.

Exit criteria:

- Each scenario validates independently.
- No new multi-form scenario format is introduced.

## Checkpoint 4: Validate The Fixture

Run:

```bash
pnpm eval:validate --user maya-chen-newhire --corpus packet-medium --write-report
pnpm eval:validate --scenario maya-chen-newhire-i9-packet-medium
pnpm eval:validate --scenario maya-chen-newhire-fw4-packet-medium
pnpm eval:validate --scenario maya-chen-newhire-direct-deposit-packet-medium
pnpm eval:test
```

Exit criteria:

- Validation passes with zero errors.
- Expected reviewed warnings, such as fake phone distractors, are recorded and
  explained if they remain.
- `validation-report.json` records document count, byte count, and fact
  coverage.
- The source size is below the direct baseline evidence cap.

## Checkpoint 5: Run The Live Open-Schema Comparison

Use the existing packet wrapper for stored-memory MCP:

```bash
pnpm eval:e2e-mcp-packet \
  --agent claude \
  --schema-mode open \
  --form-mode backend \
  --user maya-chen-newhire \
  --corpus packet-medium \
  --scenarios maya-chen-newhire-i9-packet-medium,maya-chen-newhire-fw4-packet-medium,maya-chen-newhire-direct-deposit-packet-medium \
  --artifacts-root "$ART/mcp-open-packet" \
  --mcp-server "$MCP_SERVER" \
  --mcp-config "$MCP_CONFIG" \
  --reset-demo-data \
  --model-label "$EVAL_MODEL_LABEL"
```

Run the direct open-schema no-memory baseline once per scenario, using the same
corpus and the same field maps/skip sets.

Exit criteria:

- MCP ingestion runs once for the shared dossier.
- I-9, W-4, and direct deposit fill from the same stored memory.
- Direct open-schema baseline artifacts exist for all three forms.
- The summary confirms both paths used the same committed corpus, scenario ids,
  form maps, skip sets, and full document set under the direct evidence cap.
- The summary records model labels, prompt paths or prompt versions, and
  artifact roots so the comparison is presented as a system-path comparison,
  not an accidental same-model benchmark.
- Errors can be traced to ingestion, memory storage, direct extraction, or
  form filling.

## Checkpoint 6: Summarize And Update Orchestration

Tasks:

- Write `medium-packet/implementation-summary.md`.
- Include files changed, final corpus shape, validation commands, live-run
  status, score summary, known limitations, and next recommended step.
- Include a simple human-review table:

  ```text
  doc id | category | freshness | expectedUse | include facts | forbid facts | challengeTags
  ```

- Update `orchestration.md` with packet-medium status and a pointer to the
  summary.

Exit criteria:

- The implementation summary exists.
- The orchestration doc accurately reflects packet-medium progress.
- Any deferred stale/conflict scoring ideas remain documented without blocking
  the medium corpus.
- `increase-form-complexity/TODO.md` captures follow-ups for subtler stale and
  other-person docs, stale-value metrics, conflict tests, and any online
  inspiration work.

## Open Questions

- Exact stale document count: start with 3-5 unless implementation shows this is
  too noisy.
- Whether to add any same-user conflicting current documents: recommend no for
  v1. Use stale and other-person docs first.
- Whether stale values should become a first-class false-positive metric:
  defer until after the medium run shows whether stale data is a real failure
  mode.
- Whether to use online inspiration: defer unless hand-authored documents feel
  too repetitive or unrealistic.
- Whether to keep phone distractors if warnings become noisy: start with a few
  clearly attributable fake phone numbers and accept reviewed warnings unless
  they hide real leakage.
