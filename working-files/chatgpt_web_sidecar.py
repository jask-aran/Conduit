#!/usr/bin/env python3
"""Loopback-only ChatGPT Web transport for Conduit."""

from __future__ import annotations

import base64
import hashlib
import json
import os
import random
import re
import threading
import time
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any, Iterator

from curl_cffi import __version__ as CURL_CFFI_VERSION
from curl_cffi import requests

BASE = "https://chatgpt.com"
IMPERSONATE = os.environ.get("CONDUIT_CHATGPT_WEB_IMPERSONATE", "safari260")
COOKIE_FILE = Path(os.environ["CONDUIT_CHATGPT_WEB_COOKIE_FILE"])
PORT = int(os.environ.get("CONDUIT_CHATGPT_WEB_PORT", "0"))
MAX_BODY = 1_000_000
SESSION_COOKIE = "__Secure-next-auth.session-token"
RETAINED_COOKIES = {
    SESSION_COOKIE,
    "_puid",
    "oai-sc",
    "oai-did",
    "cf_clearance",
    "__cf_bm",
    "_cfuvid",
    "__cflb",
    "__oailb",
}


class UpstreamError(Exception):
    def __init__(self, message: str, code: str = "backend_unavailable", status: int = 502, retry_after_ms: int | None = None):
        super().__init__(message)
        self.code = code
        self.status = status
        self.retry_after_ms = retry_after_ms


def parse_cookie_header(value: str) -> dict[str, str]:
    if not isinstance(value, str) or not value.strip() or len(value) > 256_000 or any(ord(char) < 32 for char in value):
        raise ValueError("Paste a valid ChatGPT cookie string")
    cookies: dict[str, str] = {}
    for part in value.split(";"):
        if "=" not in part:
            continue
        name, cookie_value = part.strip().split("=", 1)
        if name:
            cookies[name] = cookie_value
    chunks: dict[int, str] = {}
    for name in list(cookies):
        match = re.fullmatch(re.escape(SESSION_COOKIE) + r"\.(\d+)", name)
        if match:
            chunks[int(match.group(1))] = cookies.pop(name)
    if SESSION_COOKIE not in cookies and chunks:
        indexes = sorted(chunks)
        if indexes != list(range(len(indexes))):
            raise ValueError("The ChatGPT session cookie chunks are incomplete")
        cookies[SESSION_COOKIE] = "".join(chunks[index] for index in indexes)
    cookies = {name: cookie_value for name, cookie_value in cookies.items() if name in RETAINED_COOKIES}
    if SESSION_COOKIE not in cookies or not cookies[SESSION_COOKIE]:
        raise ValueError("The ChatGPT session cookie is missing")
    return cookies


def solve_pow(seed: str, difficulty: str, config: list[Any], limit: int = 500_000) -> str:
    target = bytes.fromhex(difficulty)
    width = len(target)
    for nonce in range(limit):
        candidate = list(config)
        candidate[3] = nonce
        candidate[9] = nonce >> 1
        encoded = base64.b64encode(json.dumps(candidate, separators=(",", ":")).encode()).decode()
        if hashlib.sha3_512(seed.encode() + encoded.encode()).digest()[:width] <= target:
            return "gAAAAAB" + encoded
    raise UpstreamError("ChatGPT proof of work did not resolve", "backend_unavailable", 502)


