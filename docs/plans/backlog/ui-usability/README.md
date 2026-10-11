# Local UI Usability Follow-Up

- Status: deferred product work; not an activated implementation plan
- Outcome owner: product owner and next assigned UI coordinator
- Trigger: pilot triage; fixes for blocked tasks, false success or privacy outrank polish
- Source: [Step 08 user-run acceptance](https://github.com/loyalagents/context-router/blob/7e8f1c5a90084ba6a5623bf48f3c1186fb64422f/docs/plans/active/local-migration/08-local-ui/implementation.md#2026-10-04-user-run-browser-and-native-client-acceptance)
- Last reviewed: 2026-10-10

Keep this a focused cleanup of the existing dashboard and packaged menu:

1. Make rejected-grant feedback prominent and close to the attempted action.
   This is the strongest candidate for a small earlier follow-up.
2. Show configured MCP client labels prominently in history, retaining IDs for
   disambiguation and as a fallback when labels are missing.
3. Show concise before/after preference values in collapsed history rows, with
   full snapshots available on expansion.
4. Put recovery guidance beside the dashboard's AI status. Consider a
   **Restart local runtime** action for the packaged Mac app, requested during
   Step 09 sleep/wake acceptance on 2026-10-10 and explicitly deferred. It must
   require an authenticated browser and confirmation, reuse the native guardian's
   restart lifecycle, and explain interruption of UI/MCP work and fresh unlock.
   Keep menu instructions available when the runtime cannot be reached; do not
   automatically restart or replay interrupted work.
5. Make the model-download menu reflect an already installed model, instead of
   continuing to offer Download. The user explicitly deferred this during Step 09
   acceptance; preserve verified-asset checks and explicit download consent.
6. Distinguish an AI check that can be retried from terminal states requiring
   Restart, and avoid the sleep-related AI label when no model is installed.
   The Step 09 external review identified both conservative presentation cases;
   preserve unavailable states and explicit recovery requirements underneath.

7. Refresh confirmed applied preferences without requiring a manual page reload.
   Reproduce the Step 09 report and preserve partial/uncertain mutation outcomes;
   display refresh must not retry or duplicate writes. This is prioritized for
   pilot triage by the [stabilization brief](../stabilization/README.md).

Preserve truthful confirmed/uncertain mutation outcomes, per-instance authority,
and masking of sensitive or unknown-sensitivity history. Labels are display
metadata, never authority. A fix for false success, hidden failure, private-data
exposure or a blocked supported task should be brought forward.

The numbered migration is closed. The pilot coordinator chooses the smallest
useful slice, priority, ownership and checks; not every item blocks colleague testing.

Waiting/running feedback for overlapping AI requests belongs with the separate
[local AI scheduling follow-up](../local-ai-scheduling/README.md). Coordinate its
dashboard presentation there with the backend/MCP queue contract; this UI cleanup
does not introduce queues, retries or concurrent model execution independently.

Provider/model settings and local-versus-cloud destination/consent UX belong to
the separate [model provider selection follow-up](../model-provider-selection/README.md).
Coordinate presentation there; this cleanup does not activate provider support.
