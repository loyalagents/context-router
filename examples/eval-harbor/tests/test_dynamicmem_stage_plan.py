import unittest

from build_dynamicmem_task import (
    BuildConfig,
    resolve_stage_plan,
    scored_specs_from_stage_plan,
)
from trajectory_framework import (
    STAGE_KIND_DOWNSTREAM_TASK,
    STAGE_KIND_MEMORY_UPDATE,
    STAGE_KIND_SERVICE_TASK,
    STAGE_KIND_STATE_TASK,
)


def checkpoint_spec(index: int, checkpoint_id: str) -> dict:
    return {
        "checkpointIndex": index,
        "checkpoint": {
            "checkpoint_id": checkpoint_id,
        },
    }


def config_for(*schedule: str) -> BuildConfig:
    return BuildConfig(
        checkpoint_indices=tuple(range(max(1, schedule.count(STAGE_KIND_MEMORY_UPDATE)))),
        stage_schedule=tuple(schedule),
    )


def plan_kinds(stage_plan: list) -> list[str]:
    return [item.kind for item in stage_plan]


def scored_checkpoint_ids(stage_plan: list) -> list[str]:
    return [
        str(item["checkpoint"]["checkpoint_id"])
        for item in scored_specs_from_stage_plan(stage_plan)
    ]


class DynamicMemStagePlanTests(unittest.TestCase):
    def test_single_update_task_expands_to_state_and_service(self) -> None:
        plan = resolve_stage_plan(
            [checkpoint_spec(0, "cp0")],
            config_for(STAGE_KIND_MEMORY_UPDATE, STAGE_KIND_DOWNSTREAM_TASK),
        )

        self.assertEqual(
            plan_kinds(plan),
            [
                STAGE_KIND_MEMORY_UPDATE,
                STAGE_KIND_STATE_TASK,
                STAGE_KIND_SERVICE_TASK,
            ],
        )
        self.assertEqual(scored_checkpoint_ids(plan), ["cp0"])

    def test_two_updates_task_scores_only_final_checkpoint(self) -> None:
        plan = resolve_stage_plan(
            [checkpoint_spec(0, "cp0"), checkpoint_spec(1, "cp1")],
            config_for(
                STAGE_KIND_MEMORY_UPDATE,
                STAGE_KIND_MEMORY_UPDATE,
                STAGE_KIND_DOWNSTREAM_TASK,
            ),
        )

        self.assertEqual(
            plan_kinds(plan),
            [
                STAGE_KIND_MEMORY_UPDATE,
                STAGE_KIND_MEMORY_UPDATE,
                STAGE_KIND_STATE_TASK,
                STAGE_KIND_SERVICE_TASK,
            ],
        )
        self.assertEqual(scored_checkpoint_ids(plan), ["cp1"])

    def test_interleaved_tasks_score_each_probed_checkpoint(self) -> None:
        plan = resolve_stage_plan(
            [checkpoint_spec(0, "cp0"), checkpoint_spec(1, "cp1")],
            config_for(
                STAGE_KIND_MEMORY_UPDATE,
                STAGE_KIND_DOWNSTREAM_TASK,
                STAGE_KIND_MEMORY_UPDATE,
                STAGE_KIND_DOWNSTREAM_TASK,
            ),
        )

        self.assertEqual(scored_checkpoint_ids(plan), ["cp0", "cp1"])

    def test_task_before_update_fails(self) -> None:
        with self.assertRaises(ValueError):
            resolve_stage_plan(
                [checkpoint_spec(0, "cp0")],
                config_for(STAGE_KIND_DOWNSTREAM_TASK, STAGE_KIND_MEMORY_UPDATE),
            )

    def test_repeated_task_for_same_checkpoint_fails(self) -> None:
        with self.assertRaises(ValueError):
            resolve_stage_plan(
                [checkpoint_spec(0, "cp0")],
                config_for(
                    STAGE_KIND_MEMORY_UPDATE,
                    STAGE_KIND_DOWNSTREAM_TASK,
                    STAGE_KIND_DOWNSTREAM_TASK,
                ),
            )

    def test_unscored_final_checkpoint_fails(self) -> None:
        with self.assertRaises(ValueError):
            resolve_stage_plan(
                [checkpoint_spec(0, "cp0"), checkpoint_spec(1, "cp1")],
                config_for(
                    STAGE_KIND_MEMORY_UPDATE,
                    STAGE_KIND_DOWNSTREAM_TASK,
                    STAGE_KIND_MEMORY_UPDATE,
                ),
            )


if __name__ == "__main__":
    unittest.main()
