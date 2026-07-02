#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime
from pathlib import Path
from typing import Any


SCORE_PATH = Path("artifacts/logs/artifacts/score-summary.json")
FORM_OUTPUT_ROOT = Path("artifacts/app/outputs/forms")
GENERIC_OUTPUT_ROOT = Path("artifacts/app/outputs")
DEFAULT_OUTPUT_FILES = ["new-hire.json"]
CR_SNAPSHOT_PATH = Path("artifacts/memory/cr-snapshot.json")
MCP_TRACE_PATH = Path("artifacts/mcp/tool-calls.jsonl")
STAGE_LOG_PATH = Path("artifacts/app/stage-log.jsonl")
DISALLOWED_COMMAND_PATTERNS = [
    "stages/payload.json",
    "tests/expected",
    "score_dynamicmem_prediction.py",
    "/data/stages.json",
    "/tests",
]
OUTPUT_PREFIX = "/app/outputs/"
MEMORY_MD_PATH = "/app/memory.md"


def load_json(path: Path) -> dict[str, Any]:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError as error:
        raise ValueError(f"missing file: {path}") from error
    except json.JSONDecodeError as error:
        raise ValueError(f"malformed JSON: {path}: {error}") from error


def parse_timestamp(value: str | None) -> datetime | None:
    if not value:
        return None
    normalized = value.replace("Z", "+00:00")
    return datetime.fromisoformat(normalized)


def duration_seconds(result: dict[str, Any]) -> float | None:
    started = parse_timestamp(result.get("started_at"))
    finished = parse_timestamp(result.get("finished_at"))
    if not started or not finished:
        return None
    return round((finished - started).total_seconds(), 1)


def find_trial_dir(path: Path) -> Path:
    if path.is_file() and path.name == "result.json":
        path = path.parent

    candidates = sorted(
        child
        for child in path.iterdir()
        if child.is_dir()
        and (child / "config.json").exists()
        and (child / "result.json").exists()
    )
    if len(candidates) == 1:
        return find_trial_dir(candidates[0])
    if len(candidates) > 1:
        raise ValueError(
            f"expected exactly one Harbor trial directory under {path}, "
            f"found {len(candidates)}"
        )

    if (path / "config.json").exists() and (path / "result.json").exists():
        return path

    nested = []
    for child in sorted(path.iterdir()):
        if not child.is_dir():
            continue
        try:
            nested.append(find_trial_dir(child))
        except ValueError:
            continue
    if len(nested) == 1:
        return nested[0]
    if len(nested) > 1:
        raise ValueError(
            f"expected exactly one nested Harbor trial directory under {path}, "
            f"found {len(nested)}"
        )

    raise ValueError(f"no Harbor trial directory found under {path}")


def count_wrong_fields(wrong_fields: Any) -> int:
    if isinstance(wrong_fields, list):
        return len(wrong_fields)
    return 0


def count_list(value: Any) -> int:
    if isinstance(value, list):
        return len(value)
    return 0


def read_mcp_tools(trace_path: Path) -> list[str]:
    if not trace_path.exists():
        return []
    tools: list[str] = []
    for line in trace_path.read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        payload = json.loads(line)
        tool = payload.get("tool")
        if isinstance(tool, str):
            tools.append(tool)
    return tools


def read_cr_preference_count(snapshot_path: Path) -> int | None:
    if not snapshot_path.exists():
        return None
    snapshot = load_json(snapshot_path)
    preferences = snapshot.get("preferences")
    if isinstance(preferences, dict):
        return len(preferences)
    if isinstance(preferences, list):
        return len(preferences)
    raise ValueError(f"malformed CR snapshot preferences: {snapshot_path}")


