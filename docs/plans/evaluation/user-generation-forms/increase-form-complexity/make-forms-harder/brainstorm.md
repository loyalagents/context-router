# Make Forms Harder Brainstorm

- Status: brainstorm
- Last updated: 2026-06-27
- Scope: notes for making the Maya new-hire packet harder after
  `packet-medium`

## Summary

The next useful direction is not more forms. It is harder evidence.

The current Maya packet already gives us a shared dossier for I-9, W-4, and
direct deposit. `packet-medium` has size, source variety, obvious stale docs,
and obvious other-person/sample docs. The next step should make specific
failure modes sharper while keeping the evaluation shape stable.

Recommended ladder:

```text
ownership/admissibility first
  -> conflict/temporal validity second
  -> evidence confidence/abstention later
```

This order keeps the first hard runs interpretable.

## Core Framing

The packet evaluation should answer questions like:

- Does this information belong to this user?
- Is this information current and worth keeping long term?
- When sources conflict, which source should win?
- Is there enough evidence to store or fill this fact?

The clean first cut is ownership. The high-value second cut is conflict, with
"this used to be true" treated as a conflict between candidate values.

## Why Start With Ownership

Ownership asks:

```text
This fact is real, but is it Maya's fact?
```

This is the easiest hardening step to add because it can reuse the existing
profile, forms, field maps, scenarios, runner, and manifest schema.

It also produces concrete bad outcomes:

- Jordan's bank account gets stored as Maya's account.
- An emergency contact phone gets stored as Maya's phone.
- A manager work email gets used for Maya.
- A sample W-4 filing status gets used for Maya.
- A support phone number fills a personal phone field.

These are easy to inspect in memory snapshots and form score reports.

## Why Conflict Comes Second

Conflict asks:

```text
This may be Maya's fact, but sources disagree. Which value should win?
```

Temporal validity fits here. "This used to be true" is not only stale noise; it
is a competing candidate value. The system must choose the current or
higher-authority value and avoid storing the old one as active memory.

Examples:

- old bank account vs current direct-deposit confirmation;
- old address vs current HR profile;
- old personal email vs current personal email;
- recruiter draft title vs finalized offer title;
- draft W-4 status vs approved payroll tax profile.

Conflict is more valuable long term, but it is harder to debug if ownership
boundaries are also failing. That is why it should be the second hard packet.

## Why Defer Evidence Confidence

Evidence confidence and abstention ask:

```text
Is there enough evidence to support this fact?
```

This matters, especially for missing or partial data. But it can become
subjective quickly unless the corpus has a very explicit evidence contract.
Start with cases that create concrete wrong values first. Add weak evidence and
abstention once ownership and conflict are measurable.

## Packet Labels

Use packet names that say what difficulty was added:

```text
packet-hard-ownership-v1
packet-hard-conflict-v1
packet-hard-abstention-v1
```

Avoid vague names such as `packet-hard` for the first pass. The goal is to know
what kind of difficulty caused a failure.

## PR Packaging

It is reasonable to reduce PR count by combining packet skeleton work with the
first document batch.

Skeleton-only PRs are useful when they change shared contracts, but for this
work they mostly create directories, scenarios, and a parseable manifest. The
behaviorally meaningful review starts when the packet has actual challenge
documents.

Good PR boundaries:

- planning docs by themselves;
- ownership packet skeleton plus first ownership trap batch;
- live ownership results or tiny cleanup separately;
- conflict packet skeleton plus first conflict/temporal trap batch;
- scoring or backend behavior changes separately when they become necessary.

The most important split is by difficulty family. Ownership and conflict should
stay separate even if the implementation mechanics are similar.

## Ownership Examples

Good first ownership/admissibility traps:

- coworker direct-deposit confirmation for another employee at Pacific Ledger;
- employee sample packet where the values are plausible and form-shaped;
- emergency contact setup where the contact has phone, address, and email;
- company directory profile for Maya's manager or teammate;
- shared payroll support ticket involving Maya and another employee;
- bank branch or payroll support document with institution-owned phone numbers;
- sample W-4 with realistic non-Maya tax choices;
- onboarding thread that quotes another worker's details above Maya's latest
  reply.

The document body should make ownership inferable through normal source cues:

- employee name;
- worker id;
- role;
- requester;
- subject line;
- account owner;
- sample label;
- quoted-thread speaker;
- relationship to Maya.

Do not rely only on file names or manifest tags.

## Conflict And Temporal Examples

Good second-pass conflict/temporal traps:

- stale payroll draft with old bank account and current confirmation with new
  account;
