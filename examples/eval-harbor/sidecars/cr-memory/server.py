import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from fastmcp import FastMCP
from starlette.responses import JSONResponse, PlainTextResponse


DATA_DIR = Path("/data")
PREFERENCES_PATH = DATA_DIR / "preferences.json"
TOOL_CALLS_PATH = DATA_DIR / "tool-calls.jsonl"
CONFIG_PATH = DATA_DIR / "mcp-config.json"
SERVER_LOG_PATH = DATA_DIR / "server.log"

CATALOG = [
    {
        "slug": "employee.fullName",
        "category": "employee",
        "description": "Employee full legal name",
        "valueType": "string",
        "scope": "task",
    },
    {
        "slug": "employee.email",
        "category": "employee",
        "description": "Employee email address",
        "valueType": "string",
        "scope": "task",
    },
    {
        "slug": "employee.phone",
        "category": "employee",
        "description": "Employee phone number",
        "valueType": "string",
        "scope": "task",
    },
    {
        "slug": "employee.address.street",
        "category": "employee",
        "description": "Employee home street address",
        "valueType": "string",
        "scope": "task",
    },
    {
        "slug": "employee.address.city",
        "category": "employee",
        "description": "Employee home address city",
        "valueType": "string",
        "scope": "task",
    },
    {
        "slug": "employee.address.state",
        "category": "employee",
        "description": "Employee home address state",
        "valueType": "string",
        "scope": "task",
    },
    {
        "slug": "employee.address.postalCode",
        "category": "employee",
        "description": "Employee home address postal code",
        "valueType": "string",
        "scope": "task",
    },
    {
        "slug": "employment.startDate",
        "category": "employment",
        "description": "Employee start date",
        "valueType": "string",
        "scope": "task",
    },
]

mcp = FastMCP("context-router-memory")


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def write_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2, sort_keys=True) + "\n")


def append_jsonl(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(payload, sort_keys=True) + "\n")


def log(message: str) -> None:
    SERVER_LOG_PATH.parent.mkdir(parents=True, exist_ok=True)
    with SERVER_LOG_PATH.open("a", encoding="utf-8") as handle:
        handle.write(f"{utc_now()} {message}\n")


def initial_state() -> dict[str, Any]:
    return {
        "schemaVersion": 1,
        "server": "context-router-memory",
        "preferences": {},
        "catalog": CATALOG,
        "updatedAt": None,
    }


def load_state() -> dict[str, Any]:
    if not PREFERENCES_PATH.exists():
        state = initial_state()
        write_json(PREFERENCES_PATH, state)
        return state
    return json.loads(PREFERENCES_PATH.read_text(encoding="utf-8"))


def save_state(state: dict[str, Any]) -> None:
    state["updatedAt"] = utc_now()
    write_json(PREFERENCES_PATH, state)


def record_tool_call(name: str, arguments: dict[str, Any], result: dict[str, Any]) -> None:
    append_jsonl(
        TOOL_CALLS_PATH,
        {
            "timestamp": utc_now(),
            "tool": name,
            "arguments": arguments,
            "resultSummary": {
                "success": result.get("success"),
                "count": result.get("count"),
                "mutated": result.get("mutated"),
            },
        },
    )
    log(f"tool={name} success={result.get('success')}")


def visible_catalog(category: str | None = None) -> list[dict[str, Any]]:
    if not category:
        return CATALOG
    return [entry for entry in CATALOG if entry["category"] == category]


def preference_matches(query: str | None, entry: dict[str, Any]) -> bool:
    if not query:
        return True
    q = query.lower()
    value = entry.get("value")
    haystack = " ".join(
        [
            str(entry.get("slug", "")),
            str(entry.get("category", "")),
            str(entry.get("description", "")),
            str(value if value is not None else ""),
        ]
    ).lower()
    return q in haystack


@mcp.tool()
def listPreferenceSlugs(category: str | None = None) -> dict[str, Any]:
    """List task-local preference slugs available in this CR memory server."""
    preferences = visible_catalog(category)
    result = {
        "success": True,
        "categories": sorted({entry["category"] for entry in preferences}),
        "count": len(preferences),
        "preferences": preferences,
    }
    record_tool_call("listPreferenceSlugs", {"category": category}, result)
    return result


@mcp.tool()
def searchPreferences(query: str | None = None) -> dict[str, Any]:
    """Search active preferences stored for this task."""
    state = load_state()
    stored = list(state["preferences"].values())
    active = [entry for entry in stored if preference_matches(query, entry)]
    result = {
        "success": True,
        "count": len(active),
        "active": {
            "count": len(active),
            "preferences": active,
        },
    }
    record_tool_call("searchPreferences", {"query": query}, result)
    return result


@mcp.tool()
def mutatePreferences(preferences: list[dict[str, Any]]) -> dict[str, Any]:
    """Store durable facts as active CR memory preferences.

    Each item should include slug, value, and optional evidence/confidence.
    Slugs should come from listPreferenceSlugs.
    """
    state = load_state()
    catalog_by_slug = {entry["slug"]: entry for entry in CATALOG}
    mutated = []
    errors = []

    for item in preferences:
        slug = str(item.get("slug", ""))
        if slug not in catalog_by_slug:
            errors.append({"slug": slug, "error": "unknown slug"})
            continue
        value = item.get("value")
        catalog_entry = catalog_by_slug[slug]
        record = {
            **catalog_entry,
            "value": value,
            "status": "ACTIVE",
            "sourceType": "MCP_EVAL",
            "confidence": item.get("confidence", 1.0),
            "evidence": item.get("evidence"),
            "updatedAt": utc_now(),
        }
        state["preferences"][slug] = record
        mutated.append(record)

    save_state(state)
    result = {
        "success": len(errors) == 0,
        "mutated": len(mutated),
        "errors": errors,
        "active": {
            "count": len(state["preferences"]),
            "preferences": list(state["preferences"].values()),
        },
    }
    record_tool_call("mutatePreferences", {"preferences": preferences}, result)
    return result


@mcp.custom_route("/health", methods=["GET"])
async def health_check(_request):
    return PlainTextResponse("ok")


@mcp.custom_route("/snapshot", methods=["GET"])
async def snapshot(_request):
    return JSONResponse(load_state())


@mcp.custom_route("/tool-calls", methods=["GET"])
async def tool_calls(_request):
    if not TOOL_CALLS_PATH.exists():
        return PlainTextResponse("")
    return PlainTextResponse(TOOL_CALLS_PATH.read_text(encoding="utf-8"))


def initialize_files() -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    if not PREFERENCES_PATH.exists():
        write_json(PREFERENCES_PATH, initial_state())
    if not TOOL_CALLS_PATH.exists():
        TOOL_CALLS_PATH.write_text("", encoding="utf-8")
    write_json(
        CONFIG_PATH,
        {
            "name": "context-router-memory",
            "transport": "streamable-http",
            "url": "http://cr-memory:8000/mcp",
            "tools": [
                "listPreferenceSlugs",
                "searchPreferences",
                "mutatePreferences",
            ],
        },
    )
    log("server starting")


if __name__ == "__main__":
    initialize_files()
    mcp.run(transport="streamable-http", host="0.0.0.0", port=8000)
