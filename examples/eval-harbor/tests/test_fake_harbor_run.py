import json
import tempfile
import unittest
from pathlib import Path
from typing import Optional

from report_results import summarize_run


def write_json(path: Path, payload: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, sort_keys=True), encoding="utf-8")


def write_text(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")


def create_fake_trial(
    root: Path,
    *,
    omit_output: bool = False,
    malformed_output: bool = False,
    codex_trace_items: Optional[list[dict]] = None,
) -> Path:
    trial = root / "trial-001"
    write_json(
        trial / "config.json",
        {
            "task": {"path": "examples/eval-harbor/tasks/smoke-formfill"},
            "agent": {
                "name": "codex",
                "model_name": "gpt-test",
                "kwargs": {
                    "web_search": "disabled",
                    "model_auto_compact_token_limit": 256000,
                },
            },
        },
    )
    write_json(
        trial / "result.json",
        {
            "task_name": "fake-task",
            "started_at": "2026-01-01T00:00:00Z",
            "finished_at": "2026-01-01T00:00:01Z",
            "agent_info": {
                "name": "codex",
                "model_info": {"name": "gpt-test"},
            },
            "usage": {
                "inputTokens": 1,
                "outputTokens": 2,
                "totalTokens": 3,
                "costUsd": 0.01,
            },
            "verifier_result": {"rewards": {"reward": 1.0}},
        },
    )
    write_json(
        trial / "artifacts" / "logs" / "artifacts" / "score-summary.json",
        {
            "reward": 1.0,
            "fieldAccuracy": 1.0,
            "parseSuccess": True,
            "metadataSuccess": True,
            "missingFields": [],
            "wrongFields": [],
            "overfillFields": [],
            "outputRoot": "outputs",
            "outputFiles": ["prediction.json"],
        },
    )
    if not omit_output:
        output_path = trial / "artifacts" / "app" / "outputs" / "prediction.json"
        if malformed_output:
            write_text(output_path, "{not-json")
        else:
            write_json(output_path, {})
    write_text(trial / "artifacts" / "app" / "stage-log.jsonl", "{\"done\": true}\n")

    trace_path = trial / "agent" / "codex.txt"
    trace_lines = [
        json.dumps({"item": item}, sort_keys=True)
        for item in (codex_trace_items or [])
    ]
    write_text(trace_path, "\n".join(trace_lines) + ("\n" if trace_lines else ""))
    return trial


class FakeHarborRunTests(unittest.TestCase):
    def test_summarize_run_accepts_clean_fake_trial(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            trial = create_fake_trial(Path(temp_dir))

            row = summarize_run("context-only", trial)

        self.assertEqual(row["validationErrors"], [])
        self.assertEqual(row["reward"], 1.0)
        self.assertEqual(row["totalTokens"], 3)

    def test_summarize_run_surfaces_policy_violations(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            trial = create_fake_trial(
                Path(temp_dir),
                codex_trace_items=[
                    {
                        "type": "file_change",
                        "changes": [
                            {
                                "path": "/app/notes.md",
                                "kind": "write",
                            }
                        ],
                    }
                ],
            )

            row = summarize_run("context-only", trial)

        self.assertTrue(
            any("disallowed_file_write" in error for error in row["validationErrors"]),
            row["validationErrors"],
        )

    def test_summarize_run_surfaces_missing_output_artifacts(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            trial = create_fake_trial(Path(temp_dir), omit_output=True)

            row = summarize_run("context-only", trial)

        self.assertTrue(
            any("missing final output" in error for error in row["validationErrors"]),
            row["validationErrors"],
        )

    def test_summarize_run_surfaces_malformed_output_artifacts(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            trial = create_fake_trial(Path(temp_dir), malformed_output=True)

            row = summarize_run("context-only", trial)

        self.assertTrue(
            any("malformed JSON" in error for error in row["validationErrors"]),
            row["validationErrors"],
        )


if __name__ == "__main__":
    unittest.main()
