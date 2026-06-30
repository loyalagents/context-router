#!/usr/bin/env python3
"""Build a Harbor task that preserves native DynamicMem task semantics.

The runner is Harbor/staged, but the benchmark content stays DynamicMem-native:

- raw app logs are revealed chronologically up to the target checkpoint
- the hidden expected artifact stores the upstream checkpoint task packs
- the final agent-visible task is a sanitized view of those packs with answers
  and scoring/reference material removed
- the agent writes the upstream prediction contract to outputs/prediction.json
"""

from __future__ import annotations

import argparse
import json
import re
import shutil
from copy import deepcopy
from dataclasses import dataclass
from pathlib import Path
from typing import Any


TASK_ID = "dynamicmem-user001-cp01-native-v1"
CORPUS_ID = "dynamicmem-user001-cp01-native-corpus"
SOURCE_USER_DIR = "001_user_001"
SOURCE_USER_ID = "user_001"
FINAL_CHECKPOINT_INDEX = 1
PREVIOUS_CHECKPOINT_INDEX = 0
MODEL_NAME = "gpt-5.4-mini"
REASONING_EFFORT = "high"
DEFAULT_ARM_CONFIG_PATH = Path("examples/eval-harbor/arms/dynamicmem-default.json")
REASONING_EFFORT_CHOICES = {"low", "medium", "high", "xhigh"}

TASK_A_EXCLUDED_VALUE_FIELDS_V2 = {"priority", "schedule_date", "schedule_dates"}


@dataclass(frozen=True)
class BuildConfig:
    task_id: str = TASK_ID
    corpus_id: str = CORPUS_ID
    source_user_dir: str = SOURCE_USER_DIR
    source_user_id: str = SOURCE_USER_ID
    final_checkpoint_index: int = FINAL_CHECKPOINT_INDEX
    previous_checkpoint_index: int = PREVIOUS_CHECKPOINT_INDEX
    model_name: str = MODEL_NAME
    reasoning_effort: str = REASONING_EFFORT

    def __post_init__(self) -> None:
        if self.reasoning_effort not in REASONING_EFFORT_CHOICES:
            choices = ", ".join(sorted(REASONING_EFFORT_CHOICES))
            raise ValueError(f"reasoning_effort must be one of: {choices}")


DEFAULT_BUILD_CONFIG = BuildConfig()

FALLBACK_ARM_CONFIGS = [
    {
        "mode": "context-only",
        "memoryMode": "context-only",
        "instructionPath": "examples/eval-harbor/modes/context-only.md",
        "compose": "staged",
    },
    {
        "mode": "markdown",
        "memoryMode": "markdown",
        "instructionPath": "examples/eval-harbor/modes/markdown.md",
        "compose": "staged",
    },
    {
        "mode": "cr-mcp",
        "memoryMode": "cr-mcp",
        "instructionPath": "examples/eval-harbor/modes/cr-mcp.md",
        "compose": "cr-mcp",
        "mcpServers": [
            {
                "name": "context-router-memory",
                "transport": "streamable-http",
                "url": "http://cr-memory:8000/mcp",
            }
        ],
        "artifacts": [
            {
                "source": "/data/mcp-config.json",
                "destination": "mcp/config.json",
                "service": "cr-memory",
            },
            {
                "source": "/data/preferences.json",
                "destination": "memory/cr-snapshot.json",
                "service": "cr-memory",
            },
            {
                "source": "/data/tool-calls.jsonl",
                "destination": "mcp/tool-calls.jsonl",
                "service": "cr-memory",
            },
            {
                "source": "/data/server.log",
                "destination": "mcp/server.log",
                "service": "cr-memory",
            },
            {
                "source": "/data/catalog.json",
                "destination": "mcp/catalog.json",
                "service": "cr-memory",
            },
        ],
    },
]

NEXT_STAGE_SCRIPT = """#!/usr/bin/env python3
import json
import shutil
import urllib.error
import urllib.request
from pathlib import Path


APP_ROOT = Path("/app")
CURRENT_STAGE = APP_ROOT / "current_stage"
STAGE_LOG = APP_ROOT / "stage-log.jsonl"
STAGE_URL = "http://stage-server:8765/next"


def write_json(path, payload):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2, sort_keys=True) + "\\n", encoding="utf-8")


def write_text(path, text):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")


def append_log(payload):
    STAGE_LOG.parent.mkdir(parents=True, exist_ok=True)
    with STAGE_LOG.open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(payload, sort_keys=True) + "\\n")


def fetch_next_stage():
    request = urllib.request.Request(STAGE_URL, method="POST")
    with urllib.request.urlopen(request, timeout=10) as response:
        return json.loads(response.read().decode("utf-8"))


def materialize_stage(stage):
    if CURRENT_STAGE.exists():
        shutil.rmtree(CURRENT_STAGE)
    CURRENT_STAGE.mkdir(parents=True, exist_ok=True)

    write_text(CURRENT_STAGE / "instruction.md", stage["instruction"])
    for item in stage.get("files", []):
        rel_path = item["path"]
        if rel_path.startswith("/") or ".." in Path(rel_path).parts:
            raise ValueError(f"unsafe stage file path: {rel_path}")
        target = CURRENT_STAGE / rel_path
        if "json" in item:
            write_json(target, item["json"])
        else:
            write_text(target, item["text"])

    append_log(
        {
            "stageId": stage["stageId"],
            "stageIndex": stage["stageIndex"],
            "kind": stage["kind"],
            "fileCount": len(stage.get("files", [])),
        }
    )


def main():
    try:
        payload = fetch_next_stage()
    except urllib.error.URLError as error:
        raise SystemExit(f"Failed to contact stage server: {error}") from error

    if payload.get("done"):
        print("No more stages are available.")
        append_log({"done": True})
        return 0

    stage = payload["stage"]
    materialize_stage(stage)
    print(f"Revealed stage {stage['stageIndex']}: {stage['stageId']}")
    print()
    print(stage["instruction"])
    print()
    print("Stage files are under /app/current_stage.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
"""


