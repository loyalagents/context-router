# dynamicmem-user001-cp00-04-trajectory-v1 Soundness Report

This report is for benchmark reviewers. It is hidden from the agent.

## Migration Contract

- Harbor is only the runner.
- Stage pattern: `update-answer-every-checkpoint`.
- `update-answer` stages reveal raw DynamicMem app-log deltas plus native queries for that checkpoint.
- `memory-update` stages reveal only raw DynamicMem app-log deltas and should not require a prediction.
- `downstream-task` stages reveal native queries without raw documents and score retained memory use.
- Hidden expected files preserve the scored upstream checkpoint task packs.
- Agent-visible task files remove reference answers, reference outputs, scoring points, and gold evidence ids.

## What The Agent Sees

| Stage | Kind | Visible docs | Visible files | Approx tokens | Agent task |
| ---: | --- | ---: | ---: | ---: | --- |
| 1 | update-answer | 180 | 182 | 104447 | Ingest new raw DynamicMem app logs and answer the current checkpoint's native tasks. |
| 2 | update-answer | 286 | 288 | 165374 | Ingest new raw DynamicMem app logs and answer the current checkpoint's native tasks. |
| 3 | update-answer | 250 | 252 | 150228 | Ingest new raw DynamicMem app logs and answer the current checkpoint's native tasks. |
| 4 | update-answer | 371 | 373 | 367515 | Ingest new raw DynamicMem app logs and answer the current checkpoint's native tasks. |
| 5 | update-answer | 368 | 370 | 229612 | Ingest new raw DynamicMem app logs and answer the current checkpoint's native tasks. |

## Native Task Counts

- State completion keys: `189`
- Personalized service keys: `189`
- Personalized service items: `189`
- Observed raw logs: `1455`

## Service Families

| Family | Count |
| --- | ---: |
| `action_configuration` | 91 |
| `information_request_construction` | 48 |
| `user_communication` | 50 |

## Difficulty Block

```json
{
  "challengeSignals": {
    "checkpointTrajectory": true,
    "deltaRawCheckpointHistory": true,
    "hiddenDownstreamUntilFinalStage": false,
    "hiddenFutureCheckpoints": true,
    "longContextApprox70kPlus": true,
    "multiStage": true,
    "nativePersonalizedService": true,
    "nativeStateCompletion": true,
    "updateAnswerEveryCheckpoint": true
  },
  "migrationPolicy": "Harbor runner only; DynamicMem raw logs, task packs, prediction contract, and downstream task families are preserved.",
  "schemaVersion": 1,
  "sourceDiversity": {
    "apiNames": [
      "AddExperience",
      "AddSkill",
      "AddToCart",
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
      "PostStory",
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
      "SearchSongs",
      "SearchTransactions",
      "SendConnectionRequest",
      "SendEmail",
      "SendMedia",
      "SendMessage",
      "SetGoals",
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
  "stagePattern": "update-answer -> update-answer -> update-answer -> update-answer -> update-answer",
  "stagePatternName": "update-answer-every-checkpoint",
  "stages": [
    {
      "agentTask": "Ingest new raw DynamicMem app logs and answer the current checkpoint's native tasks.",
      "approxTokenCount": 104447,
      "kind": "update-answer",
      "stageId": "01-cp00-update-answer",
      "stageIndex": 1,
      "visibleCharCount": 417789,
      "visibleDocCount": 180,
      "visibleFileCount": 182
    },
    {
      "agentTask": "Ingest new raw DynamicMem app logs and answer the current checkpoint's native tasks.",
      "approxTokenCount": 165374,
      "kind": "update-answer",
      "stageId": "02-cp01-update-answer",
      "stageIndex": 2,
      "visibleCharCount": 661497,
      "visibleDocCount": 286,
      "visibleFileCount": 288
    },
    {
      "agentTask": "Ingest new raw DynamicMem app logs and answer the current checkpoint's native tasks.",
      "approxTokenCount": 150228,
      "kind": "update-answer",
      "stageId": "03-cp02-update-answer",
      "stageIndex": 3,
      "visibleCharCount": 600913,
      "visibleDocCount": 250,
      "visibleFileCount": 252
    },
    {
      "agentTask": "Ingest new raw DynamicMem app logs and answer the current checkpoint's native tasks.",
      "approxTokenCount": 367515,
      "kind": "update-answer",
      "stageId": "04-cp03-update-answer",
      "stageIndex": 4,
      "visibleCharCount": 1470059,
      "visibleDocCount": 371,
      "visibleFileCount": 373
    },
    {
      "agentTask": "Ingest new raw DynamicMem app logs and answer the current checkpoint's native tasks.",
      "approxTokenCount": 229612,
      "kind": "update-answer",
      "stageId": "05-cp04-update-answer",
      "stageIndex": 5,
      "visibleCharCount": 918450,
      "visibleDocCount": 368,
      "visibleFileCount": 370
    }
  ],
  "taskContract": "dataset-adapter/trajectory-v1",
  "taskId": "dynamicmem-user001-cp00-04-trajectory-v1",
  "taskType": "dynamicmem-native-background-memory-trajectory",
  "totals": {
    "approxTokenCount": 1017177,
    "checkpointCount": 5,
    "downstreamStageCount": 5,
    "memoryUpdateStageCount": 0,
    "observedRawLogCount": 1455,
    "personalizedServiceItemCount": 189,
    "personalizedServiceKeyCount": 189,
    "scoredCheckpointCount": 5,
    "sourceApiCount": 46,
    "sourceAppCount": 16,
    "sourceCheckpointCount": 5,
    "stageCount": 5,
    "stateCompletionKeyCount": 189,
    "uniqueStateCompletionKeyCount": 58,
    "updateAnswerStageCount": 5,
    "visibleCharCount": 4068708,
    "visibleDocCount": 1455,
    "visibleFileCount": 1465
  },
  "trajectory": {
    "checkpointIds": [
      "cal_quarterly_001",
      "cal_quarterly_002",
      "cal_quarterly_003",
      "cal_quarterly_004",
      "cal_quarterly_005"
    ],
    "checkpointIndices": [
      0,
      1,
      2,
      3,
      4
    ],
    "checkpointTimestamps": [
      "2023-12-31 19:30:00",
      "2024-03-31 14:30:00",
      "2024-06-30 20:00:00",
      "2024-10-01 05:45:00",
      "2024-12-31 18:00:00"
    ],
    "finalCheckpointId": "cal_quarterly_005",
    "finalCheckpointIndex": 4,
    "finalCheckpointTimestamp": "2024-12-31 18:00:00",
    "sourceUserDir": "001_user_001",
    "sourceUserId": "user_001"
  }
}
```
