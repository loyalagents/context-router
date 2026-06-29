# Packet Volume and Order Hardening Plan

- Status: implementation plan
- Last updated: 2026-06-28
- Scope: Maya packet volume/noise corpus and packet-runner order controls

## Goal

Add a separate volume/noise difficulty family for the Maya shared-dossier
evaluation without mutating `packet-medium` or stacking on the existing
ownership/conflict/required hardening packets.

The target corpus is `packet-hard-volume-v1`: 100 total realistic text-like
documents, using `packet-medium` as the truth-bearing base plus 70 additional
realistic distractor or non-user-specific artifacts.

## Checkpoints

1. Runner controls:
   - Add packet document ordering to `eval:e2e-mcp-packet` and
     `eval:direct-open-schema-packet`.
   - Support `canonical`, `reverse`, `seeded-random`, `relevant-first`, and
     `relevant-last`.
   - Add `--max-evidence-chars` to direct-document runners that use the shared
     evidence loader, keeping the existing 200000 default.
   - Record document count, char counts, cap, order mode, seed, and ordered ids
     in packet artifacts.

2. Corpus:
   - Create `examples/eval/users/maya-chen-newhire/corpora/packet-hard-volume-v1`.
   - Copy the 30 `packet-medium` documents and add 70 realistic long-context
     distractor documents.
   - Keep canonical Maya truth in `profile.yaml` unchanged.
   - Do not introduce the withheld phone value.
   - Prefer plausible folder names over obvious new `noise` folders for added
     distractors.

3. Scenarios:
   - Add I-9, W-4, and direct deposit scenarios for `packet-hard-volume-v1`.
   - Keep expected snapshots empty because these are live open-schema packet
     scenarios.

4. Verification:
   - Validate the corpus and all three scenarios.
   - Run focused eval script tests for the runner changes.
   - Run live direct/MCP packet variants only after fixture validation is clean.

## Experiment Defaults

Recommended first direct-baseline commands use:

```bash
pnpm eval:direct-open-schema-packet --user maya-chen-newhire --corpus packet-hard-volume-v1 --scenarios maya-chen-newhire-i9-packet-hard-volume-v1,maya-chen-newhire-fw4-packet-hard-volume-v1,maya-chen-newhire-direct-deposit-packet-hard-volume-v1 --artifacts-root <artifact-dir> --document-order canonical --max-evidence-chars 1000000

pnpm eval:direct-open-schema-packet --user maya-chen-newhire --corpus packet-hard-volume-v1 --scenarios maya-chen-newhire-i9-packet-hard-volume-v1,maya-chen-newhire-fw4-packet-hard-volume-v1,maya-chen-newhire-direct-deposit-packet-hard-volume-v1 --artifacts-root <artifact-dir> --document-order relevant-last --max-evidence-chars 1000000
```

Use matching `--document-order` values for `eval:e2e-mcp-packet` when backend
credentials and MCP setup are available.
