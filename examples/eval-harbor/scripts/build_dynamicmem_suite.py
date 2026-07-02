#!/usr/bin/env python3
"""Generate Harbor tasks from native DynamicMem user checkpoints."""

from __future__ import annotations

import argparse
import importlib
import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Sequence

from dataset_sources import SourceResolution, resolve_dynamicmem_source_root
from validate_eval_preflight import validate_job_preflight, validate_task_preflight

from trajectory_framework import (
    PATTERN_UPDATE_ANSWER_EVERY_CHECKPOINT,
    STAGE_PATTERNS,
    parse_stage_schedule,
    stage_pattern_suffix,
    stage_schedule_label,
    stage_schedule_suffix,
)


DEFAULT_MODEL = "gpt-5.4-mini"
DEFAULT_REASONING_EFFORT = "high"
DEFAULT_CODEX_WEB_SEARCH = "disabled"
DEFAULT_CODEX_AUTO_COMPACT_TOKEN_LIMIT = 256000
DEFAULT_AGENT_TIMEOUT_SEC = 86400.0
DEFAULT_VERIFIER_TIMEOUT_SEC = 86400.0
DEFAULT_BUILD_TIMEOUT_SEC = 600.0
REASONING_EFFORT_CHOICES = {"low", "medium", "high", "xhigh"}
CODEX_WEB_SEARCH_CHOICES = {"disabled", "cached", "live"}
DEFAULT_ARM_CONFIG_PATH = Path("examples/eval-harbor/arms/dynamicmem-default.json")


@dataclass(frozen=True)
class TaskPlan:
    task_id: str
    corpus_id: str
    source_user_dir: str
    source_user_id: str
    checkpoint_indices: list[int]
    checkpoint_ids: list[str]
    checkpoint_timestamps: list[str]
    stage_pattern: str
    stage_schedule: list[str] | None
    stage_schedule_display: str
    scored_checkpoint_ids: list[str]
    observed_log_count: int
    state_completion_key_count: int
    unique_state_completion_key_count: int
    personalized_service_key_count: int
    personalized_service_item_count: int
    service_families: list[str]


def load_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def load_arm_configs(path: Path) -> list[dict[str, Any]]:
    builder = importlib.import_module("build_dynamicmem_task")
    return builder.load_arm_configs(path)


def user_dirs(source_root: Path) -> list[Path]:
    if (
        (source_root / "app_log_large.json").exists()
        and (source_root / "task_packs.json").exists()
    ):
        return [source_root]
    return sorted(
        child
        for child in source_root.iterdir()
        if child.is_dir()
        and (child / "app_log_large.json").exists()
        and (child / "task_packs.json").exists()
    )


def source_roots_for_preflight(source_root: Path) -> list[Path]:
    if (
        (source_root / "app_log_large.json").exists()
        and (source_root / "task_packs.json").exists()
    ):
        return [source_root.resolve(), source_root.parent.resolve()]
    return [source_root.resolve()]


def parse_source_users(value: str | None) -> set[str]:
    if not value:
        return set()
    return {part.strip() for part in value.split(",") if part.strip()}


def source_user_matches(source_dir: Path, allowed_users: set[str]) -> bool:
    if not allowed_users:
        return True
    task_packs = load_json(source_dir / "task_packs.json")
    source_user_id = str(task_packs.get("user_id") or "")
    compact = compact_user_label(source_user_id)
    return bool({source_dir.name, source_user_id, compact} & allowed_users)


def compact_user_label(user_id: str) -> str:
    return user_id.replace("_", "")


def checkpoint_timestamp(checkpoint: dict[str, Any]) -> str:
    as_of = checkpoint.get("as_of")
    if isinstance(as_of, dict):
        return str(as_of.get("timestamp") or "")
    return ""


def checkpoint_label(indices: list[int]) -> str:
    if not indices:
        return "cp-none"
    if indices == list(range(indices[0], indices[-1] + 1)):
        return f"cp{indices[0]:02d}-{indices[-1]:02d}"
    return "cp" + "-".join(f"{index:02d}" for index in indices)


def observed_log_count(checkpoint: dict[str, Any], app_logs: list[dict[str, Any]]) -> int:
    builder = importlib.import_module("build_dynamicmem_task")
    return len(builder.observed_logs_for_checkpoint(checkpoint, builder.normalize_app_logs(app_logs)))