class SseDecoder:
    """Decode the text and cursor fields used by ChatGPT's legacy and v1 SSE forms."""

    def __init__(self) -> None:
        self.last_path = ""
        self.assistant = False
        self.conversation_id = ""
        self.message_id = ""

    def feed(self, line: str) -> list[str]:
        if not line.startswith("data: ") or line[6:].strip() == "[DONE]":
            return []
        try:
            value = json.loads(line[6:])
        except json.JSONDecodeError:
            return []
        if not isinstance(value, dict):
            return []
        self.conversation_id = value.get("conversation_id") or self.conversation_id
        payload = value.get("v")
        if isinstance(payload, dict) and isinstance(payload.get("message"), dict):
            return self._message(payload["message"])
        if isinstance(value.get("message"), dict):
            return self._message(value["message"])
        if value.get("o") == "append":
            self.last_path = value.get("p") or self.last_path
            return [str(value.get("v", ""))] if self.assistant and self.last_path == "/message/content/parts/0" else []
        if value.get("o") == "patch" and isinstance(value.get("v"), list):
            return [str(op.get("v", "")) for op in value["v"] if isinstance(op, dict) and op.get("o") == "append" and op.get("p") == "/message/content/parts/0" and self.assistant]
        if isinstance(payload, str) and self.assistant and self.last_path == "/message/content/parts/0":
            return [payload]
        return []

    def _message(self, message: dict[str, Any]) -> list[str]:
        self.assistant = message.get("author", {}).get("role") == "assistant"
        if self.assistant:
            self.message_id = message.get("id") or self.message_id
        parts = message.get("content", {}).get("parts", [])
        return [parts[0]] if self.assistant and parts and isinstance(parts[0], str) and parts[0] else []


