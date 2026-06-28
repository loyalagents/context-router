# Make Forms Harder Orchestration

- Status: planning
- Last updated: 2026-06-28
- Scope: staged hardening of the Maya new-hire packet after `packet-medium`

## Goal

Make the packet evaluation harder without making the runner or form maps more
complicated.

The next work should add difficulty through the dossier itself. Keep the same
basic evaluation shape:

```text
one Maya profile truth file
  -> one shared packet corpus
  -> live open-schema storage in backend memory
  -> I-9, W-4, and direct deposit filled from that same memory
```

The headline comparison remains open-to-open:

```text
stored-memory MCP path:
  docs -> live open-schema extraction/storage in DB -> fill forms from memory

direct no-memory baseline:
  docs -> direct open-schema extraction/fill, no backend memory
```

The first hard packets should test whether the system stores and fills the
right user-owned facts, not whether it can survive a large rewrite of the eval
tooling.

## Strategy

Create new labeled packets instead of mutating `packet-medium`.

Recommended first packets:

```text
packet-hard-ownership-v1
packet-hard-conflict-v1
```

Keep each packet focused on one main difficulty family. Do not combine
ownership, temporal validity, weak evidence, subtle authority conflicts, and
new form mapping in the first pass. A focused packet makes failures easier to
interpret.

## Recommended PR Shape

Use a small PR ladder, but do not split skeleton-only fixture work into its own
PR unless it changes shared tooling or schema. For eval fixture work, a
skeleton without documents is usually too thin to justify separate review.

Recommended PRs:

1. Planning documentation.
2. Ownership packet fixture: skeleton, first ownership document batch,
   manifest metadata, validation report, three scenarios, and implementation
   summary. Implemented and validated in `ownership-hardening/`.
3. Ownership live-results summary and any tiny directly related cleanup.
4. Conflict packet fixture: skeleton, first conflict/temporal document batch,
   manifest metadata, validation report, three scenarios, and implementation
   summary.
5. Conflict live-results summary and any tiny directly related cleanup.

Split a PR when it changes shared eval tooling, scoring contracts, backend form
fill behavior, MCP behavior, or runner semantics. Keep new difficulty families
separate from each other even when the fixture mechanics are similar.

Do not combine ownership and conflict in the same first fixture PR. That
boundary matters more than separating skeleton creation from document authoring.

## Current Ownership Fixture Status

`packet-hard-ownership-v1` is implemented and validated as a fixture-only hard
ownership packet.

Implementation docs:

- `ownership-hardening/implementation-plan.md`
- `ownership-hardening/implementation-summary.md`

Fixture shape:

- one new corpus: `packet-hard-ownership-v1`;
- 35 total documents: copied `packet-medium` baseline plus five ownership
  challenge documents;
- three independent one-form scenarios for I-9, W-4, and direct deposit;
- no runner, scorer, backend, MCP, form-map, schema, or Maya profile changes.

Validation status:

```text
focused corpus validation: 0 errors, 48 warnings
whole-tree validation:     0 errors, 105 warnings
eval script tests:         313 passed
```

The new fixture introduced no `DOCUMENT_STALE_CUE_MISSING` warnings and no
forbidden current Maya values in ownership challenge bodies. The warning delta
is expected `DOCUMENT_SOURCE_PHONE_PRESENT` signal from mixed ownership
documents that contain current non-Maya phone values while Maya `contact.phone`
remains intentionally missing.

Checkpoint 5 remains the next step. The expected live-run signal is whether
Noah, Elena, Victor, Ari, or Taylor values appear in active memory, filled form
fields, wrong-fact counts, or overfill counts compared with `packet-medium`.

## Difficulty Order

### 1. Ownership And Admissibility

Question:

```text
This is a real fact, but does it belong to Maya?
```

Start here because it is the cleanest next step from `packet-medium`.
`packet-medium` already contains other-person and sample documents, but they
are intentionally obvious. The next packet should make those ownership
boundaries subtler while staying fair.

