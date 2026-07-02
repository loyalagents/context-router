#!/usr/bin/env python3
"""Report Codex token usage by Harbor staged-eval phase.

This is an artifact-only reporter. It reads Codex trajectory files and Harbor
stage logs from completed runs, then attributes each model-call step to the
stage that was visible at the start of that step.

Token counts are exact values from `agent/trajectory.json`. Cost is only exposed
by Codex as a whole-run total, so per-stage cost is estimated in proportion to
total tokens and is reported as `estimatedCostUsd`.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from collections import defaultdict
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any


TRAJECTORY_PATH = Path("agent/trajectory.json")
STAGE_LOG_PATH = Path("artifacts/app/stage-log.jsonl")


@dataclass
class Usage:
    input_tokens: int = 0
    output_tokens: int = 0
    cached_tokens: int = 0
    reasoning_output_tokens: int = 0
    total_tokens: int = 0
    model_calls: int = 0
    estimated_cost_usd: float | None = None

    def add(self, other: "Usage") -> None:
        self.input_tokens += other.input_tokens
        self.output_tokens += other.output_tokens
        self.cached_tokens += other.cached_tokens
        self.reasoning_output_tokens += other.reasoning_output_tokens
        self.total_tokens += other.total_tokens
        self.model_calls += other.model_calls

    def as_dict(self) -> dict[str, Any]:
        return {
            "inputTokens": self.input_tokens,
            "outputTokens": self.output_tokens,
            "cachedTokens": self.cached_tokens,
            "reasoningOutputTokens": self.reasoning_output_tokens,
            "totalTokens": self.total_tokens,
            "modelCalls": self.model_calls,
            "estimatedCostUsd": self.estimated_cost_usd,
        }


@dataclass
class Bucket:
    bucket_id: str
    bucket_kind: str
    stage_id: str | None = None
    stage_index: int | None = None
    raw_docs_visible: bool | None = None
    file_count: int | None = None
    usage: Usage = field(default_factory=Usage)

    def as_dict(self) -> dict[str, Any]:
        return {
            "bucketId": self.bucket_id,
            "bucketKind": self.bucket_kind,
            "stageId": self.stage_id,
            "stageIndex": self.stage_index,
            "rawDocsVisible": self.raw_docs_visible,
            "fileCount": self.file_count,
            **self.usage.as_dict(),
        }


def load_json(path: Path) -> dict[str, Any]:
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError as error:
        raise ValueError(f"missing file: {path}") from error
    except json.JSONDecodeError as error:
        raise ValueError(f"malformed JSON: {path}: {error}") from error
    if not isinstance(payload, dict):
        raise ValueError(f"expected JSON object in {path}")
    return payload


def load_stage_log(path: Path) -> list[dict[str, Any]]:
    entries: list[dict[str, Any]] = []
    if not path.exists():
        return entries
    for line_no, line in enumerate(path.read_text(encoding="utf-8").splitlines(), start=1):
        if not line.strip():
            continue
        try:
            payload = json.loads(line)
        except json.JSONDecodeError as error:
            raise ValueError(f"malformed JSONL at {path}:{line_no}: {error}") from error
        if not isinstance(payload, dict):
            raise ValueError(f"expected JSON object at {path}:{line_no}")
        entries.append(payload)
    return entries


def stage_entries(stage_log: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [entry for entry in stage_log if entry.get("done") is not True]


def usage_from_step(step: dict[str, Any]) -> Usage | None:
    metrics = step.get("metrics")
    if not isinstance(metrics, dict):
        return None
    input_tokens = int(metrics.get("prompt_tokens") or 0)
    output_tokens = int(metrics.get("completion_tokens") or 0)
    cached_tokens = int(metrics.get("cached_tokens") or 0)
    extra = metrics.get("extra") if isinstance(metrics.get("extra"), dict) else {}
    reasoning_output_tokens = int(extra.get("reasoning_output_tokens") or 0)
    total_tokens = int(extra.get("total_tokens") or (input_tokens + output_tokens))
    return Usage(
        input_tokens=input_tokens,
        output_tokens=output_tokens,
        cached_tokens=cached_tokens,
        reasoning_output_tokens=reasoning_output_tokens,
        total_tokens=total_tokens,
        model_calls=1,
    )


def is_next_stage_call(step: dict[str, Any]) -> bool:
    tool_calls = step.get("tool_calls")
    if not isinstance(tool_calls, list):
        return False
    for call in tool_calls:
        if not isinstance(call, dict):
            continue
        arguments = call.get("arguments")
        if not isinstance(arguments, dict):
            continue
        command = arguments.get("cmd")
        if not isinstance(command, str):
            continue
        stripped = command.strip()
        if any(
            stripped == candidate or stripped.startswith(f"{candidate} ")
            for candidate in ("/app/next_stage", "./next_stage", "next_stage")
        ):
            return True
    return False


def observation_text(step: dict[str, Any]) -> str:
    observation = step.get("observation")
    if not isinstance(observation, dict):
        return ""
    results = observation.get("results")
    if not isinstance(results, list):
        return ""
    parts: list[str] = []
    for result in results:
        if not isinstance(result, dict):
            continue
        content = result.get("content")
        if isinstance(content, str):
            parts.append(content)
    return "\n".join(parts)


def bucket_from_stage(stage: dict[str, Any]) -> Bucket:
    stage_id = str(stage.get("stageId") or f"stage-{stage.get('stageIndex', 'unknown')}")
    return Bucket(
        bucket_id=stage_id,
        bucket_kind=str(stage.get("kind") or "stage"),
        stage_id=stage_id,
        stage_index=stage.get("stageIndex") if isinstance(stage.get("stageIndex"), int) else None,
        raw_docs_visible=stage.get("rawDocsVisible")
        if isinstance(stage.get("rawDocsVisible"), bool)
        else None,
        file_count=stage.get("fileCount") if isinstance(stage.get("fileCount"), int) else None,
    )


def clone_bucket_meta(bucket: Bucket) -> Bucket:
    return Bucket(
        bucket_id=bucket.bucket_id,
        bucket_kind=bucket.bucket_kind,
        stage_id=bucket.stage_id,
        stage_index=bucket.stage_index,
        raw_docs_visible=bucket.raw_docs_visible,
        file_count=bucket.file_count,
    )


def derive_context(trial_dir: Path, root: Path) -> dict[str, str]:
    sample_dir = next(
        (parent for parent in trial_dir.parents if parent.name.startswith("sample-")),
        None,
    )
    if sample_dir is None:
        return {
            "taskId": trial_dir.name,
            "mode": "unknown",
            "sample": "unknown",
            "trialDir": str(trial_dir),
            "relativeTrialDir": str(trial_dir.relative_to(root)) if trial_dir.is_relative_to(root) else str(trial_dir),
        }
    mode_dir = sample_dir.parent
    task_dir = mode_dir.parent
    return {
        "taskId": task_dir.name,
        "mode": mode_dir.name,
        "sample": sample_dir.name,
        "trialDir": str(trial_dir),
        "relativeTrialDir": str(trial_dir.relative_to(root)) if trial_dir.is_relative_to(root) else str(trial_dir),
    }


def find_trial_dirs(root: Path) -> list[Path]:
    if (root / TRAJECTORY_PATH).exists() and (root / STAGE_LOG_PATH).exists():
        return [root]
    return sorted(
        path.parent.parent
        for path in root.rglob(str(TRAJECTORY_PATH))
        if (path.parent.parent / STAGE_LOG_PATH).exists()
    )


def allocate_cost(buckets: list[Bucket], total_cost_usd: float | None) -> None:
    if total_cost_usd is None:
        return
    total_tokens = sum(bucket.usage.total_tokens for bucket in buckets)
    if total_tokens <= 0:
        return
    for bucket in buckets:
        bucket.usage.estimated_cost_usd = total_cost_usd * bucket.usage.total_tokens / total_tokens


def final_cost(trajectory: dict[str, Any]) -> float | None:
    final_metrics = trajectory.get("final_metrics")
    if not isinstance(final_metrics, dict):
        return None
    value = final_metrics.get("total_cost_usd")
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        return float(value)
    return None


def validate_totals(trajectory: dict[str, Any], buckets: list[Bucket]) -> list[str]:
    final_metrics = trajectory.get("final_metrics")
    if not isinstance(final_metrics, dict):
        return ["trajectory missing final_metrics"]
    totals = {
        "total_prompt_tokens": sum(bucket.usage.input_tokens for bucket in buckets),
        "total_completion_tokens": sum(bucket.usage.output_tokens for bucket in buckets),
        "total_cached_tokens": sum(bucket.usage.cached_tokens for bucket in buckets),
    }
    extra = final_metrics.get("extra") if isinstance(final_metrics.get("extra"), dict) else {}
    if "total_tokens" in extra:
        totals["extra.total_tokens"] = sum(bucket.usage.total_tokens for bucket in buckets)
    if "reasoning_output_tokens" in extra:
        totals["extra.reasoning_output_tokens"] = sum(
            bucket.usage.reasoning_output_tokens for bucket in buckets
        )

    warnings: list[str] = []
    for key, actual in totals.items():
        expected: Any
        if key.startswith("extra."):
            expected = extra.get(key.split(".", 1)[1])
        else:
            expected = final_metrics.get(key)
        if expected is None:
            continue
        if int(expected) != int(actual):
            warnings.append(f"{key} mismatch: expected {expected}, attributed {actual}")
    return warnings


def analyze_trial(trial_dir: Path, root: Path) -> dict[str, Any]:
    trajectory = load_json(trial_dir / TRAJECTORY_PATH)
    stages = stage_entries(load_stage_log(trial_dir / STAGE_LOG_PATH))
    context = derive_context(trial_dir, root)

    pre_stage = Bucket(bucket_id="pre-stage", bucket_kind="overhead")
    post_stage = Bucket(bucket_id="post-stage", bucket_kind="overhead")
    buckets_by_id: dict[str, Bucket] = {
        pre_stage.bucket_id: pre_stage,
        post_stage.bucket_id: post_stage,
    }
    current = pre_stage
    revealed_count = 0
    next_stage_calls = 0
    reveal_events = 0

    steps = trajectory.get("steps")
    if not isinstance(steps, list):
        raise ValueError(f"trajectory has no steps array: {trial_dir / TRAJECTORY_PATH}")

    for step in steps:
        if not isinstance(step, dict):
            continue
        usage = usage_from_step(step)
        if usage is not None:
            if current.bucket_id not in buckets_by_id:
                buckets_by_id[current.bucket_id] = clone_bucket_meta(current)
            buckets_by_id[current.bucket_id].usage.add(usage)

        if not is_next_stage_call(step):
            continue
        next_stage_calls += 1
        text = observation_text(step)
        reveals = len(re.findall(r"Revealed stage\s+\d+", text))
        if reveals == 0 and "done" in text.lower():
            current = post_stage
            continue
        for _ in range(reveals):
            reveal_events += 1
            if revealed_count < len(stages):
                current = bucket_from_stage(stages[revealed_count])
                buckets_by_id.setdefault(current.bucket_id, clone_bucket_meta(current))
            else:
                current = Bucket(
                    bucket_id=f"unknown-stage-{revealed_count + 1}",
                    bucket_kind="unknown-stage",
                    stage_index=revealed_count + 1,
                )
                buckets_by_id.setdefault(current.bucket_id, clone_bucket_meta(current))
            revealed_count += 1

    ordered_buckets = [buckets_by_id["pre-stage"]]
    for stage in stages:
        stage_bucket = bucket_from_stage(stage)
        ordered_buckets.append(buckets_by_id.get(stage_bucket.bucket_id, stage_bucket))
    unknown_stage_ids = sorted(
        bucket_id
        for bucket_id, bucket in buckets_by_id.items()
        if bucket.bucket_kind == "unknown-stage"
    )
    ordered_buckets.extend(buckets_by_id[bucket_id] for bucket_id in unknown_stage_ids)
    ordered_buckets.append(buckets_by_id["post-stage"])
    ordered_buckets = [
        bucket
        for bucket in ordered_buckets
        if bucket.usage.model_calls > 0 or bucket.stage_id is not None or bucket.bucket_kind == "overhead"
    ]

    allocate_cost(ordered_buckets, final_cost(trajectory))
    warnings = validate_totals(trajectory, ordered_buckets)
    if reveal_events != len(stages):
        warnings.append(f"stage reveal count mismatch: revealed {reveal_events}, stage-log has {len(stages)}")

    return {
        **context,
        "model": next(
            (
                step.get("model_name")
                for step in steps
                if isinstance(step, dict) and isinstance(step.get("model_name"), str)
            ),
            None,
        ),
        "totalCostUsd": final_cost(trajectory),
        "nextStageCalls": next_stage_calls,
        "revealedStages": reveal_events,
        "stageLogStages": len(stages),
        "warnings": warnings,
        "buckets": [bucket.as_dict() for bucket in ordered_buckets],
    }


def build_report(root: Path) -> dict[str, Any]:
    trial_dirs = find_trial_dirs(root)
    if not trial_dirs:
        raise ValueError(f"no completed staged Harbor trials found under {root}")
    trials = [analyze_trial(trial_dir, root) for trial_dir in trial_dirs]
    return {
        "schemaVersion": 1,
        "root": str(root),
        "note": (
            "Stage token counts are exact sums from agent/trajectory.json step metrics. "
            "estimatedCostUsd is proportional allocation from the whole-run Codex cost."
        ),
        "trials": trials,
        "aggregateByTaskModeKind": aggregate_by_task_mode_kind(trials),
    }


def aggregate_by_task_mode_kind(trials: list[dict[str, Any]]) -> list[dict[str, Any]]:
    groups: dict[tuple[str, str, str], Usage] = defaultdict(Usage)
    counts: dict[tuple[str, str, str], set[str]] = defaultdict(set)
    cost_totals: dict[tuple[str, str, str], float] = defaultdict(float)
    for trial in trials:
        task_id = trial["taskId"]
        mode = trial["mode"]
        sample = trial["sample"]
        for bucket in trial["buckets"]:
            key = (task_id, mode, bucket["bucketKind"])
            usage = Usage(
                input_tokens=int(bucket.get("inputTokens") or 0),
                output_tokens=int(bucket.get("outputTokens") or 0),
                cached_tokens=int(bucket.get("cachedTokens") or 0),
                reasoning_output_tokens=int(bucket.get("reasoningOutputTokens") or 0),
                total_tokens=int(bucket.get("totalTokens") or 0),
                model_calls=int(bucket.get("modelCalls") or 0),
            )
            groups[key].add(usage)
            counts[key].add(sample)
            est_cost = bucket.get("estimatedCostUsd")
            if isinstance(est_cost, (int, float)) and not isinstance(est_cost, bool):
                cost_totals[key] += float(est_cost)

    rows = []
    for key in sorted(groups):
        task_id, mode, bucket_kind = key
        usage = groups[key]
        cost = cost_totals.get(key)
        usage.estimated_cost_usd = cost if cost is not None else None
        rows.append(
            {
                "taskId": task_id,
                "mode": mode,
                "bucketKind": bucket_kind,
                "samples": len(counts[key]),
                **usage.as_dict(),
            }
        )
    return rows


def fmt_int(value: Any) -> str:
    if value is None:
        return "n/a"
    return f"{int(value):,}"


def fmt_cost(value: Any) -> str:
    if value is None:
        return "n/a"
    return f"${float(value):.4f}"


def markdown_table(rows: list[dict[str, Any]], columns: list[tuple[str, str]]) -> list[str]:
    lines = [
        "| " + " | ".join(label for label, _ in columns) + " |",
        "| " + " | ".join("---" for _ in columns) + " |",
    ]
    for row in rows:
        values = []
        for _, key in columns:
            value = row.get(key)
            if key.endswith("Tokens") or key in {"modelCalls", "samples"}:
                values.append(fmt_int(value))
            elif key.endswith("CostUsd"):
                values.append(fmt_cost(value))
            else:
                values.append(str(value) if value is not None else "n/a")
        lines.append("| " + " | ".join(values) + " |")
    return lines


def markdown_report(report: dict[str, Any], *, include_detail: bool) -> str:
    lines = [
        "# Harbor Stage Token Usage Report",
        "",
        report["note"],
        "",
        "## Aggregate By Task, Arm, And Bucket Kind",
        "",
    ]
    lines.extend(
        markdown_table(
            report["aggregateByTaskModeKind"],
            [
                ("Task", "taskId"),
                ("Arm", "mode"),
                ("Bucket", "bucketKind"),
                ("Samples", "samples"),
                ("Input Tok", "inputTokens"),
                ("Output Tok", "outputTokens"),
                ("Cached Tok", "cachedTokens"),
                ("Reasoning Tok", "reasoningOutputTokens"),
                ("Total Tok", "totalTokens"),
                ("Est. Cost", "estimatedCostUsd"),
                ("Model Calls", "modelCalls"),
            ],
        )
    )

    warning_rows = []
    for trial in report["trials"]:
        for warning in trial["warnings"]:
            warning_rows.append(
                {
                    "taskId": trial["taskId"],
                    "mode": trial["mode"],
                    "sample": trial["sample"],
                    "warning": warning,
                }
            )
    if warning_rows:
        lines.extend(["", "## Warnings", ""])
        lines.extend(
            markdown_table(
                warning_rows,
                [
                    ("Task", "taskId"),
                    ("Arm", "mode"),
                    ("Sample", "sample"),
                    ("Warning", "warning"),
                ],
            )
        )

    if include_detail:
        detail_rows = []
        for trial in report["trials"]:
            for bucket in trial["buckets"]:
                detail_rows.append(
                    {
                        "taskId": trial["taskId"],
                        "mode": trial["mode"],
                        "sample": trial["sample"],
                        "bucketId": bucket["bucketId"],
                        "bucketKind": bucket["bucketKind"],
                        "inputTokens": bucket["inputTokens"],
                        "outputTokens": bucket["outputTokens"],
                        "cachedTokens": bucket["cachedTokens"],
                        "reasoningOutputTokens": bucket["reasoningOutputTokens"],
                        "totalTokens": bucket["totalTokens"],
                        "estimatedCostUsd": bucket["estimatedCostUsd"],
                        "modelCalls": bucket["modelCalls"],
                    }
                )
        lines.extend(["", "## Detailed Buckets", ""])
        lines.extend(
            markdown_table(
                detail_rows,
                [
                    ("Task", "taskId"),
                    ("Arm", "mode"),
                    ("Sample", "sample"),
                    ("Bucket Id", "bucketId"),
                    ("Bucket", "bucketKind"),
                    ("Input Tok", "inputTokens"),
                    ("Output Tok", "outputTokens"),
                    ("Cached Tok", "cachedTokens"),
                    ("Reasoning Tok", "reasoningOutputTokens"),
                    ("Total Tok", "totalTokens"),
                    ("Est. Cost", "estimatedCostUsd"),
                    ("Model Calls", "modelCalls"),
                ],
            )
        )
    return "\n".join(lines) + "\n"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Report Codex token usage by Harbor staged-eval phase."
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
        help="Include per-stage rows in the Markdown output.",
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
        args.json_out.write_text(json.dumps(report, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    markdown = markdown_report(report, include_detail=args.detail)
    if args.md_out:
        args.md_out.parent.mkdir(parents=True, exist_ok=True)
        args.md_out.write_text(markdown, encoding="utf-8")
    if not args.json_out and not args.md_out:
        print(markdown)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
