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

from trajectory_framework import (
    PATTERN_UPDATE_ANSWER_EVERY_CHECKPOINT,
    PATTERN_UPDATE_ONLY_THEN_FINAL,
    STAGE_KIND_DOWNSTREAM_TASK,
    STAGE_KIND_MEMORY_UPDATE,
    STAGE_KIND_UPDATE_ANSWER,
    STAGE_PATTERNS,
    TrajectoryStage,
    parse_stage_schedule,
    stage_pattern_suffix,
    stage_schedule_label,
    stage_schedule_suffix,
)


TASK_ID = "dynamicmem-user001-cp00-04-trajectory-v1"
CORPUS_ID = "dynamicmem-user001-cp00-04-trajectory-corpus"
SOURCE_USER_DIR = "001_user_001"
SOURCE_USER_ID = "user_001"
CHECKPOINT_INDICES = (0, 1, 2, 3, 4)
MODEL_NAME = "gpt-5.4-mini"
REASONING_EFFORT = "high"
CODEX_WEB_SEARCH = "disabled"
DEFAULT_AGENT_TIMEOUT_SEC = 86400.0
DEFAULT_VERIFIER_TIMEOUT_SEC = 86400.0
DEFAULT_BUILD_TIMEOUT_SEC = 600.0
DEFAULT_ARM_CONFIG_PATH = Path("examples/eval-harbor/arms/dynamicmem-default.json")
REASONING_EFFORT_CHOICES = {"low", "medium", "high", "xhigh"}
CODEX_WEB_SEARCH_CHOICES = {"disabled", "cached", "live"}

TASK_A_EXCLUDED_VALUE_FIELDS_V2 = {"priority", "schedule_date", "schedule_dates"}


@dataclass(frozen=True)
class BuildConfig:
    task_id: str = TASK_ID
    corpus_id: str = CORPUS_ID
    source_user_dir: str = SOURCE_USER_DIR
    source_user_id: str = SOURCE_USER_ID
    checkpoint_indices: tuple[int, ...] = CHECKPOINT_INDICES
    model_name: str = MODEL_NAME
    reasoning_effort: str = REASONING_EFFORT
    codex_web_search: str = CODEX_WEB_SEARCH
    agent_timeout_sec: float = DEFAULT_AGENT_TIMEOUT_SEC
    verifier_timeout_sec: float = DEFAULT_VERIFIER_TIMEOUT_SEC
    build_timeout_sec: float = DEFAULT_BUILD_TIMEOUT_SEC
    stage_pattern: str = PATTERN_UPDATE_ANSWER_EVERY_CHECKPOINT
    stage_schedule: tuple[str, ...] | None = None

    def __post_init__(self) -> None:
        if self.reasoning_effort not in REASONING_EFFORT_CHOICES:
            choices = ", ".join(sorted(REASONING_EFFORT_CHOICES))
            raise ValueError(f"reasoning_effort must be one of: {choices}")
        if self.codex_web_search not in CODEX_WEB_SEARCH_CHOICES:
            choices = ", ".join(sorted(CODEX_WEB_SEARCH_CHOICES))
            raise ValueError(f"codex_web_search must be one of: {choices}")
        if self.stage_pattern not in STAGE_PATTERNS:
            choices = ", ".join(sorted(STAGE_PATTERNS))
            raise ValueError(f"stage_pattern must be one of: {choices}")
        if not self.checkpoint_indices:
            raise ValueError("checkpoint_indices must not be empty")
        if tuple(sorted(set(self.checkpoint_indices))) != self.checkpoint_indices:
            raise ValueError("checkpoint_indices must be sorted and unique")
        if self.agent_timeout_sec <= 0:
            raise ValueError("agent_timeout_sec must be positive")
        if self.verifier_timeout_sec <= 0:
            raise ValueError("verifier_timeout_sec must be positive")
        if self.build_timeout_sec <= 0:
            raise ValueError("build_timeout_sec must be positive")
        if self.stage_schedule is not None:
            if not self.stage_schedule:
                raise ValueError("stage_schedule must not be empty")
            invalid = [kind for kind in self.stage_schedule if kind not in {
                STAGE_KIND_UPDATE_ANSWER,
                STAGE_KIND_MEMORY_UPDATE,
                STAGE_KIND_DOWNSTREAM_TASK,
            }]
            if invalid:
                raise ValueError(f"unsupported stage_schedule kind(s): {invalid}")

    @property
    def stage_contract_name(self) -> str:
        return "custom-stage-schedule" if self.stage_schedule is not None else self.stage_pattern

    @property
    def stage_contract_display(self) -> str:
        if self.stage_schedule is not None:
            return stage_schedule_label(self.stage_schedule)
        return self.stage_pattern


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


def selected_checkpoints(
    task_packs: dict[str, Any],
    config: BuildConfig = DEFAULT_BUILD_CONFIG,
) -> list[tuple[int, dict[str, Any]]]:
    checkpoints = task_packs["checkpoints"]
    selected = []
    for index in config.checkpoint_indices:
        if index < 0 or index >= len(checkpoints):
            raise ValueError(f"checkpoint index out of range: {index}")
        selected.append((index, checkpoints[index]))
    return selected


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


@dataclass(frozen=True)
class StagePlanItem:
    kind: str
    spec: dict[str, Any]
    scores_checkpoint: bool


def preset_stage_schedule(config: BuildConfig, checkpoint_count: int) -> tuple[str, ...]:
    if config.stage_schedule is not None:
        return config.stage_schedule
    if config.stage_pattern == PATTERN_UPDATE_ANSWER_EVERY_CHECKPOINT:
        return tuple(STAGE_KIND_UPDATE_ANSWER for _ in range(checkpoint_count))
    if config.stage_pattern == PATTERN_UPDATE_ONLY_THEN_FINAL:
        return tuple(STAGE_KIND_MEMORY_UPDATE for _ in range(checkpoint_count)) + (
            STAGE_KIND_DOWNSTREAM_TASK,
        )
    raise ValueError(f"unsupported stage pattern: {config.stage_pattern}")


