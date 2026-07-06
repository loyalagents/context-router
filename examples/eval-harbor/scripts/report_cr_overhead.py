#!/usr/bin/env python3
"""Report CR-specific token overhead diagnostics from Harbor artifacts.

This is an artifact-only reporter. Exact stage token totals come from
`report_stage_token_usage.py`; CR tool payload diagnostics come from
agent-visible `trajectory.json` tool calls and observations.
"""

from __future__ import annotations

import argparse
import json
import math
import re
import sys
from collections import Counter, defaultdict
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from report_stage_token_usage import (
    STAGE_LOG_PATH,
    TRAJECTORY_PATH,
    Bucket,
    build_report as build_stage_token_report,
    bucket_from_stage,
    derive_context,
    find_trial_dirs,
    fmt_cost,
    fmt_int,
    is_multi_step_trial_dir,
    is_next_stage_call,
    is_staged_trial_dir,
    load_json,
    load_stage_log,
    observation_text,
    stage_entries,
    step_bucket_kind,
    step_trajectory_paths,
    usage_from_step,
)


CR_TOOLS = {"listPreferenceSlugs", "searchPreferences", "mutatePreferences"}
MCP_TRACE_PATH = Path("artifacts/mcp/tool-calls.jsonl")
APPROX_BYTES_PER_TOKEN = 4
VERBOSE_OUTPUT_BYTES = 8 * 1024


@dataclass
class ToolStats:
    calls: int = 0
    argument_bytes: int = 0
    output_bytes: int = 0
    successes: int = 0
    errors: int = 0
    mutated: int = 0
    has_mutated: bool = False
    result_count: int = 0
    has_result_count: bool = False

    def add(self, other: "ToolStats") -> None:
        self.calls += other.calls
        self.argument_bytes += other.argument_bytes
        self.output_bytes += other.output_bytes
        self.successes += other.successes
        self.errors += other.errors
        if other.has_mutated:
            self.mutated += other.mutated
            self.has_mutated = True
        if other.has_result_count:
            self.result_count += other.result_count
            self.has_result_count = True

    @property
    def approx_argument_tokens(self) -> int:
        return math.ceil(self.argument_bytes / APPROX_BYTES_PER_TOKEN)

    @property
    def approx_output_tokens(self) -> int:
        return math.ceil(self.output_bytes / APPROX_BYTES_PER_TOKEN)

    def as_dict(self) -> dict[str, Any]:
        return {
            "calls": self.calls,
            "argumentBytes": self.argument_bytes,
            "outputBytes": self.output_bytes,
            "approxArgumentTokens": self.approx_argument_tokens,
            "approxOutputTokens": self.approx_output_tokens,
            "successes": self.successes,
            "errors": self.errors,
            "mutated": self.mutated if self.has_mutated else None,
            "resultCount": self.result_count if self.has_result_count else None,
        }


def compact_json_bytes(value: Any) -> int:
    text = json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return len(text.encode("utf-8"))


def tool_name(call: Any) -> str | None:
    if not isinstance(call, dict):
        return None
    for key in ("function_name", "name", "tool", "tool_name"):
        value = call.get(key)
        if isinstance(value, str):
            return value
    return None


def observation_results(step: dict[str, Any]) -> list[dict[str, Any]]:
    observation = step.get("observation")
    if not isinstance(observation, dict):
        return []
    results = observation.get("results")
    if not isinstance(results, list):
        return []
    return [result for result in results if isinstance(result, dict)]


def output_text_for_call(step: dict[str, Any], call: dict[str, Any], cr_call_count: int) -> str:
    call_id = call.get("tool_call_id") or call.get("id")
    results = observation_results(step)
    parts: list[str] = []
    if isinstance(call_id, str):
        for result in results:
            if result.get("source_call_id") != call_id:
                continue
            content = result.get("content")
            if isinstance(content, str):
                parts.append(content)
    if not parts and cr_call_count == 1:
        for result in results:
            content = result.get("content")
            if isinstance(content, str):
                parts.append(content)
    return "\n".join(parts)


def parse_json_from_text(text: str) -> Any:
    candidates = [text.strip()]
    if "Output:" in text:
        candidates.append(text.split("Output:", 1)[1].strip())
    decoder = json.JSONDecoder()
    for candidate in candidates:
        if not candidate:
            continue
        try:
            return json.loads(candidate)
        except json.JSONDecodeError:
            pass
        for match in re.finditer(r"[\[{]", candidate):
            try:
                value, _ = decoder.raw_decode(candidate[match.start() :])
                return value
            except json.JSONDecodeError:
                continue
    return None


def first_bool(payload: Any, keys: tuple[str, ...]) -> bool | None:
    if not isinstance(payload, dict):
        return None
    for key in keys:
        value = payload.get(key)
        if isinstance(value, bool):
            return value
    summary = payload.get("resultSummary")
    if isinstance(summary, dict):
        return first_bool(summary, keys)
    return None


def first_int(payload: Any, keys: tuple[str, ...]) -> int | None:
    if not isinstance(payload, dict):
        return None
    for key in keys:
        value = payload.get(key)
        if isinstance(value, int) and not isinstance(value, bool):
            return value
    summary = payload.get("resultSummary")
    if isinstance(summary, dict):
        nested = first_int(summary, keys)
        if nested is not None:
            return nested
    return None


