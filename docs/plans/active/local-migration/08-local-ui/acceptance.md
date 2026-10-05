# Step 08 Synthetic Human Acceptance

Status: **COMPLETED WITH ACCEPTED EVIDENCE LIMITS**, 2026-10-04. The operator
performed this synthetic walkthrough on implementation head
`40ef8fd84e8880cbc0539a3260ab24a693b6696a`, following successful standard and
migration CI, and explicitly accepted leaving the remaining observations
unverified. Actual results and their provenance are in the
[acceptance evidence](implementation.md#2026-10-04-user-run-browser-and-native-client-acceptance).
The checklist below remains available for future runs; it is not a claim that
every bullet has independent passing evidence. PR #167 remains draft and this
disposition does not authorize merge or activate Step 09.

The main browser/client flows, selected document apply with saved-value protection,
PDF preservation/overwrite, smart search, cancellation/manual responsiveness and
terminal shutdown passed on the recorded scope. Conflict-message visibility,
final browser AI status after cancellation and separate confirmation of both
browser locks at closeout remain unverified. The read-only client's mutation tool
was unavailable, so no manual server-side write-denial request occurred; an extra
Claude control read during Codex's DENY test was not supplied. The in-app browser's
exact version was not captured. One native task cancellation does not requalify
Step 06's accepted E/H limitations or prove session reuse.

Live model and native-client operations were user-run. No personal client
configuration was changed. Readability findings are deferred to the
[UI usability follow-up](../../ui-usability/README.md).

Use synthetic data only. Allow about 25 minutes for the no-model/browser/client
checks and at most 15 additional minutes for an already qualified model session.
Record the exact Git SHA, OS, browser and client versions, pass/fail/inconclusive
results and any unexpected outcome. Do not paste credential bytes or raw personal
records into the PR. A lost/uncertain write response means inspect state before
retrying.

## 1. Fresh Private State And One Launcher

Use the pinned toolchain and build/fresh-state commands in
[Local Dashboard](../../../../useful/LOCAL_UI.md). Keep the printed `STEP08_ROOT`
path; its database, identity and exports remain separate. Use that same parent
throughout. If ports 3002/8787 are occupied, select two unused ports consistently
instead of stopping unrelated processes. The default command is:

```sh
pnpm --filter web local-ui serve --unlock-dir "$STEP08_ROOT/exports"
```

Keep this terminal for the launcher. Open `http://127.0.0.1:3002/dashboard`, read
only the readiness record's exact unlock file, and unlock. Expect no Auth0 login,
no model requirement and no credential in page source or URL. For a second tab,
enter `unlock` in the launcher and use that newly exported file.

## 2. Reused Browser Flows

- Save a synthetic profile, save again, then clear an optional field and verify
  it stays cleared after reload.
- In Schema, create personal `synthetic.response_style` (STRING, GLOBAL), edit
  its description and export PERSONAL JSON. Verify the exported definition.
- In Preferences, set it to `brief`, edit to `detailed`, and use literal search.
  Smart search, document upload and form fill should explain unavailable AI.
- Lock the dashboard: private content disappears immediately. A fresh unlock
  restores saved data. Open a second authenticated window for the history test.

## 3. Isolated Native Clients And Authority

In another terminal, select the same `LOCAL_DATABASE_ROOT` and
`LOCAL_IDENTITY_STATE_ROOT`, and provision one dedicated credential per client:

```sh
pnpm --filter backend local-mcp provision --label claude-step08 --out "$STEP08_ROOT/exports/claude.token"
pnpm --filter backend local-mcp provision --label codex-step08 --out "$STEP08_ROOT/exports/codex.token"
pnpm --filter backend local-mcp list
```

Use the returned real IDs as `STEP08_CLAUDE_ID` and `STEP08_CODEX_ID`:

```sh
pnpm --filter backend local-mcp permissions --id "$STEP08_CLAUDE_ID" --capabilities preferences:write --targets 'synthetic.*'
pnpm --filter backend local-mcp permissions --id "$STEP08_CODEX_ID" --capabilities preferences:read --targets 'synthetic.*'
```

Use the established isolated, per-run launches in
[Step 07 acceptance section 3](../07-local-mcp/acceptance.md#3-open-both-clients-securely),
substituting the Step 08 root/token paths and this launcher's MCP port. Do not run
Step 07's separate backend. Claude's temporary JSON uses an environment reference
for the token and `--strict-mcp-config`; Codex uses per-run `-c` URL and
`bearer_token_env_var` settings. Do not run `mcp add` or edit personal client files.
Codex's per-run override does not disable unrelated saved/plugin servers; instruct
it to use only this synthetic server or explicitly disable those per-run entries.
Normal CLI chat/history persistence and cloud model processing may still occur.

Give each client: “Use only this synthetic Context Router MCP server. Do not read
credential/configuration files or other servers. Report actual tool results.”
Then perform these bounded checks:

- Both read the browser's `detailed` value. Claude sets it to `from-claude`; reload
  the browser and verify it. Codex either lacks the mutation tool or has its
  attempted write denied; record which occurred. The browser sets
  it to `from-browser`; both clients read the new value.
- In MCP Clients, inspect Codex by actual ID. Add READ/DENY for
  `synthetic.response_style`; its next search returns no matching preference. Remove only that grant and
  verify access returns. An ALLOW outside its CLI maximum must be rejected.
- Revoke only Claude in the browser. Claude fails authentication; Codex still
  reads. A cached tool list may require normal reconnect. Do not enable OAuth or
  widen policy to make a denial check pass.

## 4. History, Restart And Recovery

- In History, confirm both Audit and MCP Access show the synthetic activity.
  Create one sensitive definition/value, archive it, then inspect its audit:
  values are hidden until explicit reveal. Legacy UNKNOWN rows, if present in an
  existing test pair, are also masked; do not edit a real database to manufacture
  them (automated upgrade coverage already does that).
- Cancel the history-clear dialog once. Then enter `CLEAR HISTORY` and clear.
  Both streams become empty in both windows, including a previously hidden tab.
  Saved preferences/profile/schema and Codex access remain. New MCP activity may
  add new access records afterward.
- Use **Reset Preferences** under **Reset Memory** separately. Preferences disappear while history remains
  and a reset event is added. Recreate one synthetic value for restart.
- Stop the launcher with Ctrl-C and wait for its exit. Restart the same command
  with the same roots. The old browser session must fail; unlock with the new
  file. The principal/data/grants and Claude revocation persist. Codex reconnects
  and reads. Never initialize these roots again.

## 5. Optional Qualified AI (Explicit User-Run Only)

If already-qualified Step 06 assets and a fresh manual session are available,
follow [Local Model](../../../../useful/LOCAL_MODEL.md), stop/reap the no-model
launcher and start `local-ui serve-model` with the same database/identity and a
fresh `LOCAL_MODEL_SESSION_ROOT`/`LOCAL_MODEL_PORT`. Otherwise record this section
**pending**, without downloading assets or claiming qualification.

- Check selected readiness/formats. Analyze one short synthetic `.md` only after
  consent. Review the proposed values and apply selected items. Change one saved
  value between analysis and apply; expect an explicit conflict, not overwrite.
- Fill one small synthetic AcroForm PDF with one empty and one prefilled field.
  Download/review it: the prefilled value stays. Explicitly name that field for
  overwrite and run once more; inspect partial/skipped outcomes.
- Run one smart search, then one bounded cancellation/deadline check. While a
  model operation is busy, manual reads still work. Do not repeatedly retry to
  force a passing cancellation result. If the session latches unavailable, stop
  and reap both owners and follow fresh-session recovery. Preserve Step 06's
  accepted E email omission and H failed/inconclusive native cancellation limits.

## 6. Closeout Record

Exit both CLI clients, lock browsers, stop the launcher and any user-started model,
and observe exits. Keep the private synthetic pair for diagnosis until acceptance
is recorded; do not remove unknown processes or credential claims. Report a compact
result table for sections 1–5 and any defect. Required manual acceptance remains
pending for a future run until the coordinator records its actual results,
resolves defects and renews affected checks/reviews. The completed 2026-10-04
disposition is recorded above. This checklist does not authorize merge.
