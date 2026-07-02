#!/usr/bin/env python3
"""Small shared contract for Harbor staged trajectory tasks.

Dataset adapters should translate source data into these stage kinds, then keep
dataset-specific scoring in their own verifier.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any


STAGE_KIND_MEMORY_UPDATE = "memory-update"
STAGE_KIND_DOWNSTREAM_TASK = "downstream-task"
STAGE_KIND_STATE_TASK = "state-task"
STAGE_KIND_SERVICE_TASK = "service-task"

STAGE_KINDS = {
    STAGE_KIND_MEMORY_UPDATE,
    STAGE_KIND_DOWNSTREAM_TASK,
    STAGE_KIND_STATE_TASK,
    STAGE_KIND_SERVICE_TASK,
}

PATTERN_UPDATE_ONLY_THEN_FINAL = "update-only-then-final"

STAGE_PATTERNS = {
    PATTERN_UPDATE_ONLY_THEN_FINAL,
}

STAGE_SHORTHANDS = {
    "U": STAGE_KIND_MEMORY_UPDATE,
    "T": STAGE_KIND_DOWNSTREAM_TASK,
    "S": STAGE_KIND_STATE_TASK,
    "A": STAGE_KIND_SERVICE_TASK,
}

STAGE_KIND_SHORTHANDS = {
    value: key for key, value in STAGE_SHORTHANDS.items()
}


@dataclass(frozen=True)
class TrajectoryStage:
    stage_id: str
    stage_index: int
    kind: str
    instruction: str
    files: list[dict[str, Any]]
    checkpoint_index: int | None = None
    checkpoint_id: str | None = None

    def as_payload(self) -> dict[str, Any]:
        if self.kind not in STAGE_KINDS:
            raise ValueError(f"unsupported trajectory stage kind: {self.kind}")
        payload: dict[str, Any] = {
            "stageId": self.stage_id,
            "stageIndex": self.stage_index,
            "kind": self.kind,
            "instruction": self.instruction,
            "files": self.files,
        }
        if self.checkpoint_index is not None:
            payload["checkpointIndex"] = self.checkpoint_index
        if self.checkpoint_id is not None:
            payload["checkpointId"] = self.checkpoint_id
        return payload


def stage_pattern_suffix(stage_pattern: str) -> str:
    if stage_pattern == PATTERN_UPDATE_ONLY_THEN_FINAL:
        return "memory-final-v1"
    choices = ", ".join(sorted(STAGE_PATTERNS))
    raise ValueError(f"stage_pattern must be one of: {choices}")


def parse_stage_schedule(value: str) -> tuple[str, ...]:
    tokens = [
        token.strip().upper()
        for token in re.split(r"\s*(?:->|,|\s+)\s*", value.strip())
        if token.strip()
    ]
    if not tokens:
        raise ValueError("stage schedule must not be empty")
    unknown = [token for token in tokens if token not in STAGE_SHORTHANDS]
    if unknown:
        choices = ", ".join(sorted(STAGE_SHORTHANDS))
        raise ValueError(f"unsupported stage schedule token(s) {unknown}; use {choices}")
    return tuple(STAGE_SHORTHANDS[token] for token in tokens)


def stage_schedule_label(schedule: tuple[str, ...]) -> str:
    return " -> ".join(STAGE_KIND_SHORTHANDS.get(kind, kind) for kind in schedule)


def stage_schedule_suffix(schedule: tuple[str, ...]) -> str:
    if not schedule:
        raise ValueError("stage schedule must not be empty")
    parts = []
    for kind in schedule:
        if kind not in STAGE_KIND_SHORTHANDS:
            raise ValueError(f"unsupported stage schedule kind: {kind}")
        parts.append(STAGE_KIND_SHORTHANDS[kind].lower())
    return f"schedule-{''.join(parts)}-v1"


def count_stage_kinds(stages: list[dict[str, Any]]) -> dict[str, int]:
    return {
        kind: sum(1 for stage in stages if stage.get("kind") == kind)
        for kind in sorted(STAGE_KINDS)
    }