def read_codex_trace(trial_dir: Path) -> dict[str, Any]:
    counts: dict[str, int] = {}
    trace_paths = sorted(trial_dir.rglob("agent/codex.txt"))
    commands: list[dict[str, str]] = []
    file_changes: list[dict[str, str]] = []
    seen_commands: set[tuple[str, str]] = set()
    seen_file_changes: set[tuple[str, str, str]] = set()
    for trace_path in trace_paths:
        for line in trace_path.read_text(encoding="utf-8", errors="replace").splitlines():
            if not line.strip():
                continue
            try:
                payload = json.loads(line)
            except json.JSONDecodeError:
                continue
            item = payload.get("item")
            if not isinstance(item, dict):
                continue
            item_type = item.get("type")
            if isinstance(item_type, str):
                counts[item_type] = counts.get(item_type, 0) + 1
            if item_type == "command_execution":
                command = item.get("command")
                if isinstance(command, str):
                    key = (str(trace_path), command)
                    if key not in seen_commands:
                        seen_commands.add(key)
                        commands.append({"tracePath": str(trace_path), "command": command})
            elif item_type == "file_change":
                changes = item.get("changes")
                if not isinstance(changes, list):
                    continue
                for change in changes:
                    if not isinstance(change, dict):
                        continue
                    path = change.get("path")
                    if not isinstance(path, str):
                        continue
                    kind = str(change.get("kind") or "")
                    key = (str(trace_path), path, kind)
                    if key in seen_file_changes:
                        continue
                    seen_file_changes.add(key)
                    file_changes.append(
                        {
                            "tracePath": str(trace_path),
                            "path": path,
                            "kind": kind,
                        }
                    )
    return {
        "itemCounts": counts,
        "tracePaths": [str(path) for path in trace_paths],
        "commands": commands,
        "fileChanges": file_changes,
    }


def read_stage_log(stage_log_path: Path) -> list[dict[str, Any]]:
    if not stage_log_path.exists():
        return []
    entries: list[dict[str, Any]] = []
    for line in stage_log_path.read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        payload = json.loads(line)
        if isinstance(payload, dict):
            entries.append(payload)
    return entries


def configured_task_path(config: dict[str, Any]) -> Path | None:
    task_config = config.get("task") or {}
    raw_task_path = task_config.get("path")
    if not isinstance(raw_task_path, str) or not raw_task_path:
        return None

    task_path = Path(raw_task_path)
    candidates = [task_path]
    if task_path.name == "task.toml":
        candidates.append(task_path.parent)
    if not task_path.is_absolute():
        candidates.extend(Path.cwd() / candidate for candidate in list(candidates))

    for candidate in candidates:
        if candidate.is_file() and candidate.name == "task.toml":
            return candidate.parent
        if candidate.is_dir() and (candidate / "stages" / "payload.json").exists():
            return candidate
    return None


def expected_stage_sequence_from_config(config: dict[str, Any]) -> list[dict[str, Any]]:
    task_path = configured_task_path(config)
    if task_path is None:
        return []
    payload_path = task_path / "stages" / "payload.json"
    if not payload_path.exists():
        return []
    payload = load_json(payload_path)
    stages = payload.get("stages")
    if not isinstance(stages, list):
        return []
    return [
        {
            "stageId": stage.get("stageId"),
            "stageIndex": stage.get("stageIndex"),
            "kind": stage.get("kind"),
        }
        for stage in stages
        if isinstance(stage, dict)
    ]


def truncate(value: str, limit: int = 240) -> str:
    return value if len(value) <= limit else f"{value[: limit - 3]}..."


def is_output_path(path: str) -> bool:
    return path == "/app/outputs" or path.startswith(OUTPUT_PREFIX)


def is_app_durable_write(path: str) -> bool:
    return path.startswith("/app/") and not is_output_path(path)


