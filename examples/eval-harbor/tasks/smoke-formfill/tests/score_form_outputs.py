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


def write_json(path, payload):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(payload, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )


def main():
    expected = load_json(EXPECTED)["forms"]["new-hire"]["fields"]

    if not APP_OUTPUT.exists():
        summary = {
            "reward": 0.0,
            "parseSuccess": False,
            "error": f"Missing output file: {APP_OUTPUT}",
            "totalFields": len(expected),
            "correctFields": 0,
            "missingFields": sorted(expected),
            "wrongFields": [],
            "overfillFields": [],
        }
    else:
        try:
            actual = load_json(APP_OUTPUT)
            actual_fields = actual.get("fields", {})
            if not isinstance(actual_fields, dict):
                raise ValueError("Output JSON must contain an object at `fields`.")
            summary = {
                "reward": 0.0,
                "parseSuccess": True,
                **score_fields(expected, actual_fields),
            }
        except Exception as error:
            summary = {
                "reward": 0.0,
                "parseSuccess": False,
                "error": str(error),
                "totalFields": len(expected),
                "correctFields": 0,
                "missingFields": sorted(expected),
                "wrongFields": [],
                "overfillFields": [],
            }

    if summary["parseSuccess"]:
        total = summary["totalFields"]
        clean = (
            not summary["wrongFields"]
            and not summary["missingFields"]
            and not summary["overfillFields"]
        )
        summary["fieldAccuracy"] = summary["correctFields"] / total if total else 0.0
        summary["reward"] = 1.0 if clean else summary["fieldAccuracy"]
    else:
        summary["fieldAccuracy"] = 0.0

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
        },
    )

    raise SystemExit(0)


if __name__ == "__main__":
    main()