def apply_counts(checkpoint: dict[str, Any]) -> tuple[int, int, list[str]]:
    keys = ((checkpoint.get("rq3_apply_service_qa") or {}).get("keys") or {})
    item_count = 0
    families: set[str] = set()
    for node in keys.values():
        if not isinstance(node, dict):
            continue
        for item in node.get("items") or []:
            if isinstance(item, dict):
                item_count += 1
                family = str(item.get("service_family") or "")
                if family:
                    families.add(family)
    return len(keys), item_count, sorted(families)


def stage_contract_suffix(stage_pattern: str, stage_schedule: tuple[str, ...] | None) -> str:
    return stage_schedule_suffix(stage_schedule) if stage_schedule is not None else stage_pattern_suffix(stage_pattern)


def stage_contract_display(stage_pattern: str, stage_schedule: tuple[str, ...] | None) -> str:
    return stage_schedule_label(stage_schedule) if stage_schedule is not None else stage_pattern


def plan_user_tasks(
    source_dir: Path,
    *,
    checkpoint_indices: list[int],
    stage_pattern: str,
    stage_schedule: tuple[str, ...] | None = None,
) -> list[TaskPlan]:
    app_logs = load_json(source_dir / "app_log_large.json")
    task_packs = load_json(source_dir / "task_packs.json")
    checkpoints = task_packs["checkpoints"]
    source_user_id = task_packs["user_id"]
    source_user_dir = source_dir.name
    user_label = compact_user_label(source_user_id)
    selected_indices = []
    selected_checkpoints = []
    if stage_schedule is None and stage_pattern not in STAGE_PATTERNS:
        raise ValueError(f"unsupported stage pattern: {stage_pattern}")

    for index in checkpoint_indices:
        if index < 0 or index >= len(checkpoints):
            continue
        checkpoint = checkpoints[index]
        scp_keys = ((checkpoint.get("state_completion_pack") or {}).get("keys") or {})
        rq_key_count, rq_item_count, service_families = apply_counts(checkpoint)
        if not scp_keys or not rq_item_count:
            continue
        selected_indices.append(index)
        selected_checkpoints.append(checkpoint)

    if not selected_indices:
        return []

    builder = importlib.import_module("build_dynamicmem_task")
    stage_specs = [
        {"checkpointIndex": index, "checkpoint": checkpoint}
        for index, checkpoint in zip(selected_indices, selected_checkpoints)
    ]
    stage_plan = builder.resolve_stage_plan(
        stage_specs,
        builder.BuildConfig(
            task_id="suite-plan",
            corpus_id="suite-plan-corpus",
            source_user_dir=source_user_dir,
            source_user_id=source_user_id,
            checkpoint_indices=tuple(selected_indices),
            stage_pattern=stage_pattern,
            stage_schedule=stage_schedule,
        ),
    )
    scored_checkpoints = [item.spec["checkpoint"] for item in stage_plan if item.scores_checkpoint]
    state_keys_seen: set[str] = set()
    state_key_count = 0
    rq_key_count_total = 0
    rq_item_count_total = 0
    service_families_seen: set[str] = set()
    for checkpoint in scored_checkpoints:
        scp_keys = ((checkpoint.get("state_completion_pack") or {}).get("keys") or {})
        rq_key_count, rq_item_count, service_families = apply_counts(checkpoint)
        state_key_count += len(scp_keys)
        state_keys_seen.update(str(key) for key in scp_keys)
        rq_key_count_total += rq_key_count
        rq_item_count_total += rq_item_count
        service_families_seen.update(service_families)

    task_id = f"dynamicmem-{user_label}-{checkpoint_label(selected_indices)}-{stage_contract_suffix(stage_pattern, stage_schedule)}"
    return [
        TaskPlan(
            task_id=task_id,
            corpus_id=f"{task_id}-corpus",
            source_user_dir=source_user_dir,
            source_user_id=source_user_id,
            checkpoint_indices=selected_indices,
            checkpoint_ids=[str(checkpoint.get("checkpoint_id") or "") for checkpoint in selected_checkpoints],
            checkpoint_timestamps=[checkpoint_timestamp(checkpoint) for checkpoint in selected_checkpoints],
            stage_pattern=stage_pattern,
            stage_schedule=list(stage_schedule) if stage_schedule is not None else None,
            stage_schedule_display=stage_contract_display(stage_pattern, stage_schedule),
            scored_checkpoint_ids=[str(checkpoint.get("checkpoint_id") or "") for checkpoint in scored_checkpoints],
            observed_log_count=observed_log_count(selected_checkpoints[-1], app_logs),
            state_completion_key_count=state_key_count,
            unique_state_completion_key_count=len(state_keys_seen),
            personalized_service_key_count=rq_key_count_total,
            personalized_service_item_count=rq_item_count_total,
            service_families=sorted(service_families_seen),
        )
    ]