def result_count_from_payload(payload: Any) -> int | None:
    explicit = first_int(payload, ("count", "resultCount"))
    if explicit is not None:
        return explicit
    if not isinstance(payload, dict):
        return None
    for key in ("results", "preferences", "items", "slugs"):
        value = payload.get(key)
        if isinstance(value, list):
            return len(value)
    return None


def stats_for_call(step: dict[str, Any], call: dict[str, Any], cr_call_count: int) -> ToolStats:
    arguments = call.get("arguments", {})
    output_text = output_text_for_call(step, call, cr_call_count)
    payload = parse_json_from_text(output_text)
    stats = ToolStats(
        calls=1,
        argument_bytes=compact_json_bytes(arguments),
        output_bytes=len(output_text.encode("utf-8")),
    )

    success = first_bool(payload, ("success",))
    if success is True:
        stats.successes = 1
    elif success is False:
        stats.errors = 1
    elif output_text:
        stats.successes = 1

    mutated = first_int(payload, ("mutated", "mutatedCount"))
    if mutated is not None:
        stats.mutated = mutated
        stats.has_mutated = True

    result_count = result_count_from_payload(payload)
    if result_count is not None:
        stats.result_count = result_count
        stats.has_result_count = True

    return stats


def cr_tool_calls(step: dict[str, Any]) -> list[dict[str, Any]]:
    tool_calls = step.get("tool_calls")
    if not isinstance(tool_calls, list):
        return []
    return [
        call
        for call in tool_calls
        if isinstance(call, dict) and tool_name(call) in CR_TOOLS
    ]


def add_bucket_call(
    rows: dict[tuple[str, str, str, str, str, str], dict[str, Any]],
    context: dict[str, str],
    layout: str,
    bucket: Bucket,
    tool: str,
    stats: ToolStats,
) -> None:
    key = (
        context["taskId"],
        context["sample"],
        context["mode"],
        bucket.bucket_id,
        bucket.bucket_kind,
        tool,
    )
    row = rows.get(key)
    if row is None:
        row = {
            "taskId": context["taskId"],
            "sample": context["sample"],
            "arm": context["mode"],
            "mode": context["mode"],
            "layout": layout,
            "trialDir": context["trialDir"],
            "relativeTrialDir": context["relativeTrialDir"],
            "bucketId": bucket.bucket_id,
            "stage": bucket.bucket_kind,
            "stageId": bucket.stage_id,
            "stageIndex": bucket.stage_index,
            "rawDocsVisible": bucket.raw_docs_visible,
            "fileCount": bucket.file_count,
            "tool": tool,
            "_stats": ToolStats(),
        }
        rows[key] = row
    row["_stats"].add(stats)


def collect_step_tool_calls(
    rows: dict[tuple[str, str, str, str, str, str], dict[str, Any]],
    context: dict[str, str],
    layout: str,
    bucket: Bucket,
    step: dict[str, Any],
) -> None:
    calls = cr_tool_calls(step)
    for call in calls:
        name = tool_name(call)
        if name is None:
            continue
        add_bucket_call(
            rows,
            context,
            layout,
            bucket,
            name,
            stats_for_call(step, call, len(calls)),
        )


def analyze_staged_cr_tools(trial_dir: Path, root: Path) -> list[dict[str, Any]]:
    trajectory = load_json(trial_dir / TRAJECTORY_PATH)
    stages = stage_entries(load_stage_log(trial_dir / STAGE_LOG_PATH))
    context = derive_context(trial_dir, root)

    pre_stage = Bucket(bucket_id="pre-stage", bucket_kind="overhead")
    post_stage = Bucket(bucket_id="post-stage", bucket_kind="overhead")
    rows: dict[tuple[str, str, str, str, str, str], dict[str, Any]] = {}
    current = pre_stage
    revealed_count = 0

    steps = trajectory.get("steps")
    if not isinstance(steps, list):
        raise ValueError(f"trajectory has no steps array: {trial_dir / TRAJECTORY_PATH}")

    for step in steps:
        if not isinstance(step, dict):
            continue
        collect_step_tool_calls(rows, context, "staged", current, step)
        if not is_next_stage_call(step):
            continue
        text = observation_text(step)
        reveals = len(re.findall(r"Revealed stage\s+\d+", text))
        if reveals == 0 and "done" in text.lower():
            current = post_stage
            continue
        for _ in range(reveals):
            if revealed_count < len(stages):
                current = bucket_from_stage(stages[revealed_count])
            else:
                current = Bucket(
                    bucket_id=f"unknown-stage-{revealed_count + 1}",
                    bucket_kind="unknown-stage",
                    stage_index=revealed_count + 1,
                )
            revealed_count += 1

    return finalize_tool_rows(rows)


def analyze_multi_step_cr_tools(trial_dir: Path, root: Path) -> list[dict[str, Any]]:
    context = derive_context(trial_dir, root)
    rows: dict[tuple[str, str, str, str, str, str], dict[str, Any]] = {}
    for trajectory_path in step_trajectory_paths(trial_dir):
        step_dir = trajectory_path.parent.parent
        trajectory = load_json(trajectory_path)
        bucket = Bucket(
            bucket_id=step_dir.name,
            bucket_kind=step_bucket_kind(step_dir.name),
            stage_id=step_dir.name,
        )
        steps = trajectory.get("steps")
        if not isinstance(steps, list):
            raise ValueError(f"trajectory has no steps array: {trajectory_path}")
        for step in steps:
            if isinstance(step, dict):
                collect_step_tool_calls(rows, context, "multi-step", bucket, step)
    return finalize_tool_rows(rows)