class Bridge:
    def __init__(self) -> None:
        self.session = requests.Session(impersonate=IMPERSONATE)
        self.lock = threading.Lock()
        self.access_token = ""
        self.token_expires_at = 0.0
        self.dpl = ""
        self.scripts: list[str] = []
        self.cookie_updates = 0
        self._load_cookies()

    def _load_cookies(self) -> None:
        try:
            data = json.loads(COOKIE_FILE.read_text())
            self.session.cookies.update(data.get("cookies", {}))
        except (FileNotFoundError, json.JSONDecodeError, OSError):
            pass

    def _save_cookies(self) -> None:
        COOKIE_FILE.parent.mkdir(parents=True, exist_ok=True)
        temporary = COOKIE_FILE.with_suffix(".tmp")
        temporary.write_text(json.dumps({"cookies": dict(self.session.cookies), "savedAt": time.time()}))
        os.chmod(temporary, 0o600)
        temporary.replace(COOKIE_FILE)
        self.cookie_updates += 1

    def set_credential(self, raw_cookie: str) -> None:
        cookies = parse_cookie_header(raw_cookie)
        with self.lock:
            self.session.cookies.clear()
            self.session.cookies.update(cookies)
            self.access_token = ""
            self.token_expires_at = 0
            self._save_cookies()

    def remove_credential(self) -> None:
        with self.lock:
            self.session.cookies.clear()
            self.access_token = ""
            self.token_expires_at = 0
            try:
                COOKIE_FILE.unlink()
            except FileNotFoundError:
                pass

    def health(self) -> dict[str, Any]:
        names = sorted(dict(self.session.cookies))
        return {"status": "ok", "protocolVersion": 1, "curlCffiVersion": CURL_CFFI_VERSION,
                "impersonate": IMPERSONATE, "auth": "configured" if "__Secure-next-auth.session-token" in names else "missing",
                "cookieNames": names, "cookieUpdates": self.cookie_updates}

    def headers(self) -> dict[str, str]:
        return {"Accept": "*/*", "Accept-Language": "en-US,en;q=0.9", "Origin": BASE, "Referer": BASE + "/",
                "Oai-Device-Id": str(uuid.uuid4()), "Oai-Language": "en-US"}

    def refresh_home(self) -> None:
        response = self.session.get(BASE, headers={**self.headers(), "Accept": "text/html"}, timeout=20)
        if response.status_code != 200:
            raise self.upstream_error(response, "ChatGPT homepage request failed")
        self.scripts = re.findall(r'src="(https://cdn\.oaistatic\.com/[^"]+\.js)"', response.text)
        match = re.search(r'(?:c/|_next/static/)([a-zA-Z0-9_-]+)/', response.text) or re.search(r'data-build="([^"]+)"', response.text)
        self.dpl = match.group(1) if match else self.dpl
        self._save_cookies()

    def token(self) -> str:
        if self.access_token and time.time() < self.token_expires_at:
            return self.access_token
        if "__Secure-next-auth.session-token" not in dict(self.session.cookies):
            raise UpstreamError("Connect a ChatGPT account in Settings", "auth_expired", 401)
        response = self.session.get(BASE + "/api/auth/session", headers=self.headers(), timeout=20)
        if response.status_code == 403:
            self.refresh_home()
            response = self.session.get(BASE + "/api/auth/session", headers=self.headers(), timeout=20)
        if response.status_code != 200:
            raise self.upstream_error(response, "ChatGPT session expired")
        self.access_token = response.json().get("accessToken", "")
        if not self.access_token:
            raise UpstreamError("ChatGPT session expired", "auth_expired", 401)
        self.token_expires_at = time.time() + 1200
        self._save_cookies()
        return self.access_token

    def models(self) -> list[dict[str, Any]]:
        with self.lock:
            token = self.token()
            response = self.session.get(BASE + "/backend-api/models", headers={**self.headers(), "Authorization": "Bearer " + token}, timeout=20)
            if response.status_code != 200:
                raise self.upstream_error(response, "ChatGPT model catalog failed")
            data = response.json()
            items = data.get("models", data.get("data", data if isinstance(data, list) else []))
            return [{"id": item.get("slug") or item.get("id"), "label": item.get("title") or item.get("name") or item.get("slug") or item.get("id")}
                    for item in items if isinstance(item, dict) and (item.get("slug") or item.get("id"))]

    def requirements(self, token: str) -> tuple[str, str]:
        if not self.dpl:
            self.refresh_home()
        config = [random.choice([3000, 4000, 3120, 4160]), time.strftime("%a %b %d %Y %H:%M:%S GMT-0500 (Eastern Standard Time)"),
                  4294705152, 0, "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15",
                  random.choice(self.scripts) if self.scripts else "", self.dpl, "en-US", "en-US,en", 0,
                  "hardwareConcurrency−16", "location", "window", time.perf_counter() * 1000, str(uuid.uuid4()), "", 16,
                  time.time() * 1000 - time.perf_counter() * 1000]
        p_token = "gAAAAAC" + base64.b64encode(json.dumps(config).encode()).decode()
        response = self.session.post(BASE + "/backend-api/sentinel/chat-requirements",
            headers={**self.headers(), "Authorization": "Bearer " + token, "Content-Type": "application/json"}, json={"p": p_token}, timeout=20)
        if response.status_code != 200:
            raise self.upstream_error(response, "ChatGPT request check failed")
        data = response.json()
        proof = data.get("proofofwork", {})
        proof_token = solve_pow(proof["seed"], proof["difficulty"], config) if proof.get("required") and proof.get("seed") and proof.get("difficulty") else ""
        return data.get("token", ""), proof_token

    def chat(self, body: dict[str, Any]) -> Iterator[dict[str, Any]]:
        with self.lock:
            token = self.token()
            sentinel, proof = self.requirements(token)
            user_message_id = str(uuid.uuid4())
            payload: dict[str, Any] = {"action": "next", "messages": [{"id": user_message_id, "author": {"role": "user"},
                "create_time": time.time(), "content": {"content_type": "text", "parts": [body.get("message", "")]},
                "metadata": {"serialization_metadata": {"custom_symbol_offsets": []}}}],
                "parent_message_id": body.get("parentMessageId") or str(uuid.uuid4()), "model": body.get("model") or "auto",
                "client_prepare_state": "success", "timezone_offset_min": 0, "timezone": "UTC",
                "conversation_mode": {"kind": "primary_assistant"}, "supports_buffering": True, "supported_encodings": ["v1"],
                "history_and_training_disabled": False}
            if body.get("conversationId"):
                payload["conversation_id"] = body["conversationId"]
            headers = {**self.headers(), "Authorization": "Bearer " + token, "Content-Type": "application/json", "Accept": "text/event-stream",
                       "Openai-Sentinel-Chat-Requirements-Token": sentinel}
            if proof:
                headers["Openai-Sentinel-Proof-Token"] = proof
            response = self.session.post(BASE + "/backend-api/conversation", headers=headers, json=payload, timeout=180, stream=True)
            if response.status_code != 200:
                raise self.upstream_error(response, "ChatGPT response failed")
            decoder = SseDecoder()
            for raw_line in response.iter_lines():
                line = raw_line.decode() if isinstance(raw_line, bytes) else raw_line
                for delta in decoder.feed(line):
                    yield {"type": "delta", "text": delta}
            self._save_cookies()
            yield {"type": "done", "conversationId": decoder.conversation_id or body.get("conversationId", ""),
                   "parentMessageId": decoder.message_id}

    @staticmethod
    def upstream_error(response: Any, message: str) -> UpstreamError:
        status = response.status_code
        if status in (401, 403):
            return UpstreamError(message, "auth_expired", 401)
        if status == 429:
            retry = response.headers.get("retry-after", "60")
            try:
                retry_ms = int(float(retry) * 1000)
            except ValueError:
                retry_ms = 60_000
            return UpstreamError(message, "rate_limited", 429, retry_ms)
        return UpstreamError(f"{message} ({status})")


