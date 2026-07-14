# Conduit Chat — Phase 0 custom

This is the primary Phase 0 Conduit surface: a first-party chat interface backed
by a Conduit-owned `pi --mode rpc` process. Chat is functional. Assist, Remote,
Dashboard, Settings, sharing, and attachments are deliberately visible only as
future seams rather than simulated features.

## Run it

Requirements: Node.js 22+, npm, and an installed/authenticated `pi` command.

```bash
npm ci
npm run build
npm start
```

Open <http://127.0.0.1:4310>. For development, run `npm run dev:server` and
`npm run dev` in separate terminals.

## Project and session model

Every chat belongs to a project. The reserved `chat` project is the default
unstructured chat experience.

```text
app/files/
  chat/
    .conduit/project.json
    .conduit/sessions/*.jsonl
    .pi/settings.json
  project-name/
    .conduit/project.json
    .conduit/sessions/*.jsonl
    .pi/settings.json
    ...working files...
```

The project directory is Pi's working directory. Pi's native JSONL is the
authoritative Phase 0 session transcript and is stored under that project's
`.conduit/sessions`. Conduit maintains its own project identity around the Pi
record so the runtime transcript does not become the final application schema.

The server owns live Pi processes. Closing the browser does not terminate one;
reopening a persisted session resumes from its JSONL. Do not open the same JSONL
for writing in two apps at once. Different chats within one project are safe.

## Shared evaluation

From the repository root, this starts all three interfaces:

```bash
bash .devcontainer/start-evaluation.sh restart
```

| Port | Surface | Role |
| --- | --- | --- |
| 4310 | Conduit custom | Primary implementation |
| 3001 | Pi Tau | Server/process comparator |
| 8504 | PI WEB | Projects/session UX comparator |

Project creation writes `app/state/pi-web-projects.json`, the registry consumed
by PI WEB. Each project also gets `.pi/settings.json` pointing Pi at the same
session directory. As a result, Conduit and PI WEB discover the same project
sessions and Pi processes spawned by Tau in a project write there too.

Pi Tau's own saved-history sidebar scans Pi's global catalog rather than these
nested project stores, so it does not provide a complete cross-project listing.
This is an upstream Tau UI limitation, not a separate session format.

## Runtime API

- `GET /healthz`
- `GET /v0/capabilities`
- `GET|POST /v0/projects`
- `GET /v0/models`
- `GET /v0/sessions/:id`
- `GET|POST /v0/live-sessions`
- `GET /v0/live-sessions/:id/snapshot`
- `DELETE /v0/live-sessions/:id/process`
- `WS /v0/live-sessions/:id/stream`

The WebSocket accepts Pi RPC JSON objects and streams Pi events without
inventing a second agent protocol.