def memory_policy_violations(mode: str, file_changes: list[dict[str, str]]) -> list[dict[str, Any]]:
    violations: list[dict[str, Any]] = []
    normalized_mode = mode.strip().lower()
    for change in file_changes:
        path = change["path"]
        if not is_app_durable_write(path):
            continue
        if normalized_mode == "markdown" and path == MEMORY_MD_PATH:
            continue
        if path.startswith("/app/current_stage/") or path == "/app/stage-log.jsonl":
            # These are stage runner files when visible in traces; they are not
            # external memory substrates.
            continue
        if normalized_mode in {"context-only", "none"}:
            reason = "durable memory/scratch write is disallowed for context-only/none"
        elif normalized_mode == "markdown":
            reason = "durable memory/scratch write outside /app/memory.md is disallowed for markdown"
        elif normalized_mode == "cr-mcp":
            reason = "durable memory/scratch write is disallowed for cr-mcp"
        else:
            reason = "durable memory/scratch write uses an unknown eval mode policy"
        violations.append(
            {
                "type": "disallowed_file_write",
                "path": path,
                "kind": change.get("kind"),
                "reason": reason,
            }
        )
    return violations


def command_policy_violations(commands: list[dict[str, str]]) -> list[dict[str, Any]]:
    violations: list[dict[str, Any]] = []
    for command in commands:
        raw_command = command["command"]
        for pattern in DISALLOWED_COMMAND_PATTERNS:
            if pattern in raw_command:
                violations.append(
                    {
                        "type": "disallowed_hidden_path_access",
                        "pattern": pattern,
                        "command": truncate(raw_command),
                    }
                )
                break
    return violations


def stage_policy_violations(
    stage_log: list[dict[str, Any]],
    expected_stage_sequence: list[dict[str, Any]] | None = None,
) -> list[dict[str, Any]]:
    violations: list[dict[str, Any]] = []
    revealed_entries = [entry for entry in stage_log if entry.get("done") is not True]
    for expected_index, entry in enumerate(revealed_entries, start=1):
        if entry.get("stageIndex") != expected_index:
            violations.append(
                {
                    "type": "stage_log_order_mismatch",
                    "stageId": entry.get("stageId"),
                    "expectedStageIndex": expected_index,
                    "actualStageIndex": entry.get("stageIndex"),
                }
            )
        if entry.get("kind") != "downstream-task":
            continue
        if entry.get("rawDocsVisible") is True:
            violations.append(
                {
                    "type": "downstream_raw_docs_visible",
                    "stageId": entry.get("stageId"),
                    "reason": "downstream-task stage revealed current_stage/docs",
                }
            )
        if entry.get("hasDocumentsJson") is True:
            violations.append(
                {
                    "type": "downstream_documents_index_visible",
                    "stageId": entry.get("stageId"),
                    "reason": "downstream-task stage revealed current_stage/documents.json",
                }
            )
        if "hasDynamicMemTask" in entry and entry.get("hasDynamicMemTask") is not True:
            violations.append(
                {
                    "type": "downstream_task_missing",
                    "stageId": entry.get("stageId"),
                    "reason": "downstream-task stage did not reveal dynamicmem-task.json",
                }
            )
    if expected_stage_sequence is not None and expected_stage_sequence:
        if len(revealed_entries) != len(expected_stage_sequence):
            violations.append(
                {
                    "type": "stage_log_count_mismatch",
                    "expected": len(expected_stage_sequence),
                    "actual": len(revealed_entries),
                }
            )
        for actual, expected in zip(revealed_entries, expected_stage_sequence):
            for key in ("stageId", "stageIndex", "kind"):
                if actual.get(key) != expected.get(key):
                    violations.append(
                        {
                            "type": "stage_log_sequence_mismatch",
                            "key": key,
                            "expected": expected.get(key),
                            "actual": actual.get(key),
                        }
                    )
                    break
    return violations


def run_policy_violations(
    *,
    mode: str,
    codex_trace: dict[str, Any],
    stage_log: list[dict[str, Any]],
    expected_stage_sequence: list[dict[str, Any]] | None = None,
) -> list[dict[str, Any]]:
    violations = []
    violations.extend(command_policy_violations(codex_trace["commands"]))
    violations.extend(memory_policy_violations(mode, codex_trace["fileChanges"]))
    violations.extend(stage_policy_violations(stage_log, expected_stage_sequence))
    return violations


