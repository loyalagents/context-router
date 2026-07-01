#!/usr/bin/env python3
import json
import os
import random
import re
import shutil
import urllib.error
import urllib.request
from pathlib import Path


PREDICTION_PATH = Path(os.environ.get("DYNAMICMEM_PREDICTION_PATH", "/app/outputs/prediction.json"))
EXPECTED_BENCHMARK = Path(os.environ.get("DYNAMICMEM_EXPECTED_BENCHMARK", "/tests/expected/benchmark.json"))
ARTIFACT_ROOT = Path(os.environ.get("DYNAMICMEM_ARTIFACT_ROOT", "/logs/artifacts"))
REWARD_DIR = Path(os.environ.get("DYNAMICMEM_REWARD_DIR", "/logs/verifier"))
DEFAULT_LLM_JUDGE_BASE_URL = "https://openrouter.ai/api/v1"
DEFAULT_LLM_JUDGE_MODEL = "google/gemini-3.5-flash"


def env_int(name, default):
    raw = os.environ.get(name)
    if raw in (None, ""):
        return default
    try:
        return int(raw)
    except ValueError:
        return default


def env_float(name, default):
    raw = os.environ.get(name)
    if raw in (None, ""):
        return default
    try:
        return float(raw)
    except ValueError:
        return default


JUDGE_MODE = os.environ.get("DYNAMICMEM_JUDGE_MODE", "llm").strip().lower()
LLM_JUDGE_MODEL = os.environ.get("DYNAMICMEM_LLM_JUDGE_MODEL", DEFAULT_LLM_JUDGE_MODEL).strip()
LLM_JUDGE_MAX_ITEMS = env_int("DYNAMICMEM_LLM_JUDGE_MAX_ITEMS", 0)
LLM_JUDGE_BATCH_SIZE = max(1, env_int("DYNAMICMEM_LLM_JUDGE_BATCH_SIZE", 8))
LLM_JUDGE_SEED = env_int("DYNAMICMEM_LLM_JUDGE_SEED", 13)
LLM_JUDGE_TIMEOUT_SEC = env_float("DYNAMICMEM_LLM_JUDGE_TIMEOUT_SEC", 90.0)


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


def clamp_score(value):
    try:
        score = float(value)
    except (TypeError, ValueError):
        return 0.0
    return max(0.0, min(1.0, score))


def mean(values):
    return sum(values) / len(values) if values else 0.0


def checkpoint_id(checkpoint):
    return str(checkpoint.get("checkpoint_id") or "")


def state_question(checkpoint, state_key):
    item = ((checkpoint.get("state_completion_pack") or {}).get("keys") or {}).get(state_key)
    if isinstance(item, dict):
        return item.get("question_text")
    return None


def predicted_apply_item(prediction, state_key, qa_id):
    predicted = prediction.get("rq3_apply_answers") or {}
    pred_items = ((predicted.get(state_key) or {}).get("items") or [])
    return next((row for row in pred_items if str(row.get("qa_id") or "") == qa_id), None)


def build_llm_judge_items(checkpoints, predictions_by_id):
    items = []
    for checkpoint in checkpoints:
        cp_id = checkpoint_id(checkpoint)
        prediction = predictions_by_id.get(cp_id) or {}
        actual_state = flatten_snapshot(prediction.get("snapshot_state") or {})
        for state_key, expected_value in state_expected(checkpoint).items():
            actual_value = actual_state.get(state_key)
            deterministic_score = 1.0 if state_key in actual_state and values_match(actual_value, expected_value) else 0.0
            items.append(
                {
                    "id": f"{cp_id}::state::{state_key}",
                    "category": "state_completion",
                    "checkpoint_id": cp_id,
                    "state_key": state_key,
                    "question_text": state_question(checkpoint, state_key),
                    "expected": expected_value,
                    "actual": actual_value,
                    "deterministic_score": deterministic_score,
                }
            )
        for state_key, item in expected_apply_items(checkpoint):
            qa_id = str(item.get("qa_id") or "")
            pred_item = predicted_apply_item(prediction, state_key, qa_id)
            actual_answer = pred_item.get("answer") if isinstance(pred_item, dict) else None
            if str(item.get("service_family") or "") == "user_communication":
                deterministic_score = (
                    1.0
                    if values_match(actual_answer, item.get("reference_answer") or "")
                    else score_user_communication(actual_answer, item.get("answer_scoring_points") or [])
                )
            else:
                deterministic_score = score_structured_answer(actual_answer, item)
            items.append(
                {
                    "id": f"{cp_id}::service::{state_key}::{qa_id}",
                    "category": "personalized_service",
                    "checkpoint_id": cp_id,
                    "state_key": state_key,
                    "qa_id": qa_id,
                    "service_family": item.get("service_family"),
                    "scenario": item.get("scenario") or item.get("apply_scenario"),
                    "task_instruction": item.get("task_instruction") or item.get("apply_question") or item.get("question"),
                    "output_template": item.get("output_template"),
                    "reference_answer": item.get("reference_answer"),
                    "reference_output": item.get("reference_output"),
                    "answer_scoring_points": item.get("answer_scoring_points"),
                    "actual": actual_answer,
                    "deterministic_score": clamp_score(deterministic_score),
                }
            )
    return items


