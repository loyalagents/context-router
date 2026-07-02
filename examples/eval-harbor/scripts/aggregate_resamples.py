#!/usr/bin/env python3
"""Aggregate repeated Harbor samples for DynamicMem suite reporting."""

from __future__ import annotations

import argparse
import importlib
import json
import statistics
from pathlib import Path
from typing import Any


DEFAULT_MODES = ["context-only", "markdown", "cr-mcp"]


def load_manifest(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def task_ids_from_manifest(payload: dict[str, Any]) -> list[str]:
    return [item["taskId"] for item in payload.get("tasks", [])]


def modes_from_manifest(payload: dict[str, Any]) -> list[str]:
    arms = payload.get("arms")
    if isinstance(arms, list) and arms:
        return [arm["mode"] for arm in arms if isinstance(arm.get("mode"), str)]
    modes = payload.get("modes")
    if isinstance(modes, list) and modes:
        return [mode for mode in modes if isinstance(mode, str)]
    return DEFAULT_MODES


def summarize_sample(mode: str, sample_dir: Path) -> dict[str, Any]:
    report_results = importlib.import_module("report_results")
    row = report_results.summarize_run(mode, sample_dir)
    return {
        "sampleDir": str(sample_dir),
        "reward": row.get("reward"),
        "fieldAccuracy": row.get("fieldAccuracy"),
        "stateCompletionAccuracy": row.get("stateCompletionAccuracy"),
        "rq3ApplyMeanScore": row.get("rq3ApplyMeanScore"),
        "parseSuccess": row.get("parseSuccess"),
        "metadataSuccess": row.get("metadataSuccess"),
        "missingCount": row.get("missingCount"),
        "wrongCount": row.get("wrongCount"),
        "overfillCount": row.get("overfillCount"),
        "missingFields": row.get("missingFields", []),
        "wrongFields": row.get("wrongFields", []),
        "overfillFields": row.get("overfillFields", []),
        "validationErrors": row.get("validationErrors", []),
        "model": row.get("model"),
        "reasoningEffort": row.get("reasoningEffort"),
    }


def numeric_values(samples: list[dict[str, Any]], key: str) -> list[float]:
    values = []
    for sample in samples:
        value = sample.get(key)
        if isinstance(value, (int, float)) and not isinstance(value, bool):
            values.append(float(value))
    return values


def aggregate_samples(samples: list[dict[str, Any]]) -> dict[str, Any]:
    rewards = numeric_values(samples, "reward")
    accuracies = numeric_values(samples, "fieldAccuracy")
    state_accuracies = numeric_values(samples, "stateCompletionAccuracy")
    service_scores = numeric_values(samples, "rq3ApplyMeanScore")
    success_count = sum(1 for sample in samples if sample.get("reward") == 1.0)
    parse_failures = sum(1 for sample in samples if sample.get("parseSuccess") is not True)
    metadata_failures = sum(1 for sample in samples if sample.get("metadataSuccess") is not True)
    validation_failures = sum(1 for sample in samples if sample.get("validationErrors"))
    reasoning_efforts = sorted(
        {
            str(sample.get("reasoningEffort"))
            for sample in samples
            if sample.get("reasoningEffort") not in (None, "")
        }
    )

    def stats(values: list[float]) -> dict[str, float | None]:
        if not values:
            return {"mean": None, "std": None, "min": None, "max": None}
        return {
            "mean": statistics.fmean(values),
            "std": statistics.pstdev(values) if len(values) > 1 else 0.0,
            "min": min(values),
            "max": max(values),
        }

    return {
        "samples": len(samples),
        "reward": stats(rewards),
        "fieldAccuracy": stats(accuracies),
        "stateCompletionAccuracy": stats(state_accuracies),
        "rq3ApplyMeanScore": stats(service_scores),
        "passAtSamples": success_count > 0,
        "perfectSamples": success_count,
        "parseFailures": parse_failures,
        "metadataFailures": metadata_failures,
        "validationFailures": validation_failures,
        "reasoningEfforts": reasoning_efforts,
    }


def build_payload(root: Path, task_ids: list[str], modes: list[str]) -> dict[str, Any]:
    tasks = []
    for task_id in task_ids:
        arms = []
        for mode in modes:
            mode_dir = root / task_id / mode
            sample_dirs = sorted(mode_dir.glob("sample-*"))
            samples = [summarize_sample(mode, sample_dir) for sample_dir in sample_dirs]
            arms.append(
                {
                    "mode": mode,
                    "samples": samples,
                    "aggregate": aggregate_samples(samples),
                }
            )
        tasks.append({"taskId": task_id, "arms": arms})
    return {"schemaVersion": 1, "root": str(root), "tasks": tasks}


def fmt_float(value: Any) -> str:
    if value is None:
        return "n/a"
    return f"{value:.3f}"


def markdown_report(payload: dict[str, Any]) -> str:
    lines = [
        "# Harbor DynamicMem Resampling Report",
        "",
        "| Task | Arm | Reasoning Effort | Samples | Reward Mean | Reward Std | Reward Min | Reward Max | Field Acc. Mean | State Acc. Mean | Service Mean | Perfect Samples | Parse Fail | Metadata Fail | Artifact Fail |",
        "| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
    ]
    for task in payload["tasks"]:
        for arm in task["arms"]:
            aggregate = arm["aggregate"]
            reward = aggregate["reward"]
            accuracy = aggregate["fieldAccuracy"]
            state_accuracy = aggregate["stateCompletionAccuracy"]
            service_score = aggregate["rq3ApplyMeanScore"]
            lines.append(
                "| {task} | {mode} | {reasoning_effort} | {samples} | {reward_mean} | {reward_std} | {reward_min} | {reward_max} | {acc_mean} | {state_mean} | {service_mean} | {perfect} | {parse_fail} | {metadata_fail} | {validation_fail} |".format(
                    task=task["taskId"],
                    mode=arm["mode"],
                    reasoning_effort=", ".join(aggregate["reasoningEfforts"]) or "n/a",
                    samples=aggregate["samples"],
                    reward_mean=fmt_float(reward["mean"]),
                    reward_std=fmt_float(reward["std"]),
                    reward_min=fmt_float(reward["min"]),
                    reward_max=fmt_float(reward["max"]),
                    acc_mean=fmt_float(accuracy["mean"]),
                    state_mean=fmt_float(state_accuracy["mean"]),
                    service_mean=fmt_float(service_score["mean"]),
                    perfect=aggregate["perfectSamples"],
                    parse_fail=aggregate["parseFailures"],
                    metadata_fail=aggregate["metadataFailures"],
                    validation_fail=aggregate["validationFailures"],
                )
            )
    lines.append("")
    return "\n".join(lines)


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Aggregate Harbor repeated samples into JSON and Markdown reports."
    )
    parser.add_argument("--root", type=Path, required=True)
    parser.add_argument("--manifest", type=Path)
    parser.add_argument("--task-id", action="append", default=[])
    parser.add_argument(
        "--modes",
        help="Comma-separated mode override. Defaults to arms listed in the manifest.",
    )
    parser.add_argument("--json-output", type=Path)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()

    manifest = load_manifest(args.manifest) if args.manifest else None
    task_ids = list(args.task_id) if args.task_id else task_ids_from_manifest(manifest or {})
    task_ids = sorted(set(task_ids))
    if not task_ids:
        task_ids = sorted(child.name for child in args.root.iterdir() if child.is_dir())
    modes = (
        [mode.strip() for mode in args.modes.split(",") if mode.strip()]
        if args.modes
        else modes_from_manifest(manifest or {})
    )
    payload = build_payload(args.root, task_ids, modes)
    report = markdown_report(payload)

    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(report, encoding="utf-8")
    else:
        print(report)
    if args.json_output:
        args.json_output.parent.mkdir(parents=True, exist_ok=True)
        args.json_output.write_text(json.dumps(payload, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
