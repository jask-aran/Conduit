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
also contain `.conduit/chats/<chat-id>/{attachments,.partial}`. Pi runs from the
project root and native JSONL remains outside the working tree. Ignored
`data/sessions.json` holds the atomic lightweight Conduit chat registry. Draft
chats exist before Pi; the first message attaches a private Pi mapping and makes
the same public chat ID active. Active mappings are checkpointed after completed
responses and explicit mutations and reconciled with native files at startup.

Raw attachment bodies stream to exclusive `.part` files and publish by atomic
rename. The filesystem is the durable attachment registry. Prompt envelopes
contain validated relative paths rather than file bytes. Generation IDs gate
late output after stop; Pi receives public `abort` and `fork` RPC commands, and
a hung abort terminates the process after 250 ms for clean resumption.

The interface keeps uploaded Attachment cards above the bounded native
textarea until send, then renders the same cards beneath their user message.
Persisted image cards use the attachment preview route, including when restored
for edit. The compact composer model menu remains separate from Settings'
searchable, grouped multi-model Combobox. Cmd/Ctrl+K opens the application
Command palette; the composer slash Popover contains only `/attach`. A
project-aware breadcrumb identifies where each chat belongs.

Every Pi process receives:

- `PI_CODING_AGENT_DIR=data/pi`;
- the selected project directory as `cwd`;
- resources from `templates/chat/template.json` as explicit CLI arguments.

No session-directory override is supplied. Pi writes native JSONL sessions to
`data/pi/sessions/<encoded-cwd>/`, and Conduit verifies each JSONL header's `cwd`
when associating sessions with projects.

JSONL remains authoritative for persisted messages, tool calls, model changes,
and thinking-level changes. Opening a chat reconstructs that state from its
entries. Selecting a model updates the active process and Pi's shared
`defaultModel`; a new chat starts with that saved model while an existing chat
retains its recorded model.

## Client composition

The Shadcn icon-collapsible sidebar separates first-class Chats from expandable
Projects. Draft chats stay out of navigation until their first message creates a
session, after which the new session is selected. Context menus expose chat
rename, move, duplicate, transcript copy, and delete operations, plus project
chat creation, rename, directory opening, bulk move, and delete operations.

Assistant messages pass through `src/client/chat-markdown.jsx`, which configures
Streamdown for live and restored content. GFM, partial streaming Markdown,
KaTeX math, and lazily loaded Shiki fenced-code highlighting share one renderer.
HTML is sanitized, unsafe URLs are removed, remote images become alt text, and
external links require confirmation. User messages are displayed literally.

The single-line composer owns the current model and thinking controls. A model
selection is sent to an attached live process and saved as Pi's next-chat
default; opening a persisted session restores its own model and thinking level.

## Runtime API

- `GET /healthz`
- `GET /v0/capabilities`
- `POST /v0/chats`
- `GET|DELETE /v0/chats/:id` (draft cleanup requires `?ifEmpty=true`)
- `PUT|GET /v0/chats/:id/attachments/:attachment-id` uploads raw bytes or downloads;
  `?preview=1` serves supported raster images inline
- `GET /v0/chats/:id/attachments`
- `DELETE /v0/chats/:id/attachments/:attachment-id`
- `GET|POST /v0/projects`
- `PATCH|DELETE /v0/projects/:id`
- `POST /v0/projects/:id/open`
- `POST /v0/projects/:id/move-sessions`
- `GET /v0/models`
- `GET|PATCH /v0/settings` reads and updates Pi's shared global model scope;
  terminal and web saves use the same isolated settings file.
- `GET|PATCH|DELETE /v0/sessions/:id`
- `GET /v0/sessions/:id?before=<entry-index>` returns a ten-turn transcript page
- `GET /v0/sessions/:id/transcript`
- `GET /v0/sessions/:id/tools/:tool-id` fetches deferred large tool output
- `POST /v0/sessions/:id/duplicate` returns `409` while chat-file ownership is deferred
- `POST /v0/sessions/:id/move`
- `GET|POST /v0/live-sessions`
- `GET /v0/live-sessions/:id/snapshot`
- `DELETE /v0/live-sessions/:id/process`
- `WS /v0/live-sessions/:id/stream`

## Verification

```bash
npm test
npm run test:browser
npm run build
```

Browser tests mock the API for deterministic desktop and mobile coverage and
write screenshots and traces under `test-results/` only when a test fails.
