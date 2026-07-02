#!/usr/bin/env python3
import json
import shutil
from pathlib import Path


APP_OUTPUT_ROOT = Path("/app/outputs/forms")
EXPECTED = Path("/tests/expected/forms.json")
ARTIFACT_ROOT = Path("/logs/artifacts")
REWARD_DIR = Path("/logs/verifier")


def load_json(path):
    with path.open("r", encoding="utf-8") as handle:
        return json.load(handle)


def write_json(path, payload):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(payload, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )


def is_blank(value):
    return value in (None, "", [], {})


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


def score_form(form_id, expected_form, expected_schema_version, expected_task_id):
    output_path = APP_OUTPUT_ROOT / f"{form_id}.json"
    expected_fields = expected_form["fields"]
    unsupported_fields = expected_form.get("unsupportedFields", {})

    base = {
        "formId": form_id,
        "outputFile": f"{form_id}.json",
        "totalFields": len(expected_fields),
        "correctFields": 0,
        "missingFields": [],
        "wrongFields": [],
        "overfillFields": [],
        "metadataErrors": [],
        "parseSuccess": False,
    }

    if not output_path.exists():
        return {
            **base,
            "missingFields": sorted(expected_fields),
            "error": f"Missing output file: {output_path}",
        }

    try:
        actual = load_json(output_path)
    except Exception as error:
        return {
            **base,
            "missingFields": sorted(expected_fields),
            "error": str(error),
        }

    if not isinstance(actual, dict):
        return {
            **base,
            "missingFields": sorted(expected_fields),
            "error": "Output JSON must be an object.",
        }

    metadata_errors = score_metadata(
        actual,
        form_id,
        expected_schema_version,
        expected_task_id,
    )

    actual_fields = actual.get("fields", {})
    if not isinstance(actual_fields, dict):
        return {
            **base,
            "missingFields": sorted(expected_fields),
            "metadataErrors": metadata_errors,
            "error": "Output JSON must contain an object at `fields`.",
        }

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

    overfill = []
    allowed_keys = set(expected_fields) | set(unsupported_fields)
    for key, value in actual_fields.items():
        if key not in allowed_keys:
            overfill.append({"field": key, "actual": value, "reason": "unknown-field"})
        elif key in unsupported_fields and not is_blank(value):
            overfill.append(
                {
                    "field": key,
                    "actual": value,
                    "reason": "unsupported-field-filled",
                }
            )

    correct = len(expected_fields) - len(missing) - len(wrong)
    return {
        **base,
        "correctFields": correct,
        "missingFields": missing,
        "wrongFields": wrong,
        "overfillFields": overfill,
        "metadataErrors": metadata_errors,
        "parseSuccess": True,
    }


def main():
    expected = load_json(EXPECTED)
    expected_schema_version = expected.get("schemaVersion", 1)
    expected_task_id = expected.get("taskId", "maya-packet-hard-ownership-v1-formfill")
    forms = expected["forms"]
    form_scores = [
        score_form(form_id, form, expected_schema_version, expected_task_id)
        for form_id, form in forms.items()
    ]

    total_fields = sum(score["totalFields"] for score in form_scores)
    correct_fields = sum(score["correctFields"] for score in form_scores)
    parse_failures = sum(0 if score["parseSuccess"] else 1 for score in form_scores)

    missing_fields = []
    wrong_fields = []
    overfill_fields = []
    metadata_errors = []
    for score in form_scores:
        form_id = score["formId"]
        missing_fields.extend(f"{form_id}.{key}" for key in score["missingFields"])
        wrong_fields.extend({**entry, "formId": form_id} for entry in score["wrongFields"])
        overfill_fields.extend(
            {**entry, "formId": form_id} for entry in score["overfillFields"]
        )
        metadata_errors.extend(
            {**entry, "formId": form_id} for entry in score["metadataErrors"]
        )

    field_accuracy = correct_fields / total_fields if total_fields else 0.0
    overfill_penalty = len(overfill_fields)
    metadata_penalty = len(metadata_errors)
    reward = (
        max(0, correct_fields - overfill_penalty - metadata_penalty) / total_fields
        if total_fields
        else 0.0
    )

    summary = {
        "reward": reward,
        "fieldAccuracy": field_accuracy,
        "parseSuccess": parse_failures == 0,
        "parseFailures": parse_failures,
        "metadataSuccess": parse_failures == 0 and len(metadata_errors) == 0,
        "metadataFailures": len(metadata_errors),
        "totalForms": len(forms),
        "totalFields": total_fields,
        "correctFields": correct_fields,
        "missingFields": missing_fields,
        "wrongFields": wrong_fields,
        "overfillFields": overfill_fields,
        "metadataErrors": metadata_errors,
        "outputFiles": [f"{form_id}.json" for form_id in forms],
        "formScores": form_scores,
    }

    for form_id in forms:
        output_path = APP_OUTPUT_ROOT / f"{form_id}.json"
        if output_path.exists():
            artifact_output = ARTIFACT_ROOT / "outputs/forms" / f"{form_id}.json"
            artifact_output.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(output_path, artifact_output)

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