def resolve_stage_plan(
    stage_specs: list[dict[str, Any]],
    config: BuildConfig = DEFAULT_BUILD_CONFIG,
) -> list[StagePlanItem]:
    schedule = preset_stage_schedule(config, len(stage_specs))
    update_kinds = {STAGE_KIND_UPDATE_ANSWER, STAGE_KIND_MEMORY_UPDATE}
    update_count = sum(1 for kind in schedule if kind in update_kinds)
    if update_count != len(stage_specs):
        raise ValueError(
            "stage schedule must contain exactly one U/UA token per selected "
            f"checkpoint: updates={update_count} checkpoints={len(stage_specs)}"
        )

    checkpoint_cursor = 0
    latest_spec: dict[str, Any] | None = None
    stage_plan: list[StagePlanItem] = []
    scored_checkpoint_ids: set[str] = set()

    for kind in schedule:
        if kind in update_kinds:
            if checkpoint_cursor >= len(stage_specs):
                raise ValueError("stage schedule consumes more checkpoints than selected")
            spec = stage_specs[checkpoint_cursor]
            checkpoint_cursor += 1
            latest_spec = spec
            scores_checkpoint = kind == STAGE_KIND_UPDATE_ANSWER
        elif kind == STAGE_KIND_DOWNSTREAM_TASK:
            if latest_spec is None:
                raise ValueError("stage schedule cannot reveal T before any U/UA stage")
            spec = latest_spec
            scores_checkpoint = True
        else:
            raise ValueError(f"unsupported stage schedule kind: {kind}")

        if scores_checkpoint:
            checkpoint_id = str(spec["checkpoint"].get("checkpoint_id") or "")
            if checkpoint_id in scored_checkpoint_ids:
                raise ValueError(f"stage schedule scores checkpoint more than once: {checkpoint_id}")
            scored_checkpoint_ids.add(checkpoint_id)
        stage_plan.append(StagePlanItem(kind=kind, spec=spec, scores_checkpoint=scores_checkpoint))

    if checkpoint_cursor != len(stage_specs):
        raise ValueError("stage schedule did not consume every selected checkpoint")
    if not scored_checkpoint_ids:
        raise ValueError("stage schedule must include at least one T or UA scored checkpoint")
    if latest_spec is not None:
        latest_checkpoint_id = str(latest_spec["checkpoint"].get("checkpoint_id") or "")
        if latest_checkpoint_id not in scored_checkpoint_ids:
            raise ValueError("stage schedule must score the final updated checkpoint")

    return stage_plan


def scored_specs_from_stage_plan(stage_plan: list[StagePlanItem]) -> list[dict[str, Any]]:
    return [item.spec for item in stage_plan if item.scores_checkpoint]


def hidden_benchmark(task_packs: dict[str, Any], checkpoints: list[dict[str, Any]]) -> dict[str, Any]:
    out = {
        key: deepcopy(value)
        for key, value in task_packs.items()
        if key != "checkpoints"
    }
    out["total_checkpoints"] = len(checkpoints)
    out["checkpoints"] = [deepcopy(checkpoint) for checkpoint in checkpoints]
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
    checkpoints: list[tuple[int, dict[str, Any]]],
    visible_tasks: list[dict[str, Any]],
    observed_logs: list[dict[str, Any]],
    config: BuildConfig = DEFAULT_BUILD_CONFIG,
) -> dict[str, Any]:
    stages = []
    agent_tasks = {
        STAGE_KIND_UPDATE_ANSWER: "Ingest new raw DynamicMem app logs and answer the current checkpoint's native tasks.",
        STAGE_KIND_MEMORY_UPDATE: "Ingest new raw DynamicMem app-log delta and update retained memory only.",
        STAGE_KIND_DOWNSTREAM_TASK: "Answer the downstream DynamicMem checkpoint task using retained memory.",
    }
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
                "agentTask": agent_tasks.get(str(stage.get("kind") or ""), "Run the trajectory stage."),
            }
        )

    state_keys = [
        key
        for task in visible_tasks
        for key in task["state_completion"]["keys"]
    ]
    apply_items = [
        item
        for task in visible_tasks
        for node in task["personalized_service"]["keys"].values()
        for item in node.get("items", [])
    ]
    service_families = sorted({str(item.get("service_family") or "") for item in apply_items})
    total_chars = sum(stage["visibleCharCount"] for stage in stages)
    app_names = sorted({str(log.get("app_name") or "") for log in observed_logs})
    api_names = sorted({str(log.get("api_name") or "") for log in observed_logs})
    checkpoint_ids = [str(checkpoint.get("checkpoint_id") or "") for _, checkpoint in checkpoints]
    checkpoint_timestamps = [
        str((checkpoint.get("as_of") or {}).get("timestamp") or "")
        for _, checkpoint in checkpoints
    ]
    scored_checkpoint_ids = [
        str((task.get("checkpoint") or {}).get("checkpoint_id") or "")
        for task in visible_tasks
    ]
    kind_sequence = [stage["kind"] for stage in stages]
    is_memory_final = (
        len(kind_sequence) >= 2
        and kind_sequence[:-1] == [STAGE_KIND_MEMORY_UPDATE] * (len(kind_sequence) - 1)
        and kind_sequence[-1] == STAGE_KIND_DOWNSTREAM_TASK
    )
    return {
        "schemaVersion": 1,
        "taskId": config.task_id,
        "taskType": "dynamicmem-native-background-memory-trajectory",
        "taskContract": "dataset-adapter/trajectory-v1",
        "migrationPolicy": "Harbor runner only; DynamicMem raw logs, task packs, prediction contract, and downstream task families are preserved.",
        "stagePatternName": config.stage_contract_name,
        "stagePattern": " -> ".join(kind_sequence),
        "stageSchedule": config.stage_contract_display,
        "trajectory": {
            "sourceUserDir": config.source_user_dir,
            "sourceUserId": config.source_user_id,
            "checkpointIndices": [index for index, _ in checkpoints],
            "checkpointIds": checkpoint_ids,
            "checkpointTimestamps": checkpoint_timestamps,
            "finalCheckpointIndex": checkpoints[-1][0],
            "finalCheckpointId": checkpoint_ids[-1],
            "finalCheckpointTimestamp": checkpoint_timestamps[-1],
            "scoredCheckpointIds": scored_checkpoint_ids,
        },
        "stages": stages,
        "totals": {
            "stageCount": len(stages),
            "updateAnswerStageCount": sum(1 for stage in stages if stage["kind"] == STAGE_KIND_UPDATE_ANSWER),
            "memoryUpdateStageCount": sum(1 for stage in stages if stage["kind"] == STAGE_KIND_MEMORY_UPDATE),
            "downstreamStageCount": sum(
                1
                for stage in stages
                if stage["kind"] in {STAGE_KIND_UPDATE_ANSWER, STAGE_KIND_DOWNSTREAM_TASK}
            ),
            "sourceCheckpointCount": len(checkpoints),
            "scoredCheckpointCount": len(visible_tasks),
            "checkpointCount": len(visible_tasks),
            "visibleDocCount": sum(stage["visibleDocCount"] for stage in stages),
            "visibleFileCount": sum(stage["visibleFileCount"] for stage in stages),
            "visibleCharCount": total_chars,
            "approxTokenCount": round(total_chars / 4),
            "stateCompletionKeyCount": len(state_keys),
            "uniqueStateCompletionKeyCount": len(set(state_keys)),
            "personalizedServiceKeyCount": sum(len(task["personalized_service"]["keys"]) for task in visible_tasks),
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
            "checkpointTrajectory": len(checkpoints) > 1,
            "customStageSchedule": config.stage_schedule is not None,
            "updateAnswerEveryCheckpoint": all(kind == STAGE_KIND_UPDATE_ANSWER for kind in kind_sequence),
            "hiddenFutureCheckpoints": True,
            "hiddenDownstreamUntilFinalStage": is_memory_final,
            "interleavedDownstreamTasks": any(
                kind == STAGE_KIND_DOWNSTREAM_TASK
                for kind in kind_sequence[:-1]
            ),
            "nativeStateCompletion": True,
            "nativePersonalizedService": True,
            "deltaRawCheckpointHistory": True,
            "longContextApprox70kPlus": round(total_chars / 4) >= 70000,
        },
    }


