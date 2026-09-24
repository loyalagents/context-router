# Step 05 CP1 Feasibility And Accepted Selection

- Status: selection approved at frozen `0a6cda5af9ec90415792d2813f097e6bce62bfaa`; production evidence remains required
- Planning base: `3426dc556fea88d94a360329e7c685bc9acc155e`
- Authorizing plan C: `b90e1ae45fa6b8dc85f9298d1d511b297535c82a`, SHA-256 `ae2cbb90987a7eeca87a4570a5e2c83539aece3d19e788b4d5e442c46f230893`
- Sole writer: `/root/step05_writer`, requested Astra Extra High (`xhigh`), explicit request accepted; serving internals unverified
- Scope: bounded mechanism probes only; no completed production adapter or CLI-cutover claim

## Accepted Selection

Select Node 24.21.0's built-in `node:sqlite` and SQLite 3.53.4 for the new local mode, with DELETE rollback journals, FULL synchronization, defensive behavior, foreign keys, extension loading disabled, trusted schema disabled and memory temporary storage. No added native dependency is required. The API remains release-candidate stability; exact pinned runtime and package tests remain required. Existing PostgreSQL modes remain active.

Use explicit existing-only URI opens after private-root/file/sidecar admission. Validate application/version/exact schema/instance target before application-issued persistent settings. The selected journal guard reads only a pinned no-follow journal prefix/footer, conservatively rejects the super-journal suffix without interpreting paths, rejects short/unsafe canonical files before opening, and permits only the documented intrinsic single-database crash rollback. A false-positive rejection preserves artifacts. Bootstrap uses a closed complete stage and no-clobber publication; `recover-database-bootstrap` handles the pre-acquire complete-stage or exact linked-pair states described in the plan. The production implementation must enforce the complete root/identity/ancestry/pinning rules, beyond this representative fixture.

Ordinary UoW owns one connection and one explicit transaction. **Select busy timeout 0 and exactly one `setImmediate` scheduling yield before each native UoW attempt.** This introduces no adapter retry, mutex, nested transaction or shared connection. Root operations remain separately owned. The application retains its existing five identity attempts and unique-only final lookup. An immediate synchronous BEGIN prototype exhausted those attempts; the yield allows the guarded method → identity method → resolver → UoW callback microtasks to finish before the next queued attempt. Twelve representative callers then all converged on attempt one. This does not promise fairness or success for arbitrary asynchronous callbacks, external processes or sustained contention; actual resolver integration is required in CP4. Measured 25/250ms native busy waits delayed same-thread timers and exceeded nominal wall duration, so no total I/O deadline is inferred from those settings.

Held identity coordination uses the dedicated worker and actual retained exclusive MAIN-database connection from plan C. The parent watchdog rejects and latches promptly; actual worker termination and original process termination/reaping are distinct facts. No automatic reconnect/reacquire follows failure. Named recovery still requires the original process terminated AND reaped. A committed write with lost acknowledgement is recovery-required, even if later inspection proves it committed. A parent watchdog is not a guarantee that arbitrary native/kernel I/O stops immediately.

Preserve audit prefix behavior with one private deterministic/direct-only SQLite scalar predicate in SQL `WHERE`, before cursor/order/limit. PostgreSQL `startsWith` here is case-sensitive LIKE on `prefix + '%'`, including `%`, `_` and backslash escapes; it is not literal startsWith. The iterative codepoint matcher has no RegExp backtracking or recursive stack and keeps one compiled pattern per connection. SQLite LIKE would change case behavior; GLOB translation would add a 50,000-character limit and escaping expansion where the current public prefix has no such limit. The private predicate handles the accepted long prefixes without a new DTO limit, rejects NUL, and preserves SQL NULL predicate behavior. Full adapter filtering/pagination tests remain CP2/CP4.

Matching-pair backup uses the same held connection for SQLite backup, exact identity bytes, fsynced contents and a no-clobber complete marker. Restore copies a completed pair into new empty private roots and validates target, principal, schema, integrity and FKs. It preserves the backed-up credential/generation; rotating that restored credential is explicit. Final backup CLI/UX and hardware qualification stay in Step 09.

## Executable Evidence

Run from the dedicated worktree with exact Node 24.21.0:

```sh
node --test scripts/local-migration/sqlite-feasibility.test.mjs
```

The checked-in suite owns private temporary directories, tracks all database handles, compiles its worker and the existing identity codec into private output, supervises/reaps children, and removes roots only after every cleanup succeeds. Cleanup failures are collected while remaining closes/reaps are attempted; uncertain cleanup preserves the root. It uses no PostgreSQL, Docker or network. The separate PostgreSQL characterization is explicitly reference-only, not a local-runtime dependency.

