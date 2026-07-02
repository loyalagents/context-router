#!/usr/bin/env python3
"""Official preflight/policy checks for eval-harbor tasks, jobs, and runs."""

from __future__ import annotations

import argparse
import json
import os
import re
from pathlib import Path
from typing import Any

from report_results import (
    command_policy_violations,
    find_trial_dir,
    load_json,
    memory_policy_violations,
    read_codex_trace,
    read_stage_log,
    run_policy_violations,
    summarize_run,
    expected_stage_sequence_from_config,
)
from validate_task_soundness import (
    native_raw_log_items,
    staged_payload,
    validate_task,
)


DOWNSTREAM_KIND = "downstream-task"
STAGE_LOG_PATH = Path("artifacts/app/stage-log.jsonl")


def normalize_app_logs(payload: Any) -> list[dict[str, Any]]:
    logs = payload if isinstance(payload, list) else payload.get("app_logs", [])
    logs = [log for log in logs if isinstance(log, dict)]
    return sorted(
        logs,
        key=lambda log: (
            str(log.get("timestamp", "")),
            str(log.get("app_log_id", "")),
        ),
    )


def observed_logs_for_checkpoint(
    checkpoint: dict[str, Any],
    app_logs: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    as_of = checkpoint.get("as_of") or {}
    index = as_of.get("log_index")
    if isinstance(index, int) and 0 <= index < len(app_logs):
        return app_logs[: index + 1]
    timestamp = str(as_of.get("timestamp") or "")
    if timestamp:
        return [log for log in app_logs if str(log.get("timestamp") or "") <= timestamp]
    return []


def load_json_if_exists(path: Path) -> Any | None:
    if not path.exists():
        return None
    return load_json(path)


def resolve_source_dir(
    raw_source_dir: str,
    repo_root: Path,
    source_roots: list[Path],
) -> Path | None:
    candidates = [Path(raw_source_dir).expanduser()]
    if not candidates[0].is_absolute():
        candidates.append(repo_root / raw_source_dir)
        candidates.extend(source_root / raw_source_dir for source_root in source_roots)
    for candidate in candidates:
        if candidate.exists():
            return candidate
    return None


def task_stage_contract_errors(task_dir: Path) -> list[str]:
    payload = staged_payload(task_dir)
    if payload is None:
        return []

    errors: list[str] = []
    stages = payload.get("stages")
    if not isinstance(stages, list) or not stages:
        return [f"{task_dir.name}: staged payload must contain nonempty stages"]

    seen_ids: set[str] = set()
    actual_kinds: list[str] = []
    for expected_index, stage in enumerate(stages, start=1):
        if not isinstance(stage, dict):
            errors.append(f"{task_dir.name}: stage {expected_index} is not an object")
            continue
        actual_kinds.append(str(stage.get("kind") or ""))
        stage_id = str(stage.get("stageId") or "")
        if stage_id in seen_ids:
            errors.append(f"{task_dir.name}: duplicate stageId {stage_id}")
        seen_ids.add(stage_id)
        if stage.get("stageIndex") != expected_index:
            errors.append(
                f"{task_dir.name}: {stage_id or expected_index} stageIndex "
                f"must be {expected_index}"
            )
        paths = [
            item.get("path")
            for item in stage.get("files", [])
            if isinstance(item, dict)
        ]
        if stage.get("kind") == DOWNSTREAM_KIND:
            if any(isinstance(path, str) and path.startswith("docs/") for path in paths):
                errors.append(f"{task_dir.name}: downstream stage {stage_id} exposes docs/")
            if "documents.json" in paths:
                errors.append(
                    f"{task_dir.name}: downstream stage {stage_id} exposes documents.json"
                )

    difficulty = load_json_if_exists(task_dir / "tests" / "expected" / "difficulty.json")
    expected_pattern = difficulty.get("stagePattern") if isinstance(difficulty, dict) else None
    if isinstance(expected_pattern, str) and expected_pattern:
        actual_pattern = " -> ".join(actual_kinds)
        if actual_pattern != expected_pattern:
            errors.append(
                f"{task_dir.name}: stage pattern mismatch "
                f"expected={expected_pattern!r} actual={actual_pattern!r}"
            )
    return errors


def dynamicmem_reconstruction_errors(
    task_dir: Path,
    repo_root: Path,
    source_roots: list[Path],
) -> list[str]:
    payload = staged_payload(task_dir)
    if payload is None:
        return []
    benchmark = load_json_if_exists(task_dir / "tests" / "expected" / "benchmark.json")
    difficulty = load_json_if_exists(task_dir / "tests" / "expected" / "difficulty.json")
    if not isinstance(benchmark, dict) or not isinstance(difficulty, dict):
        return []
    if (payload.get("source") or {}).get("dataset") != "xiewenya/dynamicmem":
        return []

    raw_source_dir = (
        (payload.get("source") or {}).get("userDir")
        or (difficulty.get("trajectory") or {}).get("sourceUserDir")
    )
    if not isinstance(raw_source_dir, str) or not raw_source_dir:
        return [f"{task_dir.name}: DynamicMem source userDir missing"]

    source_dir = resolve_source_dir(raw_source_dir, repo_root, source_roots)
    if source_dir is None:
        return [
            f"{task_dir.name}: cannot verify DynamicMem log reconstruction; "
            f"source dir not found: {raw_source_dir}; pass --dynamicmem-source-root"
        ]

    app_log_path = source_dir / "app_log_large.json"
    task_packs_path = source_dir / "task_packs.json"
    if not app_log_path.exists() or not task_packs_path.exists():
        return [
            f"{task_dir.name}: source dir missing app_log_large.json or task_packs.json"
        ]

    app_logs = normalize_app_logs(load_json(app_log_path))
    task_packs = load_json(task_packs_path)
    checkpoints = task_packs.get("checkpoints")
    if not isinstance(checkpoints, list):
        return [f"{task_dir.name}: source task_packs checkpoints missing"]

    final_checkpoint_id = (difficulty.get("trajectory") or {}).get("finalCheckpointId")
    final_checkpoint = next(
        (
            checkpoint
            for checkpoint in checkpoints
            if checkpoint.get("checkpoint_id") == final_checkpoint_id
        ),
        None,
    )
    if final_checkpoint is None:
        hidden_checkpoints = benchmark.get("checkpoints") or []
        final_checkpoint = hidden_checkpoints[-1] if hidden_checkpoints else None
    if not isinstance(final_checkpoint, dict):
        return [f"{task_dir.name}: cannot identify final DynamicMem checkpoint"]

    expected_logs = observed_logs_for_checkpoint(final_checkpoint, app_logs)
    actual_logs = native_raw_log_items(payload)
    if actual_logs == expected_logs:
        return []

    expected_ids = [str(log.get("app_log_id") or "") for log in expected_logs]
    actual_ids = [str(log.get("app_log_id") or "") for log in actual_logs]
    if actual_ids != expected_ids:
        return [
            f"{task_dir.name}: staged logs do not reconstruct original DynamicMem "
            f"prefix ids expected_count={len(expected_ids)} actual_count={len(actual_ids)} "
            f"first_expected={expected_ids[:5]} first_actual={actual_ids[:5]}"
        ]

    for index, (actual, expected) in enumerate(zip(actual_logs, expected_logs)):
        if actual != expected:
            return [
                f"{task_dir.name}: staged log content mismatch at index {index} "
                f"app_log_id={actual_ids[index]}"
            ]
    return [f"{task_dir.name}: staged log reconstruction mismatch"]


def validate_task_preflight(
    task_dir: Path,
    repo_root: Path,
    source_roots: list[Path],
) -> list[str]:
    errors = validate_task(task_dir, repo_root)
    errors.extend(task_stage_contract_errors(task_dir))
    errors.extend(dynamicmem_reconstruction_errors(task_dir, repo_root, source_roots))
    return errors


def extract_job_task_paths(job_path: Path) -> list[Path]:
    task_paths: list[Path] = []
    text = job_path.read_text(encoding="utf-8")
    in_tasks = False
    for raw_line in text.splitlines():
        line = raw_line.rstrip()
        if re.match(r"^tasks:\s*$", line):
            in_tasks = True
            continue
        if in_tasks and line and not line.startswith(" "):
            in_tasks = False
        if not in_tasks:
            continue
        match = re.match(r"^\s*-\s*path:\s*(.+?)\s*$", line)
        if match:
            task_paths.append(Path(match.group(1).strip().strip('"').strip("'")))
    return task_paths


def validate_job_preflight(job_path: Path, repo_root: Path) -> list[str]:
    errors: list[str] = []
    text = job_path.read_text(encoding="utf-8")
    if not re.search(r"^\s*web_search:\s*disabled\s*$", text, re.MULTILINE):
        errors.append(f"{job_path}: Codex job must set web_search: disabled")
    compact_match = re.search(
        r"^\s*model_auto_compact_token_limit:\s*(\d+)\s*$",
        text,
        re.MULTILINE,
    )
    if not compact_match:
        errors.append(f"{job_path}: Codex job must set model_auto_compact_token_limit")
    elif int(compact_match.group(1)) <= 0:
        errors.append(f"{job_path}: model_auto_compact_token_limit must be positive")

    task_paths = extract_job_task_paths(job_path)
    if not task_paths:
        errors.append(f"{job_path}: no task path found")
    for task_path in task_paths:
        resolved = task_path if task_path.is_absolute() else repo_root / task_path
        if not resolved.exists():
            errors.append(f"{job_path}: task path does not exist: {task_path}")
    return errors


def command_durable_write_violations(
    mode: str,
    commands: list[dict[str, str]],
) -> list[dict[str, Any]]:
    changes: list[dict[str, str]] = []
    for command in commands:
        raw = command["command"]
        paths: list[str] = []
        paths.extend(re.findall(r">>\s*(/app/[^\s'\";]+)", raw))
        paths.extend(re.findall(r">\s*(/app/[^\s'\";]+)", raw))
        paths.extend(
            re.findall(
                r"\b(?:tee|touch|mkdir|cp|mv)\b[^\n;&|]*\s(/app/[^\s'\";]+)",
                raw,
            )
        )
        for path in paths:
            changes.append(
                {
                    "tracePath": command.get("tracePath", ""),
                    "path": path,
                    "kind": "command-write",
                }
            )
    return memory_policy_violations(mode, changes)


def validate_run_preflight(mode: str, run_path: Path) -> list[str]:
    errors: list[str] = []
    summary = summarize_run(mode, run_path)
    errors.extend(summary.get("validationErrors") or [])

    trial_dir = find_trial_dir(run_path)
    config = load_json(trial_dir / "config.json")
    score_artifact_root = Path(summary.get("artifactRoot") or trial_dir / "artifacts")
    stage_log_path = score_artifact_root / STAGE_LOG_PATH.relative_to("artifacts")
    stage_log = read_stage_log(stage_log_path)
    expected_sequence = expected_stage_sequence_from_config(config)
    codex_trace = read_codex_trace(trial_dir)

    violations = run_policy_violations(
        mode=mode,
        codex_trace=codex_trace,
        stage_log=stage_log,
        expected_stage_sequence=expected_sequence,
    )
    violations.extend(command_policy_violations(codex_trace["commands"]))
    violations.extend(command_durable_write_violations(mode, codex_trace["commands"]))
    for violation in violations:
        rendered = json.dumps(violation, sort_keys=True)
        if f"policy violation: {rendered}" not in errors:
            errors.append(f"policy violation: {rendered}")
    return errors


def parse_run_spec(value: str) -> tuple[str, Path]:
    if "=" not in value:
        raise argparse.ArgumentTypeError("run must use MODE=PATH")
    mode, raw_path = value.split("=", 1)
    path = Path(raw_path).expanduser()
    if not path.exists():
        raise argparse.ArgumentTypeError(f"run path does not exist: {path}")
    return mode, path


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Validate eval-harbor task/job/run soundness before paper experiments."
    )
    parser.add_argument("--task", action="append", type=Path, default=[])
    parser.add_argument("--job", action="append", type=Path, default=[])
    parser.add_argument("--run", action="append", type=parse_run_spec, default=[])
    parser.add_argument("--repo-root", type=Path, default=Path("."))
    parser.add_argument(
        "--dynamicmem-source-root",
        action="append",
        type=Path,
        default=[],
        help="Root containing DynamicMem user dirs such as 004_user_004.",
    )
    args = parser.parse_args()

    repo_root = args.repo_root.resolve()
    source_roots = [path.expanduser().resolve() for path in args.dynamicmem_source_root]
    env_source_root = os.environ.get("DYNAMICMEM_SOURCE_ROOT")
    if env_source_root:
        source_roots.append(Path(env_source_root).expanduser().resolve())
    all_errors: list[str] = []

    for task in args.task:
        task_path = task if task.is_absolute() else repo_root / task
        errors = validate_task_preflight(task_path, repo_root, source_roots)
        if errors:
            all_errors.extend(errors)
        else:
            print(f"OK task {task_path}")

    for job in args.job:
        job_path = job if job.is_absolute() else repo_root / job
        errors = validate_job_preflight(job_path, repo_root)
        if errors:
            all_errors.extend(errors)
        else:
            print(f"OK job {job_path}")

    for mode, run_path in args.run:
        errors = validate_run_preflight(mode, run_path)
        if errors:
            all_errors.extend(f"{mode} {run_path}: {error}" for error in errors)
        else:
            print(f"OK run {mode}={run_path}")

    if all_errors:
        for error in all_errors:
            print(f"ERROR {error}")
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
