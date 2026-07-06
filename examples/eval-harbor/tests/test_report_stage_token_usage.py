from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from report_stage_token_usage import build_report


def write_json(path: Path, payload: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, sort_keys=True), encoding="utf-8")


def write_text(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")


def model_step(
    *,
    input_tokens: int,
    output_tokens: int,
    cached_tokens: int,
    reasoning_tokens: int,
    total_tokens: int,
    next_stage_text: str | None = None,
) -> dict:
    step = {
        "model_name": "gpt-test",
        "metrics": {
            "prompt_tokens": input_tokens,
            "completion_tokens": output_tokens,
            "cached_tokens": cached_tokens,
            "extra": {
                "reasoning_output_tokens": reasoning_tokens,
                "total_tokens": total_tokens,
            },
        },
    }
    if next_stage_text is not None:
        step["tool_calls"] = [{"arguments": {"cmd": "./next_stage"}}]
        step["observation"] = {"results": [{"content": next_stage_text}]}
    return step


def trajectory(steps: list[dict], *, cost: float) -> dict:
    return {
        "steps": steps,
        "final_metrics": {
            "total_prompt_tokens": sum(
                step["metrics"]["prompt_tokens"] for step in steps
            ),
            "total_completion_tokens": sum(
                step["metrics"]["completion_tokens"] for step in steps
            ),
            "total_cached_tokens": sum(
                step["metrics"]["cached_tokens"] for step in steps
            ),
            "total_cost_usd": cost,
            "extra": {
                "reasoning_output_tokens": sum(
                    step["metrics"]["extra"]["reasoning_output_tokens"]
                    for step in steps
                ),
                "total_tokens": sum(
                    step["metrics"]["extra"]["total_tokens"] for step in steps
                ),
            },
        },
    }


class StageTokenUsageReportTests(unittest.TestCase):
    def test_reports_existing_staged_layout(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            trial = root / "sensitive-policy-aware-v1" / "markdown" / "sample-01" / "trial-001"
            write_json(
                trial / "agent" / "trajectory.json",
                trajectory(
                    [
                        model_step(
                            input_tokens=10,
                            output_tokens=2,
                            cached_tokens=1,
                            reasoning_tokens=1,
                            total_tokens=12,
                            next_stage_text="Revealed stage 1",
                        ),
                        model_step(
                            input_tokens=20,
                            output_tokens=2,
                            cached_tokens=1,
                            reasoning_tokens=2,
                            total_tokens=22,
                            next_stage_text="Revealed stage 2",
                        ),
                        model_step(
                            input_tokens=30,
                            output_tokens=2,
                            cached_tokens=1,
                            reasoning_tokens=3,
                            total_tokens=32,
                        ),
                    ],
                    cost=0.12,
                ),
            )
            write_text(
                trial / "artifacts" / "app" / "stage-log.jsonl",
                "\n".join(
                    [
                        json.dumps(
                            {
                                "stageId": "01-memory-update",
                                "kind": "memory-update",
                                "stageIndex": 1,
                            }
                        ),
                        json.dumps(
                            {
                                "stageId": "02-downstream-task",
                                "kind": "downstream-task",
                                "stageIndex": 2,
                            }
                        ),
                        json.dumps({"done": True}),
                    ]
                )
                + "\n",
            )

            report = build_report(root)

        self.assertEqual(report["trials"][0]["layout"], "staged")
        rows = {
            row["bucketKind"]: row for row in report["aggregateByTaskModeKind"]
        }
        self.assertEqual(rows["overhead"]["totalTokens"], 12)
        self.assertEqual(rows["memory-update"]["totalTokens"], 22)
        self.assertEqual(rows["downstream-task"]["totalTokens"], 32)
        self.assertEqual(rows["memory-update"]["modelCalls"], 1)
        self.assertAlmostEqual(rows["downstream-task"]["estimatedCostUsd"], 0.12 * 32 / 66)

    def test_reports_multi_step_layout(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            trial = root / "sensitive-policy-readback-v1" / "cr-mcp" / "sample-01" / "trial-001"
            write_json(
                trial / "steps" / "01-memory-build" / "agent" / "trajectory.json",
                trajectory(
                    [
                        model_step(
                            input_tokens=100,
                            output_tokens=10,
                            cached_tokens=40,
                            reasoning_tokens=5,
                            total_tokens=110,
                        ),
                        model_step(
                            input_tokens=200,
                            output_tokens=20,
                            cached_tokens=80,
                            reasoning_tokens=7,
                            total_tokens=220,
                        ),
                    ],
                    cost=0.03,
                ),
            )
            write_json(
                trial / "steps" / "02-readback" / "agent" / "trajectory.json",
                trajectory(
                    [
                        model_step(
                            input_tokens=300,
                            output_tokens=30,
                            cached_tokens=120,
                            reasoning_tokens=9,
                            total_tokens=330,
                        )
                    ],
                    cost=0.05,
                ),
            )

            report = build_report(root)

        trial_report = report["trials"][0]
        self.assertEqual(trial_report["layout"], "multi-step")
        self.assertEqual(trial_report["totalCostUsd"], 0.08)
        self.assertEqual(trial_report["stepCount"], 2)
        rows = {
            row["bucketKind"]: row for row in report["aggregateByTaskModeKind"]
        }
        self.assertEqual(rows["memory-build"]["samples"], 1)
        self.assertEqual(rows["memory-build"]["inputTokens"], 300)
        self.assertEqual(rows["memory-build"]["outputTokens"], 30)
        self.assertEqual(rows["memory-build"]["cachedTokens"], 120)
        self.assertEqual(rows["memory-build"]["reasoningOutputTokens"], 12)
        self.assertEqual(rows["memory-build"]["totalTokens"], 330)
        self.assertEqual(rows["memory-build"]["modelCalls"], 2)
        self.assertEqual(rows["memory-build"]["estimatedCostUsd"], 0.03)
        self.assertEqual(rows["readback"]["totalTokens"], 330)
        self.assertEqual(rows["readback"]["modelCalls"], 1)
        self.assertEqual(rows["readback"]["estimatedCostUsd"], 0.05)


if __name__ == "__main__":
    unittest.main()