def summarize_tools(calls: list[dict[str, Any]]) -> str:
    counts: Counter[str] = Counter()
    for call in calls:
        name = tool_name(call)
        if name is not None:
            counts[name] += 1
    return ", ".join(
        f"{name}x{count}" if count > 1 else name
        for name, count in sorted(counts.items())
    )


def next_model_usage(
    steps: list[Any],
    step_index: int,
) -> tuple[int | None, Any | None]:
    for next_index in range(step_index + 1, len(steps)):
        step = steps[next_index]
        if not isinstance(step, dict):
            continue
        usage = usage_from_step(step)
        if usage is not None:
            return next_index, usage
    return None, None


def followup_row_for_step(
    *,
    context: dict[str, str],
    layout: str,
    bucket: Bucket,
    steps: list[Any],
    step_index: int,
    step: dict[str, Any],
) -> dict[str, Any] | None:
    calls = cr_tool_calls(step)
    if not calls:
        return None

    argument_bytes = 0
    output_bytes = 0
    for call in calls:
        argument_bytes += compact_json_bytes(call.get("arguments", {}))
        output_bytes += len(output_text_for_call(step, call, len(calls)).encode("utf-8"))

    usage = usage_from_step(step)
    next_index, next_usage = next_model_usage(steps, step_index)
    return {
        "taskId": context["taskId"],
        "sample": context["sample"],
        "arm": context["mode"],
        "mode": context["mode"],
        "layout": layout,
        "trialDir": context["trialDir"],
        "relativeTrialDir": context["relativeTrialDir"],
        "bucketId": bucket.bucket_id,
        "stage": bucket.bucket_kind,
        "stepIndex": step_index,
        "tools": summarize_tools(calls),
        "toolCalls": len(calls),
        "argumentBytes": argument_bytes,
        "outputBytes": output_bytes,
        "approxArgumentTokens": math.ceil(argument_bytes / APPROX_BYTES_PER_TOKEN),
        "approxOutputTokens": math.ceil(output_bytes / APPROX_BYTES_PER_TOKEN),
        "modelInputTokens": usage.input_tokens if usage is not None else None,
        "modelOutputTokens": usage.output_tokens if usage is not None else None,
        "modelTotalTokens": usage.total_tokens if usage is not None else None,
        "nextModelStepIndex": next_index,
        "nextModelInputTokens": next_usage.input_tokens if next_usage is not None else None,
        "nextModelOutputTokens": next_usage.output_tokens if next_usage is not None else None,
        "nextModelTotalTokens": next_usage.total_tokens if next_usage is not None else None,
    }


def analyze_staged_cr_tool_followups(trial_dir: Path, root: Path) -> list[dict[str, Any]]:
    trajectory = load_json(trial_dir / TRAJECTORY_PATH)
    stages = stage_entries(load_stage_log(trial_dir / STAGE_LOG_PATH))
    context = derive_context(trial_dir, root)

    pre_stage = Bucket(bucket_id="pre-stage", bucket_kind="overhead")
    post_stage = Bucket(bucket_id="post-stage", bucket_kind="overhead")
    current = pre_stage
    revealed_count = 0
    rows: list[dict[str, Any]] = []

    steps = trajectory.get("steps")
    if not isinstance(steps, list):
        raise ValueError(f"trajectory has no steps array: {trial_dir / TRAJECTORY_PATH}")

    for step_index, step in enumerate(steps):
        if not isinstance(step, dict):
            continue
        row = followup_row_for_step(
            context=context,
            layout="staged",
            bucket=current,
            steps=steps,
            step_index=step_index,
            step=step,
        )
        if row is not None:
            rows.append(row)
        if not is_next_stage_call(step):
            continue
        text = observation_text(step)
        reveals = len(re.findall(r"Revealed stage\s+\d+", text))
        if reveals == 0 and "done" in text.lower():
            current = post_stage
            continue
        for _ in range(reveals):
            if revealed_count < len(stages):
                current = bucket_from_stage(stages[revealed_count])
            else:
                current = Bucket(
                    bucket_id=f"unknown-stage-{revealed_count + 1}",
                    bucket_kind="unknown-stage",
                    stage_index=revealed_count + 1,
                )
            revealed_count += 1
    return rows


def analyze_multi_step_cr_tool_followups(trial_dir: Path, root: Path) -> list[dict[str, Any]]:
    context = derive_context(trial_dir, root)
    rows: list[dict[str, Any]] = []
    for trajectory_path in step_trajectory_paths(trial_dir):
        step_dir = trajectory_path.parent.parent
        trajectory = load_json(trajectory_path)
        bucket = Bucket(
            bucket_id=step_dir.name,
            bucket_kind=step_bucket_kind(step_dir.name),
            stage_id=step_dir.name,
        )
        steps = trajectory.get("steps")
        if not isinstance(steps, list):
            raise ValueError(f"trajectory has no steps array: {trajectory_path}")
        for step_index, step in enumerate(steps):
            if not isinstance(step, dict):
                continue
            row = followup_row_for_step(
                context=context,
                layout="multi-step",
                bucket=bucket,
                steps=steps,
                step_index=step_index,
                step=step,
            )
            if row is not None:
                rows.append(row)
    return sorted(
        rows,
        key=lambda row: (
            row["taskId"],
            row["sample"],
            row["arm"],
            row["bucketId"],
            row["stepIndex"],
        ),
    )


