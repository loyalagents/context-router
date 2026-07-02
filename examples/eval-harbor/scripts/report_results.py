#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime
from pathlib import Path
from typing import Any


SCORE_PATH = Path("artifacts/logs/artifacts/score-summary.json")
FORM_OUTPUT_ROOT = Path("artifacts/app/outputs/forms")
GENERIC_OUTPUT_ROOT = Path("artifacts/app/outputs")
DEFAULT_OUTPUT_FILES = ["new-hire.json"]
CR_SNAPSHOT_PATH = Path("artifacts/memory/cr-snapshot.json")
MCP_TRACE_PATH = Path("artifacts/mcp/tool-calls.jsonl")


def load_json(path: Path) -> dict[str, Any]:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError as error:
        raise ValueError(f"missing file: {path}") from error
    except json.JSONDecodeError as error:
        raise ValueError(f"malformed JSON: {path}: {error}") from error


def parse_timestamp(value: str | None) -> datetime | None:
    if not value:
        return None
    normalized = value.replace("Z", "+00:00")
    return datetime.fromisoformat(normalized)


def duration_seconds(result: dict[str, Any]) -> float | None:
    started = parse_timestamp(result.get("started_at"))
    finished = parse_timestamp(result.get("finished_at"))
    if not started or not finished:
        return None
    return round((finished - started).total_seconds(), 1)


def find_trial_dir(path: Path) -> Path:
    if path.is_file() and path.name == "result.json":
        path = path.parent

    candidates = sorted(
        child
        for child in path.iterdir()
        if child.is_dir()
        and (child / "config.json").exists()
        and (child / "result.json").exists()
    )
    if len(candidates) == 1:
        return candidates[0]
    if len(candidates) > 1:
        raise ValueError(
            f"expected exactly one Harbor trial directory under {path}, "
            f"found {len(candidates)}"
        )

    if (path / "config.json").exists() and (path / "result.json").exists():
        return path

    raise ValueError(f"no Harbor trial directory found under {path}")


def count_wrong_fields(wrong_fields: Any) -> int:
    if isinstance(wrong_fields, list):
        return len(wrong_fields)
    return 0


def count_list(value: Any) -> int:
    if isinstance(value, list):
        return len(value)
    return 0


def read_mcp_tools(trace_path: Path) -> list[str]:
    if not trace_path.exists():
        return []
    tools: list[str] = []
    for line in trace_path.read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        payload = json.loads(line)
        tool = payload.get("tool")
        if isinstance(tool, str):
            tools.append(tool)
    return tools


def read_cr_preference_count(snapshot_path: Path) -> int | None:
    if not snapshot_path.exists():
        return None
    snapshot = load_json(snapshot_path)
    preferences = snapshot.get("preferences")
    if isinstance(preferences, dict):
        return len(preferences)
    if isinstance(preferences, list):
        return len(preferences)
    raise ValueError(f"malformed CR snapshot preferences: {snapshot_path}")


def output_files_from_score(score: dict[str, Any]) -> list[str]:
    output_files = score.get("outputFiles")
    if isinstance(output_files, list) and all(
        isinstance(item, str) for item in output_files
    ):
        return output_files
    return DEFAULT_OUTPUT_FILES


def output_root_from_score(score: dict[str, Any]) -> Path:
    if str(score.get("outputRoot") or "").strip() == "outputs":
        return GENERIC_OUTPUT_ROOT
    return FORM_OUTPUT_ROOT


def find_score_path(trial_dir: Path) -> Path:
    root_score = trial_dir / SCORE_PATH
    if root_score.exists():
        return root_score
    step_scores = sorted(trial_dir.glob(f"steps/*/{SCORE_PATH.as_posix()}"))
    if len(step_scores) == 1:
        return step_scores[0]
    if len(step_scores) > 1:
        raise ValueError(
            f"expected exactly one step score-summary.json under {trial_dir}, "
            f"found {len(step_scores)}"
        )
    raise ValueError(f"missing file: {root_score}")


def artifact_root_for_score(score_path: Path) -> Path:
    return score_path.parents[2]


