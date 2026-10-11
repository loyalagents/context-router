# Frozen Local-Migration Evidence

These are historical machine-readable receipts and frozen fixture/manifests, not
active plans or proof that the latest app satisfies every earlier acceptance case.
See [scoped closeout](../../current/LOCAL_MIGRATION_CLOSEOUT.md) for merge/CI evidence
and [current limitations](../../current/LOCAL_APPLICATION.md#qualification-and-known-limits).

The reset relocates these files **byte-for-byte** from commit
`7e8f1c5a90084ba6a5623bf48f3c1186fb64422f`:

| Original prefix under `docs/plans/active/local-migration/` | New directory under this index |
| --- | --- |
| `06-local-model/evidence/` | `06-local-model/` |
| `08-local-ui/` (JSON receipts only) | `08-local-ui/` |
| `09-installation-and-packaging/` (JSON receipts only) | `09-installation-and-packaging/` |

Step 06 manifests are still loaded by deterministic tests and optional live-run
tools. Move readers together; do not regenerate approved manifests to repair paths.

Historical CP1 runners are not qualification for the current application. At the
reset base, the original `local-model-live-quality.test.mjs` (four checks) and
`local-model-schema-probes.test.mjs` (one check) already conflict with subsequent
form-fill prompt/schema changes: the frozen manifest guard fails, and the old
required-`value` assertion differs from the now-optional field. These checks are
outside the current aggregate gate's explicit list. The reset reproduced those
predicates against the existing compiled backend and verified identical baseline
tests/source/manifests except relocated reader paths; it did not rebuild the old
base or regenerate evidence. Current production-quality/supplemental tests pass
separately. If new evaluation is commissioned, version and qualify its inputs
rather than silently updating these historical expectations.

Embedded source paths, hashes, candidate IDs and consumer identities bind historical
inputs and intentionally retain their original values. A historical path inside a
receipt is not a claim that it exists in the current checkout. Negative and failed
receipts are retained alongside passes, including accepted quality/cancellation
limits E/H. Do not cherry-pick successful diagnostics to erase failed qualification.

The full [original plan/evidence tree](https://github.com/loyalagents/context-router/tree/7e8f1c5a90084ba6a5623bf48f3c1186fb64422f/docs/plans/active/local-migration)
preserves plan approvals and interpretation. The registry's resolvable evidence
pointers now lead to current contract history or these retained files; its protected
decisions/fingerprints are unchanged. New runs need new input-bound evidence and
any required live-run approvals, not overwritten historical receipts.