This does not require:

- new profile facts;
- new form maps;
- new forms;
- new runner behavior;
- a new manifest schema version.

### 2. Conflict And Temporal Validity

Question:

```text
This may belong to Maya, but multiple sources disagree. Which value should win?
```

Treat "this used to be true" as a conflict case. The system is choosing between
candidate values, where the current or higher-authority source should beat the
old, draft, stale, or low-authority source.

This should come after ownership because conflict failures are harder to
classify if ownership boundaries are not already working.

### 3. Evidence Confidence And Abstention

Question:

```text
Is there enough evidence to store or fill this fact?
```

Defer this until after ownership and conflict. It is valuable, but the first
version can become subjective quickly unless the evidence contract is very
careful.

## Checkpoint 1: Define Packet Labels

Tasks:

- Choose the first hard packet id: `packet-hard-ownership-v1`.
- Keep `userId: maya-chen-newhire`.
- Keep forms unchanged: `i-9`, `fw4`, and `direct-deposit-sf1199a-24`.
- Keep scenario shape unchanged: three normal one-form scenarios pointing at
  the new corpus.
- Document that this packet tests ownership/admissibility only.

Exit criteria:

- Packet name communicates the difficulty family.
- The packet can be compared against `packet-medium`.
- No new runner or schema behavior is required.

## Checkpoint 2: Add Ownership Challenge Documents

Add 4-6 ownership challenge documents on top of the Maya packet shape.

Good first examples:

- coworker direct-deposit confirmation for another Pacific Ledger employee;
- emergency contact record where the contact has a phone, email, and address;
- manager or company-directory profile adjacent to Maya's directory data;
- realistic sample W-4 with non-Maya tax values;
- payroll support ticket that mentions Maya and another employee in one thread;
- bank branch or payroll support document with account-like and phone-like
  values that are not Maya's facts.

For v1, make the ownership cues subtle but fair. Do not rely only on file names.
The body should include enough source-native context for a careful model to see
that the fact belongs to another person, role, contact, institution, or sample.

Exit criteria:

- Each ownership document has a clear private manifest intent.
- The model does not see answer-key labels, but the document body contains fair
  ownership evidence.
- Maya profile truth stays unchanged.

## Checkpoint 3: Label Challenge Intent In The Manifest

Use existing V2 manifest fields first.

For each ownership challenge document:

- set `category` to the closest current enum, often `noise`,
  `employer-context`, or `hr-onboarding`;
- set `evaluationRole.expectedUse` to `ignore` for pure non-Maya documents,
  `corroborate` for mixed documents with some Maya-owned facts, or `guardrail`
  only for genuinely stale or unsafe current-use material;
- set `evaluationRole.freshness` honestly, usually `current` or `unknown`;
- set `evaluationRole.authority` based on source role, not usefulness;
- set `evaluationRole.challengeTags` with ownership labels;
- avoid `factContract.include` for non-Maya facts;
- use `factContract.forbid` for current Maya facts that must not appear in the
  document body.

Suggested challenge tags:

```text
ownership-other-employee
ownership-emergency-contact
ownership-manager
ownership-shared-thread
ownership-sample-form
ownership-institution-contact
direct-deposit-decoy
tax-decoy
phone-distractor
```

Important: challenge tags are eval metadata. They should help humans,
validators, and later scorers group the fixture. They are not preference input
and should not be surfaced to the model as "ignore this document" hints.

Exit criteria:

- Each document's purpose is visible in manifest metadata.
- The document body remains the only evidence available to live ingestion.
- Future reports can group ownership failures by challenge tag.

## Checkpoint 4: Validate The Ownership Packet

Run focused validation:

```bash
pnpm eval:validate --user maya-chen-newhire --corpus packet-hard-ownership-v1 --write-report
pnpm eval:validate --scenario maya-chen-newhire-i9-packet-hard-ownership-v1
pnpm eval:validate --scenario maya-chen-newhire-fw4-packet-hard-ownership-v1
pnpm eval:validate --scenario maya-chen-newhire-direct-deposit-packet-hard-ownership-v1
```