def build_stage_payload(
    *,
    stage_specs: list[dict[str, Any]],
    config: BuildConfig = DEFAULT_BUILD_CONFIG,
) -> dict[str, Any]:
    stages: list[dict[str, Any]] = []
    stage_plan = resolve_stage_plan(stage_specs, config)
    total_stages = len(stage_plan)
    for index, item in enumerate(stage_plan, start=1):
        spec = item.spec
        checkpoint_index = spec["checkpointIndex"]
        checkpoint = spec["checkpoint"]
        visible_task = spec["visibleTask"]
        logs = spec["logs"]
        stage_id = f"{index:02d}-cp{checkpoint_index:02d}-{item.kind}"
        files: list[dict[str, Any]]
        if item.kind == STAGE_KIND_UPDATE_ANSWER:
            instruction = render_update_answer_stage_instruction(index, total_stages, checkpoint)
            files = [
                *documents_payload(
                    logs,
                    purpose=(
                        "Raw DynamicMem app-log delta visible for this update-answer "
                        "checkpoint stage."
                    ),
                    config=config,
                ),
                {"path": "dynamicmem-task.json", "json": visible_task},
            ]
        elif item.kind == STAGE_KIND_MEMORY_UPDATE:
            instruction = render_memory_update_stage_instruction(index, total_stages, checkpoint)
            files = documents_payload(
                logs,
                purpose=(
                    "Raw DynamicMem app-log delta visible for a memory-update "
                    "stage. No downstream task is visible in this stage."
                ),
                config=config,
            )
        elif item.kind == STAGE_KIND_DOWNSTREAM_TASK:
            instruction = render_downstream_task_stage_instruction(index, total_stages, checkpoint)
            files = [{"path": "dynamicmem-task.json", "json": visible_task}]
        else:
            raise ValueError(f"unsupported stage schedule kind: {item.kind}")
        stages.append(
            TrajectoryStage(
                stage_id=stage_id,
                stage_index=index,
                checkpoint_index=checkpoint_index,
                checkpoint_id=checkpoint.get("checkpoint_id"),
                kind=item.kind,
                instruction=instruction,
                files=files,
            ).as_payload()
        )
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


def render_instruction(config: BuildConfig = DEFAULT_BUILD_CONFIG) -> str:
    if config.stage_schedule is not None:
        stage_contract = f"""The generated stage schedule is:

```text
{config.stage_contract_display}
```

Stages can have three roles:

- `memory-update`: read only the newly revealed raw app-log delta and update the
  memory/state allowed by the selected eval mode. Do not create or modify
  `outputs/prediction.json` in these stages.
- `downstream-task`: no source logs are revealed. Read `dynamicmem-task.json`
  and answer using retained memory from earlier stages.
- `update-answer`: read newly revealed raw app-log deltas plus
  `dynamicmem-task.json`, then both update memory and answer."""
        steps = """1. Run `/app/next_stage` to reveal the next stage.
2. If the stage is `memory-update`, read `documents.json` and `docs/`, then
   update only the allowed memory/state.
3. If the stage is `downstream-task`, read `dynamicmem-task.json`, then write
   `outputs/prediction.json` without using raw docs from the stage.
4. If the stage is `update-answer`, read both the raw app-log delta and
   `dynamicmem-task.json`, then update memory and write/update the prediction.
5. Repeat until `/app/next_stage` says no more stages are available."""
    elif config.stage_pattern == PATTERN_UPDATE_ONLY_THEN_FINAL:
        stage_contract = """Stages can have two roles:

- `memory-update`: read only the newly revealed raw app-log delta and update the
  memory/state allowed by the selected eval mode. Do not create or modify
  `outputs/prediction.json` in these stages.
- `downstream-task`: no source logs are revealed. Read `dynamicmem-task.json`
  and answer using retained memory from earlier stages."""
        steps = """1. Run `/app/next_stage` to reveal the next stage.
2. If the stage is `memory-update`, read `documents.json` and `docs/`, then
   update only the allowed memory/state.
3. If the stage is `downstream-task`, read `dynamicmem-task.json`, then write
   `outputs/prediction.json`.
4. Repeat until `/app/next_stage` says no more stages are available."""
    else:
        stage_contract = """Each revealed stage is an update-and-answer checkpoint. Future checkpoint logs
and future checkpoint tasks are not visible until their stage is revealed."""
        steps = """1. Run `/app/next_stage` to reveal the next checkpoint stage.
2. Read only that stage's raw app-log delta and `dynamicmem-task.json`.
3. Update the memory/state allowed by the selected eval mode.
4. Add or update that checkpoint's prediction in `outputs/prediction.json`.
5. Repeat until `/app/next_stage` says no more stages are available."""
    return f"""This is a continuous-session Harbor task for a native DynamicMem checkpoint trajectory.

You will receive staged information over time inside one agent session. The
runner is Harbor, but the task content follows DynamicMem:

{steps}

{stage_contract}

Do not inspect hidden expected answers, verifier files, source dataset files, or
any other answer-key artifacts.
"""


def render_update_answer_stage_instruction(step: int, total_steps: int, checkpoint: dict[str, Any]) -> str:
    checkpoint_id = checkpoint.get("checkpoint_id")
    timestamp = (checkpoint.get("as_of") or {}).get("timestamp")
    return f"""You are working in `/app`.

This is stage {step} of {total_steps}. It is an update-and-answer DynamicMem
checkpoint stage.

Read:

- `current_stage/documents.json`
- `current_stage/docs/`
- `current_stage/dynamicmem-task.json`

Each file under `docs/` is a raw DynamicMem app-log object newly visible for
this checkpoint. Ingest these logs in chronological order, update only the
memory/state allowed by the selected eval mode, then answer the current
checkpoint task.

Write or update:

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

Keep prior checkpoint predictions in the same `predictions` array if they were
already completed. Add one prediction object for checkpoint `{checkpoint_id}`.

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


def render_memory_update_stage_instruction(step: int, total_steps: int, checkpoint: dict[str, Any]) -> str:
    checkpoint_id = checkpoint.get("checkpoint_id")
    timestamp = (checkpoint.get("as_of") or {}).get("timestamp")
    return f"""You are working in `/app`.

This is stage {step} of {total_steps}. It is a memory-update DynamicMem stage.

Read:

- `current_stage/documents.json`
- `current_stage/docs/`

Each file under `docs/` is a raw DynamicMem app-log object newly visible up to
checkpoint `{checkpoint_id}` as of `{timestamp}`. Ingest these logs in
chronological order and update only the memory/state allowed by the selected
eval mode.

No downstream task is visible in this stage. Do not create or modify
`outputs/prediction.json` in this stage.
"""


def render_downstream_task_stage_instruction(step: int, total_steps: int, checkpoint: dict[str, Any]) -> str:
    checkpoint_id = checkpoint.get("checkpoint_id")
    timestamp = (checkpoint.get("as_of") or {}).get("timestamp")
    return f"""You are working in `/app`.

