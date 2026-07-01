#!/usr/bin/env python3
"""Small shared contract for Harbor staged trajectory tasks.

Dataset adapters should translate source data into these stage kinds, then keep
dataset-specific scoring in their own verifier.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any


STAGE_KIND_UPDATE_ANSWER = "update-answer"
STAGE_KIND_MEMORY_UPDATE = "memory-update"
STAGE_KIND_DOWNSTREAM_TASK = "downstream-task"

STAGE_KINDS = {
    STAGE_KIND_UPDATE_ANSWER,
    STAGE_KIND_MEMORY_UPDATE,
    STAGE_KIND_DOWNSTREAM_TASK,
}

PATTERN_UPDATE_ANSWER_EVERY_CHECKPOINT = "update-answer-every-checkpoint"
PATTERN_UPDATE_ONLY_THEN_FINAL = "update-only-then-final"

STAGE_PATTERNS = {
    PATTERN_UPDATE_ANSWER_EVERY_CHECKPOINT,
    PATTERN_UPDATE_ONLY_THEN_FINAL,
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
    if stage_pattern == PATTERN_UPDATE_ANSWER_EVERY_CHECKPOINT:
        return "trajectory-v1"
    if stage_pattern == PATTERN_UPDATE_ONLY_THEN_FINAL:
        return "memory-final-v1"
    choices = ", ".join(sorted(STAGE_PATTERNS))
    raise ValueError(f"stage_pattern must be one of: {choices}")


def count_stage_kinds(stages: list[dict[str, Any]]) -> dict[str, int]:
    return {
        kind: sum(1 for stage in stages if stage.get("kind") == kind)
        for kind in sorted(STAGE_KINDS)
    }
