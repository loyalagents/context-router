#!/usr/bin/env python3
import json
import re
import shutil
from pathlib import Path


PREDICTION_PATH = Path("/app/outputs/prediction.json")
EXPECTED_BENCHMARK = Path("/tests/expected/benchmark.json")
ARTIFACT_ROOT = Path("/logs/artifacts")
REWARD_DIR = Path("/logs/verifier")


def load_json(path):
    with path.open("r", encoding="utf-8") as handle:
        return json.load(handle)


def write_json(path, payload):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def normalize_text(value):
    text = re.sub(r"[^a-z0-9]+", " ", str(value).lower())
    return " ".join(text.split())


def flatten_snapshot(snapshot):
    if not isinstance(snapshot, dict):
        return {}
    if any(isinstance(key, str) and ":" in key for key in snapshot):
        return {str(key): value for key, value in snapshot.items()}
    out = {}
    for group, values in snapshot.items():
        if isinstance(values, dict):
            for key, value in values.items():
                out[f"{group}:{key}"] = value
    return out


def drop_excluded(value):
    if isinstance(value, dict):
        out = {}
        for key, child in value.items():
            if str(key).lower() in {"priority", "schedule_date", "schedule_dates"}:
                continue
            cleaned = drop_excluded(child)
            if cleaned not in (None, "", [], {}):
                out[key] = cleaned
        return out
    if isinstance(value, list):
        return [drop_excluded(child) for child in value]
    return value


def values_match(actual, expected):
    if actual == expected:
        return True
    if isinstance(actual, str) and isinstance(expected, str):
        actual_text = normalize_text(actual)
        expected_text = normalize_text(expected)
        return actual_text == expected_text or (expected_text and expected_text in actual_text)
    return False


def get_path(value, path):
    cur = value
    for part in str(path).split("."):
        if isinstance(cur, dict) and part in cur:
            cur = cur[part]
        else:
            return None
    return cur


def state_expected(checkpoint):
    pack_keys = (checkpoint.get("state_completion_pack") or {}).get("keys") or {}
    validated = flatten_snapshot(checkpoint.get("validated_snapshot_state") or {})
    expected = {}
    for key in sorted(pack_keys):
        value = drop_excluded(validated.get(key))
        if value not in (None, "", [], {}):
            expected[key] = value
    return expected


def score_state(checkpoint, prediction):
    expected = state_expected(checkpoint)
    actual = flatten_snapshot(prediction.get("snapshot_state") or {})
    missing, wrong = [], []
    for key, expected_value in expected.items():
        if key not in actual:
            missing.append(key)
        elif not values_match(actual[key], expected_value):
            wrong.append({"key": key, "expected": expected_value, "actual": actual[key]})
    correct = len(expected) - len(missing) - len(wrong)
    return {
        "total": len(expected),
        "correct": correct,
        "accuracy": correct / len(expected) if expected else 0.0,
        "missing": missing,
        "wrong": wrong,
    }


def expected_apply_items(checkpoint):
    out = []
    keys = ((checkpoint.get("rq3_apply_service_qa") or {}).get("keys") or {})
    for state_key, node in sorted(keys.items()):
        for item in node.get("items") or []:
            if isinstance(item, dict):
                out.append((state_key, item))
    return out


def score_user_communication(answer, points):
    if isinstance(points, dict):
        points = []
    text = normalize_text(answer)
    point_scores = []
    for point in points:
        if point.get("point_role") == "identity_gate":
            continue
        ref = point.get("reference_value")
        if ref is None:
            continue
        if isinstance(ref, list):
            ok = all(normalize_text(item) in text for item in ref)
        else:
            ok = normalize_text(ref) in text
        point_scores.append(1.0 if ok else 0.0)
    if not point_scores:
        return 1.0 if str(answer).strip() else 0.0
    return sum(point_scores) / len(point_scores)


