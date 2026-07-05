#!/usr/bin/env python3
"""Aggregate repeated sensitive-policy Harbor samples."""

from __future__ import annotations

import argparse
import json
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import report_results


DEFAULT_MODES = ["context-only", "markdown", "cr-mcp"]


def resolve_runs_root(path: Path) -> Path:
    if (path / "runs").is_dir():
        return path / "runs"
    return path


def task_ids_from_root(root: Path) -> list[str]:
    return sorted(
        child.name
        for child in root.iterdir()
        if child.is_dir() and child.name.startswith("sensitive-policy-")
    )


def sample_dirs_for(root: Path, task_id: str, mode: str) -> list[Path]:
    mode_dir = root / task_id / mode
    if not mode_dir.is_dir():
        return []
    return sorted(child for child in mode_dir.iterdir() if child.is_dir() and child.name.startswith("sample-"))


def metric_payload(row: dict[str, Any], key: str) -> dict[str, Any] | None:
    policy = row.get("sensitivePolicy")
    if not isinstance(policy, dict):
        return None
    metric = policy.get(key)
    return metric if isinstance(metric, dict) else None


def metric_applicable(metric: dict[str, Any] | None) -> bool:
    return bool(metric and metric.get("applicable") is True)


def metric_hit_count(metric: dict[str, Any] | None) -> int:
    value = (metric or {}).get("hitCount")
    return value if isinstance(value, int) and not isinstance(value, bool) else 0


def metric_total(metric: dict[str, Any] | None) -> int:
    value = (metric or {}).get("total")
    return value if isinstance(value, int) and not isinstance(value, bool) else 0


def metric_rate(metric: dict[str, Any] | None) -> float:
    if not metric_applicable(metric):
        return 0.0
    total = metric_total(metric)
    return metric_hit_count(metric) / total if total else 0.0


def add_metric(summary: dict[str, Any], row: dict[str, Any], key: str) -> None:
    metric = metric_payload(row, key)
    bucket = summary[key]
    if not metric_applicable(metric):
        return
    hit_count = metric_hit_count(metric)
    total = metric_total(metric)
    bucket["applicableSamples"] += 1
    bucket["hitCount"] += hit_count
    bucket["total"] += total
    if hit_count:
        bucket["samplesWithHits"] += 1
    if total and hit_count == total:
        bucket["samplesComplete"] += 1
    hits_by_category = metric.get("hitsByCategory")
    if isinstance(hits_by_category, dict):
        for category, count in hits_by_category.items():
            if isinstance(count, int) and not isinstance(count, bool):
                bucket["hitsByCategory"][str(category)] += count


def blank_metric_summary() -> dict[str, Any]:
    return {
        "applicableSamples": 0,
        "hitCount": 0,
        "total": 0,
        "rate": None,
        "samplesWithHits": 0,
        "samplesComplete": 0,
        "hitsByCategory": defaultdict(int),
    }


def finalize_metric(metric: dict[str, Any]) -> dict[str, Any]:
    out = dict(metric)
    total = out["total"]
    out["rate"] = (out["hitCount"] / total) if total else None
    out["hitsByCategory"] = dict(sorted(out["hitsByCategory"].items()))
    return out


def is_perfect(value: Any) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool) and float(value) == 1.0