def number_stats(values: list[int]) -> dict[str, Any]:
    if not values:
        return {"min": 0, "max": 0, "mean": 0.0}
    return {"min": min(values), "max": max(values), "mean": sum(values) / len(values)}


def suite_coverage(plans: list[TaskPlan]) -> dict[str, Any]:
    return {
        "taskCount": len(plans),
        "userCount": len({plan.source_user_id for plan in plans}),
        "sourceUserIds": sorted({plan.source_user_id for plan in plans}),
        "checkpointIndices": sorted({index for plan in plans for index in plan.checkpoint_indices}),
        "checkpointIds": sorted({checkpoint_id for plan in plans for checkpoint_id in plan.checkpoint_ids if checkpoint_id}),
        "checkpointsPerTask": number_stats([len(plan.checkpoint_indices) for plan in plans]),
        "serviceFamilies": sorted({family for plan in plans for family in plan.service_families}),
        "observedLogsPerTask": number_stats([plan.observed_log_count for plan in plans]),
        "stateCompletionKeysPerTask": number_stats([plan.state_completion_key_count for plan in plans]),
        "uniqueStateCompletionKeysPerTask": number_stats([plan.unique_state_completion_key_count for plan in plans]),
        "personalizedServiceItemsPerTask": number_stats([plan.personalized_service_item_count for plan in plans]),
    }


def read_task_difficulty(tasks_root: Path, task_id: str) -> dict[str, Any] | None:
    path = tasks_root / task_id / "tests" / "expected" / "difficulty.json"
    if not path.exists():
        return None
    return load_json(path)


def generate_task(
    plan: TaskPlan,
    source_dir: Path,
    *,
    tasks_root: Path,
    jobs_root: Path,
    model_name: str,
    reasoning_effort: str,
    codex_web_search: str,
    codex_auto_compact_token_limit: int,
    agent_timeout_sec: float,
    verifier_timeout_sec: float,
    build_timeout_sec: float,
    arm_configs: list[dict[str, Any]],
) -> None:
    builder = importlib.import_module("build_dynamicmem_task")
    builder.build_task(
        source_dir,
        tasks_root / plan.task_id,
        jobs_root,
        arm_configs=arm_configs,
        config=builder.BuildConfig(
            task_id=plan.task_id,
            corpus_id=plan.corpus_id,
            source_user_dir=plan.source_user_dir,
            source_user_id=plan.source_user_id,
            checkpoint_indices=tuple(plan.checkpoint_indices),
            model_name=model_name,
            reasoning_effort=reasoning_effort,
            codex_web_search=codex_web_search,
            codex_auto_compact_token_limit=codex_auto_compact_token_limit,
            agent_timeout_sec=agent_timeout_sec,
            verifier_timeout_sec=verifier_timeout_sec,
            build_timeout_sec=build_timeout_sec,
            stage_pattern=plan.stage_pattern,
            stage_schedule=tuple(plan.stage_schedule) if plan.stage_schedule is not None else None,
        ),
    )


