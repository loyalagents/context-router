#!/usr/bin/env python3
"""General eval-harbor dataset suite builder."""

from __future__ import annotations

import argparse
import importlib
from dataclasses import dataclass
from typing import Sequence


@dataclass(frozen=True)
class DatasetAdapter:
    name: str
    module: str
    description: str


DATASET_ADAPTERS = {
    "dynamicmem": DatasetAdapter(
        name="dynamicmem",
        module="build_dynamicmem_suite",
        description="DynamicMem long-horizon memory trajectories.",
    ),
}


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description=(
            "Build Harbor tasks/jobs/suite manifests from external benchmark "
            "datasets. Dataset-specific options are forwarded to the selected adapter."
        )
    )
    parser.add_argument("--dataset", choices=sorted(DATASET_ADAPTERS), required=False)
    parser.add_argument("--list-datasets", action="store_true")
    args, remaining = parser.parse_known_args(argv)

    if args.list_datasets:
        for adapter in DATASET_ADAPTERS.values():
            print(f"{adapter.name}: {adapter.description}")
        return 0
    if not args.dataset:
        parser.error("--dataset is required unless --list-datasets is set")

    adapter = DATASET_ADAPTERS[args.dataset]
    module = importlib.import_module(adapter.module)
    return int(module.main(list(remaining)))


if __name__ == "__main__":
    raise SystemExit(main())