def summarize_rows(rows: list[dict[str, Any]]) -> dict[str, Any]:
    if not rows:
        return {}

    policy = rows[0].get("sensitivePolicy") or {}
    summary: dict[str, Any] = {
        "taskId": policy.get("taskId"),
        "variant": policy.get("variant"),
        "evaluationKind": policy.get("evaluationKind"),
        "mode": rows[0].get("mode"),
        "sampleCount": len(rows),
        "rewardPasses": sum(1 for row in rows if is_perfect(row.get("reward"))),
        "allowedUtilityPasses": sum(
            1 for row in rows if is_perfect(row.get("allowedUtilityAccuracy"))
        ),
        "blockedAbstentionApplicableSamples": sum(
            1 for row in rows if row.get("blockedAbstentionAccuracy") is not None
        ),
        "blockedAbstentionPasses": sum(
            1 for row in rows if is_perfect(row.get("blockedAbstentionAccuracy"))
        ),
        "parseFailureSamples": sum(1 for row in rows if row.get("parseFailures")),
        "validationFailureSamples": sum(1 for row in rows if row.get("validationErrors")),
        "policyViolationSamples": sum(1 for row in rows if row.get("policyViolationCount")),
        "missingReportMetricSamples": 0,
        "issues": [],
        "usage": {
            "inputTokens": sum_number(rows, "inputTokens"),
            "outputTokens": sum_number(rows, "outputTokens"),
            "totalTokens": sum_number(rows, "totalTokens"),
            "costUsd": sum_number(rows, "costUsd"),
            "runtimeSeconds": sum_number(rows, "runtimeSeconds"),
        },
        "durableAllowedRetention": blank_metric_summary(),
        "persistedBlockedLeakage": blank_metric_summary(),
        "blockedOutputLeakage": blank_metric_summary(),
        "attemptedBlockedWrite": blank_metric_summary(),
        "crBlockedSlugExposure": {
            "applicableSamples": 0,
            "exposedCount": 0,
            "blockedSlugCount": 0,
            "samplesWithExposure": 0,
        },
        "samples": [],
    }

    for row in rows:
        missing = report_results.missing_required_report_metrics(row)
        if missing:
            summary["missingReportMetricSamples"] += 1
            summary["issues"].append(
                {
                    "sample": row.get("sampleName"),
                    "type": "missing_report_metrics",
                    "details": missing,
                }
            )
        if row.get("validationErrors"):
            summary["issues"].append(
                {
                    "sample": row.get("sampleName"),
                    "type": "validation_errors",
                    "details": row.get("validationErrors"),
                }
            )
        add_metric(summary, row, "durableAllowedRetention")
        add_metric(summary, row, "persistedBlockedLeakage")
        add_metric(summary, row, "blockedOutputLeakage")
        add_metric(summary, row, "attemptedBlockedWrite")

        catalog = metric_payload(row, "crBlockedSlugExposure")
        if metric_applicable(catalog):
            exposed = catalog.get("exposedCount")
            blocked = catalog.get("blockedSlugCount")
            exposed_count = exposed if isinstance(exposed, int) and not isinstance(exposed, bool) else 0
            blocked_count = blocked if isinstance(blocked, int) and not isinstance(blocked, bool) else 0
            summary["crBlockedSlugExposure"]["applicableSamples"] += 1
            summary["crBlockedSlugExposure"]["exposedCount"] += exposed_count
            summary["crBlockedSlugExposure"]["blockedSlugCount"] += blocked_count
            if exposed_count:
                summary["crBlockedSlugExposure"]["samplesWithExposure"] += 1

        summary["samples"].append(
            {
                "sample": row.get("sampleName"),
                "trialDir": row.get("trialDir"),
                "artifactRoot": row.get("artifactRoot"),
                "reward": row.get("reward"),
                "allowedUtilityAccuracy": row.get("allowedUtilityAccuracy"),
                "blockedAbstentionAccuracy": row.get("blockedAbstentionAccuracy"),
                "persistedBlockedLeakageRate": metric_rate(
                    metric_payload(row, "persistedBlockedLeakage")
                ),
                "persistedBlockedLeakageCount": metric_hit_count(
                    metric_payload(row, "persistedBlockedLeakage")
                ),
                "totalTokens": row.get("totalTokens"),
                "costUsd": row.get("costUsd"),
            }
        )

    for key in (
        "durableAllowedRetention",
        "persistedBlockedLeakage",
        "blockedOutputLeakage",
        "attemptedBlockedWrite",
    ):
        summary[key] = finalize_metric(summary[key])

    catalog = summary["crBlockedSlugExposure"]
    blocked_total = catalog["blockedSlugCount"]
    catalog["rate"] = (
        catalog["exposedCount"] / blocked_total if blocked_total else None
    )
    return summary


def sum_number(rows: list[dict[str, Any]], key: str) -> float | int | None:
    values = [
        row.get(key)
        for row in rows
        if isinstance(row.get(key), (int, float)) and not isinstance(row.get(key), bool)
    ]
    if not values:
        return None
    return sum(values)


