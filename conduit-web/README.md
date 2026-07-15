# Conduit Web

The Conduit web surface combines an Express server, server-owned Pi RPC
processes, and a React/Vite client.

## Run

```bash
npm ci
npm test
npm run build
npm start
```

Open <http://127.0.0.1:4310>. Authenticate the isolated Pi runtime from the
repository root with `./scripts/conduit-pi.mjs`, then enter `/login`.

For development, run these in separate terminals:

```bash
npm run dev:server
npm run dev
```

## Runtime model

The reserved `chat` project uses `data/chat/files` as its working directory.
Named projects use direct children such as `data/chat/files/example`. Project
metadata lives centrally in ignored `data/conduit.json`; working directories
contain only agent-visible files.

Every Pi process receives:

- `PI_CODING_AGENT_DIR=data/pi`;
- the selected project directory as `cwd`;
- resources from `templates/chat/template.json` as explicit CLI arguments.

No session-directory override is supplied. Pi writes native JSONL sessions to
`data/pi/sessions/<encoded-cwd>/`, and Conduit verifies each JSONL header's `cwd`
when associating sessions with projects.

## Runtime API

- `GET /healthz`
- `GET /v0/capabilities`
- `GET|POST /v0/projects`
- `GET /v0/models`
- `GET|PATCH /v0/settings` reads and updates Pi's shared global model scope;
  terminal and web saves use the same isolated settings file.
- `GET /v0/sessions/:id`
- `GET|POST /v0/live-sessions`
- `GET /v0/live-sessions/:id/snapshot`
- `DELETE /v0/live-sessions/:id/process`
- `WS /v0/live-sessions/:id/stream`