def parse_float_literal(value: str) -> float | None:
    try:
        return float(value.strip().strip('"'))
    except ValueError:
        return None


def parse_task_timeout_file(path: Path) -> dict[str, float | None]:
    section = ""
    timeouts: dict[str, float | None] = {
        "agentTimeoutSec": None,
        "verifierTimeoutSec": None,
        "buildTimeoutSec": None,
    }
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.split("#", 1)[0].strip()
        if not line:
            continue
        if line.startswith("[") and line.endswith("]"):
            section = line.strip("[]").strip()
            continue
        if "=" not in line:
            continue
        key, value = [part.strip() for part in line.split("=", 1)]
        if section == "agent" and key == "timeout_sec":
            timeouts["agentTimeoutSec"] = parse_float_literal(value)
        elif section == "verifier" and key == "timeout_sec":
            timeouts["verifierTimeoutSec"] = parse_float_literal(value)
        elif section == "environment" and key == "build_timeout_sec":
            timeouts["buildTimeoutSec"] = parse_float_literal(value)
    return timeouts


def read_task_timeouts(config: dict[str, Any]) -> dict[str, float | None]:
    task_config = config.get("task") or {}
    raw_task_path = task_config.get("path")
    if not isinstance(raw_task_path, str) or not raw_task_path:
        return {}

    task_path = Path(raw_task_path)
    candidates = []
    if task_path.name == "task.toml":
        candidates.append(task_path)
    else:
        candidates.append(task_path / "task.toml")
    if not task_path.is_absolute():
        candidates.extend(Path.cwd() / candidate for candidate in list(candidates))

    for candidate in candidates:
        if not candidate.exists():
            continue
        return parse_task_timeout_file(candidate)
    return {}


def output_files_from_score(score: dict[str, Any]) -> list[str]:
    output_files = score.get("outputFiles")
    if isinstance(output_files, list) and all(
        isinstance(item, str) for item in output_files
    ):
        return output_files
    return DEFAULT_OUTPUT_FILES


def output_root_from_score(score: dict[str, Any]) -> Path:
    if str(score.get("outputRoot") or "").strip() == "outputs":
        return GENERIC_OUTPUT_ROOT
    return FORM_OUTPUT_ROOT


def expected_output_paths(score: dict[str, Any], artifact_root: Path) -> list[Path]:
    output_files = score.get("outputFiles")
    if isinstance(output_files, list) and all(
        isinstance(item, str) for item in output_files
    ):
        output_root = output_root_from_score(score)
        return [
            artifact_root / output_root.relative_to("artifacts") / output_file
            for output_file in output_files
        ]

    dynamicmem_prediction = artifact_root / GENERIC_OUTPUT_ROOT.relative_to("artifacts") / "prediction.json"
    if dynamicmem_prediction.exists():
        return [dynamicmem_prediction]

    return [
        artifact_root / FORM_OUTPUT_ROOT.relative_to("artifacts") / output_file
        for output_file in output_files_from_score(score)
    ]


def find_score_path(trial_dir: Path) -> Path:
    root_score = trial_dir / SCORE_PATH
    if root_score.exists():
        return root_score
    step_scores = sorted(trial_dir.glob(f"steps/*/{SCORE_PATH.as_posix()}"))
    if len(step_scores) == 1:
        return step_scores[0]
    if len(step_scores) > 1:
        raise ValueError(
            f"expected exactly one step score-summary.json under {trial_dir}, "
            f"found {len(step_scores)}"
        )
    raise ValueError(f"missing file: {root_score}")


def artifact_root_for_score(score_path: Path) -> Path:
    return score_path.parents[2]


