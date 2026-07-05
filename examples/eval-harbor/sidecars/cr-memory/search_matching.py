"""Literal matching helpers for the eval CR memory sidecar.

This is separator-normalized substring search, not semantic or fuzzy search.
"""

from __future__ import annotations

import re
from typing import Any


SEARCH_SEPARATOR_RE = re.compile(r"[^a-z0-9]+")


def normalize_search_text(text: str) -> str:
    return SEARCH_SEPARATOR_RE.sub(" ", text.lower()).strip()


def preference_matches(query: str | None, entry: dict[str, Any]) -> bool:
    if not query:
        return True
    q = normalize_search_text(query)
    if not q:
        return False
    value = entry.get("value")
    haystack = " ".join(
        [
            str(entry.get("slug", "")),
            str(entry.get("category", "")),
            str(entry.get("description", "")),
            str(value if value is not None else ""),
        ]
    )
    return q in normalize_search_text(haystack)