def analyze_trial_cr_tool_followups(trial_dir: Path, root: Path) -> list[dict[str, Any]]:
    if is_staged_trial_dir(trial_dir):
        return analyze_staged_cr_tool_followups(trial_dir, root)
    if is_multi_step_trial_dir(trial_dir):
        return analyze_multi_step_cr_tool_followups(trial_dir, root)
    raise ValueError(f"unsupported Harbor trial layout: {trial_dir}")


def finalize_tool_rows(
    rows: dict[tuple[str, str, str, str, str, str], dict[str, Any]]
) -> list[dict[str, Any]]:
    finalized: list[dict[str, Any]] = []
    for row in rows.values():
        stats = row.pop("_stats")
        row.update(stats.as_dict())
        finalized.append(row)
    return sorted(
        finalized,
        key=lambda row: (
            row["taskId"],
            row["sample"],
            row["arm"],
            row["bucketId"],
            row["tool"],
        ),
    )


def analyze_trial_cr_tools(trial_dir: Path, root: Path) -> list[dict[str, Any]]:
    if is_staged_trial_dir(trial_dir):
        return analyze_staged_cr_tools(trial_dir, root)
    if is_multi_step_trial_dir(trial_dir):
        return analyze_multi_step_cr_tools(trial_dir, root)
    raise ValueError(f"unsupported Harbor trial layout: {trial_dir}")


def is_cr_arm(arm: str) -> bool:
    return arm == "cr-mcp" or arm.startswith("cr-") or arm.startswith("cr_")


def summarize_mcp_trace(
    trace_path: Path,
    *,
    context: dict[str, str],
    layout: str,
    stage: str | None = None,
    bucket_id: str | None = None,
) -> tuple[dict[str, Any], list[str]]:
    summary: dict[str, Any] = {
        "taskId": context["taskId"],
        "sample": context["sample"],
        "arm": context["mode"],
        "mode": context["mode"],
        "layout": layout,
        "stage": stage,
        "bucketId": bucket_id,
        "tracePath": str(trace_path),
        "exists": trace_path.exists(),
        "lineCount": 0,
        "malformedLines": 0,
        "tools": {},
    }
    warnings: list[str] = []
    if not trace_path.exists():
        return summary, warnings

    try:
        lines = trace_path.read_text(encoding="utf-8").splitlines()
    except OSError as error:
        warnings.append(f"could not read optional MCP trace {trace_path}: {error}")
        return summary, warnings

    for line_no, line in enumerate(lines, start=1):
        if not line.strip():
            continue
        summary["lineCount"] += 1
        try:
            payload = json.loads(line)
        except json.JSONDecodeError as error:
            summary["malformedLines"] += 1
            warnings.append(f"malformed optional MCP trace at {trace_path}:{line_no}: {error}")
            continue
        if not isinstance(payload, dict):
            summary["malformedLines"] += 1
            warnings.append(f"malformed optional MCP trace at {trace_path}:{line_no}: expected object")
            continue
        name = payload.get("tool")
        if not isinstance(name, str) or name not in CR_TOOLS:
            continue
        tools = summary["tools"]
        tool_summary = tools.setdefault(
            name,
            {
                "calls": 0,
                "successes": 0,
                "errors": 0,
                "mutated": None,
                "resultCount": None,
            },
        )
        tool_summary["calls"] += 1
        result_summary = payload.get("resultSummary")
        if not isinstance(result_summary, dict):
            continue
        success = result_summary.get("success")
        if success is True:
            tool_summary["successes"] += 1
        elif success is False:
            tool_summary["errors"] += 1
        mutated = result_summary.get("mutated")
        if isinstance(mutated, int) and not isinstance(mutated, bool):
            tool_summary["mutated"] = (tool_summary["mutated"] or 0) + mutated
        result_count = result_summary.get("count")
        if isinstance(result_count, int) and not isinstance(result_count, bool):
            tool_summary["resultCount"] = (tool_summary["resultCount"] or 0) + result_count
    return summary, warnings


def collect_mcp_trace_summaries(root: Path, trial_dirs: list[Path]) -> tuple[list[dict[str, Any]], list[str]]:
    summaries: list[dict[str, Any]] = []
    warnings: list[str] = []
    for trial_dir in trial_dirs:
        context = derive_context(trial_dir, root)
        if not is_cr_arm(context["mode"]):
            continue
        if is_staged_trial_dir(trial_dir):
            summary, trace_warnings = summarize_mcp_trace(
                trial_dir / MCP_TRACE_PATH,
                context=context,
                layout="staged",
            )
            summaries.append(summary)
            warnings.extend(trace_warnings)
            continue
        for trajectory_path in step_trajectory_paths(trial_dir):
            step_dir = trajectory_path.parent.parent
            summary, trace_warnings = summarize_mcp_trace(
                step_dir / MCP_TRACE_PATH,
                context=context,
                layout="multi-step",
                stage=step_bucket_kind(step_dir.name),
                bucket_id=step_dir.name,
            )
            summaries.append(summary)
            warnings.extend(trace_warnings)
    return summaries, warnings