- old recruiter profile with previous address and current HR profile with new
  address;
- old personal email in a candidate profile and current email in self-service;
- recruiter draft start date and finalized onboarding assignment start date;
- draft W-4 filing status and approved payroll tax profile;
- low-authority support ticket typo and high-authority structured export;
- audit log with before and after values where only the after value is current.

The old or low-authority value should be plausible. The current value should
win because of source status, timestamp, approval state, or authority.

## Tags And Metadata

Challenge tags are for eval tracking, not ingestion.

They should help humans and future reports answer:

- What challenge was this document intended to introduce?
- Which difficulty bucket produced failures?
- Which documents should be inspected when a value leaks?

They should not be used as model hints. The model should see the document body,
not private eval labels.

Suggested ownership tags:

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

Suggested conflict/temporal tags:

```text
conflict-current-vs-stale
conflict-authority
temporal-old-address
temporal-old-bank
temporal-old-email
temporal-draft-vs-approved
```

## Tags Versus Scoring

Tags alone do not prove a failure.

A tag tells us the category:

```text
This document is an ownership trap.
```

It does not tell the scorer exactly what value would count as leakage:

```text
Jordan Avery's routing number appeared in active Maya memory.
```

For the first hard packet, tags are enough for human review. If we see recurring
failures, add explicit scorable decoy metadata later.

Possible future decoy metadata:

```text
document id
challenge tag
owner label
decoy fact family
decoy value
expected behavior
```

That would let reports count ownership false positives and stale-value false
positives directly.

## Manifest Use

Use the existing V2 manifest shape:

- `category`;
- `evaluationRole.expectedUse`;
- `evaluationRole.freshness`;
- `evaluationRole.authority`;
- `evaluationRole.challengeTags`;
- `factContract.include`;
- `factContract.forbid`.

For ownership docs, avoid putting non-Maya facts in `factContract.include`.
Includes mean current Maya truth. If a document is there only as a decoy, use
`expectedUse: ignore` or `expectedUse: guardrail` and private challenge tags.

For temporal/conflict docs, keep old values out of `include`. Current Maya
truth stays in `profile.yaml` and current evidence docs. Old values can be
recorded later as decoy metadata if scoring needs it.

## What Not To Change First

Avoid mixing too many variables in the first hard packet.

Do not start by:

- adding more forms;
- mapping more PDF fields;
- introducing a new scenario schema;
- making stale docs extremely subtle;
- adding weak evidence and conflicts in the same packet;
- changing Maya profile truth;
- adding a broad fuzzy scorer;
- depending on repeat-run statistics.

The first hard packet should be small enough that one run can be read by hand.

## Proposed First Slice

Create:

```text
user: maya-chen-newhire
corpus: packet-hard-ownership-v1
forms: i-9, fw4, direct-deposit-sf1199a-24
documents: packet-medium baseline plus 4-6 ownership traps
```

Add scenarios:

```text
maya-chen-newhire-i9-packet-hard-ownership-v1
maya-chen-newhire-fw4-packet-hard-ownership-v1
maya-chen-newhire-direct-deposit-packet-hard-ownership-v1
```

Review questions after the run:

- Did active memory contain facts owned by another person?
- Did any form use another person's values?
- Did ownership traps cause correct Maya facts to go missing?
- Did `contact.phone` stay absent despite nearby phone values?
- Did direct no-memory and stored-memory fail differently?

## Proposed Second Slice

Create:

```text
user: maya-chen-newhire
corpus: packet-hard-conflict-v1
forms: i-9, fw4, direct-deposit-sf1199a-24
documents: ownership baseline plus 4-6 conflict/temporal traps
```

Review questions after the run:

- Did current values beat stale values?
- Did higher-authority sources beat lower-authority sources?
- Did drafts stay out of active durable memory?
- Did old values appear as active memory, suggestions, or form values?
- Were conflict failures memory failures or form-fill failures?

## Success Criteria

The first hard packets are successful if they produce interpretable signal, not
necessarily if they pass perfectly.

Good outcomes:

- clear pass on ownership boundaries;
- clear failure showing non-Maya facts in active memory;
- clear failure showing stale values beating current values;
- clear difference between MCP stored-memory and direct no-memory paths;
- enough artifact detail to decide whether the next change belongs in corpus
  design, prompts, backend storage behavior, form fill, or scoring.

Bad outcomes:

- failures cannot be attributed to a difficulty bucket;
- the model needed private manifest tags to succeed;
- too many difficulty families changed at once;
- scoring hides the actual wrong value;
- the packet is too large to inspect manually.
