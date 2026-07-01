# dynamicmem-user001-cp00-02-trajectory-v1 Soundness Report

This report is for benchmark reviewers. It is hidden from the agent.

## Migration Contract

- Harbor is only the runner.
- Each stage is an update-and-answer checkpoint turn.
- Each turn reveals only the raw DynamicMem app-log delta and native queries for that checkpoint.
- Hidden expected files preserve the upstream checkpoint task packs across the trajectory.
- Agent-visible task files remove reference answers, reference outputs, scoring points, and gold evidence ids.

## What The Agent Sees

| Stage | Kind | Visible docs | Visible files | Approx tokens | Agent task |
| ---: | --- | ---: | ---: | ---: | --- |
| 1 | update-answer | 180 | 182 | 104447 | Ingest new raw DynamicMem app logs and answer the current checkpoint's native tasks. |
| 2 | update-answer | 286 | 288 | 165374 | Ingest new raw DynamicMem app logs and answer the current checkpoint's native tasks. |
| 3 | update-answer | 250 | 252 | 150228 | Ingest new raw DynamicMem app logs and answer the current checkpoint's native tasks. |

## Native Task Counts

- State completion keys: `104`
- Personalized service keys: `104`
- Personalized service items: `104`
- Observed raw logs: `716`

## Service Families

| Family | Count |
| --- | ---: |
| `action_configuration` | 48 |
| `information_request_construction` | 26 |
| `user_communication` | 30 |

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
  "stagePattern": "update-answer -> update-answer -> update-answer",
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
    }
  ],
  "taskId": "dynamicmem-user001-cp00-02-trajectory-v1",
  "taskType": "dynamicmem-native-background-memory-trajectory",
  "totals": {
    "approxTokenCount": 420050,
    "checkpointCount": 3,
    "downstreamStageCount": 3,
    "memoryUpdateStageCount": 0,
    "observedRawLogCount": 716,
    "personalizedServiceItemCount": 104,
    "personalizedServiceKeyCount": 104,
    "sourceApiCount": 39,
    "sourceAppCount": 16,
    "stageCount": 3,
    "stateCompletionKeyCount": 104,
    "uniqueStateCompletionKeyCount": 48,
    "updateAnswerStageCount": 3,
    "visibleCharCount": 1680199,
    "visibleDocCount": 716,
    "visibleFileCount": 722
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
