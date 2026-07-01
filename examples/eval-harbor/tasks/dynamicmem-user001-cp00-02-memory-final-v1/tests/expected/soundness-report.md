# dynamicmem-user001-cp00-02-memory-final-v1 Soundness Report

This report is for benchmark reviewers. It is hidden from the agent.

## Migration Contract

- Harbor is only the runner.
- Stage pattern: `update-only-then-final`.
- `update-answer` stages reveal raw DynamicMem app-log deltas plus native queries for that checkpoint.
- `memory-update` stages reveal only raw DynamicMem app-log deltas and should not require a prediction.
- `downstream-task` stages reveal native queries without raw documents and score retained memory use.
- Hidden expected files preserve the scored upstream checkpoint task packs.
- Agent-visible task files remove reference answers, reference outputs, scoring points, and gold evidence ids.

## What The Agent Sees

| Stage | Kind | Visible docs | Visible files | Approx tokens | Agent task |
| ---: | --- | ---: | ---: | ---: | --- |
| 1 | memory-update | 180 | 181 | 90630 | Ingest new raw DynamicMem app-log delta and update retained memory only. |
| 2 | memory-update | 286 | 287 | 147930 | Ingest new raw DynamicMem app-log delta and update retained memory only. |
| 3 | memory-update | 250 | 251 | 133694 | Ingest new raw DynamicMem app-log delta and update retained memory only. |
| 4 | downstream-task | 0 | 1 | 16543 | Answer the downstream DynamicMem checkpoint task using retained memory. |

## Native Task Counts

- State completion keys: `37`
- Personalized service keys: `37`
- Personalized service items: `37`
- Observed raw logs: `716`

## Service Families

| Family | Count |
| --- | ---: |
| `action_configuration` | 20 |
| `information_request_construction` | 9 |
| `user_communication` | 8 |

## Difficulty Block

```json
{
  "challengeSignals": {
    "checkpointTrajectory": true,
    "deltaRawCheckpointHistory": true,
    "hiddenDownstreamUntilFinalStage": true,
    "hiddenFutureCheckpoints": true,
    "longContextApprox70kPlus": true,
    "multiStage": true,
    "nativePersonalizedService": true,
    "nativeStateCompletion": true,
    "updateAnswerEveryCheckpoint": false
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
      "CreatePost",
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
      "SearchBooks",
      "SearchContent",
      "SearchPlaces",
      "SearchProducts",
      "SearchRestaurants",
      "SendEmail",
      "SendMedia",
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
      "Instagram",
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
  "stagePattern": "memory-update -> memory-update -> memory-update -> downstream-task",
  "stagePatternName": "update-only-then-final",
  "stages": [
    {
      "agentTask": "Ingest new raw DynamicMem app-log delta and update retained memory only.",
      "approxTokenCount": 90630,
      "kind": "memory-update",
      "stageId": "01-cp00-memory-update",
      "stageIndex": 1,
      "visibleCharCount": 362520,
      "visibleDocCount": 180,
      "visibleFileCount": 181
    },
    {
      "agentTask": "Ingest new raw DynamicMem app-log delta and update retained memory only.",
      "approxTokenCount": 147930,
      "kind": "memory-update",
      "stageId": "02-cp01-memory-update",
      "stageIndex": 2,
      "visibleCharCount": 591721,
      "visibleDocCount": 286,
      "visibleFileCount": 287
    },
    {
      "agentTask": "Ingest new raw DynamicMem app-log delta and update retained memory only.",
      "approxTokenCount": 133694,
      "kind": "memory-update",
      "stageId": "03-cp02-memory-update",
      "stageIndex": 3,
      "visibleCharCount": 534778,
      "visibleDocCount": 250,
      "visibleFileCount": 251
    },
    {
      "agentTask": "Answer the downstream DynamicMem checkpoint task using retained memory.",
      "approxTokenCount": 16543,
      "kind": "downstream-task",
      "stageId": "04-cp02-downstream-task",
      "stageIndex": 4,
      "visibleCharCount": 66173,
      "visibleDocCount": 0,
      "visibleFileCount": 1
    }
  ],
  "taskContract": "dataset-adapter/trajectory-v1",
  "taskId": "dynamicmem-user001-cp00-02-memory-final-v1",
  "taskType": "dynamicmem-native-background-memory-trajectory",
  "totals": {
    "approxTokenCount": 388798,
    "checkpointCount": 1,
    "downstreamStageCount": 1,
    "memoryUpdateStageCount": 3,
    "observedRawLogCount": 716,
    "personalizedServiceItemCount": 37,
    "personalizedServiceKeyCount": 37,
    "scoredCheckpointCount": 1,
    "sourceApiCount": 39,
    "sourceAppCount": 16,
    "sourceCheckpointCount": 3,
    "stageCount": 4,
    "stateCompletionKeyCount": 37,
    "uniqueStateCompletionKeyCount": 37,
    "updateAnswerStageCount": 0,
    "visibleCharCount": 1555192,
    "visibleDocCount": 716,
    "visibleFileCount": 720
  },
  "trajectory": {
    "checkpointIds": [
      "cal_quarterly_001",
      "cal_quarterly_002",
      "cal_quarterly_003"
    ],
    "checkpointIndices": [
      0,
      1,
      2
    ],
    "checkpointTimestamps": [
      "2023-12-31 19:30:00",
      "2024-03-31 14:30:00",
      "2024-06-30 20:00:00"
    ],
    "finalCheckpointId": "cal_quarterly_003",
    "finalCheckpointIndex": 2,
    "finalCheckpointTimestamp": "2024-06-30 20:00:00",
    "sourceUserDir": "001_user_001",
    "sourceUserId": "user_001"
  }
}
```
