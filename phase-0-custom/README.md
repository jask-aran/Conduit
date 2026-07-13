# Conduit custom Pi runtime (reference)

This folder preserves the earlier Phase 0 direction: Conduit owns one
`pi --mode rpc` process per live chat and exposes it to a small browser client.
It is retained as an architectural reference now that PI WEB is the default.

## Run on WSL2 Ubuntu

Requirements: Node.js 20+, npm, and an authenticated `pi` command on `PATH`.

```bash
cp .env.example .env.local
npm install
npm start
```

Open <http://127.0.0.1:4310>. The server binds to loopback by default.

## Runtime contract

- `GET /healthz`
- `GET /v0/capabilities`
- `GET /v0/sessions`
- `POST /v0/sessions`
- `DELETE /v0/sessions/:id/process`
- `WS /v0/sessions/:id/stream`

The WebSocket accepts Pi RPC JSON objects. Convenience browser messages of
`{ "type": "prompt", "message": "..." }` are passed to Pi as JSONL. Pi events
are streamed back unchanged. A browser disconnect does not terminate Pi.

Session discovery uses Pi's JSONL session files. The stable public ID is derived
from the session file path; arbitrary browser-supplied paths are never accepted.

## Provenance

The original transient checkout was no longer available when this repository was
prepared. This is a faithful reconstruction of the implemented process ownership,
HTTP contract, session discovery, and JSONL bridge, not a byte-for-byte recovery.