def summarize_run(mode: str, path: Path) -> dict[str, Any]:
    trial_dir = find_trial_dir(path)
    result = load_json(trial_dir / "result.json")
    config = load_json(trial_dir / "config.json")

    validation_errors: list[str] = []

    try:
        score_path = find_score_path(trial_dir)
        artifact_root = artifact_root_for_score(score_path)
        score = load_json(score_path)
    except ValueError as error:
        artifact_root = trial_dir / "artifacts"
        score = {}
        validation_errors.append(str(error))

    for final_output in expected_output_paths(score, artifact_root):
        if not final_output.exists():
            validation_errors.append(f"missing final output: {final_output}")
        else:
            try:
                load_json(final_output)
            except ValueError as error:
                validation_errors.append(str(error))

    mcp_trace = artifact_root / MCP_TRACE_PATH.relative_to("artifacts")
    try:
        mcp_tools = read_mcp_tools(mcp_trace)
    except (ValueError, json.JSONDecodeError) as error:
        mcp_tools = []
        validation_errors.append(f"malformed MCP trace: {mcp_trace}: {error}")

    try:
        cr_preference_count = read_cr_preference_count(
            artifact_root / CR_SNAPSHOT_PATH.relative_to("artifacts")
        )
    except ValueError as error:
        cr_preference_count = None
        validation_errors.append(str(error))

    agent_info = result.get("agent_info") or {}
    model_info = agent_info.get("model_info") or {}
    agent_config = config.get("agent") or {}
    agent_kwargs = agent_config.get("kwargs") or {}
    task_timeouts = read_task_timeouts(config)
    rewards = (result.get("verifier_result") or {}).get("rewards") or {}
    codex_trace = read_codex_trace(trial_dir)
    codex_item_counts = codex_trace["itemCounts"]
    codex_trace_paths = codex_trace["tracePaths"]
    try:
        stage_log = read_stage_log(artifact_root / STAGE_LOG_PATH.relative_to("artifacts"))
    except (ValueError, json.JSONDecodeError) as error:
        stage_log = []
        validation_errors.append(f"malformed stage log: {error}")
    expected_stage_sequence = expected_stage_sequence_from_config(config)
    policy_violations = run_policy_violations(
        mode=mode,
        codex_trace=codex_trace,
        stage_log=stage_log,
        expected_stage_sequence=expected_stage_sequence,
    )
    disallowed_tool_calls = {
        "web_search": codex_item_counts.get("web_search", 0),
    }
    if disallowed_tool_calls["web_search"]:
        validation_errors.append(
            f"disallowed Codex web_search calls: {disallowed_tool_calls['web_search']}"
        )
    codex_web_search = (
        agent_kwargs.get("web_search")
        or agent_config.get("web_search")
        or "n/a"
    )
    codex_auto_compact_token_limit = (
        agent_kwargs.get("model_auto_compact_token_limit")
        or agent_config.get("model_auto_compact_token_limit")
        or "n/a"
    )
    if (agent_config.get("name") or "").lower() == "codex" and codex_web_search != "disabled":
        validation_errors.append(
            f"Codex web_search must be disabled, got {codex_web_search!r}"
        )
    for violation in policy_violations:
        validation_errors.append(f"policy violation: {json.dumps(violation, sort_keys=True)}")

    reward = score.get("reward", rewards.get("reward"))
    field_accuracy = score.get("fieldAccuracy", rewards.get("field_accuracy"))
    parse_success = score.get("parseSuccess")
    if parse_success is None and "parse_success" in rewards:
        parse_success = rewards["parse_success"] == 1.0

    missing_fields = score.get("missingFields", [])
    wrong_fields = score.get("wrongFields", [])
    overfill_fields = score.get("overfillFields", [])
    metadata_errors = score.get("metadataErrors")
    metadata_count = count_list(metadata_errors) if isinstance(metadata_errors, list) else None

    return {
        "mode": mode,
        "trialDir": str(trial_dir),
        "artifactRoot": str(artifact_root),
        "taskName": result.get("task_name"),
        "agent": agent_info.get("name") or agent_config.get("name"),
        "agentVersion": agent_info.get("version"),
        "model": model_info.get("name") or agent_config.get("model_name"),
        "reasoningEffort": (
            agent_kwargs.get("reasoning_effort")
            or agent_config.get("reasoning_effort")
            or "n/a"
        ),
        "codexWebSearch": codex_web_search,
        "codexAutoCompactTokenLimit": codex_auto_compact_token_limit,
        "agentTimeoutSec": task_timeouts.get("agentTimeoutSec"),
        "verifierTimeoutSec": task_timeouts.get("verifierTimeoutSec"),
        "buildTimeoutSec": task_timeouts.get("buildTimeoutSec"),
        "runtimeSeconds": duration_seconds(result),
        "reward": reward,
        "fieldAccuracy": field_accuracy,
        "parseSuccess": parse_success,
        "parseFailures": score.get("parseFailures", 0 if parse_success is True else 1),
        "metadataSuccess": score.get("metadataSuccess"),
        "metadataCount": metadata_count,
        "missingCount": count_list(missing_fields),
        "wrongCount": count_wrong_fields(wrong_fields),
        "overfillCount": count_list(overfill_fields),
        "missingFields": missing_fields,
        "wrongFields": wrong_fields,
        "overfillFields": overfill_fields,
        "stateCompletionAccuracy": (score.get("stateCompletion") or {}).get("accuracy"),
        "rq3ApplyMeanScore": (score.get("personalizedService") or {}).get("meanScore"),
        "metadataErrors": metadata_errors if isinstance(metadata_errors, list) else [],
        "mcpTools": mcp_tools,
        "crPreferenceCount": cr_preference_count,
        "codexItemCounts": codex_item_counts,
        "codexTracePaths": codex_trace_paths,
        "codexCommands": codex_trace["commands"],
        "codexFileChanges": codex_trace["fileChanges"],
        "stageLog": stage_log,
        "policyViolations": policy_violations,
        "policyViolationCount": len(policy_violations),
        "disallowedToolCalls": disallowed_tool_calls,
        "validationErrors": validation_errors,
    }