def collect_rows(root: Path, task_ids: list[str], modes: list[str]) -> tuple[dict[tuple[str, str], list[dict[str, Any]]], list[dict[str, Any]]]:
    rows_by_key: dict[tuple[str, str], list[dict[str, Any]]] = {}
    failures: list[dict[str, Any]] = []
    for task_id in task_ids:
        for mode in modes:
            sample_dirs = sample_dirs_for(root, task_id, mode)
            if not sample_dirs:
                failures.append(
                    {
                        "taskId": task_id,
                        "mode": mode,
                        "sample": None,
                        "error": f"missing sample directories under {root / task_id / mode}",
                    }
                )
                continue
            for sample_dir in sample_dirs:
                try:
                    row = report_results.summarize_run(mode, sample_dir)
                except Exception as error:  # noqa: BLE001 - report all malformed samples.
                    failures.append(
                        {
                            "taskId": task_id,
                            "mode": mode,
                            "sample": sample_dir.name,
                            "path": str(sample_dir),
                            "error": str(error),
                        }
                    )
                    continue
                row["sampleName"] = sample_dir.name
                rows_by_key.setdefault((task_id, mode), []).append(row)
    return rows_by_key, failures


def compare_markdown_cr(rows_by_key: dict[tuple[str, str], list[dict[str, Any]]], task_ids: list[str]) -> list[dict[str, Any]]:
    comparisons: list[dict[str, Any]] = []
    for task_id in task_ids:
        markdown_rows = {
            row.get("sampleName"): row
            for row in rows_by_key.get((task_id, "markdown"), [])
            if row.get("sampleName")
        }
        cr_rows = {
            row.get("sampleName"): row
            for row in rows_by_key.get((task_id, "cr-mcp"), [])
            if row.get("sampleName")
        }
        sample_names = sorted(set(markdown_rows) & set(cr_rows))
        if not sample_names:
            continue

        markdown_hits = 0
        markdown_total = 0
        markdown_samples_with_leakage = 0
        cr_hits = 0
        cr_total = 0
        cr_samples_with_leakage = 0
        pair_rows = []
        variant = None
        evaluation_kind = None
        for sample_name in sample_names:
            markdown = markdown_rows[sample_name]
            cr_mcp = cr_rows[sample_name]
            markdown_metric = metric_payload(markdown, "persistedBlockedLeakage")
            cr_metric = metric_payload(cr_mcp, "persistedBlockedLeakage")
            markdown_hit_count = metric_hit_count(markdown_metric)
            markdown_total_count = metric_total(markdown_metric)
            cr_hit_count = metric_hit_count(cr_metric)
            cr_total_count = metric_total(cr_metric)
            markdown_hits += markdown_hit_count
            markdown_total += markdown_total_count
            cr_hits += cr_hit_count
            cr_total += cr_total_count
            if markdown_hit_count:
                markdown_samples_with_leakage += 1
            if cr_hit_count:
                cr_samples_with_leakage += 1
            markdown_policy = markdown.get("sensitivePolicy") or {}
            cr_policy = cr_mcp.get("sensitivePolicy") or {}
            variant = variant or markdown_policy.get("variant") or cr_policy.get("variant")
            evaluation_kind = (
                evaluation_kind
                or markdown_policy.get("evaluationKind")
                or cr_policy.get("evaluationKind")
            )
            pair_rows.append(
                {
                    "sample": sample_name,
                    "markdownRate": metric_rate(markdown_metric),
                    "crRate": metric_rate(cr_metric),
                    "accessReductionVsMarkdown": metric_rate(markdown_metric)
                    - metric_rate(cr_metric),
                }
            )

        markdown_rate = markdown_hits / markdown_total if markdown_total else None
        cr_rate = cr_hits / cr_total if cr_total else None
        comparisons.append(
            {
                "taskId": task_id,
                "variant": variant,
                "evaluationKind": evaluation_kind,
                "samplePairs": len(sample_names),
                "markdownBlockedLeakage": {
                    "hitCount": markdown_hits,
                    "total": markdown_total,
                    "rate": markdown_rate,
                    "samplesWithLeakage": markdown_samples_with_leakage,
                },
                "crBlockedLeakage": {
                    "hitCount": cr_hits,
                    "total": cr_total,
                    "rate": cr_rate,
                    "samplesWithLeakage": cr_samples_with_leakage,
                },
                "accessReductionVsMarkdown": (
                    markdown_rate - cr_rate
                    if markdown_rate is not None and cr_rate is not None
                    else None
                ),
                "samples": pair_rows,
            }
        )
    return comparisons


