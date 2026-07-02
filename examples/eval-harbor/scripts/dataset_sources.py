#!/usr/bin/env python3
"""Dataset source resolution for eval-harbor builders."""

from __future__ import annotations

import os
import shutil
import subprocess
from dataclasses import dataclass
from pathlib import Path


DYNAMICMEM_DATASET_ID = "xiewenya/dynamicmem"
DYNAMICMEM_ENV_VAR = "DYNAMICMEM_SOURCE_ROOT"
DEFAULT_CACHE_ROOT_ENV = "CONTEXT_ROUTER_EVAL_DATA_CACHE"
DEFAULT_CACHE_ROOT = Path("~/.cache/context-router/eval-harbor/datasets").expanduser()
REQUIRED_DYNAMICMEM_FILES = ("app_log_large.json", "task_packs.json")


@dataclass(frozen=True)
class SourceResolution:
    dataset: str
    source_root: Path
    source_kind: str
    downloaded: bool = False


def repo_root() -> Path:
    return Path(__file__).resolve().parents[3]


def cache_root(raw_cache_root: str | Path | None = None) -> Path:
    if raw_cache_root is not None:
        return Path(raw_cache_root).expanduser()
    env_value = os.environ.get(DEFAULT_CACHE_ROOT_ENV)
    if env_value:
        return Path(env_value).expanduser()
    return DEFAULT_CACHE_ROOT


def is_dynamicmem_user_dir(path: Path) -> bool:
    return path.is_dir() and all(
        (path / name).exists() for name in REQUIRED_DYNAMICMEM_FILES
    )


def is_dynamicmem_root(path: Path) -> bool:
    if is_dynamicmem_user_dir(path):
        return True
    if not path.is_dir():
        return False
    return any(is_dynamicmem_user_dir(child) for child in path.iterdir() if child.is_dir())


def validate_dynamicmem_root(path: Path, label: str) -> Path:
    resolved = path.expanduser().resolve()
    if not is_dynamicmem_root(resolved):
        required = ", ".join(REQUIRED_DYNAMICMEM_FILES)
        raise ValueError(
            f"{label} is not a DynamicMem source root: {resolved}. "
            f"Expected a user dir or root containing user dirs with {required}."
        )
    return resolved


def dynamicmem_cache_dir(raw_cache_root: str | Path | None = None) -> Path:
    return cache_root(raw_cache_root) / "dynamicmem"


def default_dynamicmem_candidates(
    raw_cache_root: str | Path | None = None,
) -> list[tuple[str, Path]]:
    root = repo_root()
    candidates: list[tuple[str, Path]] = []
    env_value = os.environ.get(DYNAMICMEM_ENV_VAR)
    if env_value:
        candidates.append(("env", Path(env_value).expanduser()))
    candidates.extend(
        [
            (
                "repo-external",
                root / "examples" / "eval-harbor" / "external" / "dynamicmem",
            ),
            ("repo-external", root / "external" / "dynamicmem"),
            ("cache", dynamicmem_cache_dir(raw_cache_root)),
        ]
    )
    return candidates


def download_dynamicmem(target_dir: Path) -> None:
    target_dir.mkdir(parents=True, exist_ok=True)
    try:
        from huggingface_hub import snapshot_download

        snapshot_download(
            repo_id=DYNAMICMEM_DATASET_ID,
            repo_type="dataset",
            local_dir=str(target_dir),
        )
        return
    except ImportError:
        pass

    hf_bin = shutil.which("hf")
    if hf_bin is None:
        raise RuntimeError(
            "DynamicMem source data was not found and cannot be downloaded because "
            "neither huggingface_hub nor the hf CLI is installed. Install "
            "huggingface_hub, or pass --source-root /path/to/DynamicMem."
        )
    subprocess.run(
        [
            hf_bin,
            "download",
            DYNAMICMEM_DATASET_ID,
            "--repo-type",
            "dataset",
            "--local-dir",
            str(target_dir),
        ],
        check=True,
    )


def resolve_dynamicmem_source_root(
    raw_source_root: str | Path | None = None,
    *,
    raw_cache_root: str | Path | None = None,
    download_missing: bool = True,
) -> SourceResolution:
    if raw_source_root is not None and str(raw_source_root) != "auto":
        return SourceResolution(
            dataset="dynamicmem",
            source_root=validate_dynamicmem_root(Path(raw_source_root), "--source-root"),
            source_kind="explicit",
            downloaded=False,
        )

    for source_kind, candidate in default_dynamicmem_candidates(raw_cache_root):
        expanded = candidate.expanduser()
        if is_dynamicmem_root(expanded):
            return SourceResolution(
                dataset="dynamicmem",
                source_root=expanded.resolve(),
                source_kind=source_kind,
                downloaded=False,
            )

    cache_dir = dynamicmem_cache_dir(raw_cache_root)
    if not download_missing:
        raise FileNotFoundError(
            "DynamicMem source data was not found. Pass --source-root, set "
            f"{DYNAMICMEM_ENV_VAR}, create examples/eval-harbor/external/dynamicmem, "
            "or allow download by omitting --no-download."
        )

    download_dynamicmem(cache_dir)
    return SourceResolution(
        dataset="dynamicmem",
        source_root=validate_dynamicmem_root(cache_dir, "downloaded DynamicMem cache"),
        source_kind="download",
        downloaded=True,
    )