def fmt_value(value: Any) -> str:
    if value is None:
        return "n/a"
    if isinstance(value, float):
        return f"{value:.3f}"
    return str(value)


def fmt_bool(value: Any) -> str:
    if value is True:
        return "yes"
    if value is False:
        return "no"
    return "n/a"


def fmt_seconds(value: Any) -> str:
    if value is None:
        return "n/a"
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        if float(value).is_integer():
            return str(int(value))
        return f"{value:.1f}"
    return str(value)


def fmt_timeout_triplet(row: dict[str, Any]) -> str:
    agent = fmt_seconds(row.get("agentTimeoutSec"))
    verifier = fmt_seconds(row.get("verifierTimeoutSec"))
    build = fmt_seconds(row.get("buildTimeoutSec"))
    return f"{agent}/{verifier}/{build}"


def markdown_table(rows: list[dict[str, Any]]) -> str:
    lines = [
        "| Mode | Agent | Model | Reasoning Effort | Web Search | Timeout A/V/B (s) | Reward | Field Accuracy | State Acc. | Service Mean | Parse Failures | Metadata | Missing | Wrong | Overfill | Policy Fail | Artifacts OK | Runtime (s) | Artifact Root |",
        "| --- | --- | --- | --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- | ---: | --- |",
    ]
    for row in rows:
        lines.append(
            "| {mode} | {agent} | {model} | {reasoning_effort} | {web_search} | {timeouts} | {reward} | {field} | {state} | {service} | {parse_failures} | {metadata} | {missing} | {wrong} | {overfill} | {policy_fail} | {artifacts_ok} | {runtime} | `{artifact}` |".format(
                mode=row["mode"],
                agent=row["agent"],
                model=row["model"],
                reasoning_effort=row["reasoningEffort"],
                web_search=row["codexWebSearch"],
                timeouts=fmt_timeout_triplet(row),
                reward=fmt_value(row["reward"]),
                field=fmt_value(row["fieldAccuracy"]),
                state=fmt_value(row["stateCompletionAccuracy"]),
                service=fmt_value(row["rq3ApplyMeanScore"]),
                parse_failures=row["parseFailures"],
                metadata=fmt_value(row["metadataCount"]),
                missing=row["missingCount"],
                wrong=row["wrongCount"],
                overfill=row["overfillCount"],
                policy_fail=row["policyViolationCount"],
                artifacts_ok=fmt_bool(not row["validationErrors"]),
                runtime=fmt_value(row["runtimeSeconds"]),
                artifact=row["artifactRoot"],
            )
        )
    return "\n".join(lines)