def load_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def write_json(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def write_text(path: Path, text: str, *, executable: bool = False) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")
    if executable:
        path.chmod(0o755)


def load_arm_configs(path: Path | None = None) -> list[dict[str, Any]]:
    if path is None:
        path = DEFAULT_ARM_CONFIG_PATH
    if not path.exists():
        return FALLBACK_ARM_CONFIGS
    payload = load_json(path)
    arms = payload.get("arms")
    if not isinstance(arms, list) or not arms:
        raise ValueError(f"arm config must contain a nonempty arms list: {path}")
    seen_modes: set[str] = set()
    for arm in arms:
        mode = arm.get("mode")
        if not isinstance(mode, str) or not mode:
            raise ValueError(f"arm config entry missing mode: {path}")
        if mode in seen_modes:
            raise ValueError(f"duplicate arm mode {mode}: {path}")
        seen_modes.add(mode)
        if not isinstance(arm.get("instructionPath"), str):
            raise ValueError(f"arm {mode} missing instructionPath: {path}")
        compose = arm.get("compose", "staged")
        if compose not in {"staged", "cr-mcp"}:
            raise ValueError(f"arm {mode} has unsupported compose={compose}: {path}")
    return arms


def slugify(value: str) -> str:
    slug = re.sub(r"[^a-zA-Z0-9]+", "-", value).strip("-").lower()
    return slug or "value"


def normalize_app_logs(payload: Any) -> list[dict[str, Any]]:
    logs = payload if isinstance(payload, list) else payload.get("app_logs", [])
    logs = [log for log in logs if isinstance(log, dict)]
    return sorted(logs, key=lambda log: (str(log.get("timestamp", "")), str(log.get("app_log_id", ""))))


def selected_checkpoint(
    task_packs: dict[str, Any],
    config: BuildConfig = DEFAULT_BUILD_CONFIG,
) -> tuple[dict[str, Any] | None, dict[str, Any]]:
    checkpoints = task_packs["checkpoints"]
    previous = checkpoints[config.previous_checkpoint_index] if config.previous_checkpoint_index >= 0 else None
    return previous, checkpoints[config.final_checkpoint_index]


def observed_logs_for_checkpoint(checkpoint: dict[str, Any], app_logs: list[dict[str, Any]]) -> list[dict[str, Any]]:
    as_of = checkpoint.get("as_of") or {}
    index = as_of.get("log_index")
    if isinstance(index, int) and 0 <= index < len(app_logs):
        return app_logs[: index + 1]
    timestamp = str(as_of.get("timestamp") or "")
    return [log for log in app_logs if str(log.get("timestamp") or "") <= timestamp]


def relative_doc_path(log: dict[str, Any]) -> str:
    return (
        f"events/{str(log.get('timestamp', 'unknown'))[:10]}-"
        f"{slugify(str(log.get('app_log_id', 'log')))}-"
        f"{slugify(str(log.get('app_name', 'app')))}-"
        f"{slugify(str(log.get('api_name', 'api')))}.json"
    )


def documents_payload(
    logs: list[dict[str, Any]],
    *,
    purpose: str,
    config: BuildConfig = DEFAULT_BUILD_CONFIG,
) -> list[dict[str, Any]]:
    documents = []
    files = []
    for log in logs:
        rel = relative_doc_path(log)
        documents.append(
            {
                "path": rel,
                "kind": "dynamicmem-raw-app-log",
                "timestamp": log.get("timestamp"),
                "appName": log.get("app_name"),
                "apiName": log.get("api_name"),
                "appLogId": log.get("app_log_id"),
            }
        )
        files.append({"path": f"docs/{rel}", "json": log})

    return [
        {
            "path": "documents.json",
            "json": {
                "schemaVersion": 1,
                "corpusId": config.corpus_id,
                "source": {
                    "dataset": "xiewenya/dynamicmem",
                    "license": "MIT",
                    "userDir": config.source_user_dir,
                    "userId": config.source_user_id,
                },
                "documentsRoot": "docs",
                "purpose": purpose,
                "documents": documents,
            },
        },
        *files,
    ]


def drop_task_a_excluded_fields(value: Any) -> Any:
    if isinstance(value, dict):
        out = {}
        for key, child in value.items():
            if str(key).strip().lower() in TASK_A_EXCLUDED_VALUE_FIELDS_V2:
                continue
            cleaned = drop_task_a_excluded_fields(child)
            if cleaned not in (None, "", [], {}):
                out[key] = cleaned
        return out
    if isinstance(value, list):
        return [drop_task_a_excluded_fields(child) for child in value]
    return value


def flatten_snapshot(snapshot: Any) -> dict[str, Any]:
    if not isinstance(snapshot, dict):
        return {}
    if any(isinstance(key, str) and ":" in key for key in snapshot):
        return {str(key): value for key, value in snapshot.items()}
    out: dict[str, Any] = {}
    for group, values in snapshot.items():
        if not isinstance(values, dict):
            continue
        for key, value in values.items():
            out[f"{group}:{key}"] = value
    return out


def expected_snapshot_from_pack(checkpoint: dict[str, Any]) -> dict[str, Any]:
    state_keys = (checkpoint.get("state_completion_pack") or {}).get("keys") or {}
    validated = flatten_snapshot(checkpoint.get("validated_snapshot_state") or {})
    expected = {}
    for key in sorted(state_keys):
        value = drop_task_a_excluded_fields(deepcopy(validated.get(key)))
        if value not in (None, "", [], {}):
            expected[key] = value
    return expected


def sanitized_state_completion(checkpoint: dict[str, Any]) -> dict[str, Any]:
    pack = checkpoint.get("state_completion_pack") or {}
    keys = {}
    for state_key, item in sorted((pack.get("keys") or {}).items()):
        if not isinstance(item, dict):
            continue
        keys[state_key] = {
            "item_id": item.get("item_id"),
            "state_key": state_key,
            "question_text": item.get("question_text"),
            "answer_template": item.get("answer_template"),
            "retrieval_query": item.get("retrieval_query"),
        }
    return {
        "version": pack.get("version"),
        "pack_authoring": pack.get("pack_authoring"),
        "keys": keys,
    }


def sanitized_rq3_apply(checkpoint: dict[str, Any]) -> dict[str, Any]:
    pack = checkpoint.get("rq3_apply_service_qa") or {}
    keys = {}
    for state_key, node in sorted((pack.get("keys") or {}).items()):
        if not isinstance(node, dict):
            continue
        items = []
        for item in node.get("items") or []:
            if not isinstance(item, dict):
                continue
            visible = {
                "qa_id": item.get("qa_id"),
                "service_family": item.get("service_family"),
                "scenario": item.get("scenario") or item.get("apply_scenario"),
                "task_instruction": item.get("task_instruction") or item.get("apply_question") or item.get("question"),
                "retrieval_query": item.get("retrieval_query"),
            }
            if item.get("output_template") is not None:
                visible["output_template"] = item.get("output_template")
            items.append(visible)
        keys[state_key] = {"items": items}
    return {
        "version": pack.get("version"),
        "pack_prompt_version": pack.get("generator", {}).get("prompt_version"),
        "keys": keys,
    }


def visible_dynamicmem_task(
    checkpoint: dict[str, Any],
    task_packs: dict[str, Any],
    config: BuildConfig = DEFAULT_BUILD_CONFIG,
) -> dict[str, Any]:
    return {
        "schemaVersion": 1,
        "taskId": config.task_id,
        "sourceDataset": "xiewenya/dynamicmem",
        "userId": task_packs.get("user_id"),
        "task_contract_version": task_packs.get("task_contract_version"),
        "research_frame_version": task_packs.get("research_frame_version"),
        "checkpoint": {
            "checkpoint_id": checkpoint.get("checkpoint_id"),
            "as_of": checkpoint.get("as_of"),
        },
        "output": {
            "path": "outputs/prediction.json",
            "contract": {
                "task_contract_version": task_packs.get("task_contract_version"),
                "research_frame_version": task_packs.get("research_frame_version"),
                "predictions": [
                    {
                        "checkpoint_id": checkpoint.get("checkpoint_id"),
                        "snapshot_state": {},
                        "evidence": {},
                        "rq3_apply_answers": {},
                    }
                ],
            },
        },
        "state_completion": sanitized_state_completion(checkpoint),
        "personalized_service": sanitized_rq3_apply(checkpoint),
    }


def hidden_benchmark(task_packs: dict[str, Any], checkpoint: dict[str, Any]) -> dict[str, Any]:
    out = {
        key: deepcopy(value)
        for key, value in task_packs.items()
        if key != "checkpoints"
    }
    out["total_checkpoints"] = 1
    out["checkpoints"] = [deepcopy(checkpoint)]
    return out


def json_char_count(value: Any) -> int:
    return len(json.dumps(value, sort_keys=True))


def stage_file_chars(item: dict[str, Any]) -> int:
    if "json" in item:
        return json_char_count(item["json"])
    return len(str(item.get("text", "")))


def state_group(state_key: str) -> str:
    return state_key.split(":", 1)[0] if ":" in state_key else "unknown"


def build_difficulty(
    *,
    stage_payload: dict[str, Any],
    checkpoint: dict[str, Any],
    visible_task: dict[str, Any],
    observed_logs: list[dict[str, Any]],
    config: BuildConfig = DEFAULT_BUILD_CONFIG,
) -> dict[str, Any]:
    stages = []
    for stage in stage_payload["stages"]:
        files = stage.get("files", [])
        chars = sum(stage_file_chars(item) for item in files)
        doc_count = sum(
            1
            for item in files
            if isinstance(item.get("path"), str)
            and item["path"].startswith("docs/")
        )
        stages.append(
            {
                "stageIndex": stage["stageIndex"],
                "stageId": stage["stageId"],
                "kind": stage["kind"],
                "visibleFileCount": len(files),
                "visibleDocCount": doc_count,
                "visibleCharCount": chars,
                "approxTokenCount": round(chars / 4),
                "agentTask": (
                    "Ingest raw DynamicMem app logs in chronological order."
                    if stage["kind"] == "memory-update"
                    else "Answer native DynamicMem State Completion and Personalized Service tasks."
                ),
            }
        )

    state_keys = list(visible_task["state_completion"]["keys"])
    apply_items = [
        item
        for node in visible_task["personalized_service"]["keys"].values()
        for item in node.get("items", [])
    ]
    service_families = sorted({str(item.get("service_family") or "") for item in apply_items})
    total_chars = sum(stage["visibleCharCount"] for stage in stages)
    app_names = sorted({str(log.get("app_name") or "") for log in observed_logs})
    api_names = sorted({str(log.get("api_name") or "") for log in observed_logs})
    return {
        "schemaVersion": 1,
        "taskId": config.task_id,
        "taskType": "dynamicmem-native-background-memory",
        "migrationPolicy": "Harbor runner only; DynamicMem raw logs, task packs, prediction contract, and downstream task families are preserved.",
        "stagePattern": " -> ".join(stage["kind"] for stage in stages),
        "checkpoint": {
            "sourceUserDir": config.source_user_dir,
            "sourceUserId": config.source_user_id,
            "previousCheckpointIndex": config.previous_checkpoint_index,
            "finalCheckpointIndex": config.final_checkpoint_index,
            "finalCheckpointId": checkpoint.get("checkpoint_id"),
            "finalCheckpointTimestamp": (checkpoint.get("as_of") or {}).get("timestamp"),
        },
        "stages": stages,
        "totals": {
            "stageCount": len(stages),
            "memoryUpdateStageCount": sum(1 for stage in stages if stage["kind"] == "memory-update"),
            "downstreamStageCount": sum(1 for stage in stages if stage["kind"] == "downstream-task"),
            "visibleDocCount": sum(stage["visibleDocCount"] for stage in stages),
            "visibleFileCount": sum(stage["visibleFileCount"] for stage in stages),
            "visibleCharCount": total_chars,
            "approxTokenCount": round(total_chars / 4),
            "stateCompletionKeyCount": len(state_keys),
            "personalizedServiceKeyCount": len(visible_task["personalized_service"]["keys"]),
            "personalizedServiceItemCount": len(apply_items),
            "observedRawLogCount": len(observed_logs),
            "sourceAppCount": len(app_names),
            "sourceApiCount": len(api_names),
        },
        "sourceDiversity": {
            "appNames": app_names,
            "apiNames": api_names,
            "stateGroups": sorted({state_group(key) for key in state_keys}),
            "serviceFamilies": service_families,
        },
        "challengeSignals": {
            "multiStage": len(stages) > 1,
            "multiMemoryUpdate": sum(1 for stage in stages if stage["kind"] == "memory-update") > 1,
            "hiddenDownstreamUntilFinalStage": True,
            "nativeStateCompletion": True,
            "nativePersonalizedService": True,
            "fullRawCheckpointHistory": True,
            "longContextApprox70kPlus": round(total_chars / 4) >= 70000,
        },
    }


def build_stage_payload(
    *,
    first_logs: list[dict[str, Any]],
    later_logs: list[dict[str, Any]],
    visible_task: dict[str, Any],
    checkpoint: dict[str, Any],
    config: BuildConfig = DEFAULT_BUILD_CONFIG,
) -> dict[str, Any]:
    stages = [
        {
            "stageId": "01-initial-logs",
            "stageIndex": 1,
            "kind": "memory-update",
            "instruction": render_step_instruction(1, checkpoint),
            "files": documents_payload(
                first_logs,
                purpose="Raw DynamicMem app logs visible before the previous checkpoint.",
                config=config,
            ),
        },
        {
            "stageId": "02-later-logs",
            "stageIndex": 2,
            "kind": "memory-update",
            "instruction": render_step_instruction(2, checkpoint),
            "files": documents_payload(
                later_logs,
                purpose="Raw DynamicMem app logs between previous and target checkpoint.",
                config=config,
            ),
        },
        {
            "stageId": "03-native-tasks",
            "stageIndex": 3,
            "kind": "downstream-task",
            "instruction": render_step_instruction(3, checkpoint),
            "files": [{"path": "dynamicmem-task.json", "json": visible_task}],
        },
    ]
    return {
        "schemaVersion": 1,
        "taskId": config.task_id,
        "corpusId": config.corpus_id,
        "source": {
            "dataset": "xiewenya/dynamicmem",
            "license": "MIT",
            "userDir": config.source_user_dir,
            "userId": config.source_user_id,
        },
        "stages": stages,
    }


def render_instruction() -> str:
    return """This is a continuous-session Harbor task for native DynamicMem TCE.

You will receive staged information over time inside one agent session. The
runner is Harbor, but the task content follows DynamicMem:

1. Run `/app/next_stage` to reveal the first chronological raw app-log batch.
2. Update the memory/state allowed by the selected eval mode.
3. Run `/app/next_stage` again to reveal the later raw app-log batch.
4. Update memory/state again.
5. Run `/app/next_stage` again to reveal the native DynamicMem task queries.
6. Write `outputs/prediction.json` using the DynamicMem prediction contract.

Do not inspect hidden expected answers, verifier files, source dataset files, or
any other answer-key artifacts.
"""


def render_step_instruction(step: int, checkpoint: dict[str, Any]) -> str:
    if step == 1:
        return """You are working in `/app`.

This is stage 1 of 3. The downstream DynamicMem tasks are not available yet.

Read only the current batch:

- `current_stage/documents.json`
- `current_stage/docs/`

Each file under `docs/` is a raw DynamicMem app-log object. Ingest the logs in
chronological order and update only the memory/state allowed by the selected
eval mode. Do not write the final prediction yet.
"""
    if step == 2:
        return """You are working in `/app`.

This is stage 2 of 3. Earlier app-log files are no longer visible and the
downstream DynamicMem tasks are still hidden.

Read only the current batch:

- `current_stage/documents.json`
- `current_stage/docs/`

Continue updating the allowed memory/state from these later raw app logs. Prefer
later evidence when the user's current state changes. Do not write the final
prediction yet.
"""
    checkpoint_id = checkpoint.get("checkpoint_id")
    timestamp = (checkpoint.get("as_of") or {}).get("timestamp")
    return f"""You are working in `/app`.

This is stage 3 of 3. The raw app logs are no longer visible as files.

Read:

- `current_stage/dynamicmem-task.json`

Write:

- `outputs/prediction.json`

Complete both native DynamicMem task families for checkpoint `{checkpoint_id}` as
of `{timestamp}`:

- `snapshot_state`: fill every key under `state_completion.keys`.
- `evidence`: provide supporting evidence records per state key.
- `rq3_apply_answers`: answer every item under `personalized_service.keys`.

Use this exact top-level shape:

```json
{{
  "task_contract_version": "taskabc_v2",
  "research_frame_version": "rq_v2",
  "predictions": [
    {{
      "checkpoint_id": "{checkpoint_id}",
      "snapshot_state": {{}},
      "evidence": {{}},
      "rq3_apply_answers": {{}}
    }}
  ]
}}
```

For `rq3_apply_answers`, use this shape per state key:

```json
{{
  "items": [
    {{
      "qa_id": "q1",
      "service_family": "user_communication",
      "answer": "...",
      "evidence": [
        {{"app_log_id": "log_00001", "evidence_content": "short support"}}
      ]
    }}
  ]
}}
```

For structured service items, `answer` must be an object matching the visible
`output_template`. For `user_communication`, `answer` should be a specific
assistant message string.
"""


def render_task_toml(config: BuildConfig = DEFAULT_BUILD_CONFIG) -> str:
    return f"""schema_version = "1.3"

artifacts = [
  "/app/outputs/prediction.json",
  "/app/memory.md",
  "/app/stage-log.jsonl",
]

[task]
name = "context-router/{config.task_id}"
description = "DynamicMem {config.source_user_id} native checkpoint Harbor background-memory task."
authors = []
keywords = ["context-router", "eval-harbor", "dynamicmem", "background-memory", "state-completion", "personalized-service"]

[metadata]
difficulty = "hard"
category = "personal-memory"
tags = ["dynamicmem", "background-memory", "continuous-session", "staged-reveal", "state-completion", "personalized-service", "native-task-pack"]

[verifier]
timeout_sec = 120.0

[agent]
timeout_sec = 1200.0

[environment]
build_timeout_sec = 600.0
cpus = 1
memory_mb = 2048
storage_mb = 10240
gpus = 0
mcp_servers = []
workdir = "/app"

[verifier.env]

[environment.env]

[solution.env]
"""


def render_yaml_list(items: list[dict[str, Any]], indent: int) -> str:
    spaces = " " * indent
    lines: list[str] = []
    for item in items:
        first = True
        for key, value in item.items():
            prefix = "- " if first else "  "
            rendered = json.dumps(value) if isinstance(value, (list, dict)) else str(value)
            lines.append(f"{spaces}{prefix}{key}: {rendered}")
            first = False
    return "\n".join(lines)


def render_job(arm: dict[str, Any], config: BuildConfig = DEFAULT_BUILD_CONFIG) -> str:
    mode = arm["mode"]
    memory_mode = arm.get("memoryMode", mode)
    instruction_path = arm["instructionPath"]
    compose = arm.get("compose", "staged")
    compose_path = (
        f"examples/eval-harbor/jobs/{config.task_id}-cr-mcp.compose.yml"
        if compose == "cr-mcp"
        else f"examples/eval-harbor/jobs/{config.task_id}-staged.compose.yml"
    )
    suffix = f"{config.task_id}-{mode}"
    mcp_servers = arm.get("mcpServers", [])
    artifacts = arm.get("artifacts", [])

    lines = [
        f"job_name: eval-harbor-{suffix}",
        "n_concurrent_trials: 1",
        "",
        "environment:",
        "  force_build: true",
        "  env:",
        f"    EVAL_MEMORY_MODE: {memory_mode}",
        "  extra_docker_compose:",
        f"    - {compose_path}",
        "",
        "agents:",
        "  - name: codex",
        f"    model_name: {config.model_name}",
        "    kwargs:",
        f"      reasoning_effort: {config.reasoning_effort}",
    ]
    if mcp_servers:
        lines.append("    mcp_servers:")
        lines.append(render_yaml_list(mcp_servers, 6))
    lines.extend(
        [
            "",
            "tasks:",
            f"  - path: examples/eval-harbor/tasks/{config.task_id}",
            "",
            "extra_instruction_paths:",
            f"  - {instruction_path}",
        ]
    )
    if artifacts:
        lines.extend(["", "artifacts:"])
        lines.append(render_yaml_list(artifacts, 2))
    return "\n".join(lines) + "\n"


def render_cr_mcp_compose() -> str:
    return """services:
  main:
    depends_on:
      stage-server:
        condition: service_healthy
      cr-memory:
        condition: service_healthy

  stage-server:
    build:
      context: ${CONTEXT_DIR}/../../../sidecars/stage-server
    volumes:
      - ${CONTEXT_DIR}/../stages/payload.json:/data/stages.json:ro
    expose:
      - "8765"
    healthcheck:
      test: ["CMD", "python", "-c", "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8765/health', timeout=2).read()"]
      interval: 2s
      timeout: 5s
      retries: 15
      start_period: 5s

  cr-memory:
    build:
      context: ${CONTEXT_DIR}/../../../sidecars/cr-memory
    volumes:
      - ${CONTEXT_DIR}/../mcp/catalog.json:/data/catalog.json:ro
    expose:
      - "8000"
    healthcheck:
      test: ["CMD", "python", "-c", "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/health', timeout=2).read()"]
      interval: 2s
      timeout: 5s
      retries: 15
      start_period: 5s
"""


def render_staged_compose() -> str:
    return """services:
  main:
    depends_on:
      stage-server:
        condition: service_healthy

  stage-server:
    build:
      context: ${CONTEXT_DIR}/../../../sidecars/stage-server
    volumes:
      - ${CONTEXT_DIR}/../stages/payload.json:/data/stages.json:ro
    expose:
      - "8765"
    healthcheck:
      test: ["CMD", "python", "-c", "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8765/health', timeout=2).read()"]
      interval: 2s
      timeout: 5s
      retries: 15
      start_period: 5s
"""


def score_script() -> str:
    return r'''#!/usr/bin/env python3
import json
import re
import shutil
from pathlib import Path


PREDICTION_PATH = Path("/app/outputs/prediction.json")
EXPECTED_BENCHMARK = Path("/tests/expected/benchmark.json")
ARTIFACT_ROOT = Path("/logs/artifacts")
REWARD_DIR = Path("/logs/verifier")


def load_json(path):
    with path.open("r", encoding="utf-8") as handle:
        return json.load(handle)


def write_json(path, payload):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def normalize_text(value):
    text = re.sub(r"[^a-z0-9]+", " ", str(value).lower())
    return " ".join(text.split())


def flatten_snapshot(snapshot):
    if not isinstance(snapshot, dict):
        return {}
    if any(isinstance(key, str) and ":" in key for key in snapshot):
        return {str(key): value for key, value in snapshot.items()}
    out = {}
    for group, values in snapshot.items():
        if isinstance(values, dict):
            for key, value in values.items():
                out[f"{group}:{key}"] = value
    return out


def drop_excluded(value):
    if isinstance(value, dict):
        out = {}
        for key, child in value.items():
            if str(key).lower() in {"priority", "schedule_date", "schedule_dates"}:
                continue
            cleaned = drop_excluded(child)
            if cleaned not in (None, "", [], {}):
                out[key] = cleaned
        return out
    if isinstance(value, list):
        return [drop_excluded(child) for child in value]
    return value


def values_match(actual, expected):
    if actual == expected:
        return True
    if isinstance(actual, str) and isinstance(expected, str):
        actual_text = normalize_text(actual)
        expected_text = normalize_text(expected)
        return actual_text == expected_text or (expected_text and expected_text in actual_text)
    return False


def get_path(value, path):
    cur = value
    for part in str(path).split("."):
        if isinstance(cur, dict) and part in cur:
            cur = cur[part]
        else:
            return None
    return cur


def state_expected(checkpoint):
    pack_keys = (checkpoint.get("state_completion_pack") or {}).get("keys") or {}
    validated = flatten_snapshot(checkpoint.get("validated_snapshot_state") or {})
    expected = {}
    for key in sorted(pack_keys):
        value = drop_excluded(validated.get(key))
        if value not in (None, "", [], {}):
            expected[key] = value
    return expected


def score_state(checkpoint, prediction):
    expected = state_expected(checkpoint)
    actual = flatten_snapshot(prediction.get("snapshot_state") or {})
    missing, wrong = [], []
    for key, expected_value in expected.items():
        if key not in actual:
            missing.append(key)
        elif not values_match(actual[key], expected_value):
            wrong.append({"key": key, "expected": expected_value, "actual": actual[key]})
    correct = len(expected) - len(missing) - len(wrong)
    return {
        "total": len(expected),
        "correct": correct,
        "accuracy": correct / len(expected) if expected else 0.0,
        "missing": missing,
        "wrong": wrong,
    }


def expected_apply_items(checkpoint):
    out = []
    keys = ((checkpoint.get("rq3_apply_service_qa") or {}).get("keys") or {})
    for state_key, node in sorted(keys.items()):
        for item in node.get("items") or []:
            if isinstance(item, dict):
                out.append((state_key, item))
    return out


def score_user_communication(answer, points):
    if isinstance(points, dict):
        points = []
    text = normalize_text(answer)
    point_scores = []
    for point in points:
        if point.get("point_role") == "identity_gate":
            continue
        ref = point.get("reference_value")
        if ref is None:
            continue
        if isinstance(ref, list):
            ok = all(normalize_text(item) in text for item in ref)
        else:
            ok = normalize_text(ref) in text
        point_scores.append(1.0 if ok else 0.0)
    if not point_scores:
        return 1.0 if str(answer).strip() else 0.0
    return sum(point_scores) / len(point_scores)


def score_structured_answer(answer, item):
    reference_output = item.get("reference_output")
    if answer == reference_output:
        return 1.0
    points = item.get("answer_scoring_points") or []
    scores = []
    for point in points:
        target_path = point.get("target_path") or point.get("output_field_path")
        if not target_path:
            continue
        expected = point.get("reference_value")
        actual = get_path(answer, target_path)
        scores.append(1.0 if values_match(actual, expected) else 0.0)
    if scores:
        return sum(scores) / len(scores)
    return 1.0 if answer == reference_output else 0.0


def score_apply(checkpoint, prediction):
    predicted = prediction.get("rq3_apply_answers") or {}
    rows, scores = [], []
    for state_key, item in expected_apply_items(checkpoint):
        qa_id = str(item.get("qa_id") or "")
        pred_items = ((predicted.get(state_key) or {}).get("items") or [])
        pred_item = next((row for row in pred_items if str(row.get("qa_id") or "") == qa_id), None)
        if not isinstance(pred_item, dict):
            rows.append({"stateKey": state_key, "qaId": qa_id, "score": 0.0, "reason": "missing"})
            scores.append(0.0)
            continue
        answer = pred_item.get("answer")
        if str(item.get("service_family") or "") == "user_communication":
            if values_match(answer, item.get("reference_answer") or ""):
                score = 1.0
            else:
                score = score_user_communication(answer, item.get("answer_scoring_points") or [])
        else:
            score = score_structured_answer(answer, item)
        rows.append({"stateKey": state_key, "qaId": qa_id, "score": score, "reason": "deterministic-local"})
        scores.append(score)
    return {
        "total": len(scores),
        "correct": sum(1 for score in scores if score >= 0.999),
        "meanScore": sum(scores) / len(scores) if scores else 0.0,
        "items": rows,
    }


def main():
    benchmark = load_json(EXPECTED_BENCHMARK)
    checkpoint = benchmark["checkpoints"][0]
    checkpoint_id = str(checkpoint.get("checkpoint_id") or "")
    if not PREDICTION_PATH.exists():
        summary = {
            "reward": 0.0,
            "parseSuccess": False,
            "error": f"Missing output file: {PREDICTION_PATH}",
        }
        write_json(ARTIFACT_ROOT / "score-summary.json", summary)
        write_json(REWARD_DIR / "reward.json", {"reward": 0.0})
        return

    try:
        raw = load_json(PREDICTION_PATH)
        parse_success = isinstance(raw, dict)
    except Exception as error:
        summary = {"reward": 0.0, "parseSuccess": False, "error": str(error)}
        write_json(ARTIFACT_ROOT / "score-summary.json", summary)
        write_json(REWARD_DIR / "reward.json", {"reward": 0.0})
        return

    predictions = raw.get("predictions") if isinstance(raw, dict) else None
    prediction = None
    if isinstance(predictions, list):
        prediction = next((item for item in predictions if str(item.get("checkpoint_id") or "") == checkpoint_id), None)
    if not isinstance(prediction, dict):
        prediction = {}

    state = score_state(checkpoint, prediction)
    apply = score_apply(checkpoint, prediction)
    metadata_success = (
        raw.get("task_contract_version") == benchmark.get("task_contract_version")
        and raw.get("research_frame_version") == benchmark.get("research_frame_version")
        and bool(prediction)
    )
    reward = (state["accuracy"] + apply["meanScore"]) / 2 if apply["total"] else state["accuracy"]
    if not metadata_success:
        reward *= 0.5

    summary = {
        "reward": reward,
        "fieldAccuracy": state["accuracy"],
        "parseSuccess": parse_success,
        "metadataSuccess": metadata_success,
        "metadataErrors": [] if metadata_success else ["prediction contract metadata mismatch"],
        "checkpointId": checkpoint_id,
        "stateCompletion": state,
        "personalizedService": apply,
        "missingFields": state["missing"],
        "wrongFields": state["wrong"],
        "overfillFields": [],
        "outputRoot": "outputs",
        "outputFiles": ["prediction.json"],
        "officialDynamicMemJudge": "not-run-in-harbor-local-scorer",
        "note": "This deterministic Harbor scorer is a smoke/verifier proxy. The output contract is upstream DynamicMem-compatible for official LLM-as-judge evaluation.",
    }
    ARTIFACT_ROOT.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(PREDICTION_PATH, ARTIFACT_ROOT / "prediction.json")
    write_json(ARTIFACT_ROOT / "score-summary.json", summary)
    write_json(
        REWARD_DIR / "reward.json",
        {
            "reward": reward,
            "state_completion_accuracy": state["accuracy"],
            "rq3_apply_mean_score": apply["meanScore"],
            "parse_success": 1.0 if parse_success else 0.0,
            "metadata_success": 1.0 if metadata_success else 0.0,
        },
    )


if __name__ == "__main__":
    main()
'''


def solution_script(task_packs: dict[str, Any], checkpoint: dict[str, Any]) -> str:
    prediction = {
        "task_contract_version": task_packs.get("task_contract_version"),
        "research_frame_version": task_packs.get("research_frame_version"),
        "predictions": [
            {
                "checkpoint_id": checkpoint.get("checkpoint_id"),
                "snapshot_state": expected_snapshot_from_pack(checkpoint),
                "evidence": {},
                "rq3_apply_answers": {},
            }
        ],
    }
    evidence_flat = flatten_snapshot(checkpoint.get("state_observability") or {})
    pred_item = prediction["predictions"][0]
    for key in pred_item["snapshot_state"]:
        evidence_ids = []
        obs = evidence_flat.get(key)
        if isinstance(obs, dict):
            evidence_ids = obs.get("evidence_app_log_ids") or []
        pred_item["evidence"][key] = [
            {"app_log_id": log_id, "evidence_content": "oracle evidence id"}
            for log_id in evidence_ids[:3]
        ]
    for state_key, node in sorted(((checkpoint.get("rq3_apply_service_qa") or {}).get("keys") or {}).items()):
        answers = []
        for item in node.get("items") or []:
            if str(item.get("service_family") or "") == "user_communication":
                answer = item.get("reference_answer") or ""
            else:
                answer = item.get("reference_output")
            answers.append(
                {
                    "qa_id": item.get("qa_id"),
                    "service_family": item.get("service_family"),
                    "answer": answer,
                    "evidence": [
                        {"app_log_id": log_id, "evidence_content": "oracle evidence id"}
                        for log_id in (item.get("gold_memory_evidence_app_log_ids") or [])[:3]
                    ],
                    "status": "valid",
                }
            )
        pred_item["rq3_apply_answers"][state_key] = {"items": answers}
    return (
        "#!/bin/sh\n"
        "set -eu\n\n"
        "/app/next_stage >/tmp/oracle-stage-1.log\n"
        "/app/next_stage >/tmp/oracle-stage-2.log\n"
        "/app/next_stage >/tmp/oracle-stage-3.log\n\n"
        "mkdir -p outputs\n\n"
        "cat > outputs/prediction.json <<'JSON'\n"
        f"{json.dumps(prediction, indent=2, sort_keys=True)}\n"
        "JSON\n"
    )


def build_catalog(
    visible_task: dict[str, Any],
    config: BuildConfig = DEFAULT_BUILD_CONFIG,
) -> dict[str, Any]:
    preferences = []
    for state_key, item in visible_task["state_completion"]["keys"].items():
        preferences.append(
            {
                "slug": state_key,
                "category": state_group(state_key),
                "description": str(item.get("question_text") or ""),
                "valueType": "json",
                "scope": config.task_id,
            }
        )
    return {
        "schemaVersion": 1,
        "taskId": config.task_id,
        "source": f"DynamicMem {config.source_user_id} native state-completion keys",
        "preferences": preferences,
    }


def render_soundness_report(
    difficulty: dict[str, Any],
    visible_task: dict[str, Any],
    config: BuildConfig = DEFAULT_BUILD_CONFIG,
) -> str:
    lines = [
        f"# {config.task_id} Soundness Report",
        "",
        "This report is for benchmark reviewers. It is hidden from the agent.",
        "",
        "## Migration Contract",
        "",
        "- Harbor is only the runner.",
        "- T1 uses raw DynamicMem app-log objects, not summaries or selected evidence only.",
        "- T2 uses DynamicMem State Completion and Personalized Service queries.",
        "- Hidden expected files preserve the upstream checkpoint task packs.",
        "- Agent-visible task files remove reference answers, reference outputs, scoring points, and gold evidence ids.",
        "",
        "## What The Agent Sees",
        "",
        "| Stage | Kind | Visible docs | Visible files | Approx tokens | Agent task |",
        "| ---: | --- | ---: | ---: | ---: | --- |",
    ]
    for stage in difficulty["stages"]:
        lines.append(
            "| {stageIndex} | {kind} | {visibleDocCount} | {visibleFileCount} | {approxTokenCount} | {agentTask} |".format(
                **stage
            )
        )
    lines.extend(
        [
            "",
            "## Native Task Counts",
            "",
            f"- State completion keys: `{difficulty['totals']['stateCompletionKeyCount']}`",
            f"- Personalized service keys: `{difficulty['totals']['personalizedServiceKeyCount']}`",
            f"- Personalized service items: `{difficulty['totals']['personalizedServiceItemCount']}`",
            f"- Observed raw logs: `{difficulty['totals']['observedRawLogCount']}`",
            "",
            "## Service Families",
            "",
            "| Family | Count |",
            "| --- | ---: |",
        ]
    )
    family_counts: dict[str, int] = {}
    for node in visible_task["personalized_service"]["keys"].values():
        for item in node.get("items", []):
            family = str(item.get("service_family") or "unknown")
            family_counts[family] = family_counts.get(family, 0) + 1
    for family, count in sorted(family_counts.items()):
        lines.append(f"| `{family}` | {count} |")
    lines.extend(
        [
            "",
            "## Difficulty Block",
            "",
            "```json",
            json.dumps(difficulty, indent=2, sort_keys=True),
            "```",
            "",
        ]
    )
    return "\n".join(lines)


def build_task(
    source_dir: Path,
    task_dir: Path,
    jobs_dir: Path,
    *,
    arm_configs: list[dict[str, Any]] | None = None,
    config: BuildConfig = DEFAULT_BUILD_CONFIG,
) -> None:
    app_logs = normalize_app_logs(load_json(source_dir / "app_log_large.json"))
    task_packs = load_json(source_dir / "task_packs.json")
    previous_checkpoint, final_checkpoint = selected_checkpoint(task_packs, config)

    if task_packs.get("user_id") != config.source_user_id:
        raise ValueError(f"expected {config.source_user_id}, got {task_packs.get('user_id')}")
    if task_packs.get("task_contract_version") != "taskabc_v2":
        raise ValueError("only DynamicMem taskabc_v2 packs are supported")
    if not (final_checkpoint.get("state_completion_pack") and final_checkpoint.get("rq3_apply_service_qa")):
        raise ValueError("target checkpoint must contain state_completion_pack and rq3_apply_service_qa")

    observed_logs = observed_logs_for_checkpoint(final_checkpoint, app_logs)
    previous_logs = observed_logs_for_checkpoint(previous_checkpoint, app_logs) if previous_checkpoint else []
    later_logs = observed_logs[len(previous_logs) :]
    visible_task = visible_dynamicmem_task(final_checkpoint, task_packs, config)
    stage_payload = build_stage_payload(
        first_logs=previous_logs,
        later_logs=later_logs,
        visible_task=visible_task,
        checkpoint=final_checkpoint,
        config=config,
    )
    difficulty = build_difficulty(
        stage_payload=stage_payload,
        checkpoint=final_checkpoint,
        visible_task=visible_task,
        observed_logs=observed_logs,
        config=config,
    )

    if task_dir.exists():
        shutil.rmtree(task_dir)

    workspace = task_dir / "environment" / "workspace"
    write_text(
        task_dir / "environment" / "Dockerfile",
        "FROM python:3.12-slim\n\n"
        "WORKDIR /app\n\n"
        "COPY workspace/ /app/\n\n"
        "RUN chmod +x /app/next_stage && mkdir -p /app/outputs\n",
    )
    write_text(workspace / "next_stage", NEXT_STAGE_SCRIPT, executable=True)
    write_json(task_dir / "stages" / "payload.json", stage_payload)

    write_text(task_dir / "instruction.md", render_instruction())
    write_text(task_dir / "task.toml", render_task_toml(config))
    write_json(task_dir / "tests" / "expected" / "benchmark.json", hidden_benchmark(task_packs, final_checkpoint))
    write_json(task_dir / "tests" / "expected" / "visible-task.json", visible_task)
    write_json(task_dir / "tests" / "expected" / "difficulty.json", difficulty)
    write_text(task_dir / "tests" / "expected" / "soundness-report.md", render_soundness_report(difficulty, visible_task, config))
    write_text(task_dir / "tests" / "score_dynamicmem_prediction.py", score_script(), executable=True)
    write_text(
        task_dir / "tests" / "test.sh",
        "#!/bin/sh\nset -eu\n\npython3 /tests/score_dynamicmem_prediction.py\n",
        executable=True,
    )
    write_text(task_dir / "solution" / "solve.sh", solution_script(task_packs, final_checkpoint), executable=True)
    write_json(task_dir / "mcp" / "catalog.json", build_catalog(visible_task, config))
    write_text(
        task_dir / "README.md",
        f"""# {config.task_id}

This Harbor task is generated from DynamicMem (`xiewenya/dynamicmem`, MIT
license). Harbor is only the runner. The task preserves the native DynamicMem
checkpoint content:

- raw `app_log_large.json` entries are revealed in chronological batches;
- hidden expected files store the upstream checkpoint task packs;
- the final visible task exposes sanitized State Completion and Personalized
  Service queries;
- the agent writes upstream-compatible `outputs/prediction.json`.

Source user: `{config.source_user_dir}` / `{config.source_user_id}`
Target checkpoint: `{final_checkpoint['checkpoint_id']}` as of `{final_checkpoint['as_of']['timestamp']}`
Observed raw logs: `{len(observed_logs)}`
State completion keys: `{difficulty['totals']['stateCompletionKeyCount']}`
Personalized service items: `{difficulty['totals']['personalizedServiceItemCount']}`

Human-review materials:

- `tests/expected/difficulty.json`
- `tests/expected/soundness-report.md`
- `tests/expected/benchmark.json` hidden upstream-compatible benchmark slice
- `tests/expected/visible-task.json` sanitized final-stage task payload

Regenerate from a local DynamicMem user directory:

```bash
python3 examples/eval-harbor/scripts/build_dynamicmem_task.py \\
  --source-dir /path/to/DynamicMem/{config.source_user_dir} \\
  --model {config.model_name} \\
  --reasoning-effort {config.reasoning_effort}
```

Do not expose `tests/expected/` files to agents.
""",
    )

    jobs_dir.mkdir(parents=True, exist_ok=True)
    for arm in arm_configs or load_arm_configs():
        write_text(jobs_dir / f"{config.task_id}-{arm['mode']}.yaml", render_job(arm, config))
    write_text(jobs_dir / f"{config.task_id}-staged.compose.yml", render_staged_compose())
    write_text(jobs_dir / f"{config.task_id}-cr-mcp.compose.yml", render_cr_mcp_compose())


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--source-dir",
        type=Path,
        required=True,
        help="Local DynamicMem user directory containing app_log_large.json and task_packs.json.",
    )
    parser.add_argument(
        "--task-dir",
        type=Path,
        default=Path("examples/eval-harbor/tasks") / DEFAULT_BUILD_CONFIG.task_id,
    )
    parser.add_argument(
        "--jobs-dir",
        type=Path,
        default=Path("examples/eval-harbor/jobs"),
    )
    parser.add_argument(
        "--arms-config",
        type=Path,
        default=DEFAULT_ARM_CONFIG_PATH,
        help="JSON arm config with modes, instructions, compose type, and optional MCP artifacts.",
    )
    parser.add_argument("--model", default=DEFAULT_BUILD_CONFIG.model_name)
    parser.add_argument(
        "--reasoning-effort",
        default=DEFAULT_BUILD_CONFIG.reasoning_effort,
        choices=sorted(REASONING_EFFORT_CHOICES),
        help="Codex model reasoning effort written into Harbor job kwargs.",
    )
    args = parser.parse_args()

    build_task(
        args.source_dir,
        args.task_dir,
        args.jobs_dir,
        arm_configs=load_arm_configs(args.arms_config),
        config=BuildConfig(
            task_id=DEFAULT_BUILD_CONFIG.task_id,
            corpus_id=DEFAULT_BUILD_CONFIG.corpus_id,
            source_user_dir=DEFAULT_BUILD_CONFIG.source_user_dir,
            source_user_id=DEFAULT_BUILD_CONFIG.source_user_id,
            previous_checkpoint_index=DEFAULT_BUILD_CONFIG.previous_checkpoint_index,
            final_checkpoint_index=DEFAULT_BUILD_CONFIG.final_checkpoint_index,
            model_name=args.model,
            reasoning_effort=args.reasoning_effort,
        ),
    )
    print(f"Generated {args.task_dir}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
