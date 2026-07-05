import unittest
from collections import defaultdict
from typing import Optional

from report_sensitive_policy_resamples import compare_markdown_cr, markdown_report


def blocked_metric(hit_count: int, total: int) -> dict:
    return {
        "applicable": True,
        "hitCount": hit_count,
        "total": total,
    }


def row(task_id: str, mode: str, sample: str, metric: Optional[dict]) -> dict:
    policy = {
        "taskId": task_id,
        "variant": "policy-blind",
        "evaluationKind": "fresh-session-readback",
    }
    if metric is not None:
        policy["persistedBlockedLeakage"] = metric
    return {
        "mode": mode,
        "sampleName": sample,
        "sensitivePolicy": policy,
    }


class SensitivePolicyResampleReporterTests(unittest.TestCase):
    def test_comparison_skips_pairs_without_applicable_blocked_leakage(self) -> None:
        rows_by_key = defaultdict(list)
        rows_by_key[("sensitive-policy-freshness-canary-v1", "markdown")].append(
            row("sensitive-policy-freshness-canary-v1", "markdown", "sample-01", None)
        )
        rows_by_key[("sensitive-policy-freshness-canary-v1", "cr-mcp")].append(
            row("sensitive-policy-freshness-canary-v1", "cr-mcp", "sample-01", None)
        )
        rows_by_key[("sensitive-policy-readback-v1", "markdown")].append(
            row(
                "sensitive-policy-readback-v1",
                "markdown",
                "sample-01",
                blocked_metric(6, 6),
            )
        )
        rows_by_key[("sensitive-policy-readback-v1", "cr-mcp")].append(
            row(
                "sensitive-policy-readback-v1",
                "cr-mcp",
                "sample-01",
                blocked_metric(0, 6),
            )
        )

        comparisons = compare_markdown_cr(
            rows_by_key,
            [
                "sensitive-policy-freshness-canary-v1",
                "sensitive-policy-readback-v1",
            ],
        )

        self.assertEqual([item["taskId"] for item in comparisons], ["sensitive-policy-readback-v1"])
        self.assertEqual(comparisons[0]["accessReductionVsMarkdown"], 1.0)

    def test_markdown_report_handles_comparison_without_rates(self) -> None:
        report = markdown_report(
            {
                "generatedAt": "2026-07-05T00:00:00Z",
                "runsRoot": "/tmp/run",
                "taskIds": ["sensitive-policy-empty-v1"],
                "modes": ["markdown", "cr-mcp"],
                "arms": [],
                "comparisons": [
                    {
                        "taskId": "sensitive-policy-empty-v1",
                        "variant": "policy-blind",
                        "evaluationKind": "fresh-session-readback",
                        "samplePairs": 1,
                        "markdownBlockedLeakage": {
                            "hitCount": 0,
                            "total": 0,
                            "rate": None,
                            "samplesWithLeakage": 0,
                        },
                        "crBlockedLeakage": {
                            "hitCount": 0,
                            "total": 0,
                            "rate": None,
                            "samplesWithLeakage": 0,
                        },
                        "accessReductionVsMarkdown": None,
                    }
                ],
                "failures": [],
            }
        )

        self.assertIn("0/0 (n/a)", report)


if __name__ == "__main__":
    unittest.main()