def aggregate_stage_token_rows(stage_report: dict[str, Any]) -> tuple[list[dict[str, Any]], list[dict[str, Any]], list[str]]:
    bucket_rows: list[dict[str, Any]] = []
    warnings: list[str] = []
    usage_keys = (
        "inputTokens",
        "outputTokens",
        "cachedTokens",
        "reasoningOutputTokens",
        "totalTokens",
        "modelCalls",
    )
    cost_key = "estimatedCostUsd"
    groups: dict[tuple[str, str, str, str], dict[str, Any]] = {}

    for trial in stage_report["trials"]:
        for warning in trial.get("warnings", []):
            warnings.append(
                f"{trial['taskId']} {trial['mode']} {trial['sample']}: {warning}"
            )
        for bucket in trial["buckets"]:
            row = {
                "taskId": trial["taskId"],
                "sample": trial["sample"],
                "arm": trial["mode"],
                "mode": trial["mode"],
                "stage": bucket["bucketKind"],
                "bucketId": bucket["bucketId"],
                "stageId": bucket.get("stageId"),
                "stageIndex": bucket.get("stageIndex"),
                "layout": trial["layout"],
                **{key: bucket.get(key) for key in usage_keys},
                cost_key: bucket.get(cost_key),
            }
            bucket_rows.append(row)
            key = (row["taskId"], row["sample"], row["arm"], row["stage"])
            group = groups.get(key)
            if group is None:
                group = {
                    "taskId": row["taskId"],
                    "sample": row["sample"],
                    "stage": row["stage"],
                    "arm": row["arm"],
                    "mode": row["mode"],
                    **{usage_key: 0 for usage_key in usage_keys},
                    cost_key: None,
                }
                groups[key] = group
            for usage_key in usage_keys:
                group[usage_key] += int(row.get(usage_key) or 0)
            cost = row.get(cost_key)
            if isinstance(cost, (int, float)) and not isinstance(cost, bool):
                group[cost_key] = (group[cost_key] or 0.0) + float(cost)

    return (
        sorted(groups.values(), key=lambda row: (row["taskId"], row["sample"], row["stage"], row["arm"])),
        sorted(bucket_rows, key=lambda row: (row["taskId"], row["sample"], row["stage"], row["arm"], row["bucketId"])),
        warnings,
    )