This is stage {step} of {total_steps}. It is the downstream DynamicMem task
stage.

Read:

- `current_stage/dynamicmem-task.json`

No raw app-log documents are revealed in this stage. Use only retained memory,
conversation context, or the memory substrate allowed by the selected eval mode.

Write:

- `outputs/prediction.json`

Complete both native DynamicMem task families for checkpoint `{checkpoint_id}` as
of `{timestamp}`:

- `snapshot_state`: fill every key under `state_completion.keys`.
- `evidence`: provide supporting evidence records per state key when available
  from retained memory.
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
description = "DynamicMem {config.source_user_id} native checkpoint trajectory Harbor background-memory task."
authors = []
keywords = ["context-router", "eval-harbor", "dynamicmem", "background-memory", "state-completion", "personalized-service"]

[metadata]
difficulty = "hard"
category = "personal-memory"
tags = ["dynamicmem", "background-memory", "continuous-session", "staged-reveal", "state-completion", "personalized-service", "native-task-pack"]

[verifier]
timeout_sec = {config.verifier_timeout_sec:.1f}

[agent]
timeout_sec = {config.agent_timeout_sec:.1f}

[environment]
build_timeout_sec = {config.build_timeout_sec:.1f}
cpus = 1
memory_mb = 2048
storage_mb = 10240
gpus = 0
mcp_servers = []
workdir = "/app"

[verifier.env]
DYNAMICMEM_JUDGE_MODE = "llm"
DYNAMICMEM_LLM_JUDGE_BASE_URL = "https://openrouter.ai/api/v1"
DYNAMICMEM_LLM_JUDGE_MODEL = "google/gemini-3.5-flash"
DYNAMICMEM_LLM_JUDGE_MAX_ITEMS = "0"
DYNAMICMEM_STAGE_PATTERN = "{config.stage_contract_name}"
DYNAMICMEM_STAGE_SCHEDULE = "{config.stage_contract_display}"

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
        f"      web_search: {config.codex_web_search}",
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
import os
import random
import re
import shutil
import urllib.error
import urllib.request
from pathlib import Path


PREDICTION_PATH = Path(os.environ.get("DYNAMICMEM_PREDICTION_PATH", "/app/outputs/prediction.json"))
EXPECTED_BENCHMARK = Path(os.environ.get("DYNAMICMEM_EXPECTED_BENCHMARK", "/tests/expected/benchmark.json"))
ARTIFACT_ROOT = Path(os.environ.get("DYNAMICMEM_ARTIFACT_ROOT", "/logs/artifacts"))
REWARD_DIR = Path(os.environ.get("DYNAMICMEM_REWARD_DIR", "/logs/verifier"))
DEFAULT_LLM_JUDGE_BASE_URL = "https://openrouter.ai/api/v1"
DEFAULT_LLM_JUDGE_MODEL = "google/gemini-3.5-flash"


def env_int(name, default):
    raw = os.environ.get(name)
    if raw in (None, ""):
        return default
    try:
        return int(raw)
    except ValueError:
        return default


def env_float(name, default):
    raw = os.environ.get(name)
    if raw in (None, ""):
        return default
    try:
        return float(raw)
    except ValueError:
        return default


JUDGE_MODE = os.environ.get("DYNAMICMEM_JUDGE_MODE", "llm").strip().lower()
LLM_JUDGE_MODEL = os.environ.get("DYNAMICMEM_LLM_JUDGE_MODEL", DEFAULT_LLM_JUDGE_MODEL).strip()
LLM_JUDGE_MAX_ITEMS = env_int("DYNAMICMEM_LLM_JUDGE_MAX_ITEMS", 0)
LLM_JUDGE_BATCH_SIZE = max(1, env_int("DYNAMICMEM_LLM_JUDGE_BATCH_SIZE", 8))
LLM_JUDGE_SEED = env_int("DYNAMICMEM_LLM_JUDGE_SEED", 13)
LLM_JUDGE_TIMEOUT_SEC = env_float("DYNAMICMEM_LLM_JUDGE_TIMEOUT_SEC", 90.0)


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


def predicted_apply_items(predicted, state_key):
    if not isinstance(predicted, dict):
        return []
    node = predicted.get(state_key)
    if isinstance(node, dict):
        items = node.get("items") or []
    elif isinstance(node, list):
        items = node
    else:
        items = []
    return [item for item in items if isinstance(item, dict)]


def score_apply(checkpoint, prediction):
    predicted = prediction.get("rq3_apply_answers") or {}
    rows, scores = [], []
    for state_key, item in expected_apply_items(checkpoint):
        qa_id = str(item.get("qa_id") or "")
        pred_items = predicted_apply_items(predicted, state_key)
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


def clamp_score(value):
    try:
        score = float(value)
    except (TypeError, ValueError):
        return 0.0
    return max(0.0, min(1.0, score))


def mean(values):
    return sum(values) / len(values) if values else 0.0


def checkpoint_id(checkpoint):
    return str(checkpoint.get("checkpoint_id") or "")


def state_question(checkpoint, state_key):
    item = ((checkpoint.get("state_completion_pack") or {}).get("keys") or {}).get(state_key)
    if isinstance(item, dict):
        return item.get("question_text")
    return None


def predicted_apply_item(prediction, state_key, qa_id):
    predicted = prediction.get("rq3_apply_answers") or {}
    pred_items = predicted_apply_items(predicted, state_key)
    return next((row for row in pred_items if str(row.get("qa_id") or "") == qa_id), None)


def build_llm_judge_items(checkpoints, predictions_by_id):
    items = []
    for checkpoint in checkpoints:
        cp_id = checkpoint_id(checkpoint)
        prediction = predictions_by_id.get(cp_id) or {}
        actual_state = flatten_snapshot(prediction.get("snapshot_state") or {})
        for state_key, expected_value in state_expected(checkpoint).items():
            actual_value = actual_state.get(state_key)
            deterministic_score = 1.0 if state_key in actual_state and values_match(actual_value, expected_value) else 0.0
            items.append(
                {
                    "id": f"{cp_id}::state::{state_key}",
                    "category": "state_completion",
                    "checkpoint_id": cp_id,
                    "state_key": state_key,
                    "question_text": state_question(checkpoint, state_key),
                    "expected": expected_value,
                    "actual": actual_value,
                    "deterministic_score": deterministic_score,
                }
            )
        for state_key, item in expected_apply_items(checkpoint):
            qa_id = str(item.get("qa_id") or "")
            pred_item = predicted_apply_item(prediction, state_key, qa_id)
            actual_answer = pred_item.get("answer") if isinstance(pred_item, dict) else None
            if str(item.get("service_family") or "") == "user_communication":
                deterministic_score = (
                    1.0
                    if values_match(actual_answer, item.get("reference_answer") or "")
                    else score_user_communication(actual_answer, item.get("answer_scoring_points") or [])
                )
            else:
                deterministic_score = score_structured_answer(actual_answer, item)
            items.append(
                {
                    "id": f"{cp_id}::service::{state_key}::{qa_id}",
                    "category": "personalized_service",
                    "checkpoint_id": cp_id,
                    "state_key": state_key,
                    "qa_id": qa_id,
                    "service_family": item.get("service_family"),
                    "scenario": item.get("scenario") or item.get("apply_scenario"),
                    "task_instruction": item.get("task_instruction") or item.get("apply_question") or item.get("question"),
                    "output_template": item.get("output_template"),
                    "reference_answer": item.get("reference_answer"),
                    "reference_output": item.get("reference_output"),
                    "answer_scoring_points": item.get("answer_scoring_points"),
                    "actual": actual_answer,
                    "deterministic_score": clamp_score(deterministic_score),
                }
            )
    return items


