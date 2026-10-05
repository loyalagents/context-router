# Local UI Usability Follow-Up

- Status: deferred product work; not an activated implementation plan
- Outcome owner: product owner and next assigned UI coordinator
- Trigger: revisit once Step 09's packaged local workflow is usable, before
  broader usability testing; optional Steps 10/11 are not prerequisites
- Source: [Step 08 user-run acceptance](../local-migration/08-local-ui/implementation.md#2026-10-04-user-run-browser-and-native-client-acceptance)
- Last reviewed: 2026-10-04

Keep this a focused cleanup of the existing dashboard:

1. Make rejected-grant feedback prominent and close to the attempted action.
   This is the strongest candidate for a small earlier follow-up.
2. Show configured MCP client labels prominently in history, retaining IDs for
   disambiguation and as a fallback when labels are missing.
3. Show concise before/after preference values in collapsed history rows, with
   full snapshots available on expansion.

Preserve truthful confirmed/uncertain mutation outcomes, per-instance authority,
and masking of sensitive or unknown-sensitivity history. Labels are display
metadata, never authority. A fix for false success, hidden failure, private-data
exposure or a blocked supported task should be brought forward.

These improvements do not block Step 08 closeout or add mandatory Step 09 scope.
Choose the smallest useful slice and its checks when this follow-up is activated.
