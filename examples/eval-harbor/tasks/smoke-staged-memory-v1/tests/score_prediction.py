#!/usr/bin/env python3
import json
import shutil
from pathlib import Path


PREDICTION_PATH = Path("/app/outputs/prediction.json")
EXPECTED_PATH = Path("/tests/expected/answers.json")
ARTIFACT_ROOT = Path("/logs/artifacts")
REWARD_DIR = Path("/logs/verifier")


def load_json(path):
    with path.open("r", encoding="utf-8") as handle:
        return json.load(handle)


def write_json(path, payload):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def main():
    expected = load_json(EXPECTED_PATH)
    summary = {
        "parseSuccess": False,
        "metadataSuccess": False,
        "totalFields": len(expected["answers"]),
        "correctFields": 0,
        "missingFields": [],
        "wrongFields": [],
    }

    if PREDICTION_PATH.exists():
        try:
            actual = load_json(PREDICTION_PATH)
            summary["parseSuccess"] = isinstance(actual, dict)
            summary["metadataSuccess"] = actual.get("taskId") == expected["taskId"]
            actual_answers = actual.get("answers") if isinstance(actual, dict) else None
            if not isinstance(actual_answers, dict):
                actual_answers = {}
            for key, expected_value in expected["answers"].items():
                if key not in actual_answers:
                    summary["missingFields"].append(key)
                elif actual_answers[key] != expected_value:
                    summary["wrongFields"].append(
                        {
                            "field": key,
                            "expected": expected_value,
                            "actual": actual_answers[key],
                        }
                    )
                else:
                    summary["correctFields"] += 1
        except Exception as error:
            summary["error"] = str(error)
    else:
        summary["error"] = f"Missing output file: {PREDICTION_PATH}"

    summary["reward"] = summary["correctFields"] / summary["totalFields"]

    ARTIFACT_ROOT.mkdir(parents=True, exist_ok=True)
    if PREDICTION_PATH.exists():
        shutil.copy2(PREDICTION_PATH, ARTIFACT_ROOT / "prediction.json")
    stage_log = Path("/app/stage-log.jsonl")
    if stage_log.exists():
        shutil.copy2(stage_log, ARTIFACT_ROOT / "stage-log.jsonl")
    write_json(ARTIFACT_ROOT / "score-summary.json", summary)
    reward = {
        "reward": summary["reward"],
        "parseSuccess": 1.0 if summary["parseSuccess"] else 0.0,
        "metadataSuccess": 1.0 if summary["metadataSuccess"] else 0.0,
        "correctFields": summary["correctFields"],
        "totalFields": summary["totalFields"],
        "missingFieldCount": len(summary["missingFields"]),
        "wrongFieldCount": len(summary["wrongFields"]),
    }
    write_json(REWARD_DIR / "reward.json", reward)

    print(json.dumps(reward, indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