def aggregate_tool_rows(bucket_rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    groups: dict[tuple[str, str, str, str, str], dict[str, Any]] = {}
    int_keys = (
        "calls",
        "argumentBytes",
        "outputBytes",
        "approxArgumentTokens",
        "approxOutputTokens",
        "successes",
        "errors",
    )
    nullable_int_keys = ("mutated", "resultCount")

    for row in bucket_rows:
        key = (row["taskId"], row["sample"], row["arm"], row["stage"], row["tool"])
        group = groups.get(key)
        if group is None:
            group = {
                "taskId": row["taskId"],
                "sample": row["sample"],
                "stage": row["stage"],
                "arm": row["arm"],
                "mode": row["mode"],
                "tool": row["tool"],
                **{int_key: 0 for int_key in int_keys},
                **{nullable_key: None for nullable_key in nullable_int_keys},
            }
            groups[key] = group
        for int_key in int_keys:
            group[int_key] += int(row.get(int_key) or 0)
        for nullable_key in nullable_int_keys:
            value = row.get(nullable_key)
            if isinstance(value, int) and not isinstance(value, bool):
                group[nullable_key] = (group[nullable_key] or 0) + value

    for row in groups.values():
        row["approxArgumentTokens"] = math.ceil(row["argumentBytes"] / APPROX_BYTES_PER_TOKEN)
        row["approxOutputTokens"] = math.ceil(row["outputBytes"] / APPROX_BYTES_PER_TOKEN)

    return sorted(
        groups.values(),
        key=lambda row: (row["taskId"], row["sample"], row["stage"], row["arm"], row["tool"]),
    )


def matched_cr_vs_markdown_deltas(stage_rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    index = {
        (row["taskId"], row["sample"], row["stage"], row["arm"]): row
        for row in stage_rows
    }
    deltas: list[dict[str, Any]] = []
    for row in stage_rows:
        if not is_cr_arm(row["arm"]):
            continue
        markdown = index.get((row["taskId"], row["sample"], row["stage"], "markdown"))
        if markdown is None:
            continue
        markdown_tokens = int(markdown.get("totalTokens") or 0)
        cr_tokens = int(row.get("totalTokens") or 0)
        deltas.append(
            {
                "taskId": row["taskId"],
                "sample": row["sample"],
                "stage": row["stage"],
                "crArm": row["arm"],
                "markdownArm": "markdown",
                "crTotalTokens": cr_tokens,
                "markdownTotalTokens": markdown_tokens,
                "deltaTokens": cr_tokens - markdown_tokens,
                "ratio": (cr_tokens / markdown_tokens) if markdown_tokens > 0 else None,
            }
        )
    return sorted(deltas, key=lambda row: (row["taskId"], row["sample"], row["stage"], row["crArm"]))


def model_call_delta_rows(stage_rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    index = {
        (row["taskId"], row["sample"], row["stage"], row["arm"]): row
        for row in stage_rows
    }
    rows: list[dict[str, Any]] = []
    for row in stage_rows:
        if not is_cr_arm(row["arm"]):
            continue
        markdown = index.get((row["taskId"], row["sample"], row["stage"], "markdown"))
        if markdown is None:
            continue
        cr_tokens = int(row.get("totalTokens") or 0)
        markdown_tokens = int(markdown.get("totalTokens") or 0)
        cr_calls = int(row.get("modelCalls") or 0)
        markdown_calls = int(markdown.get("modelCalls") or 0)
        cr_tokens_per_call = cr_tokens / cr_calls if cr_calls > 0 else None
        markdown_tokens_per_call = (
            markdown_tokens / markdown_calls if markdown_calls > 0 else None
        )
        rows.append(
            {
                "taskId": row["taskId"],
                "sample": row["sample"],
                "stage": row["stage"],
                "crArm": row["arm"],
                "crModelCalls": cr_calls,
                "markdownModelCalls": markdown_calls,
                "deltaModelCalls": cr_calls - markdown_calls,
                "crTokensPerCall": cr_tokens_per_call,
                "markdownTokensPerCall": markdown_tokens_per_call,
                "deltaTokensPerCall": (
                    cr_tokens_per_call - markdown_tokens_per_call
                    if cr_tokens_per_call is not None
                    and markdown_tokens_per_call is not None
                    else None
                ),
                "deltaTokens": cr_tokens - markdown_tokens,
            }
        )
    return sorted(rows, key=lambda row: (row["taskId"], row["sample"], row["stage"], row["crArm"]))


def is_downstream_stage(stage: str) -> bool:
    normalized = stage.lower()
    return (
        "downstream" in normalized
        or "readback" in normalized
        or normalized in {"state-task", "service-task"}
    )


def diagnosis_flags(tool_bucket_rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    flags: list[dict[str, Any]] = []
    catalog_counts: dict[tuple[str, str, str], int] = defaultdict(int)
    for row in tool_bucket_rows:
        if row["tool"] == "listPreferenceSlugs":
            catalog_counts[(row["taskId"], row["sample"], row["arm"])] += int(row.get("calls") or 0)

        if (
            row["tool"] == "mutatePreferences"
            and "memory" in row["stage"].lower()
            and int(row.get("calls") or 0) > 1
        ):
            flags.append(
                {
                    "flag": "write fragmentation",
                    "taskId": row["taskId"],
                    "sample": row["sample"],
                    "arm": row["arm"],
                    "stage": row["stage"],
                    "bucketId": row["bucketId"],
                    "tool": row["tool"],
                    "value": row["calls"],
                    "message": "mutatePreferences called more than once in a memory/update bucket",
                }
            )

        if int(row.get("outputBytes") or 0) > VERBOSE_OUTPUT_BYTES:
            flags.append(
                {
                    "flag": "verbose output",
                    "taskId": row["taskId"],
                    "sample": row["sample"],
                    "arm": row["arm"],
                    "stage": row["stage"],
                    "bucketId": row["bucketId"],
                    "tool": row["tool"],
                    "value": row["outputBytes"],
                    "message": "CR tool output exceeds 8 KB in one bucket",
                }
            )

        if row["tool"] == "searchPreferences" and is_downstream_stage(row["stage"]):
            flags.append(
                {
                    "flag": "retrieval-heavy downstream",
                    "taskId": row["taskId"],
                    "sample": row["sample"],
                    "arm": row["arm"],
                    "stage": row["stage"],
                    "bucketId": row["bucketId"],
                    "tool": row["tool"],
                    "value": row["calls"],
                    "message": "searchPreferences appears in a downstream/readback bucket",
                }
            )

    for (task_id, sample, arm), calls in sorted(catalog_counts.items()):
        if calls <= 1:
            continue
        flags.append(
            {
                "flag": "repeated catalog lookup",
                "taskId": task_id,
                "sample": sample,
                "arm": arm,
                "stage": "sample",
                "bucketId": None,
                "tool": "listPreferenceSlugs",
                "value": calls,
                "message": "listPreferenceSlugs called more than once in a sample",
            }
        )

    return sorted(flags, key=lambda row: (row["taskId"], row["sample"], row["flag"], str(row.get("bucketId"))))


def trace_summary_counts(trace_summaries: list[dict[str, Any]]) -> dict[str, int]:
    return {
        "traceFiles": len(trace_summaries),
        "traceFilesFound": sum(1 for summary in trace_summaries if summary.get("exists")),
        "missingTraceFiles": sum(1 for summary in trace_summaries if not summary.get("exists")),
        "malformedTraceLines": sum(int(summary.get("malformedLines") or 0) for summary in trace_summaries),
    }


def build_report(root: Path) -> dict[str, Any]:
    trial_dirs = find_trial_dirs(root)
    if not trial_dirs:
        raise ValueError(f"no completed staged or multi-step Harbor trials found under {root}")

    stage_report = build_stage_token_report(root)
    stage_rows, stage_bucket_rows, stage_warnings = aggregate_stage_token_rows(stage_report)

    tool_bucket_rows: list[dict[str, Any]] = []
    tool_followup_rows: list[dict[str, Any]] = []
    for trial_dir in trial_dirs:
        tool_bucket_rows.extend(analyze_trial_cr_tools(trial_dir, root))
        tool_followup_rows.extend(analyze_trial_cr_tool_followups(trial_dir, root))
    tool_rows = aggregate_tool_rows(tool_bucket_rows)

    trace_summaries, trace_warnings = collect_mcp_trace_summaries(root, trial_dirs)
    warnings = stage_warnings + trace_warnings

    return {
        "schemaVersion": 1,
        "root": str(root),
        "note": (
            "Stage token counts are exact sums from Codex trajectory metrics. "
            "CR tool payload token counts are approximate byte/4 diagnostics "
            "from agent-visible tool arguments and observations."
        ),
        "stageTokenRows": stage_rows,
        "stageTokenBucketRows": stage_bucket_rows,
        "crToolRows": tool_rows,
        "crToolBucketRows": tool_bucket_rows,
        "crToolFollowupRows": tool_followup_rows,
        "matchedCrVsMarkdownDeltas": matched_cr_vs_markdown_deltas(stage_rows),
        "modelCallDeltaRows": model_call_delta_rows(stage_rows),
        "diagnosisFlags": diagnosis_flags(tool_bucket_rows),
        "mcpTraceSummaries": trace_summaries,
        "mcpTraceSummaryCounts": trace_summary_counts(trace_summaries),
        "warnings": warnings,
    }


def format_value(key: str, value: Any) -> str:
    if value is None:
        return "n/a"
    if key == "ratio":
        return f"{float(value):.2f}x"
    if key.endswith("TokensPerCall"):
        return fmt_int(round(float(value)))
    if key.endswith("CostUsd") or key == "cost":
        return fmt_cost(value)
    if (
        key.endswith("Tokens")
        or key.endswith("Bytes")
        or key
        in {
            "calls",
            "modelCalls",
            "crModelCalls",
            "markdownModelCalls",
            "deltaModelCalls",
            "successes",
            "errors",
            "mutated",
            "resultCount",
            "stepIndex",
            "nextModelStepIndex",
            "toolCalls",
            "deltaTokens",
            "crTotalTokens",
            "markdownTotalTokens",
            "value",
            "lineCount",
            "malformedLines",
        }
    ):
        return fmt_int(value)
    return str(value)


def markdown_table(rows: list[dict[str, Any]], columns: list[tuple[str, str]]) -> list[str]:
    lines = [
        "| " + " | ".join(label for label, _ in columns) + " |",
        "| " + " | ".join("---" for _ in columns) + " |",
    ]
    for row in rows:
        lines.append(
            "| "
            + " | ".join(format_value(key, row.get(key)) for _, key in columns)
            + " |"
        )
    return lines


def markdown_report(report: dict[str, Any], *, include_detail: bool) -> str:
    trace_counts = report["mcpTraceSummaryCounts"]
    lines = [
        "# CR Token Overhead Report",
        "",
        report["note"],
        "",
        (
            "Optional MCP trace evidence: "
            f"{trace_counts['traceFilesFound']}/{trace_counts['traceFiles']} trace files found; "
            f"{trace_counts['malformedTraceLines']} malformed trace lines."
        ),
        "",
        "## Stage Token Comparison",
        "",
    ]
    lines.extend(
        markdown_table(
            report["stageTokenRows"],
            [
                ("Task", "taskId"),
                ("Sample", "sample"),
                ("Stage", "stage"),
                ("Arm", "arm"),
                ("Total Tokens", "totalTokens"),
                ("Cost", "estimatedCostUsd"),
                ("Model Calls", "modelCalls"),
            ],
        )
    )
    lines.extend(["", "## CR Tool Breakdown", ""])
    lines.extend(
        markdown_table(
            report["crToolRows"],
            [
                ("Task", "taskId"),
                ("Sample", "sample"),
                ("Stage", "stage"),
                ("Tool", "tool"),
                ("Calls", "calls"),
                ("Arg Bytes", "argumentBytes"),
                ("Output Bytes", "outputBytes"),
                ("Approx Output Tokens", "approxOutputTokens"),
                ("Mutated", "mutated"),
                ("Result Count", "resultCount"),
            ],
        )
    )
    lines.extend(["", "## Matched CR vs Markdown Delta", ""])
    lines.extend(
        markdown_table(
            report["matchedCrVsMarkdownDeltas"],
            [
                ("Task", "taskId"),
                ("Sample", "sample"),
                ("Stage", "stage"),
                ("CR Tokens", "crTotalTokens"),
                ("Markdown Tokens", "markdownTotalTokens"),
                ("Delta Tokens", "deltaTokens"),
                ("CR / Markdown", "ratio"),
            ],
        )
    )
    lines.extend(["", "## Model Call Delta Summary", ""])
    lines.extend(
        markdown_table(
            report["modelCallDeltaRows"],
            [
                ("Task", "taskId"),
                ("Sample", "sample"),
                ("Stage", "stage"),
                ("CR Calls", "crModelCalls"),
                ("Markdown Calls", "markdownModelCalls"),
                ("Delta Calls", "deltaModelCalls"),
                ("CR Tok/Call", "crTokensPerCall"),
                ("Markdown Tok/Call", "markdownTokensPerCall"),
                ("Delta Tok/Call", "deltaTokensPerCall"),
                ("Delta Tokens", "deltaTokens"),
            ],
        )
    )
    lines.extend(["", "## Diagnosis Flags", ""])
    if report["diagnosisFlags"]:
        lines.extend(
            markdown_table(
                report["diagnosisFlags"],
                [
                    ("Flag", "flag"),
                    ("Task", "taskId"),
                    ("Sample", "sample"),
                    ("Stage", "stage"),
                    ("Tool", "tool"),
                    ("Value", "value"),
                    ("Message", "message"),
                ],
            )
        )
    else:
        lines.append("No diagnosis flags.")

    if report["warnings"]:
        lines.extend(["", "## Warnings", ""])
        lines.extend(
            markdown_table(
                [{"warning": warning} for warning in report["warnings"]],
                [("Warning", "warning")],
            )
        )

    if include_detail:
        lines.extend(["", "## CR Tool Follow-up Model Calls", ""])
        lines.extend(
            markdown_table(
                report["crToolFollowupRows"],
                [
                    ("Task", "taskId"),
                    ("Sample", "sample"),
                    ("Bucket Id", "bucketId"),
                    ("Stage", "stage"),
                    ("Step", "stepIndex"),
                    ("Tools", "tools"),
                    ("Tool Calls", "toolCalls"),
                    ("Tool Out Tok", "approxOutputTokens"),
                    ("Model Tok", "modelTotalTokens"),
                    ("Next Step", "nextModelStepIndex"),
                    ("Next Model Input", "nextModelInputTokens"),
                    ("Next Model Tok", "nextModelTotalTokens"),
                ],
            )
        )
        lines.extend(["", "## Detailed CR Tool Buckets", ""])
        lines.extend(
            markdown_table(
                report["crToolBucketRows"],
                [
                    ("Task", "taskId"),
                    ("Sample", "sample"),
                    ("Bucket Id", "bucketId"),
                    ("Stage", "stage"),
                    ("Arm", "arm"),
                    ("Tool", "tool"),
                    ("Calls", "calls"),
                    ("Arg Bytes", "argumentBytes"),
                    ("Output Bytes", "outputBytes"),
                    ("Approx Arg Tokens", "approxArgumentTokens"),
                    ("Approx Output Tokens", "approxOutputTokens"),
                    ("Successes", "successes"),
                    ("Errors", "errors"),
                ],
            )
        )
        lines.extend(["", "## MCP Trace Evidence", ""])
        trace_rows: list[dict[str, Any]] = []
        for summary in report["mcpTraceSummaries"]:
            tools = summary["tools"]
            if not tools:
                trace_rows.append(
                    {
                        "taskId": summary["taskId"],
                        "sample": summary["sample"],
                        "arm": summary["arm"],
                        "stage": summary.get("stage"),
                        "bucketId": summary.get("bucketId"),
                        "exists": summary["exists"],
                        "lineCount": summary["lineCount"],
                        "malformedLines": summary["malformedLines"],
                        "tool": None,
                        "calls": None,
                        "successes": None,
                        "errors": None,
                        "mutated": None,
                        "resultCount": None,
                    }
                )
                continue
            for tool, tool_summary in sorted(tools.items()):
                trace_rows.append(
                    {
                        "taskId": summary["taskId"],
                        "sample": summary["sample"],
                        "arm": summary["arm"],
                        "stage": summary.get("stage"),
                        "bucketId": summary.get("bucketId"),
                        "exists": summary["exists"],
                        "lineCount": summary["lineCount"],
                        "malformedLines": summary["malformedLines"],
                        "tool": tool,
                        "calls": tool_summary["calls"],
                        "successes": tool_summary["successes"],
                        "errors": tool_summary["errors"],
                        "mutated": tool_summary["mutated"],
                        "resultCount": tool_summary["resultCount"],
                    }
                )
        lines.extend(
            markdown_table(
                trace_rows,
                [
                    ("Task", "taskId"),
                    ("Sample", "sample"),
                    ("Arm", "arm"),
                    ("Stage", "stage"),
                    ("Bucket Id", "bucketId"),
                    ("Exists", "exists"),
                    ("Lines", "lineCount"),
                    ("Malformed", "malformedLines"),
                    ("Tool", "tool"),
                    ("Calls", "calls"),
                    ("Successes", "successes"),
                    ("Errors", "errors"),
                    ("Mutated", "mutated"),
                    ("Result Count", "resultCount"),
                ],
            )
        )

    return "\n".join(lines) + "\n"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Report CR token overhead diagnostics from Harbor artifacts."
    )
    parser.add_argument(
        "root",
        type=Path,
        help="Completed Harbor artifact root, sample directory, or trial directory.",
    )
    parser.add_argument("--json-out", type=Path, help="Optional JSON report path.")
    parser.add_argument("--md-out", type=Path, help="Optional Markdown report path.")
    parser.add_argument(
        "--detail",
        action="store_true",
        help="Include bucket-level CR tool and optional MCP trace detail.",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    root = args.root.resolve()
    try:
        report = build_report(root)
    except ValueError as error:
        print(f"error: {error}", file=sys.stderr)
        return 1

    if args.json_out:
        args.json_out.parent.mkdir(parents=True, exist_ok=True)
        args.json_out.write_text(
            json.dumps(report, indent=2, sort_keys=True) + "\n",
            encoding="utf-8",
        )
    markdown = markdown_report(report, include_detail=args.detail)
    if args.md_out:
        args.md_out.parent.mkdir(parents=True, exist_ok=True)
        args.md_out.write_text(markdown, encoding="utf-8")
    if not args.json_out and not args.md_out:
        print(markdown)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
