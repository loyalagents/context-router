#!/usr/bin/env python3
from __future__ import annotations

import json
import os
import shutil
from pathlib import Path
from typing import Any


OUTPUT_PATH = Path(os.environ.get("FRESHNESS_CANARY_OUTPUT_PATH", "/app/outputs/freshness-canary-report.json"))
EXPECTED_PATH = Path(os.environ.get("FRESHNESS_CANARY_EXPECTED_PATH", "/tests/expected/freshness-canary.json"))
RUNTIME_PROBE_PATH = Path(os.environ.get("FRESHNESS_CANARY_RUNTIME_PATH", "/app/freshness-probe-runtime.json"))
ARTIFACT_ROOT = Path(os.environ.get("FRESHNESS_CANARY_ARTIFACT_ROOT", "/logs/artifacts"))
REWARD_DIR = Path(os.environ.get("FRESHNESS_CANARY_REWARD_DIR", "/logs/verifier"))
MEMORY_MODE = os.environ.get("EVAL_MEMORY_MODE", "unknown")


def load_json(path: Path) -> Any:
    with path.open(encoding="utf-8") as handle:
        return json.load(handle)


def write_json(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def normalize_text(value: Any) -> str:
    return "".join(char for char in str(value).lower() if char.isalnum())


def answer_payload(answers: dict[str, Any], qid: str) -> dict[str, Any] | None:
    raw = answers.get(qid)
    return raw if isinstance(raw, dict) else None


def answer_matches(actual: Any, expected: str) -> bool:
    return normalize_text(actual) == normalize_text(expected)


def score_allowed(answers: dict[str, Any], expected: dict[str, Any]) -> dict[str, Any]:
    rows: list[dict[str, Any]] = []
    correct = 0
    for record in expected.get("allowedFacts", []):
        qid = str(record.get("id") or "")
        payload = answer_payload(answers, qid)
        if payload is None:
            rows.append({"id": qid, "status": "missing"})
            continue
        if payload.get("abstained") is True:
            rows.append({"id": qid, "status": "abstained"})
        elif answer_matches(payload.get("answer"), str(record.get("value") or "")):
            correct += 1
            rows.append({"id": qid, "status": "correct"})
        else:
            rows.append({"id": qid, "status": "wrong", "actual": payload.get("answer")})
    total = len(expected.get("allowedFacts", []))
    return {
        "total": total,
        "correct": correct,
        "accuracy": correct / total if total else 0.0,
        "carryover": correct > 0,
        "rows": rows,
    }


def score_nonce_absence(answers: dict[str, Any], expected: dict[str, Any]) -> dict[str, Any]:
    rows: list[dict[str, Any]] = []
    absent = 0
    carryover_hits: list[str] = []
    for record in expected.get("nonceFacts", []):
        qid = str(record.get("id") or "")
        value = str(record.get("value") or "")
        payload = answer_payload(answers, qid)
        if payload is None:
            rows.append({"id": qid, "status": "missing"})
            continue
        answer = payload.get("answer")
        answer_empty = answer is None or str(answer).strip() == ""
        if payload.get("abstained") is True and answer_empty:
            absent += 1
            rows.append({"id": qid, "status": "absent"})
        elif answer_matches(answer, value) or normalize_text(value) in normalize_text(answer):
            carryover_hits.append(qid)
            rows.append({"id": qid, "status": "carried_over", "actual": answer})
        else:
            rows.append({"id": qid, "status": "wrong_nonempty", "actual": answer})
    total = len(expected.get("nonceFacts", []))
    return {
        "total": total,
        "absent": absent,
        "accuracy": absent / total if total else 0.0,
        "conversationCarryover": bool(carryover_hits),
        "carryoverHits": carryover_hits,
        "rows": rows,
    }


def main() -> int:
    expected = load_json(EXPECTED_PATH)
    actual: dict[str, Any] = {}
    parse_success = False
    error: str | None = None
    if OUTPUT_PATH.exists():
        try:
            loaded = load_json(OUTPUT_PATH)
            if isinstance(loaded, dict):
                actual = loaded
                parse_success = True
            else:
                error = "freshness-canary-report.json must contain a JSON object"
        except Exception as exc:  # noqa: BLE001 - verifier should record parser errors.
            error = str(exc)
    else:
        error = f"Missing output file: {OUTPUT_PATH}"

    metadata_success = parse_success and actual.get("taskId") == expected.get("taskId")
    answers = actual.get("answers") if isinstance(actual.get("answers"), dict) else {}
    allowed = score_allowed(answers, expected)
    nonce_absence = score_nonce_absence(answers, expected)

    runtime_probe: dict[str, Any] = {}
    runtime_probe_success = False
    if RUNTIME_PROBE_PATH.exists():
        try:
            loaded_probe = load_json(RUNTIME_PROBE_PATH)
            if isinstance(loaded_probe, dict):
                runtime_probe = loaded_probe
                runtime_probe_success = True
        except Exception as exc:  # noqa: BLE001 - verifier should record parser errors.
            runtime_probe = {"error": str(exc)}

    post_cleanup = runtime_probe.get("postCleanup") if isinstance(runtime_probe.get("postCleanup"), dict) else {}
    pre_cleanup = runtime_probe.get("preCleanup") if isinstance(runtime_probe.get("preCleanup"), dict) else {}
    filesystem_carryover = any(
        post_cleanup.get(key) is True
        for key in ("appCarryover", "tmpCarryover", "homeCarryover")
    )
    output_freshness = actual.get("freshness") if isinstance(actual.get("freshness"), dict) else {}

    positive_control_required = MEMORY_MODE in {"markdown", "cr-mcp"}
    if positive_control_required:
        positive_control_pass = allowed["accuracy"] == 1.0
    elif MEMORY_MODE == "context-only":
        positive_control_pass = not allowed["carryover"]
    else:
        positive_control_pass = True

    conversation_carryover = bool(nonce_absence["conversationCarryover"])
    if MEMORY_MODE == "context-only" and allowed["carryover"]:
        conversation_carryover = True

    negative_control_required = MEMORY_MODE == "context-only"
    negative_control_pass = (
        nonce_absence["accuracy"] == 1.0 and not conversation_carryover
        if negative_control_required
        else True
    )
    nonce_policy_pass = nonce_absence["accuracy"] == 1.0 and not nonce_absence["conversationCarryover"]
    filesystem_pass = runtime_probe_success and not filesystem_carryover
    output_valid = parse_success and metadata_success
    reward = 1.0 if output_valid and positive_control_pass and negative_control_pass and filesystem_pass else 0.0

    summary: dict[str, Any] = {
        "taskType": "freshness-canary",
        "taskId": expected.get("taskId"),
        "mode": MEMORY_MODE,
        "reward": reward,
        "rewardSource": "deterministic",
        "parseSuccess": parse_success,
        "parseFailures": 0 if parse_success else 1,
        "metadataSuccess": metadata_success,
        "metadataErrors": [] if metadata_success else ["taskId mismatch or malformed output"],
        "allowedRecoverability": allowed,
        "allowedRecoverabilityRequired": positive_control_required,
        "nonceAbsence": nonce_absence,
        "negativeControlRequired": negative_control_required,
        "noncePolicyPass": nonce_policy_pass,
        "freshness": {
            "conversationCarryover": conversation_carryover,
            "appCarryover": post_cleanup.get("appCarryover", runtime_probe.get("appCarryover")),
            "tmpCarryover": post_cleanup.get("tmpCarryover", runtime_probe.get("tmpCarryover")),
            "homeCarryover": post_cleanup.get("homeCarryover", runtime_probe.get("homeCarryover")),
            "preCleanup": pre_cleanup,
            "postCleanup": post_cleanup,
            "checkedPaths": runtime_probe.get("checkedPaths") or {},
            "agentReported": output_freshness,
        },
        "freshnessCanaryPass": reward == 1.0,
        "outputRoot": "outputs",
        "outputFiles": ["freshness-canary-report.json"],
    }
    if error:
        summary["error"] = error

    ARTIFACT_ROOT.mkdir(parents=True, exist_ok=True)
    if OUTPUT_PATH.exists():
        shutil.copy2(OUTPUT_PATH, ARTIFACT_ROOT / "freshness-canary-report.json")
    if RUNTIME_PROBE_PATH.exists():
        shutil.copy2(RUNTIME_PROBE_PATH, ARTIFACT_ROOT / "freshness-probe-runtime.json")
    write_json(ARTIFACT_ROOT / "score-summary.json", summary)
    write_json(
        REWARD_DIR / "reward.json",
        {
            "reward": reward,
            "parse_success": 1.0 if parse_success else 0.0,
            "metadata_success": 1.0 if metadata_success else 0.0,
            "nonce_absence_accuracy": nonce_absence["accuracy"],
            "allowed_recoverability_accuracy": allowed["accuracy"],
            "filesystem_pass": 1.0 if filesystem_pass else 0.0,
        },
    )
    print(json.dumps({"reward": reward, "mode": MEMORY_MODE}, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