def score_structured_answer(answer, item):
    reference_output = item.get("reference_output")
    if answer == reference_output:
        return 1.0
    points = item.get("answer_scoring_points") or []
    scores = []
    for point in points:
        target_path = point.get("target_path") or point.get("output_field_path")
        if not target_path:
            continue
        expected = point.get("reference_value")
        actual = get_path(answer, target_path)
        scores.append(1.0 if values_match(actual, expected) else 0.0)
    if scores:
        return sum(scores) / len(scores)
    return 1.0 if answer == reference_output else 0.0


def score_apply(checkpoint, prediction):
    predicted = prediction.get("rq3_apply_answers") or {}
    rows, scores = [], []
    for state_key, item in expected_apply_items(checkpoint):
        qa_id = str(item.get("qa_id") or "")
        pred_items = ((predicted.get(state_key) or {}).get("items") or [])
        pred_item = next((row for row in pred_items if str(row.get("qa_id") or "") == qa_id), None)
        if not isinstance(pred_item, dict):
            rows.append({"stateKey": state_key, "qaId": qa_id, "score": 0.0, "reason": "missing"})
            scores.append(0.0)
            continue
        answer = pred_item.get("answer")
        if str(item.get("service_family") or "") == "user_communication":
            if values_match(answer, item.get("reference_answer") or ""):
                score = 1.0
            else:
                score = score_user_communication(answer, item.get("answer_scoring_points") or [])
        else:
            score = score_structured_answer(answer, item)
        rows.append({"stateKey": state_key, "qaId": qa_id, "score": score, "reason": "deterministic-local"})
        scores.append(score)
    return {
        "total": len(scores),
        "correct": sum(1 for score in scores if score >= 0.999),
        "meanScore": sum(scores) / len(scores) if scores else 0.0,
        "items": rows,
    }


def score_checkpoint(checkpoint, prediction):
    state = score_state(checkpoint, prediction)
    apply = score_apply(checkpoint, prediction)
    reward = (state["accuracy"] + apply["meanScore"]) / 2 if apply["total"] else state["accuracy"]
    return {
        "checkpointId": str(checkpoint.get("checkpoint_id") or ""),
        "checkpointTimestamp": (checkpoint.get("as_of") or {}).get("timestamp"),
        "reward": reward,
        "stateCompletion": state,
        "personalizedService": apply,
        "missingFields": state["missing"],
        "wrongFields": state["wrong"],
    }


def aggregate_checkpoints(rows):
    if not rows:
        return {
            "reward": 0.0,
            "stateAccuracy": 0.0,
            "applyMeanScore": 0.0,
            "stateTotal": 0,
            "stateCorrect": 0,
            "applyTotal": 0,
            "applyCorrect": 0,
            "missingFields": [],
            "wrongFields": [],
        }
    state_total = sum(row["stateCompletion"]["total"] for row in rows)
    state_correct = sum(row["stateCompletion"]["correct"] for row in rows)
    apply_total = sum(row["personalizedService"]["total"] for row in rows)
    apply_correct = sum(row["personalizedService"]["correct"] for row in rows)
    missing = []
    wrong = []
    for row in rows:
        checkpoint_id = row["checkpointId"]
        missing.extend(
            {"checkpointId": checkpoint_id, "key": key}
            for key in row["stateCompletion"]["missing"]
        )
        wrong.extend(
            {"checkpointId": checkpoint_id, **item}
            for item in row["stateCompletion"]["wrong"]
        )
    state_accuracy = state_correct / state_total if state_total else 0.0
    apply_mean = (
        sum(
            item["score"]
            for row in rows
            for item in row["personalizedService"]["items"]
        )
        / apply_total
        if apply_total
        else 0.0
    )
    return {
        "reward": sum(row["reward"] for row in rows) / len(rows),
        "stateAccuracy": state_accuracy,
        "applyMeanScore": apply_mean,
        "stateTotal": state_total,
        "stateCorrect": state_correct,
        "applyTotal": apply_total,
        "applyCorrect": apply_correct,
        "missingFields": missing,
        "wrongFields": wrong,
    }