def summarize_run(mode: str, path: Path) -> dict[str, Any]:
    trial_dir = find_trial_dir(path)
    result = load_json(trial_dir / "result.json")
    config = load_json(trial_dir / "config.json")

    validation_errors: list[str] = []

    try:
        score_path = find_score_path(trial_dir)
        artifact_root = artifact_root_for_score(score_path)
        score = load_json(score_path)
    except ValueError as error:
        artifact_root = trial_dir / "artifacts"
        score = {}
        validation_errors.append(str(error))

    output_root = output_root_from_score(score)
    for output_file in output_files_from_score(score):
        final_output = artifact_root / output_root.relative_to("artifacts") / output_file
        if not final_output.exists():
            validation_errors.append(f"missing final output: {final_output}")
        else:
            try:
                load_json(final_output)
            except ValueError as error:
                validation_errors.append(str(error))

    mcp_trace = artifact_root / MCP_TRACE_PATH.relative_to("artifacts")
    try:
        mcp_tools = read_mcp_tools(mcp_trace)
    except (ValueError, json.JSONDecodeError) as error:
        mcp_tools = []
        validation_errors.append(f"malformed MCP trace: {mcp_trace}: {error}")

    try:
        cr_preference_count = read_cr_preference_count(
            artifact_root / CR_SNAPSHOT_PATH.relative_to("artifacts")
        )
    except ValueError as error:
        cr_preference_count = None
        validation_errors.append(str(error))

    agent_info = result.get("agent_info") or {}
    model_info = agent_info.get("model_info") or {}
    agent_config = config.get("agent") or {}
    agent_kwargs = agent_config.get("kwargs") or {}
    rewards = (result.get("verifier_result") or {}).get("rewards") or {}

    reward = score.get("reward", rewards.get("reward"))
    field_accuracy = score.get("fieldAccuracy", rewards.get("field_accuracy"))
    parse_success = score.get("parseSuccess")
    if parse_success is None and "parse_success" in rewards:
        parse_success = rewards["parse_success"] == 1.0

    missing_fields = score.get("missingFields", [])
    wrong_fields = score.get("wrongFields", [])
    overfill_fields = score.get("overfillFields", [])
    metadata_errors = score.get("metadataErrors")
    metadata_count = count_list(metadata_errors) if isinstance(metadata_errors, list) else None

    return {
        "mode": mode,
        "trialDir": str(trial_dir),
        "artifactRoot": str(artifact_root),
        "taskName": result.get("task_name"),
        "agent": agent_info.get("name") or agent_config.get("name"),
        "agentVersion": agent_info.get("version"),
        "model": model_info.get("name") or agent_config.get("model_name"),
        "reasoningEffort": (
            agent_kwargs.get("reasoning_effort")
            or agent_config.get("reasoning_effort")
            or "n/a"
        ),
        "serviceTier": (
            agent_kwargs.get("service_tier")
            or agent_config.get("service_tier")
            or "standard"
        ),
        "runtimeSeconds": duration_seconds(result),
        "reward": reward,
        "fieldAccuracy": field_accuracy,
        "parseSuccess": parse_success,
        "parseFailures": score.get("parseFailures", 0 if parse_success is True else 1),
        "metadataSuccess": score.get("metadataSuccess"),
        "metadataCount": metadata_count,
        "missingCount": count_list(missing_fields),
        "wrongCount": count_wrong_fields(wrong_fields),
        "overfillCount": count_list(overfill_fields),
        "missingFields": missing_fields,
        "wrongFields": wrong_fields,
        "overfillFields": overfill_fields,
        "stateCompletionAccuracy": (score.get("stateCompletion") or {}).get("accuracy"),
        "rq3ApplyMeanScore": (score.get("personalizedService") or {}).get("meanScore"),
        "metadataErrors": metadata_errors if isinstance(metadata_errors, list) else [],
        "mcpTools": mcp_tools,
        "crPreferenceCount": cr_preference_count,
        "validationErrors": validation_errors,
    }


def fmt_value(value: Any) -> str:
    if value is None:
        return "n/a"
    if isinstance(value, float):
        return f"{value:.3f}"
    return str(value)


def fmt_bool(value: Any) -> str:
    if value is True:
        return "yes"
    if value is False:
        return "no"
    return "n/a"