def select_llm_items(items):
    if LLM_JUDGE_MAX_ITEMS <= 0 or LLM_JUDGE_MAX_ITEMS >= len(items):
        return items, False
    indexed = list(enumerate(items))
    rng = random.Random(LLM_JUDGE_SEED)
    rng.shuffle(indexed)
    selected = sorted(indexed[:LLM_JUDGE_MAX_ITEMS], key=lambda pair: pair[0])
    return [item for _, item in selected], True


def extract_json_object(text):
    if isinstance(text, dict):
        return text
    if not isinstance(text, str):
        raise ValueError("LLM response content is not text")
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        start = text.find("{")
        end = text.rfind("}")
        if start < 0 or end < start:
            raise
        return json.loads(text[start : end + 1])


def call_openai_json(messages):
    api_key = os.environ.get("DYNAMICMEM_LLM_JUDGE_API_KEY") or os.environ.get("OPENAI_API_KEY")
    if not api_key:
        raise RuntimeError("missing OPENAI_API_KEY or DYNAMICMEM_LLM_JUDGE_API_KEY")
    base_url = (
        os.environ.get("DYNAMICMEM_LLM_JUDGE_BASE_URL")
        or os.environ.get("OPENAI_BASE_URL")
        or DEFAULT_LLM_JUDGE_BASE_URL
    ).rstrip("/")
    request_body = {
        "model": LLM_JUDGE_MODEL,
        "messages": messages,
        "temperature": 0,
        "response_format": {"type": "json_object"},
    }
    try:
        payload = post_openai_json(base_url, api_key, request_body)
    except urllib.error.HTTPError:
        request_body.pop("response_format", None)
        payload = post_openai_json(base_url, api_key, request_body)
    content = payload["choices"][0]["message"]["content"]
    return extract_json_object(content)


def post_openai_json(base_url, api_key, request_body):
    request = urllib.request.Request(
        f"{base_url}/chat/completions",
        data=json.dumps(request_body).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=LLM_JUDGE_TIMEOUT_SEC) as response:
        return json.loads(response.read().decode("utf-8"))


def judge_batch(batch):
    rubric = """You are scoring DynamicMem predictions.

Return a JSON object with exactly this shape:
{"items":[{"id":"...","score":0.0,"label":"correct|partial|wrong|missing","reason":"short"}]}

Use semantic equivalence, not string equality.

Score 1.0 when the actual answer captures the same fact or task result as the reference.
Score 0.5 when it is partly correct but missing important detail.
Score 0.0 when it is missing, contradicted, belongs to the wrong entity, uses stale facts, or invents unsupported details.

For state_completion, judge whether the actual memory value answers the question and preserves the expected durable fact.
For personalized_service, judge whether the actual downstream answer would satisfy the task instruction using the expected reference/scoring points.
Do not give credit for JSON formatting alone if the semantic value is wrong."""
    messages = [
        {"role": "system", "content": rubric},
        {
            "role": "user",
            "content": json.dumps({"items": batch}, ensure_ascii=False, sort_keys=True),
        },
    ]
    payload = call_openai_json(messages)
    rows = payload.get("items")
    if not isinstance(rows, list):
        raise ValueError("LLM judge response missing items list")
    by_id = {}
    for row in rows:
        if not isinstance(row, dict):
            continue
        item_id = str(row.get("id") or "")
        if not item_id:
            continue
        by_id[item_id] = {
            "id": item_id,
            "score": clamp_score(row.get("score")),
            "label": str(row.get("label") or ""),
            "reason": str(row.get("reason") or "")[:500],
        }
    missing = [item["id"] for item in batch if item["id"] not in by_id]
    if missing:
        raise ValueError(f"LLM judge omitted item ids: {missing[:5]}")
    return [by_id[item["id"]] for item in batch]


