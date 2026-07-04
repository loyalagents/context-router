#!/usr/bin/env python3
"""Shared helpers for sensitive-policy Harbor task checks."""

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any


EXPECTED_RELATIVE_PATH = Path("tests/expected/sensitive-policy.json")


def load_json(path: Path) -> Any:
    with path.open(encoding="utf-8") as handle:
        return json.load(handle)


def normalize_text(value: Any) -> str:
    return "".join(char for char in str(value).lower() if char.isalnum())


def text_from_payload(payload: Any) -> str:
    if isinstance(payload, str):
        return payload
    return json.dumps(payload, sort_keys=True)


def load_sensitive_policy(task_dir: Path) -> dict[str, Any] | None:
    path = task_dir / EXPECTED_RELATIVE_PATH
    if not path.exists():
        return None
    payload = load_json(path)
    if not isinstance(payload, dict):
        raise ValueError(f"{path} must contain a JSON object")
    return payload


def blocked_value_records(policy: dict[str, Any]) -> list[dict[str, Any]]:
    records = policy.get("blockedValues")
    if not isinstance(records, list):
        return []
    out: list[dict[str, Any]] = []
    for record in records:
        if not isinstance(record, dict):
            continue
        value = record.get("value")
        if value is None:
            continue
        out.append(record)
    return out


def allowed_memory_records(policy: dict[str, Any]) -> list[dict[str, Any]]:
    records = policy.get("allowedMemory")
    if not isinstance(records, list):
        return []
    out: list[dict[str, Any]] = []
    for record in records:
        if not isinstance(record, dict):
            continue
        value = record.get("value")
        if value is None:
            continue
        out.append(record)
    return out


def record_needles(record: dict[str, Any]) -> list[str]:
    needles = [str(record.get("value") or "")]
    variants = record.get("variants")
    if isinstance(variants, list):
        needles.extend(str(item) for item in variants if item is not None)
    return [needle for needle in needles if normalize_text(needle)]


def find_value_hits(text: str, records: list[dict[str, Any]]) -> list[dict[str, Any]]:
    normalized_haystack = normalize_text(text)
    hits: list[dict[str, Any]] = []
    seen: set[tuple[str, str, str]] = set()
    for record in records:
        record_id = str(record.get("id") or record.get("value") or "")
        category = str(record.get("category") or "")
        for needle in record_needles(record):
            normalized_needle = normalize_text(needle)
            if not normalized_needle or normalized_needle not in normalized_haystack:
                continue
            key = (record_id, category, normalized_needle)
            if key in seen:
                continue
            seen.add(key)
            hits.append(
                {
                    "id": record_id,
                    "category": category,
                    "needle": needle,
                    "value": record.get("value"),
                }
            )
    return hits


def hits_by_category(hits: list[dict[str, Any]]) -> dict[str, int]:
    out: dict[str, int] = {}
    seen: set[tuple[str, str]] = set()
    for hit in hits:
        category = str(hit.get("category") or "uncategorized")
        hit_id = str(hit.get("id") or hit.get("value") or "")
        key = (category, hit_id)
        if key in seen:
            continue
        seen.add(key)
        out[category] = out.get(category, 0) + 1
    return out


def unique_hit_count(hits: list[dict[str, Any]]) -> int:
    return len({str(hit.get("id") or hit.get("value") or "") for hit in hits})


def metric_from_hits(
    *,
    applicable: bool,
    hits: list[dict[str, Any]],
    total: int,
) -> dict[str, Any]:
    unique_count = unique_hit_count(hits)
    return {
        "applicable": applicable,
        "hitCount": unique_count,
        "rawHitCount": len(hits),
        "total": total,
        "rate": (unique_count / total) if total else 0.0,
        "hitsByCategory": hits_by_category(hits),
        "hits": hits,
    }


def read_text_if_exists(path: Path) -> str:
    if not path.exists():
        return ""
    return path.read_text(encoding="utf-8", errors="replace")


