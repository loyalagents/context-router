# Implementation Feedback A

## Summary

The `packet-hard-conflict-v1` fixture looks sound. It is based on
`packet-medium`, has the expected five conflict/temporal challenge documents,
keeps current Maya truth supported by authoritative records, and the three new
scenarios point at the new corpus correctly. I did not find a fixture-blocking
correctness issue.

One PR-scope caveat: the latest fixture commit is fixture/docs-only, but the
current branch history also contains older backend/eval-script commits. If this
is opened as a fixture-only PR against `main`, confirm the PR diff excludes
those unrelated commits or broaden the PR scope and validation notes.

## Findings

- No blocking fixture findings.

- Scope caveat: comparing the branch after `8944b8e` to `HEAD` includes
  non-fixture changes under `apps/backend/src/modules/preferences/form-fill/`
  and `examples/eval/scripts/direct-open-schema*.mjs`. The conflict fixture
  commit itself (`1af8039`) is scoped correctly, but the PR base matters for the
  "fixture-only" claim.

## Should Address Before PR

- Confirm the PR diff is scoped to the conflict fixture/docs/scenarios, or
  explicitly document and validate the older non-fixture code changes if they
  are intentionally part of the PR.

## Nice To Have

- No fixture change is needed for the whitespace-only copied-document delta in
  `examples/eval/users/maya-chen-newhire/corpora/packet-hard-conflict-v1/documents/work-authorization/005-work-authorization-intake-field-export.txt:38`.
  The change removes trailing whitespace and is validation-clean. Restore byte
  parity only if exact copied-baseline parity becomes a repo convention.

## Validation Run

- `git status --short`: clean before writing this feedback file.
- `git diff --stat`: no working-tree diff before writing this feedback file.
- `git diff -- examples/eval/users/maya-chen-newhire/corpora/packet-hard-conflict-v1`: no working-tree diff before writing this feedback file.
- `git diff -- examples/eval/scenarios`: no working-tree diff before writing this feedback file.
- `rg "packet-medium|maya-chen-newhire__packet-medium|packet-hard-ownership|maya-chen-newhire__packet-hard-ownership" ...packet-hard-conflict-v1 ...scenarios`: no stale copied corpus/scenario identifiers found.
- `diff -qr packet-medium/documents packet-hard-conflict-v1/documents`: only new docs `031`-`035` plus the whitespace-only copied-doc delta noted above.
- `node examples/eval/scripts/validate.mjs --user maya-chen-newhire --corpus packet-hard-conflict-v1`: passed, 0 errors / 46 warnings.
- `node examples/eval/scripts/validate.mjs --scenario maya-chen-newhire-i9-packet-hard-conflict-v1`: passed, 0 errors / 46 warnings.
- `node examples/eval/scripts/validate.mjs --scenario maya-chen-newhire-fw4-packet-hard-conflict-v1`: passed, 0 errors / 46 warnings.
- `node examples/eval/scripts/validate.mjs --scenario maya-chen-newhire-direct-deposit-packet-hard-conflict-v1`: passed, 0 errors / 46 warnings.
- `node examples/eval/scripts/validate.mjs --user maya-chen-newhire --corpus packet-medium`: passed, 0 errors / 46 warnings, confirming the focused warning count is inherited.
- `node --test examples/eval/scripts`: passed, 314 tests / 0 failures.
- `git diff --check HEAD`: passed.

## Open Questions

- Is the intended PR base the parent of `1af8039`, or will this branch be
  opened against `main` with the older form-fill/direct-open-schema commits
  included?