def write_suite_manifest(
    plans: list[TaskPlan],
    *,
    output: Path,
    source_root: Path,
    source_resolution: SourceResolution,
    tasks_root: Path,
    jobs_root: Path,
    model_name: str,
    reasoning_effort: str,
    codex_web_search: str,
    codex_auto_compact_token_limit: int,
    agent_timeout_sec: float,
    verifier_timeout_sec: float,
    build_timeout_sec: float,
    samples: int,
    arm_configs: list[dict[str, Any]],
) -> None:
    payload = {
        "schemaVersion": 1,
        "issue": 137,
        "sourceDataset": {
            "name": "xiewenya/dynamicmem",
            "license": "MIT",
            "sourceRoot": str(source_root),
            "sourceKind": source_resolution.source_kind,
            "downloaded": source_resolution.downloaded,
            "nativeInputs": ["app_log_large.json", "task_packs.json"],
            "migrationPolicy": (
                "Harbor replaces only the runner. Each generated task preserves "
                "one native DynamicMem user checkpoint trajectory, including raw "
                "app-log deltas, state_completion_pack, rq3_apply_service_qa, "
                "and the upstream prediction contract."
            ),
            "selectionPolicy": (
                "Deterministic checkpoint-trajectory migration. One Harbor task "
                "maps to one DynamicMem user and the selected checkpoint indices; "
                "no state-key chunking or synthetic form schema generation is used."
            ),
        },
        "modelName": model_name,
        "reasoningEffort": reasoning_effort,
        "stagePatterns": sorted({plan.stage_pattern for plan in plans}),
        "agentConfig": {
            "agent": "codex",
            "modelName": model_name,
            "reasoningEffort": reasoning_effort,
            "reasoningEffortConfigKey": "model_reasoning_effort",
            "codexWebSearch": codex_web_search,
            "codexWebSearchConfigKey": "web_search",
            "codexAutoCompactTokenLimit": codex_auto_compact_token_limit,
            "codexAutoCompactConfigKey": "model_auto_compact_token_limit",
            "agentTimeoutSec": agent_timeout_sec,
            "verifierTimeoutSec": verifier_timeout_sec,
            "buildTimeoutSec": build_timeout_sec,
        },
        "timeouts": {
            "agentSec": agent_timeout_sec,
            "verifierSec": verifier_timeout_sec,
            "buildSec": build_timeout_sec,
        },
        "samplesPerTaskArm": samples,
        "paths": {
            "tasksRoot": str(tasks_root),
            "jobsRoot": str(jobs_root),
            "sourceRoot": str(source_root),
        },
        "stageSchedules": sorted({plan.stage_schedule_display for plan in plans}),
        "arms": [
            {
                "mode": arm["mode"],
                "memoryMode": arm.get("memoryMode", arm["mode"]),
                "instructionPath": arm["instructionPath"],
                "compose": arm.get("compose", "staged"),
                "reasoningEffort": reasoning_effort,
                "codexWebSearch": codex_web_search,
                "codexAutoCompactTokenLimit": codex_auto_compact_token_limit,
                "agentTimeoutSec": agent_timeout_sec,
                "verifierTimeoutSec": verifier_timeout_sec,
                "buildTimeoutSec": build_timeout_sec,
            }
            for arm in arm_configs
        ],
        "tasks": [
            {
                "taskId": plan.task_id,
                "corpusId": plan.corpus_id,
                "sourceUserDir": plan.source_user_dir,
                "sourceUserId": plan.source_user_id,
                "checkpointIndices": plan.checkpoint_indices,
                "checkpointIds": plan.checkpoint_ids,
                "checkpointTimestamps": plan.checkpoint_timestamps,
                "stagePattern": plan.stage_pattern,
                "stageSchedule": plan.stage_schedule,
                "stageScheduleDisplay": plan.stage_schedule_display,
                "scoredCheckpointIds": plan.scored_checkpoint_ids,
                "finalCheckpointIndex": plan.checkpoint_indices[-1],
                "finalCheckpointId": plan.checkpoint_ids[-1],
                "finalCheckpointTimestamp": plan.checkpoint_timestamps[-1],
                "observedLogCount": plan.observed_log_count,
                "stateCompletionKeyCount": plan.state_completion_key_count,
                "uniqueStateCompletionKeyCount": plan.unique_state_completion_key_count,
                "personalizedServiceKeyCount": plan.personalized_service_key_count,
                "personalizedServiceItemCount": plan.personalized_service_item_count,
                "serviceFamilies": plan.service_families,
                "difficulty": read_task_difficulty(tasks_root, plan.task_id),
            }
            for plan in plans
        ],
        "coverage": suite_coverage(plans),
    }
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(payload, indent=2, sort_keys=True) + "\n", encoding="utf-8")


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


