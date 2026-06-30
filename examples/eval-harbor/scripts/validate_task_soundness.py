#!/usr/bin/env python3
"""Static soundness checks for Harbor form-fill tasks."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any


HIDDEN_MARKERS = [
    "tests/expected",
    "source-trace",
    "expectedValue",
    "oldFactKey",
    "field-map.json",
    "validation-report",
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


def validate_task(task_dir: Path, repo_root: Path) -> list[str]:
    errors: list[str] = []
    task_id = task_dir.name
    workspace = task_dir / "environment" / "workspace"

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
        if not schema_path.exists():
            errors.append(f"{task_id}: missing schema for form {form_id}")
            continue
        schema = load_json(schema_path)
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

    leaked = [marker for marker in HIDDEN_MARKERS if marker in visible_agent_text(task_dir)]
    if leaked:
        errors.append(f"{task_id}: visible workspace contains hidden markers {leaked}")

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
            else:
                corpus_label = "none"
                docs_count = len(
                    [
                        path
                        for path in (task / "environment" / "workspace" / "docs").rglob("*")
                        if path.is_file()
                    ]
                )
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