| Probe | Observed evidence |
| --- | --- |
| Runtime/admission | Actual Node `v24.21.0`, darwin arm64; SQLite `3.53.4`; source ID `2026-07-24 19:02:57 bf7c7f30031888f4e796e429ab3978879485813aaca6f641c7b33e4e09459bcc`; compile options recorded; existing-only missing-file rejection without creation; empty stderr on isolated builtin import |
| API/settings | Defensive method exists and blocks writable-schema mutation; extension re-enable rejected; FK, DELETE, FULL, trusted-schema-off and memory temp settings observed |
| Admission negatives | Foreign application ID, future version, unexpected schema, wrong target, zero/corrupt file, unsafe sidecar/link/mode rejected; nonhot bytes/settings preserved, including zero canonical plus sidecar |
| Representative schema | SQL NULL versus JSON text null, nested JSON, millisecond Date, FK cascade/check, unique/partial live index and READ/SUGGEST/WRITE/DEFINE order |
| Ordinary transaction | Async callback writes rollback wholly; exact `undefined`, `null`, `NaN` and provider-like caller rejection; frozen expired facet before COMMIT; unrelated connection cannot join writer |
| Failed COMMIT | Real independent SHARED reader blocks writer COMMIT after a witnessed insert; BUSY leaves transaction active; explicit rollback removes the write; one attempt and no successful result |
| Real hot journal | Killed-and-reaped writer leaves nonzero hot journal; ordinary engine replay restores all 200 committed rows and leaves identity bytes unchanged |
| Embedded reference | Valid existing off-root and invalid/relative reference tails rejected before SQLite, with main/journal/identity/external bytes unchanged. Deliberately unguarded missing-reference control skips rollback of 192 spilled pages, proving real recognition; no claim that this control proved external deletion |
| Bootstrap | Killed pre/postcommit stages and published same-inode pair distinguished; closed-copy validation reaches pre-acquire recovery; partial/multiple/populated/unrelated stages fail unchanged |
| Identity scheduling | Guarded async method/resolver/UoW layering, twelve callers, one scheduling yield, all resolve the same sole principal/binding within the unchanged five-attempt limit |
| Held worker | Independent readers/writers excluded before, during and after COMMIT, including after journal descriptor inspection/close and throughout backup; fresh access after actual close |
| Lost acknowledgement | Actual COMMIT followed by stalled worker returns no acknowledgement; parent deadline/fail-latch rejects later work; candidate bytes retained; after actual termination the committed change is visible |
| Stopped process | SIGSTOP owner excludes contenders both before and after commit; only SIGKILL plus awaited exit permits precommit rollback/postcommit preservation. Busy 0/25/250ms and timer blocking recorded |
| Matching pair/closure | Existing codec bytes copied while owner held, complete marker publication, new-root restore validates exact target/principal/integrity/FKs, old generation is restored and then explicitly rotated without source change. Compiled worker runs in a separate supervisor with hostile cwd/env and no global module search |
| Prefix predicate | Matches observed case/wildcard/escape behavior, literal GLOB metacharacters, escaped underscore/backslash, astral codepoint `_`, NUL rejection and >60,000-character patterns without GLOB's limit |

The suite has thirteen tests; several rows above are assertions within one test. This is mechanism evidence, not the complete production adapter/shared-contract/use-case/recovery matrix. The matching-pair probe uses the actual codec but manually performs representative publication/rotation; actual state service, authentication and all failure boundaries remain CP3/CP4. The standalone worker proof is not the actual backend CLI package proof required by CP4/CP5. No Windows, network filesystem or power-loss guarantee is made.

## PostgreSQL Reference Characterization

The existing backend was generated/built under Node 24.21.0 and pnpm 10.25.0. An independently owned labelled `postgres:15-alpine` fixture used a fresh tmpfs database, random loopback-only port and fresh credential, applied the existing migrations, then ran `scripts/local-migration/sqlite-reference-probe.mjs`. Every attempt verified immutable container ID/owner before stopping and confirming automatic removal. No hosted data/provider participated.

- `Case` matches `Case.alpha`; `case` matches `case.beta`.
- `wild%` and `wild_` each match the four `wild` rows, including literal `%` and `_`; a single trailing backslash prefix escapes the appended percent and matches none of the fixture rows.
- Empty and `%` prefixes match all eight rows. Literal 60,001-character and GLOB-special 60,003-character prefixes are accepted and match none; 60,001 percent wildcards match all eight. NUL rejects. Positive literal `*?[`, escaped underscore/backslash and astral-character cases are checked.
- Definition create `options:null` stores SQL NULL; explicit update null, catalog null and verified-binding metadata null store JSON null. Omitted options retain a prior nonnull object. Nested object `undefined` is omitted.
- Empty definition update and existing M2M upsert preserve explicitly seeded **2001** timestamps, making the check falsifiable; M2M also preserves its existing email.

External evidence directory: `/private/tmp/step05-activation-evidence/`. Final source-matched logs are `feasibility-final-confirmed.log`, `reference-probe.log`, `reference-fixture.json` and `reference-build.log`. Earlier `feasibility-initial.log`, `feasibility-second.log` and `feasibility-targeted.log` are retained failed exploratory evidence: fixture canonical-path/control assumptions and immediate scheduling were corrected. They are not successful validation. The confirmed log records the final thirteen-test result/timings and exact engine options; the fixture JSON records reference ownership, exit and cleanup.

## Review Boundary

Affected architecture/maintainability/packaging/scope (`/root/selection_architecture`, Astra xhigh), persistence/recovery/security/privacy (`/root/plan_persistence_b`, resumed Astra xhigh), and compatibility/tests (`/root/plan_compatibility`, Astra High) approved the exact frozen selection without blockers. Explicit settings were accepted; internals are unverified. The coordinator then released production implementation. Ordinary busy-zero/yield, journal admission, retained worker ownership, intrinsic replay limits, scalar prefix predicate and matching-pair mechanism are explicit review subjects. All Step 03/04 invariant and final-review obligations remain active. No next-step activation or merge is authorized.
