import unittest

from trajectory_framework import (
    PATTERN_UPDATE_ONLY_THEN_FINAL,
    STAGE_KIND_DOWNSTREAM_TASK,
    STAGE_KIND_MEMORY_UPDATE,
    parse_stage_schedule,
    stage_pattern_suffix,
    stage_schedule_label,
    stage_schedule_suffix,
)


class TrajectoryFrameworkTests(unittest.TestCase):
    def test_parse_stage_schedule_variants(self) -> None:
        self.assertEqual(
            parse_stage_schedule("U,T"),
            (STAGE_KIND_MEMORY_UPDATE, STAGE_KIND_DOWNSTREAM_TASK),
        )
        self.assertEqual(
            parse_stage_schedule("U -> U -> T"),
            (
                STAGE_KIND_MEMORY_UPDATE,
                STAGE_KIND_MEMORY_UPDATE,
                STAGE_KIND_DOWNSTREAM_TASK,
            ),
        )
        self.assertEqual(
            parse_stage_schedule("  u   t  "),
            (STAGE_KIND_MEMORY_UPDATE, STAGE_KIND_DOWNSTREAM_TASK),
        )
        self.assertEqual(
            parse_stage_schedule(" U ,  T "),
            (STAGE_KIND_MEMORY_UPDATE, STAGE_KIND_DOWNSTREAM_TASK),
        )

    def test_parse_stage_schedule_rejects_invalid_values(self) -> None:
        with self.assertRaises(ValueError):
            parse_stage_schedule("")
        with self.assertRaises(ValueError):
            parse_stage_schedule("U,X")

    def test_schedule_labels_and_suffixes(self) -> None:
        schedule = (
            STAGE_KIND_MEMORY_UPDATE,
            STAGE_KIND_MEMORY_UPDATE,
            STAGE_KIND_DOWNSTREAM_TASK,
        )
        self.assertEqual(stage_schedule_label(schedule), "U -> U -> T")
        self.assertEqual(
            stage_schedule_suffix((STAGE_KIND_MEMORY_UPDATE, STAGE_KIND_DOWNSTREAM_TASK)),
            "schedule-ut-v1",
        )
        self.assertEqual(
            stage_pattern_suffix(PATTERN_UPDATE_ONLY_THEN_FINAL),
            "memory-final-v1",
        )


if __name__ == "__main__":
    unittest.main()
