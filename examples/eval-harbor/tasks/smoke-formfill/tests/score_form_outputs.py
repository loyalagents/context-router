#!/usr/bin/env python3
import json
import shutil
from pathlib import Path


APP_OUTPUT = Path("/app/outputs/forms/new-hire.json")
EXPECTED = Path("/tests/expected/forms.json")
ARTIFACT_ROOT = Path("/logs/artifacts")
REWARD_DIR = Path("/logs/verifier")


def load_json(path):
    with path.open("r", encoding="utf-8") as handle:
        return json.load(handle)


def score_fields(expected_fields, actual_fields):
    missing = []
    wrong = []

    for key, expected_value in expected_fields.items():
        if key not in actual_fields:
            missing.append(key)
            continue
        actual_value = actual_fields[key]
        if actual_value != expected_value:
            wrong.append(
                {
                    "field": key,
                    "expected": expected_value,
                    "actual": actual_value,
                }
            )

    overfill = sorted(key for key in actual_fields if key not in expected_fields)
    correct = len(expected_fields) - len(missing) - len(wrong)

    return {
        "totalFields": len(expected_fields),
        "correctFields": correct,
        "missingFields": missing,
        "wrongFields": wrong,
        "overfillFields": overfill,
    }


def score_metadata(actual, form_id, expected_schema_version, expected_task_id):
    errors = []
    expected_values = {
        "schemaVersion": expected_schema_version,
        "taskId": expected_task_id,
        "formId": form_id,
    }
    for field, expected_value in expected_values.items():
        actual_value = actual.get(field)
        if actual_value != expected_value:
            reason = "missing-metadata" if field not in actual else "wrong-metadata"
            errors.append(
                {
                    "field": field,
                    "expected": expected_value,
                    "actual": actual_value,
                    "reason": reason,
                }
            )
    return errors


def write_json(path, payload):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(payload, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )


def main():
    expected_payload = load_json(EXPECTED)
    expected_schema_version = expected_payload.get("schemaVersion", 1)
    expected_task_id = expected_payload.get("taskId", "smoke-formfill")
    form_id = "new-hire"
    expected = expected_payload["forms"][form_id]["fields"]

    if not APP_OUTPUT.exists():
        summary = {
            "reward": 0.0,
            "parseSuccess": False,
            "metadataSuccess": False,
            "metadataFailures": 0,
            "error": f"Missing output file: {APP_OUTPUT}",
            "totalFields": len(expected),
            "correctFields": 0,
            "missingFields": sorted(expected),
            "wrongFields": [],
            "overfillFields": [],
            "metadataErrors": [],
        }
    else:
        try:
            actual = load_json(APP_OUTPUT)
            if not isinstance(actual, dict):
                raise ValueError("Output JSON must be an object.")
            metadata_errors = score_metadata(
                actual,
                form_id,
                expected_schema_version,
                expected_task_id,
            )
            actual_fields = actual.get("fields", {})
            if not isinstance(actual_fields, dict):
                summary = {
                    "reward": 0.0,
                    "parseSuccess": False,
                    "metadataSuccess": len(metadata_errors) == 0,
                    "metadataFailures": len(metadata_errors),
                    "metadataErrors": metadata_errors,
                    "error": "Output JSON must contain an object at `fields`.",
                    "totalFields": len(expected),
                    "correctFields": 0,
                    "missingFields": sorted(expected),
                    "wrongFields": [],
                    "overfillFields": [],
                }
            else:
                summary = {
                    "reward": 0.0,
                    "parseSuccess": True,
                    "metadataSuccess": len(metadata_errors) == 0,
                    "metadataFailures": len(metadata_errors),
                    "metadataErrors": metadata_errors,
                    **score_fields(expected, actual_fields),
                }
        except Exception as error:
            summary = {
                "reward": 0.0,
                "parseSuccess": False,
                "metadataSuccess": False,
                "metadataFailures": 0,
                "error": str(error),
                "totalFields": len(expected),
                "correctFields": 0,
                "missingFields": sorted(expected),
                "wrongFields": [],
                "overfillFields": [],
                "metadataErrors": [],
            }

    if summary["parseSuccess"]:
        total = summary["totalFields"]
        penalty = len(summary["overfillFields"]) + summary["metadataFailures"]
        summary["fieldAccuracy"] = summary["correctFields"] / total if total else 0.0
        summary["reward"] = (
            max(0, summary["correctFields"] - penalty) / total if total else 0.0
        )
    else:
        summary["fieldAccuracy"] = 0.0

    summary["metadataSuccess"] = (
        summary["parseSuccess"] and summary["metadataFailures"] == 0
    )

    if APP_OUTPUT.exists():
        artifact_output = ARTIFACT_ROOT / "outputs/forms/new-hire.json"
        artifact_output.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(APP_OUTPUT, artifact_output)

    write_json(ARTIFACT_ROOT / "score-summary.json", summary)
    write_json(
        REWARD_DIR / "reward.json",
        {
            "reward": summary["reward"],
            "field_accuracy": summary["fieldAccuracy"],
            "parse_success": 1.0 if summary["parseSuccess"] else 0.0,
            "metadata_success": 1.0 if summary["metadataSuccess"] else 0.0,
        },
    )

    raise SystemExit(0)


if __name__ == "__main__":
    main()
