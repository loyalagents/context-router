#!/usr/bin/env python3
"""Run Harbor jobs repeatedly for task x arm robustness samples."""

from __future__ import annotations

import argparse
import json
import subprocess
from pathlib import Path


DEFAULT_MODES = ["context-only", "markdown", "cr-mcp"]


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


def run_command(command: list[str], *, dry_run: bool) -> None:
    print(" ".join(command))
    if not dry_run:
        subprocess.run(command, check=True)


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Run 3x Harbor resampling for each task and memory arm."
    )
    parser.add_argument("--manifest", type=Path)
    parser.add_argument("--task-id", action="append", default=[])
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
    parser.add_argument("--yes", action="store_true", default=True)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

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

    modes = (
        [mode.strip() for mode in args.modes.split(",") if mode.strip()]
        if args.modes
        else modes_from_manifest(manifest or {})
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
                for env in args.verifier_env:
                    command.extend(["--verifier-env", env])
                if args.yes:
                    command.append("--yes")
                run_command(command, dry_run=args.dry_run)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