Exit criteria:

- Validation has zero errors.
- Any warnings are reviewed and summarized.
- Corpus truth still proves current Maya facts.
- Ownership decoys do not accidentally contain current Maya values unless that
  is the explicit intended challenge.

## Checkpoint 5: Run The Ownership Packet

Run the stored-memory packet path:

```bash
pnpm eval:e2e-mcp-packet \
  --agent claude \
  --schema-mode open \
  --form-mode backend \
  --user maya-chen-newhire \
  --corpus packet-hard-ownership-v1 \
  --scenarios maya-chen-newhire-i9-packet-hard-ownership-v1,maya-chen-newhire-fw4-packet-hard-ownership-v1,maya-chen-newhire-direct-deposit-packet-hard-ownership-v1 \
  --artifacts-root "$ART/mcp-open-packet" \
  --mcp-server "$MCP_SERVER" \
  --mcp-config "$MCP_CONFIG" \
  --reset-demo-data \
  --model-label "$EVAL_MODEL_LABEL"
```

Run the direct packet baseline:

```bash
pnpm eval:direct-open-schema-packet \
  --user maya-chen-newhire \
  --corpus packet-hard-ownership-v1 \
  --scenarios maya-chen-newhire-i9-packet-hard-ownership-v1,maya-chen-newhire-fw4-packet-hard-ownership-v1,maya-chen-newhire-direct-deposit-packet-hard-ownership-v1 \
  --artifacts-root "$ART/direct-open-packet" \
  --model "$EVAL_DIRECT_OPEN_SCHEMA_MODEL"
```

Review:

- active memory for non-Maya facts;
- form fields filled with non-Maya values;
- correct Maya facts that went missing because ownership became confusing;
- intentionally missing facts such as `contact.phone`;
- unscored active preferences that look like ownership leakage.

Exit criteria:

- MCP and direct packet artifacts exist.
- Failures can be classified as ownership, normal extraction, storage, or
  form-fill errors.
- The result is summarized as directional `N=1`, not a benchmark guarantee.

## Checkpoint 6: Add Conflict And Temporal Validity

After the ownership packet is interpretable, create `packet-hard-conflict-v1`.

Add 4-6 conflict cases:

- old bank account vs current direct-deposit confirmation;
- old address vs current HR or employee self-service profile;
- recruiter draft title or start date vs finalized offer/onboarding record;
- old personal email vs current personal email;
- draft W-4 filing status vs approved payroll tax profile;
- low-authority ticket note vs higher-authority structured profile export.

Use `freshness`, `authority`, `expectedUse`, and `challengeTags` to record
intent. Keep current Maya truth in `profile.yaml`; old values should live only
in challenge documents.

Suggested challenge tags:

```text
conflict-current-vs-stale
conflict-authority
temporal-old-address
temporal-old-bank
temporal-old-email
temporal-draft-vs-approved
```

Exit criteria:

- The packet isolates conflict/temporal failures from ownership failures.
- Current/high-authority values remain the expected truth.
- Any old values that are important to detect later are recorded in a scorable
  way before adding scorer logic.

## Future Scoring Notes

Challenge tags alone are not enough to score leakage. They identify the
difficulty category, not the exact wrong value.

If ownership or stale-value failures recur, add explicit scorable decoy metadata
later. A future shape could record:

```text
document id
challenge tag
decoy fact family
decoy value
owner label
expected behavior
```

Do not add that metadata until the first hard packets show which failures are
worth measuring.

## Non-Goals For The First Hard Packets

- Do not add a new manifest schema version.
- Do not add a new multi-form scenario format.
- Do not map more SF 1199A digit boxes.
- Do not add repeat-run statistics yet.
- Do not add a broad fuzzy scorer.
- Do not combine all difficulty families into one first packet.
- Do not put answer-key labels into document bodies.