def select_llm_items(items):
    if LLM_JUDGE_MAX_ITEMS <= 0 or LLM_JUDGE_MAX_ITEMS >= len(items):
        return items, False
    indexed = list(enumerate(items))
    rng = random.Random(LLM_JUDGE_SEED)
    rng.shuffle(indexed)
    selected = sorted(indexed[:LLM_JUDGE_MAX_ITEMS], key=lambda pair: pair[0])
    return [item for _, item in selected], True


def extract_json_object(text):
    if isinstance(text, dict):
        return text
    if not isinstance(text, str):
        raise ValueError("LLM response content is not text")
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        start = text.find("{")
        end = text.rfind("}")
        if start < 0 or end < start:
            raise
        return json.loads(text[start : end + 1])


def call_openai_json(messages):
    api_key = os.environ.get("DYNAMICMEM_LLM_JUDGE_API_KEY") or os.environ.get("OPENAI_API_KEY")
    if not api_key:
        raise RuntimeError("missing OPENAI_API_KEY or DYNAMICMEM_LLM_JUDGE_API_KEY")
    base_url = (
        os.environ.get("DYNAMICMEM_LLM_JUDGE_BASE_URL")
        or os.environ.get("OPENAI_BASE_URL")
        or DEFAULT_LLM_JUDGE_BASE_URL
    ).rstrip("/")
    request_body = {
        "model": LLM_JUDGE_MODEL,
        "messages": messages,
        "temperature": 0,
        "response_format": {"type": "json_object"},
    }
    try:
        payload = post_openai_json(base_url, api_key, request_body)
    except urllib.error.HTTPError:
        request_body.pop("response_format", None)
        payload = post_openai_json(base_url, api_key, request_body)
    content = payload["choices"][0]["message"]["content"]
    return extract_json_object(content)


def post_openai_json(base_url, api_key, request_body):
    request = urllib.request.Request(
        f"{base_url}/chat/completions",
        data=json.dumps(request_body).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=LLM_JUDGE_TIMEOUT_SEC) as response:
        return json.loads(response.read().decode("utf-8"))


def judge_batch(batch):
    rubric = """You are scoring DynamicMem predictions.

Return a JSON object with exactly this shape:
{"items":[{"id":"...","score":0.0,"label":"correct|partial|wrong|missing","reason":"short"}]}

Use semantic equivalence, not string equality.

Score 1.0 when the actual answer captures the same fact or task result as the reference.
Score 0.5 when it is partly correct but missing important detail.
Score 0.0 when it is missing, contradicted, belongs to the wrong entity, uses stale facts, or invents unsupported details.

For state_completion, judge whether the actual memory value answers the question and preserves the expected durable fact.
For personalized_service, judge whether the actual downstream answer would satisfy the task instruction using the expected reference/scoring points.
Do not give credit for JSON formatting alone if the semantic value is wrong."""
    messages = [
        {"role": "system", "content": rubric},
        {
            "role": "user",
            "content": json.dumps({"items": batch}, ensure_ascii=False, sort_keys=True),
        },
    ]
    payload = call_openai_json(messages)
    rows = payload.get("items")
    if not isinstance(rows, list):
        raise ValueError("LLM judge response missing items list")
    by_id = {}
    for row in rows:
        if not isinstance(row, dict):
            continue
        item_id = str(row.get("id") or "")
        if not item_id:
            continue
        by_id[item_id] = {
            "id": item_id,
            "score": clamp_score(row.get("score")),
            "label": str(row.get("label") or ""),
            "reason": str(row.get("reason") or "")[:500],
        }
    missing = [item["id"] for item in batch if item["id"] not in by_id]
    if missing:
        raise ValueError(f"LLM judge omitted item ids: {missing[:5]}")
    return [by_id[item["id"]] for item in batch]