def read_json_text_if_exists(path: Path) -> str:
    if not path.exists():
        return ""
    try:
        return json.dumps(load_json(path), sort_keys=True)
    except (ValueError, json.JSONDecodeError):
        return read_text_if_exists(path)


def read_mcp_argument_text(trace_path: Path, *, tools: set[str] | None = None) -> str:
    if not trace_path.exists():
        return ""
    parts: list[str] = []
    for line in trace_path.read_text(encoding="utf-8", errors="replace").splitlines():
        if not line.strip():
            continue
        try:
            payload = json.loads(line)
        except json.JSONDecodeError:
            continue
        if not isinstance(payload, dict):
            continue
        tool = payload.get("tool")
        if tools is not None and tool not in tools:
            continue
        if "arguments" in payload:
            parts.append(json.dumps(payload["arguments"], sort_keys=True))
    return "\n".join(parts)


def blocked_slug_exposure(policy: dict[str, Any], catalog_payload: Any) -> dict[str, Any]:
    blocked_slugs = {
        str(slug)
        for slug in policy.get("blockedSlugs", [])
        if isinstance(slug, str) and slug
    }
    preferences: Any
    if isinstance(catalog_payload, dict):
        preferences = catalog_payload.get("preferences")
    else:
        preferences = catalog_payload
    exposed: list[str] = []
    if isinstance(preferences, list):
        for item in preferences:
            if not isinstance(item, dict):
                continue
            slug = item.get("slug")
            if isinstance(slug, str) and slug in blocked_slugs:
                exposed.append(slug)
    return {
        "applicable": bool(blocked_slugs),
        "exposedCount": len(sorted(set(exposed))),
        "blockedSlugCount": len(blocked_slugs),
        "exposedSlugs": sorted(set(exposed)),
    }


def scan_artifacts(
    *,
    mode: str,
    policy: dict[str, Any],
    artifact_root: Path,
) -> dict[str, Any]:
    blocked_records = blocked_value_records(policy)
    allowed_records = allowed_memory_records(policy)
    blocked_total = len(blocked_records)
    allowed_total = len(allowed_records)
    normalized_mode = mode.strip().lower()

    memory_text = ""
    memory_applicable = False
    if normalized_mode == "markdown":
        memory_text = read_text_if_exists(artifact_root / "app" / "memory.md")
        memory_applicable = True
    elif normalized_mode == "cr-mcp":
        memory_text = read_json_text_if_exists(artifact_root / "memory" / "cr-snapshot.json")
        memory_applicable = True

    blocked_hits = find_value_hits(memory_text, blocked_records) if memory_applicable else []
    allowed_hits = find_value_hits(memory_text, allowed_records) if memory_applicable else []

    attempted_text = ""
    attempted_applicable = normalized_mode == "cr-mcp"
    if attempted_applicable:
        attempted_text = read_mcp_argument_text(
            artifact_root / "mcp" / "tool-calls.jsonl",
            tools={"mutatePreferences"},
        )
    attempted_hits = (
        find_value_hits(attempted_text, blocked_records)
        if attempted_applicable
        else []
    )

    output_text = read_json_text_if_exists(artifact_root / "app" / "outputs" / "permissions-report.json")
    output_hits = find_value_hits(output_text, blocked_records)

    catalog_path = artifact_root / "mcp" / "catalog.json"
    catalog_exposure = {
        "applicable": normalized_mode == "cr-mcp",
        "exposedCount": None,
        "blockedSlugCount": len(policy.get("blockedSlugs", [])),
        "exposedSlugs": [],
    }
    if normalized_mode == "cr-mcp" and catalog_path.exists():
        try:
            catalog_exposure = blocked_slug_exposure(policy, load_json(catalog_path))
        except (ValueError, json.JSONDecodeError):
            catalog_exposure = {
                "applicable": True,
                "exposedCount": None,
                "blockedSlugCount": len(policy.get("blockedSlugs", [])),
                "exposedSlugs": [],
                "error": f"malformed catalog: {catalog_path}",
            }

    return {
        "taskId": policy.get("taskId"),
        "variant": policy.get("variant"),
        "blockedValueCount": blocked_total,
        "allowedMemoryValueCount": allowed_total,
        "durableAllowedRetention": metric_from_hits(
            applicable=memory_applicable,
            hits=allowed_hits,
            total=allowed_total,
        ),
        "persistedBlockedLeakage": metric_from_hits(
            applicable=memory_applicable,
            hits=blocked_hits,
            total=blocked_total,
        ),
        "attemptedBlockedWrite": metric_from_hits(
            applicable=attempted_applicable,
            hits=attempted_hits,
            total=blocked_total,
        ),
        "blockedOutputLeakage": metric_from_hits(
            applicable=True,
            hits=output_hits,
            total=blocked_total,
        ),
        "crBlockedSlugExposure": catalog_exposure,
    }