BRIDGE = Bridge()


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *_args: Any) -> None:
        return

    def json_body(self) -> dict[str, Any]:
        size = int(self.headers.get("Content-Length", "0"))
        if size > MAX_BODY:
            raise ValueError("Request is too large")
        return json.loads(self.rfile.read(size) or b"{}")

    def send_json(self, status: int, value: Any) -> None:
        data = json.dumps(value).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self) -> None:
        try:
            if self.path == "/health":
                return self.send_json(200, BRIDGE.health())
            if self.path == "/models":
                return self.send_json(200, {"models": BRIDGE.models()})
            self.send_json(404, {"error": "not_found"})
        except Exception as cause:
            self.send_error_json(cause)

    def do_PUT(self) -> None:
        try:
            if self.path != "/credential":
                return self.send_json(404, {"error": "not_found"})
            BRIDGE.set_credential(self.json_body().get("cookie", ""))
            self.send_json(200, BRIDGE.health())
        except Exception as cause:
            self.send_error_json(cause)

    def do_DELETE(self) -> None:
        if self.path != "/credential":
            return self.send_json(404, {"error": "not_found"})
        BRIDGE.remove_credential()
        self.send_json(200, BRIDGE.health())

    def do_POST(self) -> None:
        try:
            if self.path != "/chat":
                return self.send_json(404, {"error": "not_found"})
            self.send_response(200)
            self.send_header("Content-Type", "application/x-ndjson")
            self.end_headers()
            for event in BRIDGE.chat(self.json_body()):
                self.wfile.write(json.dumps(event).encode() + b"\n")
                self.wfile.flush()
        except (BrokenPipeError, ConnectionResetError):
            pass
        except Exception as cause:
            event = error_body(cause)
            try:
                self.wfile.write(json.dumps({"type": "error", **event}).encode() + b"\n")
                self.wfile.flush()
            except (BrokenPipeError, ConnectionResetError):
                pass

    def send_error_json(self, cause: Exception) -> None:
        body = error_body(cause)
        self.send_json(body.pop("status"), body)


def error_body(cause: Exception) -> dict[str, Any]:
    if isinstance(cause, UpstreamError):
        return {"status": cause.status, "error": cause.code, "message": str(cause), **({"retryAfterMs": cause.retry_after_ms} if cause.retry_after_ms else {})}
    if isinstance(cause, (ValueError, json.JSONDecodeError)):
        return {"status": 400, "error": "invalid_request", "message": str(cause)}
    return {"status": 502, "error": "backend_unavailable", "message": str(cause)}


if __name__ == "__main__":
    server = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    print(json.dumps({"event": "ready", "port": server.server_port}), flush=True)
    server.serve_forever()