def judge_batch_resilient(batch):
    try:
        return judge_batch(batch)
    except (urllib.error.URLError, TimeoutError, RuntimeError, ValueError, KeyError, json.JSONDecodeError):
        if len(batch) <= 1:
            raise
        midpoint = max(1, len(batch) // 2)
        return judge_batch_resilient(batch[:midpoint]) + judge_batch_resilient(batch[midpoint:])


def run_llm_judge(checkpoints, predictions_by_id, deterministic_reward, metadata_success):
    all_items = build_llm_judge_items(checkpoints, predictions_by_id)
    if JUDGE_MODE in {"deterministic", "off", "none", "disabled"}:
        return {
            "status": "disabled",
            "mode": JUDGE_MODE,
            "model": LLM_JUDGE_MODEL,
            "totalItems": len(all_items),
        }
    if deterministic_reward >= 0.999 and metadata_success:
        return {
            "status": "skipped-perfect-deterministic",
            "mode": JUDGE_MODE,
            "model": LLM_JUDGE_MODEL,
            "totalItems": len(all_items),
            "judgedItems": 0,
        }
    if not (os.environ.get("DYNAMICMEM_LLM_JUDGE_API_KEY") or os.environ.get("OPENAI_API_KEY")):
        return {
            "status": "skipped-missing-api-key",
            "mode": JUDGE_MODE,
            "model": LLM_JUDGE_MODEL,
            "totalItems": len(all_items),
            "judgedItems": 0,
            "error": "Set OPENAI_API_KEY or DYNAMICMEM_LLM_JUDGE_API_KEY to run LLM-as-judge.",
        }

    selected_items, sampled = select_llm_items(all_items)
    judged = []
    try:
        for index in range(0, len(selected_items), LLM_JUDGE_BATCH_SIZE):
            batch = selected_items[index : index + LLM_JUDGE_BATCH_SIZE]
            judged.extend(judge_batch_resilient(batch))
    except (urllib.error.URLError, TimeoutError, RuntimeError, ValueError, KeyError, json.JSONDecodeError) as error:
        return {
            "status": "error",
            "mode": JUDGE_MODE,
            "model": LLM_JUDGE_MODEL,
            "totalItems": len(all_items),
            "judgedItems": len(judged),
            "sampled": sampled,
            "error": str(error),
        }

    item_meta = {item["id"]: item for item in selected_items}
    rows = []
    for row in judged:
        meta = item_meta[row["id"]]
        rows.append(
            {
                **row,
                "category": meta["category"],
                "checkpointId": meta["checkpoint_id"],
                "stateKey": meta["state_key"],
                "qaId": meta.get("qa_id"),
                "deterministicScore": meta["deterministic_score"],
            }
        )
    state_scores = [row["score"] for row in rows if row["category"] == "state_completion"]
    service_scores = [row["score"] for row in rows if row["category"] == "personalized_service"]
    if state_scores and service_scores:
        reward = (mean(state_scores) + mean(service_scores)) / 2
    elif state_scores:
        reward = mean(state_scores)
    else:
        reward = mean(service_scores)
    return {
        "status": "ok",
        "mode": JUDGE_MODE,
        "model": LLM_JUDGE_MODEL,
        "totalItems": len(all_items),
        "judgedItems": len(rows),
        "sampled": sampled,
        "sampleSeed": LLM_JUDGE_SEED if sampled else None,
        "maxItems": LLM_JUDGE_MAX_ITEMS,
        "batchSize": LLM_JUDGE_BATCH_SIZE,
        "rewardBeforeMetadataPenalty": reward,
        "stateCompletion": {
            "judged": len(state_scores),
            "meanScore": mean(state_scores),
            "correct": sum(1 for score in state_scores if score >= 0.999),
        },
        "personalizedService": {
            "judged": len(service_scores),
            "meanScore": mean(service_scores),
            "correct": sum(1 for score in service_scores if score >= 0.999),
        },
        "items": rows,
    }


def score_checkpoint(checkpoint, prediction):
    state = score_state(checkpoint, prediction)
    apply = score_apply(checkpoint, prediction)
    reward = (state["accuracy"] + apply["meanScore"]) / 2 if apply["total"] else state["accuracy"]
    return {
        "checkpointId": str(checkpoint.get("checkpoint_id") or ""),
        "checkpointTimestamp": (checkpoint.get("as_of") or {}).get("timestamp"),
        "reward": reward,
        "stateCompletion": state,
        "personalizedService": apply,
        "missingFields": state["missing"],
        "wrongFields": state["wrong"],
    }


def aggregate_checkpoints(rows):
    if not rows:
        return {
            "reward": 0.0,
            "stateAccuracy": 0.0,
            "applyMeanScore": 0.0,
            "stateTotal": 0,
            "stateCorrect": 0,
            "applyTotal": 0,
            "applyCorrect": 0,
            "missingFields": [],
            "wrongFields": [],
        }
    state_total = sum(row["stateCompletion"]["total"] for row in rows)
    state_correct = sum(row["stateCompletion"]["correct"] for row in rows)
    apply_total = sum(row["personalizedService"]["total"] for row in rows)
    apply_correct = sum(row["personalizedService"]["correct"] for row in rows)
    missing = []
    wrong = []
    for row in rows:
        checkpoint_id = row["checkpointId"]
        missing.extend(
            {"checkpointId": checkpoint_id, "key": key}
            for key in row["stateCompletion"]["missing"]
        )
        wrong.extend(
            {"checkpointId": checkpoint_id, **item}
            for item in row["stateCompletion"]["wrong"]
        )
    state_accuracy = state_correct / state_total if state_total else 0.0
    apply_mean = (
        sum(
            item["score"]
            for row in rows
            for item in row["personalizedService"]["items"]
        )
        / apply_total
        if apply_total
        else 0.0
    )
    return {
        "reward": sum(row["reward"] for row in rows) / len(rows),
        "stateAccuracy": state_accuracy,
        "applyMeanScore": apply_mean,
        "stateTotal": state_total,
        "stateCorrect": state_correct,
        "applyTotal": apply_total,
        "applyCorrect": apply_correct,
        "missingFields": missing,
        "wrongFields": wrong,
    }


def main():
    benchmark = load_json(EXPECTED_BENCHMARK)
    checkpoints = benchmark.get("checkpoints") or []
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
    predictions_by_id = {}
    if isinstance(predictions, list):
        for item in predictions:
            if isinstance(item, dict):
                predictions_by_id[str(item.get("checkpoint_id") or "")] = item

    checkpoint_rows = []
    missing_predictions = []
    for checkpoint in checkpoints:
        checkpoint_id = str(checkpoint.get("checkpoint_id") or "")
        prediction = predictions_by_id.get(checkpoint_id)
        if not isinstance(prediction, dict):
            missing_predictions.append(checkpoint_id)
            prediction = {}
        checkpoint_rows.append(score_checkpoint(checkpoint, prediction))

    aggregate = aggregate_checkpoints(checkpoint_rows)
    metadata_success = (
        raw.get("task_contract_version") == benchmark.get("task_contract_version")
        and raw.get("research_frame_version") == benchmark.get("research_frame_version")
        and not missing_predictions
    )
    reward = aggregate["reward"]
    if not metadata_success:
        reward *= 0.5
    deterministic_reward = reward
    llm_judge = run_llm_judge(checkpoints, predictions_by_id, deterministic_reward, metadata_success)
    reward_source = "deterministic"
    if llm_judge.get("status") == "ok":
        reward = llm_judge["rewardBeforeMetadataPenalty"]
        if not metadata_success:
            reward *= 0.5
        reward_source = "llm-judge"
    elif llm_judge.get("status") in {"skipped-missing-api-key", "error"} and JUDGE_MODE == "llm":
        reward_source = "deterministic-fallback"

    summary = {
        "reward": reward,
        "rewardSource": reward_source,
        "fieldAccuracy": aggregate["stateAccuracy"],
        "parseSuccess": parse_success,
        "metadataSuccess": metadata_success,
        "metadataErrors": [] if metadata_success else ["prediction contract metadata mismatch or missing checkpoint prediction"],
        "missingCheckpointPredictions": missing_predictions,
        "checkpointCount": len(checkpoints),
        "checkpoints": checkpoint_rows,
        "stateCompletion": {
            "total": aggregate["stateTotal"],
            "correct": aggregate["stateCorrect"],
            "accuracy": aggregate["stateAccuracy"],
        },
        "personalizedService": {
            "total": aggregate["applyTotal"],
            "correct": aggregate["applyCorrect"],
            "meanScore": aggregate["applyMeanScore"],
        },
        "missingFields": aggregate["missingFields"],
        "wrongFields": aggregate["wrongFields"],
        "overfillFields": [],
        "outputRoot": "outputs",
        "outputFiles": ["prediction.json"],
        "llmJudge": llm_judge,
        "deterministic": {
            "reward": deterministic_reward,
            "stateCompletionAccuracy": aggregate["stateAccuracy"],
            "rq3ApplyMeanScore": aggregate["applyMeanScore"],
        },
        "note": "DynamicMem semantic scoring uses the configured LLM judge when available. Deterministic scoring is retained as a proxy and fallback for oracle/local smoke runs.",
    }
    ARTIFACT_ROOT.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(PREDICTION_PATH, ARTIFACT_ROOT / "prediction.json")
    write_json(ARTIFACT_ROOT / "score-summary.json", summary)
    write_json(
        REWARD_DIR / "reward.json",
        {
            "reward": reward,
            "state_completion_accuracy": aggregate["stateAccuracy"],
            "rq3_apply_mean_score": aggregate["applyMeanScore"],
            "parse_success": 1.0 if parse_success else 0.0,
            "metadata_success": 1.0 if metadata_success else 0.0,
            "reward_source_is_llm_judge": 1.0 if reward_source == "llm-judge" else 0.0,
            "llm_judge_ok": 1.0 if llm_judge.get("status") == "ok" else 0.0,
        },
    )


if __name__ == "__main__":
    main()
'''


def checkpoint_prediction(checkpoint: dict[str, Any]) -> dict[str, Any]:
    prediction = {
        "checkpoint_id": checkpoint.get("checkpoint_id"),
        "snapshot_state": expected_snapshot_from_pack(checkpoint),
        "evidence": {},
        "rq3_apply_answers": {},
    }
    evidence_flat = flatten_snapshot(checkpoint.get("state_observability") or {})
    for key in prediction["snapshot_state"]:
        evidence_ids = []
        obs = evidence_flat.get(key)
        if isinstance(obs, dict):
            evidence_ids = obs.get("evidence_app_log_ids") or []
        prediction["evidence"][key] = [
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
        prediction["rq3_apply_answers"][state_key] = {"items": answers}
    return prediction


def solution_script(task_packs: dict[str, Any], checkpoints: list[dict[str, Any]]) -> str:
    prediction = {
        "task_contract_version": task_packs.get("task_contract_version"),
        "research_frame_version": task_packs.get("research_frame_version"),
        "predictions": [checkpoint_prediction(checkpoint) for checkpoint in checkpoints],
    }
    return (
        "#!/bin/sh\n"
        "set -eu\n\n"
        "mkdir -p outputs\n\n"
        "cat > outputs/prediction.json <<'JSON'\n"
        f"{json.dumps(prediction, indent=2, sort_keys=True)}\n"
        "JSON\n"
    )


def build_catalog(
    visible_tasks: list[dict[str, Any]],
    config: BuildConfig = DEFAULT_BUILD_CONFIG,
) -> dict[str, Any]:
    preferences = []
    by_slug: dict[str, dict[str, Any]] = {}
    for visible_task in visible_tasks:
        for state_key, item in visible_task["state_completion"]["keys"].items():
            by_slug.setdefault(state_key, item)
    for state_key, item in sorted(by_slug.items()):
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
        "source": f"DynamicMem {config.source_user_id} trajectory state-completion keys",
        "preferences": preferences,
    }


def render_soundness_report(
    difficulty: dict[str, Any],
    visible_tasks: list[dict[str, Any]],
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
        f"- Stage contract: `{config.stage_contract_display}`.",
        "- `update-answer` stages reveal raw DynamicMem app-log deltas plus native queries for that checkpoint.",
        "- `memory-update` stages reveal only raw DynamicMem app-log deltas and should not require a prediction.",
        "- `downstream-task` stages reveal native queries without raw documents and score retained memory use.",
        "- Hidden expected files preserve the scored upstream checkpoint task packs.",
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
    for visible_task in visible_tasks:
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


def render_stage_cli_arg(config: BuildConfig) -> str:
    if config.stage_schedule is not None:
        return f"--stage-schedule {stage_schedule_label(config.stage_schedule).replace(' -> ', ',')}"
    return f"--stage-pattern {config.stage_pattern}"


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
    selected = selected_checkpoints(task_packs, config)

    if task_packs.get("user_id") != config.source_user_id:
        raise ValueError(f"expected {config.source_user_id}, got {task_packs.get('user_id')}")
    if task_packs.get("task_contract_version") != "taskabc_v2":
        raise ValueError("only DynamicMem taskabc_v2 packs are supported")
    for index, checkpoint in selected:
        if not (checkpoint.get("state_completion_pack") and checkpoint.get("rq3_apply_service_qa")):
            raise ValueError(f"checkpoint {index} must contain state_completion_pack and rq3_apply_service_qa")

    stage_specs = []
    visible_tasks = []
    previous_observed_count = 0
    for checkpoint_index, checkpoint in selected:
        observed_for_checkpoint = observed_logs_for_checkpoint(checkpoint, app_logs)
        if len(observed_for_checkpoint) < previous_observed_count:
            raise ValueError("selected checkpoints must move forward in observed log count")
        delta_logs = observed_for_checkpoint[previous_observed_count:]
        previous_observed_count = len(observed_for_checkpoint)
        visible_task = visible_dynamicmem_task(checkpoint, task_packs, config)
        visible_tasks.append(visible_task)
        stage_specs.append(
            {
                "checkpointIndex": checkpoint_index,
                "checkpoint": checkpoint,
                "logs": delta_logs,
                "visibleTask": visible_task,
            }
        )

    observed_logs = observed_logs_for_checkpoint(selected[-1][1], app_logs)
    stage_plan = resolve_stage_plan(stage_specs, config)
    scored_specs = scored_specs_from_stage_plan(stage_plan)
    scored_checkpoints = [
        (spec["checkpointIndex"], spec["checkpoint"])
        for spec in scored_specs
    ]
    scored_checkpoint_payloads = [spec["checkpoint"] for spec in scored_specs]
    scored_visible_tasks = [spec["visibleTask"] for spec in scored_specs]

    stage_payload = build_stage_payload(stage_specs=stage_specs, config=config)
    difficulty = build_difficulty(
        stage_payload=stage_payload,
        checkpoints=selected,
        visible_tasks=scored_visible_tasks,
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

    write_text(task_dir / "instruction.md", render_instruction(config))
    write_text(task_dir / "task.toml", render_task_toml(config))
    write_json(task_dir / "tests" / "expected" / "benchmark.json", hidden_benchmark(task_packs, scored_checkpoint_payloads))
    write_json(task_dir / "tests" / "expected" / "visible-tasks.json", scored_visible_tasks)
    write_json(task_dir / "tests" / "expected" / "difficulty.json", difficulty)
    write_text(task_dir / "tests" / "expected" / "soundness-report.md", render_soundness_report(difficulty, scored_visible_tasks, config))
    write_text(task_dir / "tests" / "score_dynamicmem_prediction.py", score_script(), executable=True)
    write_text(
        task_dir / "tests" / "test.sh",
        "#!/bin/sh\nset -eu\n\npython3 /tests/score_dynamicmem_prediction.py\n",
        executable=True,
    )
    write_text(task_dir / "solution" / "solve.sh", solution_script(task_packs, scored_checkpoint_payloads), executable=True)
    write_json(task_dir / "mcp" / "catalog.json", build_catalog(scored_visible_tasks, config))
    write_text(
        task_dir / "README.md",
        f"""# {config.task_id}

This Harbor task is generated from DynamicMem (`xiewenya/dynamicmem`, MIT
license). Harbor is only the runner. The task preserves the native DynamicMem
checkpoint content:

- raw `app_log_large.json` entries are revealed as chronological checkpoint deltas;
- hidden expected files store the upstream checkpoint task packs for the full trajectory;
- each visible stage exposes sanitized State Completion and Personalized
  Service queries for that checkpoint;
- the agent writes upstream-compatible `outputs/prediction.json`.

Source user: `{config.source_user_dir}` / `{config.source_user_id}`
Checkpoint trajectory: `{', '.join(str(index) for index, _ in selected)}`
Final checkpoint: `{selected[-1][1]['checkpoint_id']}` as of `{selected[-1][1]['as_of']['timestamp']}`
Stage contract: `{config.stage_contract_display}`
Scored checkpoints: `{', '.join(str(index) for index, _ in scored_checkpoints)}`
Observed raw logs: `{len(observed_logs)}`
State completion evaluations: `{difficulty['totals']['stateCompletionKeyCount']}`
Personalized service items: `{difficulty['totals']['personalizedServiceItemCount']}`

Human-review materials:

- `tests/expected/difficulty.json`
- `tests/expected/soundness-report.md`
- `tests/expected/benchmark.json` hidden upstream-compatible benchmark slice
- `tests/expected/visible-tasks.json` sanitized checkpoint-stage task payloads

Scoring:

- official DynamicMem reward uses the configured LLM-as-judge when
  `DYNAMICMEM_LLM_JUDGE_API_KEY` or `OPENAI_API_KEY` is available;
- generated tasks default to `DYNAMICMEM_LLM_JUDGE_BASE_URL=https://openrouter.ai/api/v1`
  and `DYNAMICMEM_LLM_JUDGE_MODEL=google/gemini-3.5-flash`;
- deterministic key/value scoring is retained in `score-summary.json` as a
  proxy and fallback for oracle/local smoke runs.

Regenerate from a local DynamicMem user directory:

```bash
python3 examples/eval-harbor/scripts/build_dynamicmem_task.py \\
  --source-dir /path/to/DynamicMem/{config.source_user_dir} \\
  --checkpoint-indices {','.join(str(index) for index, _ in selected)} \\
  {render_stage_cli_arg(config)} \\
  --model {config.model_name} \\
  --reasoning-effort {config.reasoning_effort} \\
  --codex-web-search {config.codex_web_search} \\
  --agent-timeout-sec {config.agent_timeout_sec:g} \\
  --verifier-timeout-sec {config.verifier_timeout_sec:g} \\
  --build-timeout-sec {config.build_timeout_sec:g}
```

Do not expose `tests/expected/` files to agents.
""",
    )

    jobs_dir.mkdir(parents=True, exist_ok=True)
    for arm in arm_configs or load_arm_configs():
        write_text(jobs_dir / f"{config.task_id}-{arm['mode']}.yaml", render_job(arm, config))
    write_text(jobs_dir / f"{config.task_id}-staged.compose.yml", render_staged_compose())
    write_text(jobs_dir / f"{config.task_id}-cr-mcp.compose.yml", render_cr_mcp_compose())


def parse_checkpoint_indices(value: str) -> list[int]:
    indices: list[int] = []
    for raw_part in value.split(","):
        part = raw_part.strip()
        if not part:
            continue
        if "-" in part:
            start, end = part.split("-", 1)
            indices.extend(range(int(start), int(end) + 1))
        else:
            indices.append(int(part))
    return sorted(set(indices))


def compact_user_label(user_id: str) -> str:
    return user_id.replace("_", "")


def checkpoint_label(indices: list[int]) -> str:
    if not indices:
        return "cp-none"
    if indices == list(range(indices[0], indices[-1] + 1)):
        return f"cp{indices[0]:02d}-{indices[-1]:02d}"
    return "cp" + "-".join(f"{index:02d}" for index in indices)


def task_id_for_source(
    source_dir: Path,
    checkpoint_indices: list[int],
    stage_pattern: str,
    stage_schedule: tuple[str, ...] | None = None,
) -> tuple[str, str, str, str]:
    task_packs = load_json(source_dir / "task_packs.json")
    source_user_id = str(task_packs.get("user_id") or SOURCE_USER_ID)
    source_user_dir = source_dir.name
    suffix = stage_schedule_suffix(stage_schedule) if stage_schedule is not None else stage_pattern_suffix(stage_pattern)
    task_id = (
        f"dynamicmem-{compact_user_label(source_user_id)}-"
        f"{checkpoint_label(checkpoint_indices)}-{suffix}"
    )
    return task_id, f"{task_id}-corpus", source_user_dir, source_user_id


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
        default=None,
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
        "--checkpoint-indices",
        default=",".join(str(index) for index in DEFAULT_BUILD_CONFIG.checkpoint_indices),
        help="Comma/range checkpoint trajectory, for example 0-4 or 0,1,3.",
    )
    parser.add_argument(
        "--reasoning-effort",
        default=DEFAULT_BUILD_CONFIG.reasoning_effort,
        choices=sorted(REASONING_EFFORT_CHOICES),
        help="Codex model reasoning effort written into Harbor job kwargs.",
    )
    parser.add_argument(
        "--codex-web-search",
        default=DEFAULT_BUILD_CONFIG.codex_web_search,
        choices=sorted(CODEX_WEB_SEARCH_CHOICES),
        help="Codex web_search policy written into Harbor job kwargs.",
    )
    parser.add_argument(
        "--agent-timeout-sec",
        type=float,
        default=DEFAULT_BUILD_CONFIG.agent_timeout_sec,
        help="Harbor agent timeout in seconds written into task.toml.",
    )
    parser.add_argument(
        "--verifier-timeout-sec",
        type=float,
        default=DEFAULT_BUILD_CONFIG.verifier_timeout_sec,
        help="Harbor verifier timeout in seconds written into task.toml.",
    )
    parser.add_argument(
        "--build-timeout-sec",
        type=float,
        default=DEFAULT_BUILD_CONFIG.build_timeout_sec,
        help="Harbor environment build timeout in seconds written into task.toml.",
    )
    parser.add_argument(
        "--stage-pattern",
        default=DEFAULT_BUILD_CONFIG.stage_pattern,
        choices=sorted(STAGE_PATTERNS),
        help="Trajectory stage contract to generate.",
    )
    parser.add_argument(
        "--stage-schedule",
        default=None,
        help=(
            "Custom staged trajectory using U, T, and UA tokens, for example "
            "'U,U,T,U,T'. When set, this overrides --stage-pattern."
        ),
    )
    args = parser.parse_args()
    checkpoint_indices = parse_checkpoint_indices(args.checkpoint_indices)
    stage_schedule = parse_stage_schedule(args.stage_schedule) if args.stage_schedule else None
    task_id, corpus_id, source_user_dir, source_user_id = task_id_for_source(
        args.source_dir,
        checkpoint_indices,
        args.stage_pattern,
        stage_schedule,
    )
    task_dir = args.task_dir or Path("examples/eval-harbor/tasks") / task_id

    build_task(
        args.source_dir,
        task_dir,
        args.jobs_dir,
        arm_configs=load_arm_configs(args.arms_config),
        config=BuildConfig(
            task_id=task_id,
            corpus_id=corpus_id,
            source_user_dir=source_user_dir,
            source_user_id=source_user_id,
            checkpoint_indices=tuple(checkpoint_indices),
            model_name=args.model,
            reasoning_effort=args.reasoning_effort,
            codex_web_search=args.codex_web_search,
            agent_timeout_sec=args.agent_timeout_sec,
            verifier_timeout_sec=args.verifier_timeout_sec,
            build_timeout_sec=args.build_timeout_sec,
            stage_pattern=args.stage_pattern,
            stage_schedule=stage_schedule,
        ),
    )
    print(f"Generated {task_dir}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