def fmt_rate(metric: dict[str, Any] | None, *, include_samples: bool = False) -> str:
    if not metric or not metric.get("applicableSamples"):
        return "n/a"
    rate = metric.get("rate")
    rate_text = "n/a" if rate is None else f"{rate:.3f}"
    text = f"{metric['hitCount']}/{metric['total']} ({rate_text})"
    if include_samples:
        text += f"; {metric['samplesWithHits']}/{metric['applicableSamples']} samples"
    return text


def fmt_fraction(numerator: int, denominator: int) -> str:
    if denominator == 0:
        return "n/a"
    return f"{numerator}/{denominator} ({numerator / denominator:.3f})"


def fmt_cost(value: Any) -> str:
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        return f"${value:.4f}"
    return "n/a"


def fmt_number(value: Any) -> str:
    if isinstance(value, int) and not isinstance(value, bool):
        return str(value)
    if isinstance(value, float) and not isinstance(value, bool):
        return f"{value:.3f}"
    return "n/a"


def markdown_report(payload: dict[str, Any]) -> str:
    lines = [
        "# Sensitive Policy Resample Report",
        "",
        f"- Generated: `{payload['generatedAt']}`",
        f"- Runs root: `{payload['runsRoot']}`",
        f"- Task IDs: `{', '.join(payload['taskIds'])}`",
        f"- Modes: `{', '.join(payload['modes'])}`",
        "",
        "## Arm Summary",
        "",
        "| Task | Evaluation / Variant | Mode | Samples | Reward | Allowed Utility | Blocked Abstention | Durable Allowed Retention | Persisted Blocked Leakage | Blocked Output Leakage | Attempted Blocked Write | CR Blocked Slug Exposure | Total Tokens | Cost | Issues |",
        "| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
    ]
    for row in payload["arms"]:
        catalog = row["crBlockedSlugExposure"]
        if catalog["applicableSamples"]:
            catalog_rate = catalog["rate"]
            catalog_text = (
                f"{catalog['exposedCount']}/{catalog['blockedSlugCount']} "
                f"({catalog_rate:.3f}); "
                f"{catalog['samplesWithExposure']}/{catalog['applicableSamples']} samples"
            )
        else:
            catalog_text = "n/a"
        issues = (
            row["parseFailureSamples"]
            + row["validationFailureSamples"]
            + row["policyViolationSamples"]
            + row["missingReportMetricSamples"]
            + len(row["issues"])
        )
        lines.append(
            "| {task} | {variant} | {mode} | {samples} | {reward} | {allowed} | {blocked_abstention} | {durable} | {persisted} | {output} | {attempted} | {catalog} | {tokens} | {cost} | {issues} |".format(
                task=row["taskId"],
                variant=(
                    (row.get("evaluationKind") or "n/a")
                    + " / "
                    + (row.get("variant") or "n/a")
                ),
                mode=row["mode"],
                samples=row["sampleCount"],
                reward=fmt_fraction(row["rewardPasses"], row["sampleCount"]),
                allowed=fmt_fraction(row["allowedUtilityPasses"], row["sampleCount"]),
                blocked_abstention=fmt_fraction(
                    row["blockedAbstentionPasses"],
                    row["blockedAbstentionApplicableSamples"],
                ),
                durable=fmt_rate(row["durableAllowedRetention"]),
                persisted=fmt_rate(row["persistedBlockedLeakage"], include_samples=True),
                output=fmt_rate(row["blockedOutputLeakage"], include_samples=True),
                attempted=fmt_rate(row["attemptedBlockedWrite"], include_samples=True),
                catalog=catalog_text,
                tokens=fmt_number(row["usage"]["totalTokens"]),
                cost=fmt_cost(row["usage"]["costUsd"]),
                issues=issues,
            )
        )

    lines.extend(
        [
            "",
            "## Markdown vs CR",
            "",
            "| Task | Evaluation / Variant | Sample Pairs | Markdown Blocked Leakage | CR Blocked Leakage | Access Reduction vs Markdown |",
            "| --- | --- | ---: | ---: | ---: | ---: |",
        ]
    )
    for item in payload["comparisons"]:
        markdown = item["markdownBlockedLeakage"]
        cr = item["crBlockedLeakage"]
        delta = item.get("accessReductionVsMarkdown")
        delta_text = "n/a" if delta is None else f"{delta:.3f}"
        markdown_text = (
            f"{markdown['hitCount']}/{markdown['total']} "
            f"({markdown['rate']:.3f}); "
            f"{markdown['samplesWithLeakage']}/{item['samplePairs']} samples"
        )
        cr_text = (
            f"{cr['hitCount']}/{cr['total']} "
            f"({cr['rate']:.3f}); "
            f"{cr['samplesWithLeakage']}/{item['samplePairs']} samples"
        )
        lines.append(
            f"| {item['taskId']} | "
            f"{(item.get('evaluationKind') or 'n/a') + ' / ' + (item.get('variant') or 'n/a')} | "
            f"{item['samplePairs']} | {markdown_text} | {cr_text} | {delta_text} |"
        )

    lines.extend(
        [
            "",
            "## Notes",
            "",
            "- This report evaluates durable memory storage boundaries, not a definitive downstream Do Not Use claim.",
            "- `context-only` has no durable memory surface, so durable retention/leakage metrics are not applicable there.",
            "- Prefer counts and samples-with-leakage over a single mean when citing this result.",
        ]
    )

    if payload["failures"] or any(row["issues"] for row in payload["arms"]):
        lines.extend(["", "## Issues", ""])
        for failure in payload["failures"]:
            lines.append(f"- Load failure: `{json.dumps(failure, sort_keys=True)}`")
        for row in payload["arms"]:
            for issue in row["issues"]:
                lines.append(
                    f"- {row['taskId']} / {row['mode']}: `{json.dumps(issue, sort_keys=True)}`"
                )
    return "\n".join(lines) + "\n"


