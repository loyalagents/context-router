#!/usr/bin/env python3
"""Run Harbor jobs repeatedly for task x arm robustness samples."""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
from pathlib import Path

from validate_eval_preflight import (
    validate_job_preflight,
    validate_run_preflight,
    validate_task_preflight,
)


DEFAULT_MODES = ["context-only", "markdown", "cr-mcp"]
DYNAMICMEM_VERIFIER_ENV_BRIDGE = [
    "DYNAMICMEM_LLM_JUDGE_API_KEY",
    "DYNAMICMEM_LLM_JUDGE_BASE_URL",
    "DYNAMICMEM_LLM_JUDGE_MODEL",
    "DYNAMICMEM_JUDGE_MODE",
    "DYNAMICMEM_LLM_JUDGE_MAX_ITEMS",
    "DYNAMICMEM_LLM_JUDGE_BATCH_SIZE",
    "DYNAMICMEM_LLM_JUDGE_TIMEOUT_SEC",
    "DYNAMICMEM_LLM_JUDGE_SEED",
]


def load_manifest(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def task_ids_from_manifest(payload: dict) -> list[str]:
    return [item["taskId"] for item in payload.get("tasks", [])]


def modes_from_manifest(payload: dict) -> list[str]:
    arms = payload.get("arms")
    if isinstance(arms, list) and arms:
        return [arm["mode"] for arm in arms if isinstance(arm.get("mode"), str)]
    modes = payload.get("modes")
    if isinstance(modes, list) and modes:
        return [mode for mode in modes if isinstance(mode, str)]
    return DEFAULT_MODES


def jobs_root_from_manifest(payload: dict) -> Path | None:
    paths = payload.get("paths")
    if not isinstance(paths, dict):
        return None
    jobs_root = paths.get("jobsRoot")
    if isinstance(jobs_root, str) and jobs_root:
        return Path(jobs_root)
    return None


def tasks_root_from_manifest(payload: dict) -> Path | None:
    paths = payload.get("paths")
    if not isinstance(paths, dict):
        return None
    tasks_root = paths.get("tasksRoot")
    if isinstance(tasks_root, str) and tasks_root:
        return Path(tasks_root)
    return None


def source_roots_from_manifest(payload: dict) -> list[Path]:
    paths = payload.get("paths")
    roots: list[Path] = []
    if isinstance(paths, dict):
        raw_source_root = paths.get("sourceRoot") or paths.get("dynamicmemSourceRoot")
        if isinstance(raw_source_root, str) and raw_source_root:
            roots.append(Path(raw_source_root))
    source_dataset = payload.get("sourceDataset")
    if isinstance(source_dataset, dict):
        raw_source_root = source_dataset.get("sourceRoot")
        if isinstance(raw_source_root, str) and raw_source_root:
            roots.append(Path(raw_source_root))
    return roots


def run_preflight(
    *,
    task_ids: list[str],
    modes: list[str],
    tasks_root: Path,
    jobs_root: Path,
    repo_root: Path,
    source_roots: list[Path],
) -> None:
    errors: list[str] = []
    checked_tasks: set[Path] = set()
    for task_id in task_ids:
        task_path = tasks_root / task_id
        resolved_task_path = task_path if task_path.is_absolute() else repo_root / task_path
        if resolved_task_path not in checked_tasks:
            checked_tasks.add(resolved_task_path)
            if not resolved_task_path.exists():
                errors.append(f"missing task directory: {task_path}")
            else:
                errors.extend(
                    validate_task_preflight(
                        resolved_task_path,
                        repo_root,
                        source_roots,
                    )
                )
        for mode in modes:
            job_path = jobs_root / f"{task_id}-{mode}.yaml"
            resolved_job_path = job_path if job_path.is_absolute() else repo_root / job_path
            if not resolved_job_path.exists():
                errors.append(f"missing job file: {job_path}")
            else:
                errors.extend(validate_job_preflight(resolved_job_path, repo_root))

    if errors:
        print("Preflight failed; Harbor jobs were not started.", file=sys.stderr)
        for error in errors:
            print(f"ERROR {error}", file=sys.stderr)
        raise SystemExit(1)
    print(
        f"Preflight OK: {len(checked_tasks)} task(s), "
        f"{len(task_ids) * len(modes)} job(s)."
    )


def run_command(command: list[str], *, dry_run: bool) -> None:
    print(" ".join(command))
    if not dry_run:
        subprocess.run(command, check=True)


def verifier_env_with_dynamicmem_defaults(
    verifier_env: list[str],
    env_files: list[str],
    manifest: dict | None,
) -> list[str]:
    """Bridge DynamicMem judge env-file values into Harbor verifier env.

    Harbor's --env-file is not enough for verifier execution in current local
    runs. Passing VAR=${VAR} keeps secrets out of the command text while letting
    Harbor resolve values from the env file/process env.
    """

    merged = list(verifier_env)
    configured_names = {item.split("=", 1)[0] for item in merged}
    is_dynamicmem = False
    if isinstance(manifest, dict):
        source = manifest.get("sourceDataset")
        is_dynamicmem = (
            isinstance(source, dict)
            and str(source.get("name") or "") == "xiewenya/dynamicmem"
        )
    env_file_names: set[str] = set()
    for path in env_files:
        env_file_names.update(env_file_dynamicmem_names(path))
    env_file_has_dynamicmem = bool(env_file_names)
    if not is_dynamicmem and not env_file_has_dynamicmem:
        return merged

    for name in DYNAMICMEM_VERIFIER_ENV_BRIDGE:
        if name not in configured_names and (
            name in os.environ or name in env_file_names
        ):
            merged.append(f"{name}=${{{name}}}")
    return merged


def env_file_has_dynamicmem_keys(path: str) -> bool:
    return bool(env_file_dynamicmem_names(path))


def env_file_dynamicmem_names(path: str) -> set[str]:
    try:
        text = Path(path).expanduser().read_text(encoding="utf-8")
    except OSError:
        return set()
    names: set[str] = set()
    for line in text.splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("#") or "=" not in stripped:
            continue
        name = stripped.split("=", 1)[0].strip()
        if name.startswith("DYNAMICMEM_"):
            names.add(name)
    return names


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Run 3x Harbor resampling for each task and memory arm."
    )
    parser.add_argument("--manifest", type=Path)
    parser.add_argument("--task-id", action="append", default=[])
    parser.add_argument("--tasks-root", type=Path)
    parser.add_argument("--jobs-root", type=Path)
    parser.add_argument("--output-root", type=Path, default=Path("/tmp/cr-harbor-dynamicmem-suite"))
    parser.add_argument("--harbor-bin", default="harbor")
    parser.add_argument("--samples", type=int, default=3)
    parser.add_argument("--n-concurrent", type=int, default=1)
    parser.add_argument(
        "--modes",
        help="Comma-separated mode override. Defaults to arms listed in the manifest.",
    )
    parser.add_argument("--env-file", action="append", default=[])
    parser.add_argument("--agent-env", action="append", default=["CODEX_FORCE_AUTH_JSON=true"])
    parser.add_argument("--verifier-env", action="append", default=[])
    parser.add_argument(
        "--dynamicmem-source-root",
        action="append",
        type=Path,
        default=[],
        help=(
            "Root containing DynamicMem user dirs. Normally read from the suite "
            "manifest; use this only for older manifests."
        ),
    )
    parser.add_argument("--yes", action="store_true", default=True)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    repo_root = Path.cwd().resolve()
    manifest = load_manifest(args.manifest) if args.manifest else None
    task_ids = list(args.task_id) if args.task_id else task_ids_from_manifest(manifest or {})
    task_ids = sorted(set(task_ids))
    if not task_ids:
        raise SystemExit("provide --manifest or at least one --task-id")
    jobs_root = (
        args.jobs_root
        or jobs_root_from_manifest(manifest or {})
        or Path("examples/eval-harbor/jobs")
    )
    tasks_root = (
        args.tasks_root
        or tasks_root_from_manifest(manifest or {})
        or Path("examples/eval-harbor/tasks")
    )

    modes = (
        [mode.strip() for mode in args.modes.split(",") if mode.strip()]
        if args.modes
        else modes_from_manifest(manifest or {})
    )
    source_roots = [
        root.expanduser().resolve()
        for root in [
            *source_roots_from_manifest(manifest or {}),
            *args.dynamicmem_source_root,
        ]
    ]
    env_source_root = os.environ.get("DYNAMICMEM_SOURCE_ROOT")
    if env_source_root:
        source_roots.append(Path(env_source_root).expanduser().resolve())

    run_preflight(
        task_ids=task_ids,
        modes=modes,
        tasks_root=tasks_root,
        jobs_root=jobs_root,
        repo_root=repo_root,
        source_roots=source_roots,
    )

    verifier_env = verifier_env_with_dynamicmem_defaults(
        list(args.verifier_env),
        list(args.env_file),
        manifest,
    )

    for task_id in task_ids:
        for mode in modes:
            job_path = jobs_root / f"{task_id}-{mode}.yaml"
            if not job_path.exists():
                raise SystemExit(f"missing job file: {job_path}")
            for sample in range(1, args.samples + 1):
                output_dir = args.output_root / task_id / mode / f"sample-{sample:02d}"
                command = [
                    args.harbor_bin,
                    "run",
                    "-c",
                    str(job_path),
                    "--jobs-dir",
                    str(output_dir),
                    "--n-concurrent",
                    str(args.n_concurrent),
                ]
                for env_file in args.env_file:
                    command.extend(["--env-file", env_file])
                for env in args.agent_env:
                    command.extend(["--agent-env", env])
                for env in verifier_env:
                    command.extend(["--verifier-env", env])
                if args.yes:
                    command.append("--yes")
                run_command(command, dry_run=args.dry_run)
                if not args.dry_run:
                    errors = validate_run_preflight(mode, output_dir)
                    if errors:
                        print(
                            f"Post-run validation failed for {task_id}/{mode}/sample-{sample:02d}.",
                            file=sys.stderr,
                        )
                        for error in errors:
                            print(f"ERROR {error}", file=sys.stderr)
                        raise SystemExit(1)
                    print(f"Post-run validation OK: {task_id}/{mode}/sample-{sample:02d}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
