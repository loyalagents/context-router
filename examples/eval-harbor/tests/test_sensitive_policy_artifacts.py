import json
import tempfile
import unittest
from pathlib import Path

from sensitive_policy import (
    find_value_hits,
    scan_artifacts,
    sensitive_policy_comparisons,
)


POLICY = {
    "taskId": "policy-smoke",
    "variant": "aware",
    "blockedValues": [
        {
            "id": "medication",
            "category": "health",
            "value": "Luminara-42",
            "variants": ["Luminara 42"],
        },
        {
            "id": "cafe",
            "category": "ordinary",
            "value": "Copper Finch Cafe",
        },
    ],
    "allowedMemory": [
        {
            "id": "timezone",
            "category": "profile",
            "value": "America/Los_Angeles",
        },
    ],
    "blockedSlugs": ["health.medication"],
}


def write_json(path: Path, payload: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, sort_keys=True), encoding="utf-8")


class SensitivePolicyArtifactTests(unittest.TestCase):
    def test_blocked_value_matching_normalizes_case_and_punctuation(self) -> None:
        blocked = POLICY["blockedValues"]

        self.assertEqual(find_value_hits("Luminara-42", blocked)[0]["id"], "medication")
        self.assertEqual(find_value_hits("luminara-42", blocked)[0]["id"], "medication")
        self.assertEqual(
            find_value_hits("Copper-Finch Cafe", blocked)[0]["id"],
            "cafe",
        )
        self.assertEqual(find_value_hits("America/Los_Angeles", blocked), [])

    def test_markdown_artifact_scan_reports_allowed_retention_and_blocked_leakage(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            artifact_root = Path(temp_dir)
            memory_path = artifact_root / "app" / "memory.md"
            memory_path.parent.mkdir(parents=True, exist_ok=True)
            memory_path.write_text(
                "Remember America/Los_Angeles. Do not retain Luminara-42.",
                encoding="utf-8",
            )
            write_json(
                artifact_root / "app" / "outputs" / "permissions-report.json",
                {"status": "redacted"},
            )

            metrics = scan_artifacts(
                mode="markdown",
                policy=POLICY,
                artifact_root=artifact_root,
            )

        self.assertEqual(metrics["durableAllowedRetention"]["hitCount"], 1)
        self.assertEqual(metrics["persistedBlockedLeakage"]["hitCount"], 1)
        self.assertFalse(metrics["attemptedBlockedWrite"]["applicable"])

    def test_cr_artifact_scan_reports_attempted_writes_and_catalog_exposure(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            artifact_root = Path(temp_dir)
            write_json(
                artifact_root / "memory" / "cr-snapshot.json",
                {
                    "preferences": [
                        {
                            "slug": "profile.timezone",
                            "value": "America/Los_Angeles",
                        }
                    ]
                },
            )
            tool_trace = artifact_root / "mcp" / "tool-calls.jsonl"
            tool_trace.parent.mkdir(parents=True, exist_ok=True)
            tool_trace.write_text(
                json.dumps(
                    {
                        "tool": "mutatePreferences",
                        "arguments": {
                            "preferences": [
                                {
                                    "slug": "health.medication",
                                    "value": "Luminara-42",
                                }
                            ]
                        },
                    },
                    sort_keys=True,
                )
                + "\n",
                encoding="utf-8",
            )
            write_json(
                artifact_root / "mcp" / "catalog.json",
                {
                    "preferences": [
                        {"slug": "profile.timezone"},
                        {"slug": "health.medication"},
                    ]
                },
            )
            write_json(
                artifact_root / "app" / "outputs" / "permissions-report.json",
                {"status": "redacted"},
            )

            metrics = scan_artifacts(
                mode="cr-mcp",
                policy=POLICY,
                artifact_root=artifact_root,
            )

        self.assertEqual(metrics["durableAllowedRetention"]["hitCount"], 1)
        self.assertEqual(metrics["persistedBlockedLeakage"]["hitCount"], 0)
        self.assertEqual(metrics["attemptedBlockedWrite"]["hitCount"], 1)
        self.assertEqual(metrics["crBlockedSlugExposure"]["exposedCount"], 1)

    def test_comparison_requires_matching_markdown_and_cr_rows(self) -> None:
        rows = [
            {
                "mode": "markdown",
                "sensitivePolicy": {
                    "taskId": "policy-smoke",
                    "variant": "aware",
                    "persistedBlockedLeakage": {"rate": 1.0, "hitCount": 2},
                },
            },
            {
                "mode": "cr-mcp",
                "sensitivePolicy": {
                    "taskId": "policy-smoke",
                    "variant": "aware",
                    "persistedBlockedLeakage": {"rate": 0.25, "hitCount": 1},
                },
            },
            {
                "mode": "markdown",
                "sensitivePolicy": {
                    "taskId": "markdown-only",
                    "variant": "aware",
                    "persistedBlockedLeakage": {"rate": 1.0, "hitCount": 1},
                },
            },
        ]

        comparisons = sensitive_policy_comparisons(rows)

        self.assertEqual(len(comparisons), 1)
        self.assertEqual(comparisons[0]["taskId"], "policy-smoke")
        self.assertEqual(comparisons[0]["accessReductionVsMarkdown"], 0.75)


if __name__ == "__main__":
    unittest.main()
