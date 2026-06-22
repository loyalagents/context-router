# Packet-Small Implementation Plan

- Status: implementation plan
- Last updated: 2026-06-20
- Scope: first shared-dossier packet for Maya Chen across I-9, W-4, and direct
  deposit

## Goal

Build `packet-small` as the first complete vertical slice for the new-hire
packet evaluation.

The slice should prove that one realistic dossier can support multiple forms
without adding a new multi-form runner yet. It should stay small enough to
inspect by hand and should prepare for the open-schema stored-memory versus
direct open-schema baseline comparison.

## Checkpoint 1: Plan And Normalize Profile

Tasks:

- Keep `maya-chen-newhire` as the packet user.
- Normalize `identity.otherLastNames` from an empty array to `null` so the I-9
  optional field behaves as a blank fact instead of an array fact that needs
  special coverage.
- Keep `contact.phone: null` as the intentionally missing fact for I-9 and
  direct deposit.

Exit criteria:

- `profile.yaml` validates.
- No seed preferences are added.

## Checkpoint 2: Add Open-Schema Fact Coverage

Tasks:

- Extend `examples/eval/scoring/fact-storage-map.v1.json` with the active
  packet facts that are not already mapped.
- Cover address facts, date of birth, middle initial, W-4 filing status, and
  direct-deposit banking facts.
- Do not add computed W-4 fields or the deferred routing/account digit boxes.

Exit criteria:

- Open-schema database scoring can report on the packet facts that matter to
  the three mapped forms.

## Checkpoint 3: Author Packet-Small Corpus

Tasks:

- Add `examples/eval/users/maya-chen-newhire/corpora/packet-small/`.
- Use the `realistic-generated` manifest shape.
- Author 8 small, realistic documents:
  - driver license OCR;
  - SSN card OCR;
  - HR onboarding profile export;
  - I-9 Section 1 draft export;
  - W-4 withholding setup export;
  - direct-deposit portal confirmation;
  - payroll/direct-deposit instructions;
  - other-employee sample packet.
- Declare facts explicitly in each document `factContract`.
- Declare `contact.phone` intentionally missing for I-9 and direct deposit.
- Keep phone-like text out of all document bodies for v1.

Exit criteria:

- Corpus validation passes with a written `validation-report.json`.
- The dossier is small enough to inspect by hand.

## Checkpoint 4: Add One-Form Scenarios

Tasks:

- Add normal one-form scenario directories for:
  - `maya-chen-newhire-i9-packet-small`;
  - `maya-chen-newhire-fw4-packet-small`;
  - `maya-chen-newhire-direct-deposit-packet-small`.
- Point all three scenarios at user `maya-chen-newhire` and corpus
  `packet-small`.
- Keep `expectedSnapshots` empty because these are live/open-schema fixtures,
  not deterministic seed-hydrated runner snapshots.

Exit criteria:

- Each scenario validates independently.

## Checkpoint 5: Verify

Run:

```bash
pnpm eval:validate --user maya-chen-newhire --corpus packet-small --write-report
pnpm eval:validate --scenario maya-chen-newhire-i9-packet-small
pnpm eval:validate --scenario maya-chen-newhire-fw4-packet-small
pnpm eval:validate --scenario maya-chen-newhire-direct-deposit-packet-small
pnpm eval:test
```

If possible in the local environment, run the live open-schema stored-memory
path and direct open-schema no-memory baselines. If backend auth, MCP config, or
model credentials are unavailable, record that as not run in the summary rather
than blocking the fixture slice.

## Checkpoint 6: Final Docs

Tasks:

- Write `small-packet/implementation-summary.md` with files changed, final
  corpus shape, validation/test commands, live-run status, known limitations,
  and the next recommended step.
- Update `orchestration.md` to mark packet-small implementation status and link
  to the implementation summary.

Exit criteria:

- The implementation summary exists.
- The orchestration doc reflects the current state.
