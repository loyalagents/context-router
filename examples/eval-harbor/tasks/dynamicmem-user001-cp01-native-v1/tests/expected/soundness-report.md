# dynamicmem-user001-cp01-native-v1 Soundness Report

This report is for benchmark reviewers. It is hidden from the agent.

## Migration Contract

- Harbor is only the runner.
- T1 uses raw DynamicMem app-log objects, not summaries or selected evidence only.
- T2 uses DynamicMem State Completion and Personalized Service queries.
- Hidden expected files preserve the upstream checkpoint task packs.
- Agent-visible task files remove reference answers, reference outputs, scoring points, and gold evidence ids.

## What The Agent Sees

| Stage | Kind | Visible docs | Visible files | Approx tokens | Agent task |
| ---: | --- | ---: | ---: | ---: | --- |
| 1 | memory-update | 180 | 181 | 90616 | Ingest raw DynamicMem app logs in chronological order. |
| 2 | memory-update | 286 | 287 | 147916 | Ingest raw DynamicMem app logs in chronological order. |
| 3 | downstream-task | 0 | 1 | 17451 | Answer native DynamicMem State Completion and Personalized Service tasks. |

## Native Task Counts

- State completion keys: `37`
- Personalized service keys: `37`
- Personalized service items: `37`
- Observed raw logs: `466`

## Service Families

| Family | Count |
| --- | ---: |
| `action_configuration` | 15 |
| `information_request_construction` | 9 |
| `user_communication` | 13 |

## Difficulty Block

```json
{
  "challengeSignals": {
    "fullRawCheckpointHistory": true,
    "hiddenDownstreamUntilFinalStage": true,
    "longContextApprox70kPlus": true,
    "multiMemoryUpdate": true,
    "multiStage": true,
    "nativePersonalizedService": true,
    "nativeStateCompletion": true
  },
  "checkpoint": {
    "finalCheckpointId": "cal_quarterly_002",
    "finalCheckpointIndex": 1,
    "finalCheckpointTimestamp": "2024-03-31 14:30:00",
    "previousCheckpointIndex": 0,
    "sourceUserDir": "001_user_001",
    "sourceUserId": "user_001"
  },
  "migrationPolicy": "Harbor runner only; DynamicMem raw logs, task packs, prediction contract, and downstream task families are preserved.",
  "schemaVersion": 1,
  "sourceDiversity": {
    "apiNames": [
      "AddSkill",
      "CheckIn",
      "Checkout",
      "ClickResult",
      "CommentOnPost",
      "ContinueConversation",
      "CreateConversation",
      "CreateDatabaseEntry",
      "CreatePage",
      "GetBalance",
      "GetDirections",
      "GetFeed",
      "GetPortfolio",
      "GetTransactions",
      "LogWorkout",
      "PayBill",
      "PlaceOrder",
      "PlayContent",
      "PlaySong",
      "RateBook",
      "ReadEmail",
      "RecordActivity",
      "ReplyEmail",
      "Search",
      "SearchContent",
      "SearchPlaces",
      "SearchProducts",
      "SearchRestaurants",
      "SendEmail",
      "SendMessage",
      "ShowProduct",
      "ShowWishlist",
      "SyncDevice",
      "TransferMoney",
      "UpdatePage",
      "UpdateProfile"
    ],
    "appNames": [
      "Amazon",
      "Chase",
      "Fitbit",
      "Gmail",
      "Goodreads",
      "Google",
      "Google Maps",
      "LLM Assistant",
      "LinkedIn",
      "Netflix",
      "Notion",
      "Robinhood",
      "Spotify",
      "UberEats",
      "WhatsApp"
    ],
    "serviceFamilies": [
      "action_configuration",
      "information_request_construction",
      "user_communication"
    ],
    "stateGroups": [
      "habits_state",
      "preferences_state",
      "user_attributes_state"
    ]
  },
  "stagePattern": "memory-update -> memory-update -> downstream-task",
  "stages": [
    {
      "agentTask": "Ingest raw DynamicMem app logs in chronological order.",
      "approxTokenCount": 90616,
      "kind": "memory-update",
      "stageId": "01-initial-logs",
      "stageIndex": 1,
      "visibleCharCount": 362463,
      "visibleDocCount": 180,
      "visibleFileCount": 181
    },
    {
      "agentTask": "Ingest raw DynamicMem app logs in chronological order.",
      "approxTokenCount": 147916,
      "kind": "memory-update",
      "stageId": "02-later-logs",
      "stageIndex": 2,
      "visibleCharCount": 591664,
      "visibleDocCount": 286,
      "visibleFileCount": 287
    },
    {
      "agentTask": "Answer native DynamicMem State Completion and Personalized Service tasks.",
      "approxTokenCount": 17451,
      "kind": "downstream-task",
      "stageId": "03-native-tasks",
      "stageIndex": 3,
      "visibleCharCount": 69805,
      "visibleDocCount": 0,
      "visibleFileCount": 1
    }
  ],
  "taskId": "dynamicmem-user001-cp01-native-v1",
  "taskType": "dynamicmem-native-background-memory",
  "totals": {
    "approxTokenCount": 255983,
    "downstreamStageCount": 1,
    "memoryUpdateStageCount": 2,
    "observedRawLogCount": 466,
    "personalizedServiceItemCount": 37,
    "personalizedServiceKeyCount": 37,
    "sourceApiCount": 36,
    "sourceAppCount": 15,
    "stageCount": 3,
    "stateCompletionKeyCount": 37,
    "visibleCharCount": 1023932,
    "visibleDocCount": 466,
    "visibleFileCount": 469
  }
}
```
