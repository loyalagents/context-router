#!/usr/bin/env python3
"""Static soundness checks for Harbor form-fill tasks."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

from trajectory_framework import (
    STAGE_KIND_DOWNSTREAM_TASK,
    STAGE_KIND_MEMORY_UPDATE,
    STAGE_KIND_UPDATE_ANSWER,
)


HIDDEN_MARKERS = [
    "tests/expected",
    "source-trace",
    "expectedValue",
    "oldFactKey",
    "field-map.json",
    "validation-report",
    "validated_snapshot_state",
    "expected_snapshot_state",
    "reference_answer",
    "reference_output",
    "answer_scoring_points",
    "gold_memory_evidence_app_log_ids",
]


def load_json(path: Path) -> Any:
    with path.open() as handle:
        return json.load(handle)


def visible_agent_text(task_dir: Path) -> str:
    visible_roots = [task_dir / "environment" / "workspace"]
    visible_roots.extend(sorted((task_dir / "steps").glob("*/workdir")))
    parts: list[str] = []
    for root in visible_roots:
        if not root.exists():
            continue
        for path in root.rglob("*"):
            if path.is_file():
                parts.append(path.relative_to(task_dir).as_posix())
                parts.append(path.read_text(errors="ignore"))
    return "\n".join(parts)


def validate_documents_index(
    task_id: str,
    documents_path: Path,
    docs_root: Path,
    *,
    label: str,
) -> tuple[str | None, list[str]]:
    errors: list[str] = []
    documents_index = load_json(documents_path)
    corpus_id = documents_index.get("corpusId")
    indexed_paths = sorted(doc.get("path") for doc in documents_index.get("documents", []))
    actual_paths = sorted(
        path.relative_to(docs_root).as_posix()
        for path in docs_root.rglob("*")
        if path.is_file()
    )
    if indexed_paths != actual_paths:
        missing = sorted(set(actual_paths) - set(indexed_paths))[:10]
        extra = sorted(set(indexed_paths) - set(actual_paths))[:10]
        errors.append(
            f"{task_id}: {label} documents index mismatch "
            f"missing={missing} extra={extra}"
        )
    if len(indexed_paths) != len(set(indexed_paths)):
        errors.append(f"{task_id}: {label} duplicate documents.json paths")
    if documents_index.get("documentsRoot") != "docs":
        errors.append(f"{task_id}: {label} documentsRoot must be docs")
    return corpus_id, errors


def validate_stage_documents_index(
    task_id: str,
    stage_id: str,
    stage_files: list[dict[str, Any]],
) -> tuple[str | None, list[str]]:
    errors: list[str] = []
    by_path = {item.get("path"): item for item in stage_files if isinstance(item, dict)}
    documents_item = by_path.get("documents.json")
    if documents_item is None:
        return None, errors
    documents_index = documents_item.get("json")
    if not isinstance(documents_index, dict):
        errors.append(f"{task_id}: {stage_id} documents.json must be a JSON object")
        return None, errors
    corpus_id = documents_index.get("corpusId")
    indexed_paths = sorted(doc.get("path") for doc in documents_index.get("documents", []))
    actual_paths = sorted(
        path.removeprefix("docs/")
        for path in by_path
        if isinstance(path, str) and path.startswith("docs/")
    )
    if indexed_paths != actual_paths:
        missing = sorted(set(actual_paths) - set(indexed_paths))[:10]
        extra = sorted(set(indexed_paths) - set(actual_paths))[:10]
        errors.append(
            f"{task_id}: {stage_id} staged documents index mismatch "
            f"missing={missing} extra={extra}"
        )
    if len(indexed_paths) != len(set(indexed_paths)):
        errors.append(f"{task_id}: {stage_id} duplicate staged documents paths")
    if documents_index.get("documentsRoot") != "docs":
        errors.append(f"{task_id}: {stage_id} documentsRoot must be docs")
    return corpus_id, errors


def staged_payload(task_dir: Path) -> dict[str, Any] | None:
    payload_path = task_dir / "stages" / "payload.json"
    if not payload_path.exists():
        return None
    return load_json(payload_path)


def staged_agent_text(staged: dict[str, Any] | None) -> str:
    if staged is None:
        return ""
    parts: list[str] = []
    for stage in staged.get("stages", []):
        if not isinstance(stage, dict):
            continue
        parts.append(str(stage.get("instruction") or ""))
        for item in stage.get("files", []):
            if not isinstance(item, dict):
                continue
            parts.append(str(item.get("path") or ""))
            if "json" in item:
                parts.append(json.dumps(item["json"], sort_keys=True))
            else:
                parts.append(str(item.get("text") or ""))
    return "\n".join(parts)


def contains_forbidden_key(value: Any, forbidden: set[str], path: str = "") -> list[str]:
    hits: list[str] = []
    if isinstance(value, dict):
        for key, child in value.items():
            key_text = str(key)
            child_path = f"{path}.{key_text}" if path else key_text
            if key_text in forbidden:
                hits.append(child_path)
            hits.extend(contains_forbidden_key(child, forbidden, child_path))
    elif isinstance(value, list):
        for index, child in enumerate(value):
            hits.extend(contains_forbidden_key(child, forbidden, f"{path}[{index}]"))
    return hits


def native_stage_files(staged: dict[str, Any] | None) -> list[tuple[dict[str, Any], dict[str, Any]]]:
    if staged is None:
        return []
    out: list[tuple[dict[str, Any], dict[str, Any]]] = []
    for stage in staged.get("stages", []):
        if not isinstance(stage, dict):
            continue
        for item in stage.get("files", []):
            if isinstance(item, dict):
                out.append((stage, item))
    return out


def native_raw_log_items(staged: dict[str, Any] | None) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for _, item in native_stage_files(staged):
        path = item.get("path")
        payload = item.get("json")
        if isinstance(path, str) and path.startswith("docs/") and isinstance(payload, dict):
            out.append(payload)
    return out


def native_service_item_ids(keys: dict[str, Any]) -> dict[str, set[str]]:
    out: dict[str, set[str]] = {}
    for state_key, node in keys.items():
        ids: set[str] = set()
        if isinstance(node, dict):
            for item in node.get("items") or []:
                if isinstance(item, dict) and item.get("qa_id") is not None:
                    ids.add(str(item["qa_id"]))
        out[state_key] = ids
    return out


def validate_native_visible_contract(
    task_id: str,
    benchmark: dict[str, Any],
    checkpoint: dict[str, Any],
    visible_task: dict[str, Any],
) -> list[str]:
    errors: list[str] = []
    if visible_task.get("taskId") != task_id:
        errors.append(f"{task_id}: visible DynamicMem taskId mismatch")
    if visible_task.get("userId") != benchmark.get("user_id"):
        errors.append(f"{task_id}: visible DynamicMem userId mismatch")
    for key in ("task_contract_version", "research_frame_version"):
        if visible_task.get(key) != benchmark.get(key):
            errors.append(f"{task_id}: visible DynamicMem {key} mismatch")
        output_contract = (visible_task.get("output") or {}).get("contract") or {}
        if output_contract.get(key) != benchmark.get(key):
            errors.append(f"{task_id}: visible DynamicMem output contract {key} mismatch")
    visible_checkpoint = visible_task.get("checkpoint") or {}
    if visible_checkpoint.get("checkpoint_id") != checkpoint.get("checkpoint_id"):
        errors.append(f"{task_id}: visible DynamicMem checkpoint_id mismatch")
    if visible_checkpoint.get("as_of") != checkpoint.get("as_of"):
        errors.append(f"{task_id}: visible DynamicMem checkpoint as_of mismatch")
    if (visible_task.get("output") or {}).get("path") != "outputs/prediction.json":
        errors.append(f"{task_id}: visible DynamicMem output path must be outputs/prediction.json")
    return errors


def validate_native_stage_contract(
    task_id: str,
    checkpoints: list[dict[str, Any]],
    difficulty: dict[str, Any],
    visible_tasks: list[dict[str, Any]],
    staged: dict[str, Any] | None,
) -> list[str]:
    errors: list[str] = []
    if staged is None:
        errors.append(f"{task_id}: native DynamicMem task must use staged reveal")
        return errors

    stages = staged.get("stages")
    if not isinstance(stages, list):
        errors.append(f"{task_id}: native DynamicMem staged payload has no stages list")
        return errors

    actual_kinds = [stage.get("kind") for stage in stages if isinstance(stage, dict)]
    allowed_kinds = {
        STAGE_KIND_UPDATE_ANSWER,
        STAGE_KIND_MEMORY_UPDATE,
        STAGE_KIND_DOWNSTREAM_TASK,
    }
    is_update_answer = actual_kinds == [STAGE_KIND_UPDATE_ANSWER] * len(checkpoints)
    is_memory_final = (
        len(actual_kinds) >= 2
        and actual_kinds[:-1] == [STAGE_KIND_MEMORY_UPDATE] * (len(actual_kinds) - 1)
        and actual_kinds[-1] == STAGE_KIND_DOWNSTREAM_TASK
    )
    is_custom_valid = (
        bool(actual_kinds)
        and all(kind in allowed_kinds for kind in actual_kinds)
        and any(kind in {STAGE_KIND_UPDATE_ANSWER, STAGE_KIND_DOWNSTREAM_TASK} for kind in actual_kinds)
    )
    if not (is_update_answer or is_memory_final or is_custom_valid):
        errors.append(f"{task_id}: native DynamicMem stage kind pattern mismatch: {actual_kinds}")
    if is_update_answer and len(stages) != len(checkpoints):
        errors.append(
            f"{task_id}: native DynamicMem stage/checkpoint count mismatch "
            f"stages={len(stages)} checkpoints={len(checkpoints)}"
        )
    updated_checkpoint_ids: set[str] = set()
    for stage in stages:
        if not isinstance(stage, dict):
            continue
        kind = stage.get("kind")
        checkpoint_id = str(stage.get("checkpointId") or "")
        if kind in {STAGE_KIND_MEMORY_UPDATE, STAGE_KIND_UPDATE_ANSWER} and checkpoint_id:
            updated_checkpoint_ids.add(checkpoint_id)
        if kind == STAGE_KIND_DOWNSTREAM_TASK and checkpoint_id not in updated_checkpoint_ids:
            errors.append(
                f"{task_id}: downstream-task stage appears before update for checkpoint {checkpoint_id}"
            )

    raw_logs = native_raw_log_items(staged)
    raw_log_ids = [str(log.get("app_log_id") or "") for log in raw_logs]
    if len(raw_log_ids) != len(set(raw_log_ids)):
        errors.append(f"{task_id}: native DynamicMem staged raw logs contain duplicate app_log_id")
    timestamps = [str(log.get("timestamp") or "") for log in raw_logs]
    if timestamps != sorted(timestamps):
        errors.append(f"{task_id}: native DynamicMem staged raw logs are not chronological")
    as_of = (checkpoints[-1].get("as_of") or {}) if checkpoints else {}
    log_index = as_of.get("log_index")
    if isinstance(log_index, int) and len(raw_logs) != log_index + 1:
        errors.append(
            f"{task_id}: native DynamicMem raw log count must equal checkpoint log_index + 1 "
            f"expected={log_index + 1} actual={len(raw_logs)}"
        )

    visible_by_checkpoint_id = {
        ((visible_task.get("checkpoint") or {}).get("checkpoint_id")): visible_task
        for visible_task in visible_tasks
        if isinstance(visible_task, dict)
    }
    expected_checkpoint_ids = [
        checkpoint.get("checkpoint_id")
        for checkpoint in checkpoints
    ]
    seen_checkpoint_ids = []
    for stage, item in native_stage_files(staged):
        if item.get("path") == "dynamicmem-task.json":
            if stage.get("kind") not in {STAGE_KIND_UPDATE_ANSWER, STAGE_KIND_DOWNSTREAM_TASK}:
                errors.append(f"{task_id}: dynamicmem-task.json must appear only in downstream/update-answer stages")
            payload = item.get("json")
            checkpoint_id = ((payload or {}).get("checkpoint") or {}).get("checkpoint_id") if isinstance(payload, dict) else None
            seen_checkpoint_ids.append(checkpoint_id)
            if payload != visible_by_checkpoint_id.get(checkpoint_id):
                errors.append(f"{task_id}: staged dynamicmem-task.json does not match visible-tasks.json for {checkpoint_id}")
        if stage.get("kind") == STAGE_KIND_MEMORY_UPDATE and item.get("path") == "dynamicmem-task.json":
            errors.append(f"{task_id}: memory-update stage exposes dynamicmem-task.json")
        if stage.get("kind") == STAGE_KIND_DOWNSTREAM_TASK and isinstance(item.get("path"), str) and item["path"].startswith("docs/"):
            errors.append(f"{task_id}: downstream-task stage exposes raw docs")
        if stage.get("kind") == STAGE_KIND_DOWNSTREAM_TASK and item.get("path") == "documents.json":
            errors.append(f"{task_id}: downstream-task stage exposes documents.json")
    if seen_checkpoint_ids != expected_checkpoint_ids:
        errors.append(
            f"{task_id}: native DynamicMem task checkpoint exposure mismatch "
            f"expected={expected_checkpoint_ids} actual={seen_checkpoint_ids}"
        )

    totals = difficulty.get("totals", {})
    if totals.get("stageCount") != len(stages):
        errors.append(f"{task_id}: difficulty stageCount mismatch")
    actual_doc_count = len(raw_logs)
    actual_file_count = sum(len(stage.get("files", [])) for stage in stages if isinstance(stage, dict))
    if totals.get("visibleDocCount") != actual_doc_count:
        errors.append(f"{task_id}: difficulty visibleDocCount mismatch")
    if totals.get("visibleFileCount") != actual_file_count:
        errors.append(f"{task_id}: difficulty visibleFileCount mismatch")
    if totals.get("observedRawLogCount") != actual_doc_count:
        errors.append(f"{task_id}: difficulty observedRawLogCount mismatch")
    if totals.get("memoryUpdateStageCount") != actual_kinds.count(STAGE_KIND_MEMORY_UPDATE):
        errors.append(f"{task_id}: difficulty memoryUpdateStageCount mismatch")
    if totals.get("updateAnswerStageCount") != actual_kinds.count(STAGE_KIND_UPDATE_ANSWER):
        errors.append(f"{task_id}: difficulty updateAnswerStageCount mismatch")
    expected_downstream_count = actual_kinds.count(STAGE_KIND_DOWNSTREAM_TASK) + actual_kinds.count(STAGE_KIND_UPDATE_ANSWER)
    if totals.get("downstreamStageCount") != expected_downstream_count:
        errors.append(f"{task_id}: difficulty downstreamStageCount mismatch")
    return errors


def validate_native_catalog(
    task_id: str,
    task_dir: Path,
    scp_keys: dict[str, Any],
) -> list[str]:
    catalog_path = task_dir / "mcp" / "catalog.json"
    if not catalog_path.exists():
        return [f"{task_id}: native DynamicMem task missing mcp/catalog.json"]
    catalog = load_json(catalog_path)
    errors: list[str] = []
    if catalog.get("taskId") != task_id:
        errors.append(f"{task_id}: native DynamicMem catalog taskId mismatch")
    catalog_slugs = {pref.get("slug") for pref in catalog.get("preferences", [])}
    if catalog_slugs != set(scp_keys):
        errors.append(
            f"{task_id}: native DynamicMem catalog slug mismatch "
            f"catalog_only={sorted(catalog_slugs - set(scp_keys))[:10]} "
            f"hidden_only={sorted(set(scp_keys) - catalog_slugs)[:10]}"
        )
    scopes = {pref.get("scope") for pref in catalog.get("preferences", [])}
    if scopes != {task_id}:
        errors.append(f"{task_id}: native DynamicMem catalog scopes must be only {task_id}")
    return errors


def validate_native_dynamicmem_task(
    task_id: str,
    task_dir: Path,
    staged: dict[str, Any] | None,
) -> tuple[bool, list[str]]:
    benchmark_path = task_dir / "tests" / "expected" / "benchmark.json"
    if not benchmark_path.exists():
        return False, []

    errors: list[str] = []
    visible_tasks_path = task_dir / "tests" / "expected" / "visible-tasks.json"
    difficulty_path = task_dir / "tests" / "expected" / "difficulty.json"
    soundness_path = task_dir / "tests" / "expected" / "soundness-report.md"
    if not visible_tasks_path.exists():
        errors.append(f"{task_id}: missing tests/expected/visible-tasks.json")
        return True, errors
    if not difficulty_path.exists():
        errors.append(f"{task_id}: missing tests/expected/difficulty.json")
        return True, errors
    if not soundness_path.exists():
        errors.append(f"{task_id}: missing tests/expected/soundness-report.md")

    benchmark = load_json(benchmark_path)
    visible_tasks = load_json(visible_tasks_path)
    difficulty = load_json(difficulty_path)
    checkpoints = benchmark.get("checkpoints")
    if not isinstance(checkpoints, list) or not checkpoints:
        errors.append(f"{task_id}: native benchmark must contain at least one checkpoint")
        return True, errors
    if not isinstance(visible_tasks, list) or len(visible_tasks) != len(checkpoints):
        errors.append(
            f"{task_id}: visible-tasks checkpoint count mismatch "
            f"visible={len(visible_tasks) if isinstance(visible_tasks, list) else 'invalid'} "
            f"hidden={len(checkpoints)}"
        )
        return True, errors

    forbidden_visible_keys = {
        "validated_snapshot_state",
        "expected_snapshot_state",
        "state_observability",
        "state_questionability",
        "reference_answer",
        "reference_output",
        "reference_anchors",
        "answer_scoring_points",
        "gold_memory_evidence_app_log_ids",
        "item_validation",
        "pack_identity",
    }
    leaks = contains_forbidden_key(visible_tasks, forbidden_visible_keys)
    if leaks:
        errors.append(f"{task_id}: visible DynamicMem task leaks hidden keys {leaks[:10]}")

    catalog_slugs: set[str] = set()
    state_key_count = 0
    unique_state_keys: set[str] = set()
    rq_key_count = 0
    rq_item_count = 0
    for checkpoint, visible_task in zip(checkpoints, visible_tasks):
        scp_keys = ((checkpoint.get("state_completion_pack") or {}).get("keys") or {})
        rq_keys = ((checkpoint.get("rq3_apply_service_qa") or {}).get("keys") or {})
        if not scp_keys:
            errors.append(f"{task_id}: native benchmark has no state_completion_pack keys")
        if not rq_keys:
            errors.append(f"{task_id}: native benchmark has no rq3_apply_service_qa keys")
        errors.extend(validate_native_visible_contract(task_id, benchmark, checkpoint, visible_task))

        visible_scp_keys = ((visible_task.get("state_completion") or {}).get("keys") or {})
        visible_rq_keys = ((visible_task.get("personalized_service") or {}).get("keys") or {})
        if set(visible_scp_keys) != set(scp_keys):
            errors.append(
                f"{task_id}: visible state_completion keys mismatch "
                f"checkpoint={checkpoint.get('checkpoint_id')} "
                f"hidden_only={sorted(set(scp_keys) - set(visible_scp_keys))[:10]} "
                f"visible_only={sorted(set(visible_scp_keys) - set(scp_keys))[:10]}"
            )
        if set(visible_rq_keys) != set(rq_keys):
            errors.append(
                f"{task_id}: visible personalized_service keys mismatch "
                f"checkpoint={checkpoint.get('checkpoint_id')} "
                f"hidden_only={sorted(set(rq_keys) - set(visible_rq_keys))[:10]} "
                f"visible_only={sorted(set(visible_rq_keys) - set(rq_keys))[:10]}"
            )
        hidden_qa_ids = native_service_item_ids(rq_keys)
        visible_qa_ids = native_service_item_ids(visible_rq_keys)
        if visible_qa_ids != hidden_qa_ids:
            errors.append(f"{task_id}: visible personalized_service qa_id coverage mismatch")
        catalog_slugs.update(str(key) for key in scp_keys)
        state_key_count += len(scp_keys)
        unique_state_keys.update(str(key) for key in scp_keys)
        rq_key_count += len(rq_keys)
        for node in rq_keys.values():
            if isinstance(node, dict):
                rq_item_count += len([item for item in node.get("items", []) if isinstance(item, dict)])

    totals = difficulty.get("totals", {})
    if totals.get("stateCompletionKeyCount") != state_key_count:
        errors.append(f"{task_id}: difficulty stateCompletionKeyCount mismatch")
    if totals.get("uniqueStateCompletionKeyCount") != len(unique_state_keys):
        errors.append(f"{task_id}: difficulty uniqueStateCompletionKeyCount mismatch")
    if totals.get("personalizedServiceKeyCount") != rq_key_count:
        errors.append(f"{task_id}: difficulty personalizedServiceKeyCount mismatch")
    if totals.get("personalizedServiceItemCount") != rq_item_count:
        errors.append(f"{task_id}: difficulty personalizedServiceItemCount mismatch")
    errors.extend(
        validate_native_stage_contract(
            task_id,
            checkpoints,
            difficulty,
            visible_tasks,
            staged,
        )
    )
    errors.extend(validate_native_catalog(task_id, task_dir, {key: {} for key in catalog_slugs}))

    return True, errors


def validate_task(task_dir: Path, repo_root: Path) -> list[str]:
    errors: list[str] = []
    task_id = task_dir.name
    workspace = task_dir / "environment" / "workspace"
    staged = staged_payload(task_dir)
    staged_schemas: dict[str, dict[str, Any]] = {}

    documents_path = workspace / "documents.json"
    corpus_id = None
    if documents_path.exists():
        corpus_id, index_errors = validate_documents_index(
            task_id,
            documents_path,
            workspace / "docs",
            label="workspace",
        )
        errors.extend(index_errors)

    if staged is not None:
        if staged.get("taskId") != task_id:
            errors.append(f"{task_id}: staged payload taskId mismatch")
        stages = staged.get("stages")
        if not isinstance(stages, list) or not stages:
            errors.append(f"{task_id}: staged payload must contain nonempty stages list")
            stages = []
        seen_stage_ids: set[str] = set()
        for expected_index, stage in enumerate(stages, start=1):
            stage_id = stage.get("stageId")
            if not stage_id:
                errors.append(f"{task_id}: staged payload missing stageId")
                stage_id = f"stage-{expected_index}"
            if stage_id in seen_stage_ids:
                errors.append(f"{task_id}: duplicate stageId {stage_id}")
            seen_stage_ids.add(stage_id)
            if stage.get("stageIndex") != expected_index:
                errors.append(f"{task_id}: {stage_id} stageIndex must be {expected_index}")
            if not stage.get("instruction"):
                errors.append(f"{task_id}: {stage_id} missing instruction")
            stage_files = stage.get("files")
            if not isinstance(stage_files, list):
                errors.append(f"{task_id}: {stage_id} files must be a list")
                stage_files = []
            paths: list[str] = []
            for item in stage_files:
                path = item.get("path") if isinstance(item, dict) else None
                if not isinstance(path, str) or not path:
                    errors.append(f"{task_id}: {stage_id} has file without path")
                    continue
                if path.startswith("/") or ".." in Path(path).parts:
                    errors.append(f"{task_id}: {stage_id} unsafe staged path {path}")
                paths.append(path)
                if path.startswith("forms/") and path.endswith(".schema.json"):
                    form_id = Path(path).name.removesuffix(".schema.json")
                    schema = item.get("json")
                    if isinstance(schema, dict):
                        staged_schemas[form_id] = schema
                    else:
                        errors.append(f"{task_id}: {stage_id} schema {path} must be JSON")
            if len(paths) != len(set(paths)):
                errors.append(f"{task_id}: {stage_id} duplicate staged file paths")
            stage_corpus_id, stage_errors = validate_stage_documents_index(
                task_id,
                stage_id,
                stage_files,
            )
            errors.extend(stage_errors)
            if stage_corpus_id:
                if corpus_id is None:
                    corpus_id = stage_corpus_id
                elif stage_corpus_id != corpus_id:
                    errors.append(f"{task_id}: staged corpus mismatch in {stage_id}")

    is_native_dynamicmem, native_errors = validate_native_dynamicmem_task(
        task_id,
        task_dir,
        staged,
    )
    if is_native_dynamicmem:
        errors.extend(native_errors)
        leaked = [
            marker
            for marker in HIDDEN_MARKERS
            if marker in visible_agent_text(task_dir) or marker in staged_agent_text(staged)
        ]
        if leaked:
            errors.append(f"{task_id}: visible workspace/stages contain hidden markers {leaked}")
        return errors

    for step_documents_path in sorted(
        (task_dir / "steps").glob("*/workdir/_step_documents.json")
    ):
        step_docs_root = step_documents_path.parent / "_step_docs"
        step_corpus_id, step_errors = validate_documents_index(
            task_id,
            step_documents_path,
            step_docs_root,
            label=step_documents_path.relative_to(task_dir).as_posix(),
        )
        errors.extend(step_errors)
        if step_corpus_id != corpus_id:
            errors.append(
                f"{task_id}: step corpus mismatch in "
                f"{step_documents_path.relative_to(task_dir).as_posix()}"
            )

    expected_path = task_dir / "tests" / "expected" / "forms.json"
    if not expected_path.exists():
        errors.append(f"{task_id}: missing tests/expected/forms.json")
        return errors
    expected = load_json(expected_path)
    if expected.get("taskId") != task_id:
        errors.append(f"{task_id}: expected forms taskId mismatch")

    if staged is not None:
        difficulty_path = task_dir / "tests" / "expected" / "difficulty.json"
        if not difficulty_path.exists():
            errors.append(f"{task_id}: missing tests/expected/difficulty.json")
        else:
            difficulty = load_json(difficulty_path)
            if difficulty.get("taskId") != task_id:
                errors.append(f"{task_id}: difficulty taskId mismatch")
            stage_count = difficulty.get("totals", {}).get("stageCount")
            if stage_count != len(staged.get("stages", [])):
                errors.append(
                    f"{task_id}: difficulty stageCount mismatch "
                    f"expected={len(staged.get('stages', []))} actual={stage_count}"
                )
            expected_required_count = sum(
                len(form.get("fields", {}))
                for form in expected.get("forms", {}).values()
            )
            difficulty_field_count = difficulty.get("totals", {}).get("requiredFieldCount")
            if difficulty_field_count != expected_required_count:
                errors.append(
                    f"{task_id}: difficulty requiredFieldCount mismatch "
                    f"expected={expected_required_count} actual={difficulty_field_count}"
                )
        if not (task_dir / "tests" / "expected" / "soundness-report.md").exists():
            errors.append(f"{task_id}: missing tests/expected/soundness-report.md")

    trace_path = task_dir / "tests" / "expected" / "source-trace.json"
    trace = load_json(trace_path) if trace_path.exists() else None
    if trace is not None:
        if trace.get("taskId") != task_id:
            errors.append(f"{task_id}: source-trace taskId mismatch")
        expected_corpus = f"examples/eval/users/maya-chen-newhire/corpora/{corpus_id}"
        if trace.get("derivedFrom", {}).get("corpus") != expected_corpus:
            errors.append(f"{task_id}: source-trace corpus mismatch")

    catalog_path = task_dir / "mcp" / "catalog.json"
    catalog = load_json(catalog_path) if catalog_path.exists() else None
    if catalog is not None:
        if catalog.get("taskId") != task_id:
            errors.append(f"{task_id}: catalog taskId mismatch")
        scopes = {pref.get("scope") for pref in catalog.get("preferences", [])}
        allowed_scopes = {corpus_id, task_id, f"maya-{corpus_id}"} if corpus_id else set()
        if corpus_id and scopes and not scopes <= allowed_scopes:
            errors.append(f"{task_id}: catalog scope mismatch: {sorted(scopes)}")

    source_validation_path = repo_root / "examples" / "eval" / "users" / "maya-chen-newhire" / "corpora" / str(corpus_id) / "validation-report.json"
    if source_validation_path.exists():
        validation = load_json(source_validation_path)
        if validation.get("status") != "pass" or validation.get("summary", {}).get("errors") != 0:
            errors.append(f"{task_id}: source corpus validation is not clean")

    catalog_slugs = {pref["slug"] for pref in catalog.get("preferences", [])} if catalog else set()
    needed_slugs: set[str] = set()
    forms = expected.get("forms", {})
    for form_id, expected_form in forms.items():
        schema_path = workspace / "forms" / f"{form_id}.schema.json"
        if schema_path.exists():
            schema = load_json(schema_path)
        elif form_id in staged_schemas:
            schema = staged_schemas[form_id]
        else:
            errors.append(f"{task_id}: missing schema for form {form_id}")
            continue
        if schema.get("outputShape", {}).get("taskId") != task_id:
            errors.append(f"{task_id}: schema outputShape taskId mismatch for {form_id}")

        schema_required = {
            row["key"] if isinstance(row, dict) else row
            for row in schema.get("requiredFields", [])
        }
        expected_required = set(expected_form.get("fields", {}))
        if schema_required != expected_required:
            errors.append(
                f"{task_id}: required field mismatch for {form_id}: "
                f"schema_only={sorted(schema_required - expected_required)} "
                f"expected_only={sorted(expected_required - schema_required)}"
            )

        schema_unsupported_rows = schema.get("unsupportedFields")
        if schema_unsupported_rows is None:
            schema_unsupported_rows = schema.get("optionalFields", [])
        schema_unsupported = {
            row["key"] if isinstance(row, dict) else row
            for row in schema_unsupported_rows
        }
        expected_unsupported = set(expected_form.get("unsupportedFields", {}))
        if schema_unsupported != expected_unsupported:
            errors.append(
                f"{task_id}: unsupported field mismatch for {form_id}: "
                f"schema_only={sorted(schema_unsupported - expected_unsupported)} "
                f"expected_only={sorted(expected_unsupported - schema_unsupported)}"
            )

        if trace is None:
            continue
        trace_form = trace.get("forms", {}).get(form_id)
        if not trace_form:
            errors.append(f"{task_id}: missing source-trace form {form_id}")
            continue
        for field, expected_value in expected_form.get("fields", {}).items():
            trace_field = trace_form.get("fields", {}).get(field)
            if not trace_field:
                errors.append(f"{task_id}: missing source-trace field {form_id}.{field}")
                continue
            if trace_field.get("expectedValue") != expected_value:
                errors.append(f"{task_id}: source-trace value mismatch for {form_id}.{field}")
            if trace_field.get("oldFactKey"):
                needed_slugs.add(trace_field["oldFactKey"])
        for field in expected_form.get("unsupportedFields", {}):
            trace_field = trace_form.get("unsupportedFields", {}).get(field)
            if not trace_field:
                errors.append(f"{task_id}: missing unsupported source-trace field {form_id}.{field}")
                continue
            if trace_field.get("oldFactKey"):
                needed_slugs.add(trace_field["oldFactKey"])

    if catalog is not None:
        missing_slugs = sorted(needed_slugs - catalog_slugs)
        if missing_slugs:
            errors.append(f"{task_id}: catalog missing source-trace slugs {missing_slugs}")

    leaked = [
        marker
        for marker in HIDDEN_MARKERS
        if marker in visible_agent_text(task_dir) or marker in staged_agent_text(staged)
    ]
    if leaked:
        errors.append(f"{task_id}: visible workspace/stages contain hidden markers {leaked}")

    return errors


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("tasks", nargs="+", type=Path)
    parser.add_argument("--repo-root", type=Path, default=Path("."))
    args = parser.parse_args()

    all_errors: list[str] = []
    for task in args.tasks:
        errors = validate_task(task, args.repo_root)
        if errors:
            all_errors.extend(errors)
        else:
            documents_path = task / "environment" / "workspace" / "documents.json"
            if documents_path.exists():
                docs = load_json(documents_path)
                corpus_label = docs.get("corpusId")
                docs_count = len(docs.get("documents", []))
            elif (task / "stages" / "payload.json").exists():
                payload = load_json(task / "stages" / "payload.json")
                corpus_label = payload.get("corpusId")
                docs_count = 0
                for stage in payload.get("stages", []):
                    for item in stage.get("files", []):
                        path = item.get("path") if isinstance(item, dict) else None
                        if isinstance(path, str) and path.startswith("docs/"):
                            docs_count += 1
            else:
                corpus_label = "none"
                docs_count = len(
                    [
                        path
                        for path in (task / "environment" / "workspace" / "docs").rglob("*")
                        if path.is_file()
                    ]
                )
            native_benchmark = task / "tests" / "expected" / "benchmark.json"
            if native_benchmark.exists():
                benchmark = load_json(native_benchmark)
                checkpoints = benchmark.get("checkpoints") or []
                state_key_count = 0
                rq_items = 0
                for checkpoint in checkpoints:
                    scp_keys = ((checkpoint.get("state_completion_pack") or {}).get("keys") or {})
                    rq_keys = ((checkpoint.get("rq3_apply_service_qa") or {}).get("keys") or {})
                    state_key_count += len(scp_keys)
                    rq_items += sum(
                        len(node.get("items") or [])
                        for node in rq_keys.values()
                        if isinstance(node, dict)
                    )
                print(
                    f"OK {task.name}: corpus={corpus_label} "
                    f"docs={docs_count} "
                    f"checkpoints={len(checkpoints)} "
                    f"state_keys={state_key_count} service_items={rq_items}"
                )
            else:
                expected = load_json(task / "tests" / "expected" / "forms.json")
                required_count = sum(len(form.get("fields", {})) for form in expected.get("forms", {}).values())
                unsupported_count = sum(len(form.get("unsupportedFields", {})) for form in expected.get("forms", {}).values())
                print(
                    f"OK {task.name}: corpus={corpus_label} "
                    f"docs={docs_count} "
                    f"required={required_count} unsupported={unsupported_count}"
                )

    if all_errors:
        for error in all_errors:
            print(f"ERROR {error}")
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