def judge_batch_resilient(batch):
    try:
        return judge_batch(batch)
    except (urllib.error.URLError, TimeoutError, RuntimeError, ValueError, KeyError, json.JSONDecodeError):
        if len(batch) <= 1:
            raise
        midpoint = max(1, len(batch) // 2)
        return judge_batch_resilient(batch[:midpoint]) + judge_batch_resilient(batch[midpoint:])


def run_llm_judge(checkpoints, predictions_by_id, deterministic_reward, metadata_success):
    all_items = build_llm_judge_items(checkpoints, predictions_by_id)
    if JUDGE_MODE in {"deterministic", "off", "none", "disabled"}:
        return {
            "status": "disabled",
            "mode": JUDGE_MODE,
            "model": LLM_JUDGE_MODEL,
            "totalItems": len(all_items),
        }
    if deterministic_reward >= 0.999 and metadata_success:
        return {
            "status": "skipped-perfect-deterministic",
            "mode": JUDGE_MODE,
            "model": LLM_JUDGE_MODEL,
            "totalItems": len(all_items),
            "judgedItems": 0,
        }
    if not (os.environ.get("DYNAMICMEM_LLM_JUDGE_API_KEY") or os.environ.get("OPENAI_API_KEY")):
        return {
            "status": "skipped-missing-api-key",
            "mode": JUDGE_MODE,
            "model": LLM_JUDGE_MODEL,
            "totalItems": len(all_items),
            "judgedItems": 0,
            "error": "Set OPENAI_API_KEY or DYNAMICMEM_LLM_JUDGE_API_KEY to run LLM-as-judge.",
        }

    selected_items, sampled = select_llm_items(all_items)
    judged = []
    try:
        for index in range(0, len(selected_items), LLM_JUDGE_BATCH_SIZE):
            batch = selected_items[index : index + LLM_JUDGE_BATCH_SIZE]
            judged.extend(judge_batch_resilient(batch))
    except (urllib.error.URLError, TimeoutError, RuntimeError, ValueError, KeyError, json.JSONDecodeError) as error:
        return {
            "status": "error",
            "mode": JUDGE_MODE,
            "model": LLM_JUDGE_MODEL,
            "totalItems": len(all_items),
            "judgedItems": len(judged),
            "sampled": sampled,
            "error": str(error),
        }

    item_meta = {item["id"]: item for item in selected_items}
    rows = []
    for row in judged:
        meta = item_meta[row["id"]]
        rows.append(
            {
                **row,
                "category": meta["category"],
                "checkpointId": meta["checkpoint_id"],
                "stateKey": meta["state_key"],
                "qaId": meta.get("qa_id"),
                "deterministicScore": meta["deterministic_score"],
            }
        )
    state_scores = [row["score"] for row in rows if row["category"] == "state_completion"]
    service_scores = [row["score"] for row in rows if row["category"] == "personalized_service"]
    if state_scores and service_scores:
        reward = (mean(state_scores) + mean(service_scores)) / 2
    elif state_scores:
        reward = mean(state_scores)
    else:
        reward = mean(service_scores)
    return {
        "status": "ok",
        "mode": JUDGE_MODE,
        "model": LLM_JUDGE_MODEL,
        "totalItems": len(all_items),
        "judgedItems": len(rows),
        "sampled": sampled,
        "sampleSeed": LLM_JUDGE_SEED if sampled else None,
        "maxItems": LLM_JUDGE_MAX_ITEMS,
        "batchSize": LLM_JUDGE_BATCH_SIZE,
        "rewardBeforeMetadataPenalty": reward,
        "stateCompletion": {
            "judged": len(state_scores),
            "meanScore": mean(state_scores),
            "correct": sum(1 for score in state_scores if score >= 0.999),
        },
        "personalizedService": {
            "judged": len(service_scores),
            "meanScore": mean(service_scores),
            "correct": sum(1 for score in service_scores if score >= 0.999),
        },
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
    deterministic_reward = reward
    llm_judge = run_llm_judge(checkpoints, predictions_by_id, deterministic_reward, metadata_success)
    reward_source = "deterministic"
    if llm_judge.get("status") == "ok":
        reward = llm_judge["rewardBeforeMetadataPenalty"]
        if not metadata_success:
            reward *= 0.5
        reward_source = "llm-judge"
    elif llm_judge.get("status") in {"skipped-missing-api-key", "error"} and JUDGE_MODE == "llm":
        reward_source = "deterministic-fallback"

    summary = {
        "reward": reward,
        "rewardSource": reward_source,
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
        "llmJudge": llm_judge,
        "deterministic": {
            "reward": deterministic_reward,
            "stateCompletionAccuracy": aggregate["stateAccuracy"],
            "rq3ApplyMeanScore": aggregate["applyMeanScore"],
        },
        "note": "DynamicMem semantic scoring uses the configured LLM judge when available. Deterministic scoring is retained as a proxy and fallback for oracle/local smoke runs.",
    }
    ARTIFACT_ROOT.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(PREDICTION_PATH, ARTIFACT_ROOT / "prediction.json")
    write_json(ARTIFACT_ROOT / "score-summary.json", summary)
    write_json(
        REWARD_DIR / "reward.json",
        {
            "reward": reward,
            "reward_source": reward_source,
            "state_completion_accuracy": aggregate["stateAccuracy"],
            "rq3_apply_mean_score": aggregate["applyMeanScore"],
            "parse_success": 1.0 if parse_success else 0.0,
            "metadata_success": 1.0 if metadata_success else 0.0,
            "llm_judge_status": llm_judge.get("status"),
        },
    )


if __name__ == "__main__":
    main()