def build_payload(root: Path, task_ids: list[str], modes: list[str]) -> dict[str, Any]:
    rows_by_key, failures = collect_rows(root, task_ids, modes)
    arms = []
    for task_id in task_ids:
        for mode in modes:
            rows = rows_by_key.get((task_id, mode), [])
            if rows:
                arms.append(summarize_rows(rows))
    return {
        "generatedAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "runsRoot": str(root),
        "taskIds": task_ids,
        "modes": modes,
        "arms": arms,
        "comparisons": compare_markdown_cr(rows_by_key, task_ids),
        "failures": failures,
    }


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Aggregate sensitive-policy Harbor resamples into Markdown and JSON."
    )
    parser.add_argument("--root", type=Path, required=True, help="Run root or run-root/runs directory.")
    parser.add_argument("--task-id", action="append", default=[])
    parser.add_argument(
        "--modes",
        default=",".join(DEFAULT_MODES),
        help="Comma-separated modes to aggregate.",
    )
    parser.add_argument("--output", type=Path)
    parser.add_argument("--json-output", type=Path)
    args = parser.parse_args()

    root = resolve_runs_root(args.root.expanduser()).resolve()
    if not root.is_dir():
        raise SystemExit(f"missing runs root: {root}")
    task_ids = sorted(set(args.task_id)) if args.task_id else task_ids_from_root(root)
    if not task_ids:
        raise SystemExit(f"no sensitive-policy task directories found under {root}")
    modes = [mode.strip() for mode in args.modes.split(",") if mode.strip()]
    if not modes:
        raise SystemExit("at least one mode is required")

    payload = build_payload(root, task_ids, modes)
    report = markdown_report(payload)

    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(report, encoding="utf-8")
    else:
        print(report, end="")
    if args.json_output:
        args.json_output.parent.mkdir(parents=True, exist_ok=True)
        args.json_output.write_text(
            json.dumps(payload, indent=2, sort_keys=True) + "\n",
            encoding="utf-8",
        )
    if payload["failures"]:
        raise SystemExit(1)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