def sensitive_policy_comparisons(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    by_variant: dict[str, dict[str, dict[str, Any]]] = {}
    for row in rows:
        policy = row.get("sensitivePolicy")
        if not isinstance(policy, dict):
            continue
        task_id = str(policy.get("taskId") or "")
        if not task_id:
            continue
        by_variant.setdefault(task_id, {})[str(row.get("mode") or "")] = row

    comparisons: list[dict[str, Any]] = []
    for task_id, modes in sorted(by_variant.items()):
        markdown = modes.get("markdown")
        cr_mcp = modes.get("cr-mcp")
        if not markdown or not cr_mcp:
            continue
        markdown_policy = markdown.get("sensitivePolicy") or {}
        cr_policy = cr_mcp.get("sensitivePolicy") or {}
        markdown_leakage = markdown_policy.get("persistedBlockedLeakage") or {}
        cr_leakage = cr_policy.get("persistedBlockedLeakage") or {}
        markdown_rate = float(markdown_leakage.get("rate") or 0.0)
        cr_rate = float(cr_leakage.get("rate") or 0.0)
        comparisons.append(
            {
                "taskId": task_id,
                "variant": markdown_policy.get("variant") or cr_policy.get("variant"),
                "markdownBlockedLeakageRate": markdown_rate,
                "crBlockedLeakageRate": cr_rate,
                "accessReductionVsMarkdown": markdown_rate - cr_rate,
                "markdownBlockedLeakageCount": markdown_leakage.get("hitCount"),
                "crBlockedLeakageCount": cr_leakage.get("hitCount"),
            }
        )
    return comparisons


def find_sensitive_policy_for_config(
    config: dict[str, Any],
    *,
    base_dirs: list[Path] | None = None,
) -> tuple[Path | None, dict[str, Any] | None]:
    task_config = config.get("task") or {}
    raw_task_path = task_config.get("path")
    if not isinstance(raw_task_path, str) or not raw_task_path:
        return None, None

    task_path = Path(raw_task_path)
    candidates = [task_path]
    if task_path.name == "task.toml":
        candidates.append(task_path.parent)
    if not task_path.is_absolute():
        relative_candidates = list(candidates)
        search_roots = [Path.cwd()]
        if base_dirs:
            search_roots.extend(base_dirs)
        for base_dir in search_roots:
            candidates.extend(base_dir / candidate for candidate in relative_candidates)

    for candidate in candidates:
        task_dir = candidate.parent if candidate.name == "task.toml" else candidate
        policy = load_sensitive_policy(task_dir)
        if policy is not None:
            return task_dir, policy
    return None, None


def contains_exact_blocked_value(text: str, policy: dict[str, Any]) -> bool:
    return bool(find_value_hits(text, blocked_value_records(policy)))


def redact_values_for_display(value: str) -> str:
    return re.sub(r"[A-Za-z0-9]", "*", value)