def markdown_table(rows: list[dict[str, Any]]) -> str:
    lines = [
        "| Mode | Agent | Model | Reasoning Effort | Service Tier | Reward | Field Accuracy | State Acc. | Service Mean | Parse Failures | Metadata | Missing | Wrong | Overfill | Artifacts OK | Runtime (s) | Artifact Root |",
        "| --- | --- | --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- | ---: | --- |",
    ]
    for row in rows:
        lines.append(
            "| {mode} | {agent} | {model} | {reasoning_effort} | {service_tier} | {reward} | {field} | {state} | {service} | {parse_failures} | {metadata} | {missing} | {wrong} | {overfill} | {artifacts_ok} | {runtime} | `{artifact}` |".format(
                mode=row["mode"],
                agent=row["agent"],
                model=row["model"],
                reasoning_effort=row["reasoningEffort"],
                service_tier=row["serviceTier"],
                reward=fmt_value(row["reward"]),
                field=fmt_value(row["fieldAccuracy"]),
                state=fmt_value(row["stateCompletionAccuracy"]),
                service=fmt_value(row["rq3ApplyMeanScore"]),
                parse_failures=row["parseFailures"],
                metadata=fmt_value(row["metadataCount"]),
                missing=row["missingCount"],
                wrong=row["wrongCount"],
                overfill=row["overfillCount"],
                artifacts_ok=fmt_bool(not row["validationErrors"]),
                runtime=fmt_value(row["runtimeSeconds"]),
                artifact=row["artifactRoot"],
            )
        )
    return "\n".join(lines)


def detail_sections(rows: list[dict[str, Any]]) -> str:
    sections: list[str] = []
    for row in rows:
        lines = [f"### {row['mode']}"]
        lines.append(f"- Trial: `{row['trialDir']}`")
        if row["mcpTools"]:
            lines.append(f"- MCP tools: `{', '.join(row['mcpTools'])}`")
        if row["crPreferenceCount"] is not None:
            lines.append(f"- CR preferences: `{row['crPreferenceCount']}`")
        if row["missingFields"]:
            lines.append(f"- Missing fields: `{json.dumps(row['missingFields'])}`")
        if row["wrongFields"]:
            lines.append(f"- Wrong fields: `{json.dumps(row['wrongFields'])}`")
        if row["overfillFields"]:
            lines.append(f"- Overfill fields: `{json.dumps(row['overfillFields'])}`")
        if row["metadataErrors"]:
            lines.append(f"- Metadata errors: `{json.dumps(row['metadataErrors'])}`")
        if row["validationErrors"]:
            lines.append(
                f"- Validation errors: `{json.dumps(row['validationErrors'])}`"
            )
        if len(lines) == 1:
            lines.append("- No field errors.")
        sections.append("\n".join(lines))
    return "\n\n".join(sections)


def build_report(rows: list[dict[str, Any]]) -> str:
    return "\n\n".join(
        [
            "# Harbor Eval Report",
            markdown_table(rows),
            "## Details",
            detail_sections(rows),
            "",
        ]
    )


def parse_run_spec(value: str) -> tuple[str, Path]:
    if "=" not in value:
        raise argparse.ArgumentTypeError("run must use MODE=PATH")
    mode, raw_path = value.split("=", 1)
    if not mode:
        raise argparse.ArgumentTypeError("run mode must not be empty")
    path = Path(raw_path).expanduser()
    if not path.exists():
        raise argparse.ArgumentTypeError(f"run path does not exist: {path}")
    return mode, path


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Build a Markdown comparison report from Harbor eval outputs."
    )
    parser.add_argument(
        "--run",
        action="append",
        required=True,
        type=parse_run_spec,
        metavar="MODE=PATH",
        help="Mode label and Harbor job/trial directory. Repeat for each arm.",
    )
    parser.add_argument("--output", type=Path, help="Optional Markdown output path.")
    parser.add_argument("--json-output", type=Path, help="Optional JSON output path.")
    parser.add_argument(
        "--allow-invalid",
        action="store_true",
        help="Emit a report but exit 0 even when required artifacts are invalid.",
    )
    args = parser.parse_args()

    rows = [summarize_run(mode, path) for mode, path in args.run]
    report = build_report(rows)
    payload = {"runs": rows}

    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(report, encoding="utf-8")
    else:
        print(report)

    if args.json_output:
        args.json_output.parent.mkdir(parents=True, exist_ok=True)
        args.json_output.write_text(
            json.dumps(payload, indent=2, sort_keys=True) + "\n",
            encoding="utf-8",
        )

    has_validation_errors = any(row["validationErrors"] for row in rows)
    if has_validation_errors and not args.allow_invalid:
        print("error: one or more runs failed artifact validation", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
