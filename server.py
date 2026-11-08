#!/usr/bin/env python3
"""
2026-2027 家庭共同记账 - H5 预览与双人实时云同步服务端
- 访问 http://localhost:8080/web/ 即可在手机/电脑浏览器使用 H5 版
- 提供 GET/POST /api/ledger?code=cq2026 接口，供 H5 和微信小程序局域网/云端双人实时同步
"""
import os
import json
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(BASE_DIR, "cloud_data")
os.makedirs(DATA_DIR, exist_ok=True)


class LedgerHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=BASE_DIR, **kwargs)

    def end_headers(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(204)
        self.end_headers()

    def do_GET(self):
        parsed = urlparse(self.path)
        if parsed.path == "/":
            self.send_response(302)
            self.send_header("Location", "/web/index.html")
            self.end_headers()
            return

        if parsed.path == "/api/ledger":
            qs = parse_qs(parsed.query)
            code = qs.get("code", ["cq2026"])[0]
            safe_code = "".join(c for c in code if c.isalnum() or c in ("_", "-")) or "cq2026"
            fpath = os.path.join(DATA_DIR, f"ledger_{safe_code}.json")
            if os.path.exists(fpath):
                with open(fpath, "r", encoding="utf-8") as f:
                    payload = json.load(f)
            else:
                payload = {"code": safe_code, "data": None}
            body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return

        super().do_GET()

    def do_POST(self):
        parsed = urlparse(self.path)
        if parsed.path == "/api/ledger":
            qs = parse_qs(parsed.query)
            code = qs.get("code", ["cq2026"])[0]
            safe_code = "".join(c for c in code if c.isalnum() or c in ("_", "-")) or "cq2026"
            length = int(self.headers.get("Content-Length", 0))
            raw = self.rfile.read(length).decode("utf-8") if length > 0 else "{}"
            try:
                body_json = json.loads(raw)
                fpath = os.path.join(DATA_DIR, f"ledger_{safe_code}.json")
                with open(fpath, "w", encoding="utf-8") as f:
                    json.dump({"code": safe_code, "data": body_json.get("data")}, f, ensure_ascii=False, indent=2)
                resp = json.dumps({"ok": True, "code": safe_code}).encode("utf-8")
                self.send_response(200)
            except Exception as e:
                resp = json.dumps({"ok": False, "error": str(e)}).encode("utf-8")
                self.send_response(400)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(resp)))
            self.end_headers()
            self.wfile.write(resp)
            return

        self.send_response(404)
        self.end_headers()


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 8080))
    server = ThreadingHTTPServer(("0.0.0.0", port), LedgerHandler)
    print(f"Server started at http://localhost:{port}/web/index.html")
    server.serve_forever()
