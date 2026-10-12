# Stabilization Backlog

- Status: triage candidates, not implementation authorization
- Owner: pilot coordinator assigns bounded task owners at activation

Prioritize obvious pain, misleading results, private-data exposure and unsafe
recovery before inviting colleagues. A real-data pilot may accept scoped limits;
it must not discover avoidable silent corruption or require unsafe repair.
Track each fix once here or in its linked canonical brief. Mark **pilot blocker**
and **worktree eligible** independently after investigation.

| Candidate | First evidence and likely boundary | Parallelism caution |
| --- | --- | --- |
| Stale saved-preference display after apply | Addressed in merged [PR #173](https://github.com/loyalagents/context-router/pull/173); D passed two response-injected packaged UI journeys in the [pilot](../../active/colleague-pilot/plan.md#d-results-and-review-follow-up-2026-10-12), with real-backend/fake-model source-browser coverage renewed separately. [UI brief](../ui-usability/README.md) retains source evidence | Preserve uncertain/partial outcomes; source fix does not itself qualify installed bytes |
| Rejected PDF | Reproduce with consent or a minimal synthetic equivalent; distinguish supported-subset rejection from parser defects | No private document committed or uploaded externally |
| Possible wrong-person email proposal | Active separate investigation owned by the “Fix wrong-person attribution” chat, using a synthetic suite and bounded document-analysis scope. Still an invitation dependency; no fix is claimed or absorbed into the delivery milestone | Coordinate model/parser/domain/build resources; no automatic integration, merge or live inference; do not generalize accepted omission E |
| Recovery from interrupted startup/owner loss/reboot | Review fail-closed lifecycle and a supported recovery or explicitly consented pilot reset; never clear journals as a shortcut | Sensitive native/storage ownership work, serialize with packaging/reset changes |
| Version replacement and disk budget | Measure real A-to-B change, retained weights, partial downloads, archives, backups and logs; safe bounded cleanup | Pilot release task, not independent changes to downloader/store ownership |
| Redacted feedback and actionable errors | App/version/OS/client identification, clear unsupported/busy/disconnected states, no tokens or document content in logs | Often a bounded worktree slice after logging contract is agreed |
| Prominent denied-grant, history and AI-status feedback | [UI usability](../ui-usability/README.md) retains the detailed backlog | Visual slices may be independent; authority/restart logic is not merely visual |
| Deterministic regression coverage | Tests for an identified defect or untested supported flow, not unrelated hardening | Separate fixtures/ports/build outputs; backend behavior remains tests first |

Not every candidate is an established defect or an automatic pilot blocker.
Record reproduction, consequence, intended fix, acceptance and owner before
implementing. For model changes, preserve frozen negative evidence and evaluate
the affected quality/cancellation contract rather than silently lowering thresholds.

Parallel worktree tasks need exact path/contract ownership and one main-checkout
integrator. Shared schemas, lockfiles, native guardian, credential code, generated
files and gate configuration are serialized. Use the
[validation policy](../../../useful/AGENT_WORKFLOW.md#validation-and-context-discipline):
focused checks during correction, then required qualification on a frozen candidate.