def detail_sections(rows: list[dict[str, Any]]) -> str:
    sections: list[str] = []
    for row in rows:
        lines = [f"### {row['mode']}"]
        lines.append(f"- Trial: `{row['trialDir']}`")
        if row["mcpTools"]:
            lines.append(f"- MCP tools: `{', '.join(row['mcpTools'])}`")
        if row["crPreferenceCount"] is not None:
            lines.append(f"- CR preferences: `{row['crPreferenceCount']}`")
        if row["codexTracePaths"]:
            lines.append(f"- Codex traces: `{', '.join(row['codexTracePaths'])}`")
        if any(row["disallowedToolCalls"].values()):
            lines.append(f"- Disallowed tool calls: `{json.dumps(row['disallowedToolCalls'])}`")
        if row["policyViolations"]:
            lines.append(f"- Policy violations: `{json.dumps(row['policyViolations'])}`")
        if row["missingFields"]:
            lines.append(f"- Missing fields: `{json.dumps(row['missingFields'])}`")
        if row["wrongFields"]:
            lines.append(f"- Wrong fields: `{json.dumps(row['wrongFields'])}`")
        if row["overfillFields"]:
            lines.append(f"- Overfill fields: `{json.dumps(row['overfillFields'])}`")
        if row["metadataErrors"]:
            lines.append(f"- Metadata errors: `{json.dumps(row['metadataErrors'])}`")
        if row["validationErrors"]:
            lines.append(
                f"- Validation errors: `{json.dumps(row['validationErrors'])}`"
            )
        if len(lines) == 1:
            lines.append("- No field errors.")
        sections.append("\n".join(lines))
    return "\n\n".join(sections)


def build_report(rows: list[dict[str, Any]]) -> str:
    return "\n\n".join(
        [
            "# Harbor Eval Report",
            markdown_table(rows),
            "## Details",
            detail_sections(rows),
            "",
        ]
    )


def parse_run_spec(value: str) -> tuple[str, Path]:
    if "=" not in value:
        raise argparse.ArgumentTypeError("run must use MODE=PATH")
    mode, raw_path = value.split("=", 1)
    if not mode:
        raise argparse.ArgumentTypeError("run mode must not be empty")
    path = Path(raw_path).expanduser()
    if not path.exists():
        raise argparse.ArgumentTypeError(f"run path does not exist: {path}")
    return mode, path


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Build a Markdown comparison report from Harbor eval outputs."
    )
    parser.add_argument(
        "--run",
        action="append",
        required=True,
        type=parse_run_spec,
        metavar="MODE=PATH",
        help="Mode label and Harbor job/trial directory. Repeat for each arm.",
    )
    parser.add_argument("--output", type=Path, help="Optional Markdown output path.")
    parser.add_argument("--json-output", type=Path, help="Optional JSON output path.")
    parser.add_argument(
        "--allow-invalid",
        action="store_true",
        help="Emit a report but exit 0 even when required artifacts are invalid.",
    )
    args = parser.parse_args()

    rows = [summarize_run(mode, path) for mode, path in args.run]
    report = build_report(rows)
    payload = {"runs": rows}

    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(report, encoding="utf-8")
    else:
        print(report)

    if args.json_output:
        args.json_output.parent.mkdir(parents=True, exist_ok=True)
        args.json_output.write_text(
            json.dumps(payload, indent=2, sort_keys=True) + "\n",
            encoding="utf-8",
        )

    has_validation_errors = any(row["validationErrors"] for row in rows)
    if has_validation_errors and not args.allow_invalid:
        print("error: one or more runs failed artifact validation", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
