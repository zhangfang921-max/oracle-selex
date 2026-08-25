"""
ORACLE G4 screening microservice.

Serves the same HTTP contract as before so the Node backend needs no protocol
change:

    GET  /health            -> {"status", "engine", "model_loaded"}
    POST /screen            -> {"success", "data": [...], "engine"}
           body: {"sequences": ["ACGU...", ...]}

Scoring lives in g4_scorers.py (MIT, independent implementation). The optional
G4NN model is the original authors' GPL-3.0 artefact and is not distributed with
ORACLE; when it is not installed, `g4NN` comes back as null and `model_loaded`
is false. See scripts/fetch_g4nn_model.md.

Port: 3002 by default, override with the G4_PORT environment variable.
"""

import json
import os
import sys
from http.server import BaseHTTPRequestHandler, HTTPServer

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from g4_scorers import load_g4nn_model, screen_sequence  # noqa: E402

PORT = int(os.environ.get("G4_PORT", "3002"))

ENGINE_WITH_NN = "ORACLE G4 scorers (cGcC, G4Hunter) + G4NN external model"
ENGINE_NO_NN = "ORACLE G4 scorers (cGcC, G4Hunter)"

g4nn_model = None


def engine_name() -> str:
    return ENGINE_WITH_NN if g4nn_model is not None else ENGINE_NO_NN


class G4Handler(BaseHTTPRequestHandler):
    def _send_json(self, status: int, payload: dict) -> None:
        body = json.dumps(payload).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path == "/health":
            self._send_json(200, {
                "status": "ok",
                "engine": engine_name(),
                "model_loaded": g4nn_model is not None,
            })
        else:
            self._send_json(404, {"success": False, "message": "not found"})

    def do_POST(self):
        if self.path != "/screen":
            self._send_json(404, {"success": False, "message": "not found"})
            return
        try:
            length = int(self.headers.get("Content-Length", 0))
            payload = json.loads(self.rfile.read(length)) if length else {}
            sequences = payload.get("sequences", [])
            if not isinstance(sequences, list):
                raise ValueError("'sequences' must be a list")
            results = [screen_sequence(seq, g4nn_model) for seq in sequences]
            self._send_json(200, {
                "success": True,
                "data": results,
                "engine": engine_name(),
            })
        except Exception as exc:
            self._send_json(500, {"success": False, "message": str(exc)})

    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "POST, GET, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def log_message(self, format, *args):  # noqa: A002 - signature fixed by base class
        pass


def main() -> None:
    global g4nn_model
    g4nn_model = load_g4nn_model()
    if g4nn_model is None:
        print("[g4] G4NN model not installed - cGcC and G4Hunter only "
              "(see scripts/fetch_g4nn_model.md)", flush=True)
    else:
        print("[g4] G4NN model loaded", flush=True)

    server = HTTPServer(("0.0.0.0", PORT), G4Handler)
    print(f"[g4] G4 screening service listening on port {PORT}", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        server.shutdown()
        sys.exit(0)


if __name__ == "__main__":
    main()
