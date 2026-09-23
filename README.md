# Conduit

![A chat beside the Workspace terminal running OpenCode](docs/images/chat-and-terminal.png)

![A Codex chat beside the Workspace file editor](docs/images/chat-and-editor.png)

Conduit is a self-hosted, single-user app for working with any coding agent. It
gives chats, working files, Workspaces, attachments, terminals and live agent
sessions one authenticated home, reachable from the web, the desktop and your
phone. Its goal is a durable, personal control plane for agents that work across
local and remote environments.

## Features

- **Any agent, one chat.** Persistent chats using any harness you have
  installed, or the prebuilt Pi-based Conduit harness. Every agent gets the same
  live thinking and tool calls, approvals, attachments, model and effort
  controls, and history.

- **Workspace panel with file editing.** Beside any chat: browse, preview, edit
  and search files, see Git status, history and diffs, and review what the agent
  changed without leaving the conversation.

- **Ultrafast terminal streaming.** A ttyd-style terminal streams the server's
  own shell straight to the client, one keystroke or tap away from every chat,
  dashboard and Workspace. It is backed by tmux, so it outlives navigation and
  server restarts and brings back the commands it was running.

- **Any folder is a Workspace.** Link a folder on your computer, create a
  managed one or clone a Git repository, each with its own dashboard, icon and
  colour.

- **Web, Windows and Android.** Browser, desktop and native mobile clients with
  full feature parity, all running off a single Node server. See
  [desktop and Android clients](docs/desktop-client.md).

- **Voice.** Push-to-talk and toggle dictation through managed local Whisper
  and Parakeet tiers or OpenAI, Deepgram and Groq.

- **Self-hosted.** A Docker deployment with automatic HTTPS and persistent data
  and Workspace mounts.

<p>
  <img src="docs/images/split-editor-terminal.png" width="49%" alt="Two files side by side with a terminal" />
  <img src="docs/images/workspace-files.png" width="49%" alt="A Workspace's files beside its chat" />
</p>

## Agents

Each agent runs as its own harness; Conduit translates its events into one chat
model, so every agent gets the same transcript, trace, approvals and history.
Adapted today:

- **Conduit Pi** — [Pi](https://github.com/earendil-works/pi) profiles, with
  forks, regeneration, steering and queued prompts
- **Codex CLI** — through `codex app-server`
- **OpenCode** — through its background service and event stream
- **fx** — through `fx acp`
- **ChatGPT Web**

A profile picks the harness, model and effort for a chat. The **Computer** area
opens each installed harness's own sessions, so a thread started in its CLI can
be picked up here. See the [chat backend contract](docs/chat-backend-contract.md)
for what each one supports.

## Architecture

```text
  Pi        Codex CLI     OpenCode       fx        ChatGPT Web     harnesses
   │            │             │           │             │
   ▼            ▼             ▼           ▼             ▼
┌────────────────────────────────────────────────────────────┐
│                      Conduit server                        │
│  adapters · chat logs · Workspaces · terminals · auth      │
└────────────────────────────────────────────────────────────┘
        │  HTTP + one live WebSocket per chat
   ┌────┴──────────────┬───────────────────┬─────────────┐
   ▼                   ▼                   ▼             ▼
 browser / PWA   Windows desktop     Android app     … any number,
                   (Tauri)          (Capacitor)      at once
```

One server holds the agents and the files; any number of clients attach to it,
and a client can hold several servers and move between them
([servers](docs/servers.md)).

## Deploy

Requires a Linux VPS, a public hostname that points to it, and Docker Engine
with the Compose plugin. On Debian or Ubuntu, the installer can install Docker
when run as root.

```bash
curl -fsSL https://get.jask-aran.com/conduit | bash
```
Enter the public hostname and login password when prompted. Open the HTTPS URL
shown by the installer.

To update an existing deployment:

```bash
~/conduit/scripts/deploy.sh restart
```

See [deployment operations](docs/operations/deployment.md) for custom paths,
release pinning, backup, and restore.

## Start locally

Requires Node.js 22+ and npm.

```bash
bash .devcontainer/start-conduit.sh setup
node scripts/conduit-auth.mjs set-password
bash .devcontainer/start-conduit.sh restart
```

Open <http://127.0.0.1:4310>. Sign in, then open **Settings → Auth** to connect
a model provider.

## Repository map

```text
conduit-web/  Server, harness adapters, web client, native shells, and tests
templates/    Pi profiles, tools, and skills
scripts/      Authentication, deployment, backup, and release tools
docs/         Architecture, operations, and release documentation
```

Development guides:
- [Web runtime and API](conduit-web/README.md)
- [Deployment operations](docs/operations/deployment.md)
- [Runtime data](docs/operations/runtime-data.md)
- [Testing](docs/testing.md)
- [Contributing](CONTRIBUTING.md)
