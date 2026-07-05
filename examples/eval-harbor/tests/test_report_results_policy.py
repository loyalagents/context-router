import unittest

from report_results import (
    command_policy_violations,
    memory_policy_violations,
    missing_required_report_metrics,
)


class ReportResultsPolicyTests(unittest.TestCase):
    def test_memory_policy_blocks_durable_scratch_by_mode(self) -> None:
        self.assertEqual(
            [item["path"] for item in memory_policy_violations("context-only", [
                {"path": "/app/notes.md", "kind": "write"},
                {"path": "/app/memory.md", "kind": "write"},
            ])],
            ["/app/notes.md", "/app/memory.md"],
        )
        self.assertEqual(
            [item["path"] for item in memory_policy_violations("none", [
                {"path": "/app/notes.md", "kind": "write"},
            ])],
            ["/app/notes.md"],
        )
        self.assertEqual(
            [item["path"] for item in memory_policy_violations("cr-mcp", [
                {"path": "/app/memory.md", "kind": "write"},
            ])],
            ["/app/memory.md"],
        )

    def test_markdown_allows_only_memory_md_as_durable_memory(self) -> None:
        violations = memory_policy_violations(
            "markdown",
            [
                {"path": "/app/memory.md", "kind": "write"},
                {"path": "/app/notes.md", "kind": "write"},
            ],
        )

        self.assertEqual([item["path"] for item in violations], ["/app/notes.md"])

    def test_stage_and_output_paths_are_allowed(self) -> None:
        for mode in ("context-only", "none", "markdown", "cr-mcp"):
            with self.subTest(mode=mode):
                self.assertEqual(
                    memory_policy_violations(
                        mode,
                        [
                            {"path": "/app/outputs/prediction.json", "kind": "write"},
                            {"path": "/app/current_stage/stage.json", "kind": "write"},
                            {"path": "/app/stage-log.jsonl", "kind": "write"},
                        ],
                    ),
                    [],
                )

    def test_hidden_path_command_detection(self) -> None:
        violations = command_policy_violations(
            [
                {"command": "ls /tests"},
                {"command": "cat tests/expected/answer.json"},
                {"command": "cat /data/stages.json"},
                {"command": "cat stages/payload.json"},
            ]
        )

        self.assertEqual(
            [item["pattern"] for item in violations],
            ["/tests", "tests/expected", "/data/stages.json", "stages/payload.json"],
        )

    def test_required_metric_checks_by_task_type(self) -> None:
        self.assertEqual(
            missing_required_report_metrics(
                {
                    "taskType": "generic",
                    "reward": 1.0,
                    "totalTokens": 100,
                    "costUsd": 0.01,
                }
            ),
            [],
        )
        self.assertEqual(
            missing_required_report_metrics(
                {
                    "taskType": "generic",
                    "reward": 1.0,
                    "totalTokens": 100,
                }
            ),
            ["costUsd"],
        )
        self.assertEqual(
            missing_required_report_metrics(
                {
                    "taskType": "dynamicmem",
                    "reward": 1.0,
                    "totalTokens": 100,
                    "costUsd": 0.01,
                }
            ),
            ["llmStateMeanScore", "llmServiceMeanScore"],
        )
        self.assertEqual(
            missing_required_report_metrics(
                {
                    "taskType": "sensitive-policy",
                    "reward": 1.0,
                    "totalTokens": 100,
                    "costUsd": 0.01,
                    "allowedUtilityAccuracy": 1.0,
                    "outputRoot": "outputs",
                    "outputFiles": ["permissions-report.json"],
                }
            ),
            ["blockedOutputLeakage"],
        )


if __name__ == "__main__":
    unittest.main()
