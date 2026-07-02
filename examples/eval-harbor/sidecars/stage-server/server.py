import json
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any


DATA_PATH = Path("/data/stages.json")
STATE_PATH = Path("/tmp/stage-server-state.json")


def load_json(path: Path) -> Any:
    with path.open("r", encoding="utf-8") as handle:
        return json.load(handle)


def write_json(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def load_state() -> dict[str, int]:
    if not STATE_PATH.exists():
        return {"nextIndex": 0}
    state = load_json(STATE_PATH)
    next_index = state.get("nextIndex")
    if not isinstance(next_index, int) or next_index < 0:
        return {"nextIndex": 0}
    return {"nextIndex": next_index}


def response(handler: BaseHTTPRequestHandler, status: int, payload: Any) -> None:
    body = json.dumps(payload, indent=2, sort_keys=True).encode("utf-8")
    handler.send_response(status)
    handler.send_header("Content-Type", "application/json")
    handler.send_header("Content-Length", str(len(body)))
    handler.end_headers()
    handler.wfile.write(body)


class Handler(BaseHTTPRequestHandler):
    def log_message(self, format: str, *args: object) -> None:
        return

    def do_GET(self) -> None:
        if self.path == "/health":
            response(self, 200, {"ok": True})
            return
        if self.path == "/status":
            state = load_state()
            stages = load_json(DATA_PATH).get("stages", [])
            response(
                self,
                200,
                {
                    "nextIndex": state["nextIndex"],
                    "totalStages": len(stages),
                    "done": state["nextIndex"] >= len(stages),
                },
            )
            return
        response(self, 404, {"error": "not found"})

    def do_POST(self) -> None:
        if self.path != "/next":
            response(self, 404, {"error": "not found"})
            return

        payload = load_json(DATA_PATH)
        stages = payload.get("stages", [])
        if not isinstance(stages, list):
            response(self, 500, {"error": "stages.json must contain a stages list"})
            return

        state = load_state()
        index = state["nextIndex"]
        if index >= len(stages):
            response(
                self,
                200,
                {
                    "schemaVersion": payload.get("schemaVersion", 1),
                    "taskId": payload.get("taskId"),
                    "done": True,
                    "nextIndex": index,
                    "totalStages": len(stages),
                },
            )
            return

        stage = stages[index]
        write_json(STATE_PATH, {"nextIndex": index + 1})
        response(
            self,
            200,
            {
                "schemaVersion": payload.get("schemaVersion", 1),
                "taskId": payload.get("taskId"),
                "done": False,
                "nextIndex": index + 1,
                "totalStages": len(stages),
                "stage": stage,
            },
        )


def main() -> None:
    if not DATA_PATH.exists():
        raise SystemExit(f"Missing stage payload: {DATA_PATH}")
    server = ThreadingHTTPServer(("0.0.0.0", 8765), Handler)
    server.serve_forever()


if __name__ == "__main__":
    main()