def run_generated_preflight(
    plans: list[TaskPlan],
    *,
    source_root: Path,
    tasks_root: Path,
    jobs_root: Path,
    arm_configs: list[dict[str, Any]],
) -> None:
    repo_root = Path.cwd().resolve()
    source_roots = source_roots_for_preflight(source_root)
    errors: list[str] = []

    for plan in plans:
        task_path = tasks_root / plan.task_id
        errors.extend(validate_task_preflight(task_path, repo_root, source_roots))
        for arm in arm_configs:
            errors.extend(
                validate_job_preflight(
                    jobs_root / f"{plan.task_id}-{arm['mode']}.yaml",
                    repo_root,
                )
            )

    if errors:
        for error in errors:
            print(f"ERROR {error}")
        raise SystemExit(1)
    print(f"Preflight OK: {len(plans)} task(s), {len(plans) * len(arm_configs)} job(s)")


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Generate native DynamicMem Harbor tasks.")
    parser.add_argument(
        "--source-root",
        default=None,
        help=(
            "DynamicMem source root or user dir. Use 'auto' or omit to resolve "
            "from DYNAMICMEM_SOURCE_ROOT, repo external paths, cache, or Hugging Face."
        ),
    )
    parser.add_argument(
        "--dataset-cache-root",
        default=None,
        help="Cache root for auto-downloaded benchmark datasets.",
    )
    parser.add_argument(
        "--no-download",
        action="store_true",
        help="Do not download DynamicMem when no local source root is found.",
    )
    parser.add_argument("--tasks-root", type=Path, default=Path("examples/eval-harbor/tasks"))
    parser.add_argument("--jobs-root", type=Path, default=Path("examples/eval-harbor/jobs"))
    parser.add_argument("--manifest", type=Path, default=Path("examples/eval-harbor/suites/dynamicmem-suite.json"))
    parser.add_argument("--arms-config", type=Path, default=DEFAULT_ARM_CONFIG_PATH)
    parser.add_argument("--model", default=DEFAULT_MODEL)
    parser.add_argument(
        "--reasoning-effort",
        default=DEFAULT_REASONING_EFFORT,
        choices=sorted(REASONING_EFFORT_CHOICES),
        help="Codex reasoning effort written into every generated Harbor job.",
    )
    parser.add_argument(
        "--codex-web-search",
        default=DEFAULT_CODEX_WEB_SEARCH,
        choices=sorted(CODEX_WEB_SEARCH_CHOICES),
        help="Codex web_search policy written into every generated Harbor job.",
    )
    parser.add_argument(
        "--codex-auto-compact-token-limit",
        type=int,
        default=DEFAULT_CODEX_AUTO_COMPACT_TOKEN_LIMIT,
        help=argparse.SUPPRESS,
    )
    parser.add_argument(
        "--agent-timeout-sec",
        type=float,
        default=DEFAULT_AGENT_TIMEOUT_SEC,
        help="Harbor agent timeout in seconds written into every generated task.toml.",
    )
    parser.add_argument(
        "--verifier-timeout-sec",
        type=float,
        default=DEFAULT_VERIFIER_TIMEOUT_SEC,
        help="Harbor verifier timeout in seconds written into every generated task.toml.",
    )
    parser.add_argument(
        "--build-timeout-sec",
        type=float,
        default=DEFAULT_BUILD_TIMEOUT_SEC,
        help="Harbor environment build timeout in seconds written into every generated task.toml.",
    )
    parser.add_argument("--samples", type=int, default=3)
    parser.add_argument("--max-users", type=int, default=5)
    parser.add_argument("--max-tasks", type=int, default=10)
    parser.add_argument(
        "--source-users",
        default=None,
        help=(
            "Optional comma-separated DynamicMem users to include. Accepts "
            "directory names like 008_user_008, ids like user_008, or compact labels like user008."
        ),
    )
    parser.add_argument("--checkpoint-indices", default="0-4")
    parser.add_argument(
        "--stage-pattern",
        default=PATTERN_UPDATE_ANSWER_EVERY_CHECKPOINT,
        choices=sorted(STAGE_PATTERNS),
    )
    parser.add_argument(
        "--stage-schedule",
        default=None,
        help=(
            "Custom staged trajectory using U, T, and UA tokens, for example "
            "'U,U,T,U,T'. When set, this overrides --stage-pattern."
        ),
    )
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument(
        "--skip-preflight",
        action="store_true",
        help="Skip generated task/job preflight checks. This should only be used while debugging builders.",
    )
    args = parser.parse_args(argv)

    checkpoint_indices = parse_checkpoint_indices(args.checkpoint_indices)
    stage_schedule = parse_stage_schedule(args.stage_schedule) if args.stage_schedule else None
    if args.codex_auto_compact_token_limit <= 0:
        raise SystemExit("ERROR --codex-auto-compact-token-limit must be positive")
    arm_configs = load_arm_configs(args.arms_config)
    try:
        source_resolution = resolve_dynamicmem_source_root(
            args.source_root,
            raw_cache_root=args.dataset_cache_root,
            download_missing=not args.no_download,
        )
    except (FileNotFoundError, RuntimeError, ValueError) as error:
        raise SystemExit(f"ERROR {error}") from None
    source_root = source_resolution.source_root
    allowed_users = parse_source_users(args.source_users)
    print(
        f"DynamicMem source root: {source_root} "
        f"(source={source_resolution.source_kind}, downloaded={source_resolution.downloaded})"
    )
    all_plans: list[tuple[Path, TaskPlan]] = []
    selected_source_dirs = [
        source_dir
        for source_dir in user_dirs(source_root)
        if source_user_matches(source_dir, allowed_users)
    ][: args.max_users]
    for source_dir in selected_source_dirs:
        for plan in plan_user_tasks(
            source_dir,
            checkpoint_indices=checkpoint_indices,
            stage_pattern=args.stage_pattern,
            stage_schedule=stage_schedule,
        ):
            all_plans.append((source_dir, plan))
            if len(all_plans) >= args.max_tasks:
                break
        if len(all_plans) >= args.max_tasks:
            break

    if not all_plans:
        raise SystemExit("no DynamicMem task plans generated")

    for source_dir, plan in all_plans:
        print(
            f"{plan.task_id}: user={plan.source_user_id} "
            f"checkpoints={','.join(str(index) for index in plan.checkpoint_indices)} "
            f"stage_schedule={plan.stage_schedule_display} "
            f"logs={plan.observed_log_count} "
            f"state_keys={plan.state_completion_key_count} "
            f"service_items={plan.personalized_service_item_count}"
        )
        if not args.dry_run:
            generate_task(
                plan,
                source_dir,
                tasks_root=args.tasks_root,
                jobs_root=args.jobs_root,
                model_name=args.model,
                reasoning_effort=args.reasoning_effort,
                codex_web_search=args.codex_web_search,
                codex_auto_compact_token_limit=args.codex_auto_compact_token_limit,
                agent_timeout_sec=args.agent_timeout_sec,
                verifier_timeout_sec=args.verifier_timeout_sec,
                build_timeout_sec=args.build_timeout_sec,
                arm_configs=arm_configs,
            )

    if args.dry_run:
        print(f"Dry run only; did not write suite manifest: {args.manifest}")
        return 0

    write_suite_manifest(
        [plan for _, plan in all_plans],
        output=args.manifest,
        source_root=source_root,
        source_resolution=source_resolution,
        tasks_root=args.tasks_root,
        jobs_root=args.jobs_root,
        model_name=args.model,
        reasoning_effort=args.reasoning_effort,
        codex_web_search=args.codex_web_search,
        codex_auto_compact_token_limit=args.codex_auto_compact_token_limit,
        agent_timeout_sec=args.agent_timeout_sec,
        verifier_timeout_sec=args.verifier_timeout_sec,
        build_timeout_sec=args.build_timeout_sec,
        samples=args.samples,
        arm_configs=arm_configs,
    )
    print(f"Wrote suite manifest: {args.manifest}")
    if not args.skip_preflight:
        run_generated_preflight(
            [plan for _, plan in all_plans],
            source_root=source_root,
            tasks_root=args.tasks_root,
            jobs_root=args.jobs_root,
            arm_configs=arm_configs,
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