def main():
    benchmark = load_json(EXPECTED_BENCHMARK)
    checkpoints = benchmark.get("checkpoints") or []
    if not PREDICTION_PATH.exists():
        summary = {
            "reward": 0.0,
            "parseSuccess": False,
            "error": f"Missing output file: {PREDICTION_PATH}",
        }
        write_json(ARTIFACT_ROOT / "score-summary.json", summary)
        write_json(REWARD_DIR / "reward.json", {"reward": 0.0})
        return

    try:
        raw = load_json(PREDICTION_PATH)
        parse_success = isinstance(raw, dict)
    except Exception as error:
        summary = {"reward": 0.0, "parseSuccess": False, "error": str(error)}
        write_json(ARTIFACT_ROOT / "score-summary.json", summary)
        write_json(REWARD_DIR / "reward.json", {"reward": 0.0})
        return

    predictions = raw.get("predictions") if isinstance(raw, dict) else None
    predictions_by_id = {}
    if isinstance(predictions, list):
        for item in predictions:
            if isinstance(item, dict):
                predictions_by_id[str(item.get("checkpoint_id") or "")] = item

    checkpoint_rows = []
    missing_predictions = []
    for checkpoint in checkpoints:
        checkpoint_id = str(checkpoint.get("checkpoint_id") or "")
        prediction = predictions_by_id.get(checkpoint_id)
        if not isinstance(prediction, dict):
            missing_predictions.append(checkpoint_id)
            prediction = {}
        checkpoint_rows.append(score_checkpoint(checkpoint, prediction))

    aggregate = aggregate_checkpoints(checkpoint_rows)
    metadata_success = (
        raw.get("task_contract_version") == benchmark.get("task_contract_version")
        and raw.get("research_frame_version") == benchmark.get("research_frame_version")
        and not missing_predictions
    )
    reward = aggregate["reward"]
    if not metadata_success:
        reward *= 0.5

    summary = {
        "reward": reward,
        "fieldAccuracy": aggregate["stateAccuracy"],
        "parseSuccess": parse_success,
        "metadataSuccess": metadata_success,
        "metadataErrors": [] if metadata_success else ["prediction contract metadata mismatch or missing checkpoint prediction"],
        "missingCheckpointPredictions": missing_predictions,
        "checkpointCount": len(checkpoints),
        "checkpoints": checkpoint_rows,
        "stateCompletion": {
            "total": aggregate["stateTotal"],
            "correct": aggregate["stateCorrect"],
            "accuracy": aggregate["stateAccuracy"],
        },
        "personalizedService": {
            "total": aggregate["applyTotal"],
            "correct": aggregate["applyCorrect"],
            "meanScore": aggregate["applyMeanScore"],
        },
        "missingFields": aggregate["missingFields"],
        "wrongFields": aggregate["wrongFields"],
        "overfillFields": [],
        "outputRoot": "outputs",
        "outputFiles": ["prediction.json"],
        "officialDynamicMemJudge": "not-run-in-harbor-local-scorer",
        "note": "This deterministic Harbor scorer is a trajectory smoke/verifier proxy. The output contract is upstream DynamicMem-compatible for official LLM-as-judge evaluation.",
    }
    ARTIFACT_ROOT.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(PREDICTION_PATH, ARTIFACT_ROOT / "prediction.json")
    write_json(ARTIFACT_ROOT / "score-summary.json", summary)
    write_json(
        REWARD_DIR / "reward.json",
        {
            "reward": reward,
            "state_completion_accuracy": aggregate["stateAccuracy"],
            "rq3_apply_mean_score": aggregate["applyMeanScore"],
            "parse_success": 1.0 if parse_success else 0.0,
            "metadata_success": 1.0 if metadata_success else 0.0,
        },
    )


if __name__ == "__main__":
    main()
