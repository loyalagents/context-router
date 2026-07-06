from __future__ import annotations

import json
import math
import tempfile
import unittest
from pathlib import Path

from report_cr_overhead import build_report


def write_json(path: Path, payload: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, sort_keys=True), encoding="utf-8")


def write_text(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")


def model_step(
    *,
    total_tokens: int,
    input_tokens: int | None = None,
    output_tokens: int = 1,
    next_stage_text: str | None = None,
) -> dict:
    prompt_tokens = input_tokens if input_tokens is not None else total_tokens - output_tokens
    step = {
        "model_name": "gpt-test",
        "metrics": {
            "prompt_tokens": prompt_tokens,
            "completion_tokens": output_tokens,
            "cached_tokens": 0,
            "extra": {
                "reasoning_output_tokens": 0,
                "total_tokens": total_tokens,
            },
        },
    }
    if next_stage_text is not None:
        step["tool_calls"] = [{"arguments": {"cmd": "./next_stage"}}]
        step["observation"] = {"results": [{"content": next_stage_text}]}
    return step


def cr_tool_step(
    *,
    tool: str,
    arguments: object,
    output: str,
    total_tokens: int,
    call_id: str,
) -> dict:
    step = model_step(total_tokens=total_tokens)
    step["tool_calls"] = [
        {
            "tool_call_id": call_id,
            "function_name": tool,
            "arguments": arguments,
        }
    ]
    step["observation"] = {
        "results": [
            {
                "source_call_id": call_id,
                "content": output,
            }
        ]
    }
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


def write_stage_log(trial: Path, stages: list[dict]) -> None:
    write_text(
        trial / "artifacts" / "app" / "stage-log.jsonl",
        "\n".join(json.dumps(stage) for stage in [*stages, {"done": True}]) + "\n",
    )


class CrOverheadReportTests(unittest.TestCase):
    def test_staged_trial_assigns_cr_tools_and_tokens_to_visible_stages(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            trial = root / "dynamicmem-v1" / "cr-mcp" / "sample-01" / "trial-001"
            write_json(
                trial / "agent" / "trajectory.json",
                trajectory(
                    [
                        model_step(total_tokens=10, next_stage_text="Revealed stage 1"),
                        cr_tool_step(
                            tool="listPreferenceSlugs",
                            arguments={"category": None},
                            output='{"success":true,"slugs":["meal","seat"]}',
                            total_tokens=20,
                            call_id="call-list",
                        ),
                        cr_tool_step(
                            tool="mutatePreferences",
                            arguments={"preferences": [{"slug": "meal", "value": "veg"}]},
                            output='{"success":true,"mutated":1}',
                            total_tokens=30,
                            call_id="call-mutate",
                        ),
                        model_step(total_tokens=40, next_stage_text="Revealed stage 2"),
                        cr_tool_step(
                            tool="searchPreferences",
                            arguments={"query": "meal"},
                            output='{"success":true,"results":[{"slug":"meal"}]}',
                            total_tokens=50,
                            call_id="call-search",
                        ),
                    ],
                    cost=0.15,
                ),
            )
            write_stage_log(
                trial,
                [
                    {
                        "stageId": "01-memory-update",
                        "kind": "memory-update",
                        "stageIndex": 1,
                    },
                    {
                        "stageId": "02-downstream-task",
                        "kind": "downstream-task",
                        "stageIndex": 2,
                    },
                ],
            )

            report = build_report(root)

        stage_rows = {
            (row["arm"], row["stage"]): row for row in report["stageTokenRows"]
        }
        self.assertEqual(stage_rows[("cr-mcp", "overhead")]["totalTokens"], 10)
        self.assertEqual(stage_rows[("cr-mcp", "memory-update")]["totalTokens"], 90)
        self.assertEqual(stage_rows[("cr-mcp", "downstream-task")]["totalTokens"], 50)

        tool_rows = {
            (row["stage"], row["tool"]): row for row in report["crToolRows"]
        }
        self.assertEqual(tool_rows[("memory-update", "listPreferenceSlugs")]["calls"], 1)
        self.assertEqual(tool_rows[("memory-update", "mutatePreferences")]["mutated"], 1)
        self.assertEqual(tool_rows[("downstream-task", "searchPreferences")]["resultCount"], 1)
        search_row = tool_rows[("downstream-task", "searchPreferences")]
        self.assertEqual(
            search_row["approxOutputTokens"],
            math.ceil(search_row["outputBytes"] / 4),
        )
        self.assertEqual(report["mcpTraceSummaryCounts"]["missingTraceFiles"], 1)
        self.assertFalse(report["warnings"])

    def test_multi_step_trial_groups_tools_by_step_bucket(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            trial = root / "dynamicmem-v1" / "cr-mcp" / "sample-01" / "trial-001"
            write_json(
                trial / "steps" / "01-memory-build" / "agent" / "trajectory.json",
                trajectory(
                    [
                        cr_tool_step(
                            tool="mutatePreferences",
                            arguments={"preferences": [{"slug": "timezone", "value": "PST"}]},
                            output='{"success":true,"mutated":1}',
                            total_tokens=110,
                            call_id="memory-call",
                        )
                    ],
                    cost=0.03,
                ),
            )
            write_json(
                trial / "steps" / "02-readback" / "agent" / "trajectory.json",
                trajectory(
                    [
                        cr_tool_step(
                            tool="searchPreferences",
                            arguments={"query": "timezone"},
                            output='{"success":true,"results":[{"slug":"timezone"}]}',
                            total_tokens=220,
                            call_id="readback-call",
                        )
                    ],
                    cost=0.05,
                ),
            )

            report = build_report(root)

        stage_rows = {
            (row["stage"], row["arm"]): row for row in report["stageTokenRows"]
        }
        self.assertEqual(stage_rows[("memory-build", "cr-mcp")]["totalTokens"], 110)
        self.assertEqual(stage_rows[("readback", "cr-mcp")]["totalTokens"], 220)

        tool_rows = {
            (row["stage"], row["tool"]): row for row in report["crToolRows"]
        }
        self.assertEqual(tool_rows[("memory-build", "mutatePreferences")]["calls"], 1)
        self.assertEqual(tool_rows[("readback", "searchPreferences")]["calls"], 1)

    def test_matched_cr_vs_markdown_deltas_skip_missing_markdown_rows(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            cr_trial = root / "dynamicmem-v1" / "cr-mcp" / "sample-01" / "trial-001"
            markdown_trial = root / "dynamicmem-v1" / "markdown" / "sample-01" / "trial-001"
            unmatched_cr = root / "dynamicmem-v1" / "cr-mcp" / "sample-02" / "trial-001"
            for trial, total, cost in [
                (cr_trial, 150, 0.15),
                (markdown_trial, 100, 0.10),
                (unmatched_cr, 80, 0.08),
            ]:
                write_json(
                    trial / "agent" / "trajectory.json",
                    trajectory(
                        [
                            model_step(total_tokens=1, next_stage_text="Revealed stage 1"),
                            model_step(total_tokens=total),
                        ],
                        cost=cost,
                    ),
                )
                write_stage_log(
                    trial,
                    [
                        {
                            "stageId": "01-memory-update",
                            "kind": "memory-update",
                            "stageIndex": 1,
                        }
                    ],
                )

            report = build_report(root)

        deltas = report["matchedCrVsMarkdownDeltas"]
        self.assertEqual(len(deltas), 2)
        by_stage = {row["stage"]: row for row in deltas}
        self.assertEqual(by_stage["memory-update"]["deltaTokens"], 50)
        self.assertEqual(by_stage["memory-update"]["ratio"], 1.5)
        self.assertNotIn(
            "sample-02",
            {row["sample"] for row in report["matchedCrVsMarkdownDeltas"]},
        )

    def test_malformed_optional_mcp_trace_warns_but_uses_trajectory_data(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            trial = root / "dynamicmem-v1" / "cr-mcp" / "sample-01" / "trial-001"
            write_json(
                trial / "agent" / "trajectory.json",
                trajectory(
                    [
                        model_step(total_tokens=5, next_stage_text="Revealed stage 1"),
                        cr_tool_step(
                            tool="searchPreferences",
                            arguments={"query": "seat"},
                            output='{"success":true,"results":[{"slug":"seat"}]}',
                            total_tokens=25,
                            call_id="search-call",
                        ),
                    ],
                    cost=0.03,
                ),
            )
            write_stage_log(
                trial,
                [
                    {
                        "stageId": "01-readback",
                        "kind": "readback",
                        "stageIndex": 1,
                    }
                ],
            )
            write_text(
                trial / "artifacts" / "mcp" / "tool-calls.jsonl",
                "\n".join(
                    [
                        "{bad json",
                        json.dumps(
                            {
                                "tool": "searchPreferences",
                                "resultSummary": {
                                    "count": 1,
                                    "mutated": None,
                                    "success": True,
                                },
                            }
                        ),
                    ]
                )
                + "\n",
            )

            report = build_report(root)

        self.assertIn(
            ("readback", "searchPreferences"),
            {(row["stage"], row["tool"]) for row in report["crToolRows"]},
        )
        self.assertEqual(report["mcpTraceSummaryCounts"]["traceFilesFound"], 1)
        self.assertEqual(report["mcpTraceSummaryCounts"]["malformedTraceLines"], 1)
        self.assertTrue(
            any("malformed optional MCP trace" in warning for warning in report["warnings"])
        )


if __name__ == "__main__":
    unittest.main()
