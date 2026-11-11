# Conduit

One polished home for the coding agents you run. Chats, a real terminal, files and Workspaces for Conduit's own durable agent, Codex, Claude Code, OpenCode and more, self-hosted and available on your desktop, phone and browser.

![Conduit chat, Workspace changes and terminal](docs/images/hero.gif)

**Every agent, one transcript.** Follow live thinking, tool calls and history in the same chat interface. Use voice dictation, approvals, attachments, model and effort controls where supported; pick up supported CLI threads from the Work area.

**A real terminal, everywhere.** Open a WebGL terminal with a shortcut from a chat or place page. Its tmux session keeps running when you navigate away or the server restarts.

**Workspaces beside your chat.** Link any folder, create a managed folder or clone a Git repository. Browse, edit and search files, then inspect Git status and diffs from the Workspace rail and dock.

**Web, Windows and Android on your own server.** Run one Node server for your agents and files, then connect from multiple clients. Each client can keep several servers; the installed apps can find servers on your LAN.

## Supported agents

| Harness | How Conduit drives it |
| --- | --- |
| Conduit durable agent | Built in: runs inside the server on your Pi models and logins, and a chat survives a restart mid-turn |
| Codex | Installed Codex through `codex app-server` |
| Claude Code | Installed Claude Code and its saved sessions |
| OpenCode | Installed OpenCode through its shared service and event stream |
| fx | Installed fx through ACP |
| ChatGPT Web | Models from a connected ChatGPT account |

Capabilities vary by harness; each adapter declares its own (`conduit-web/src/chat-backend-contract.d.ts`).

## Compare

The tlbx and Garcon entries reflect their public [tlbx README](https://github.com/tlbx-ai/tlbx#readme) and [Garcon README](https://github.com/cfal/garcon#readme).

| Capability | Conduit | tlbx | Garcon |
| --- | --- | --- | --- |
| Self-hosted browser access | Yes | Yes | Yes |
| Structured agent conversations and tool calls | Yes | Agent Controller sessions | Yes |
| Terminals beside agent work | Yes | Yes | Yes |
| Files and Git changes beside agent work | Yes | Yes | Yes |
| Claude Code in a structured conversation | Yes | Terminal session | Yes |
| First-party Windows and Android clients | Yes | (verify) | (verify) |
| Several servers in one client | Yes | Hub connects machines | (verify) |

## Screenshots

<p>
  <img src="docs/images/chat-and-terminal.png" width="49%" alt="Chat beside a terminal" />
  <img src="docs/images/chat-and-editor.png" width="49%" alt="Chat beside the file editor" />
</p>
<p>
  <img src="docs/images/split-editor-terminal.png" width="49%" alt="Two files and a terminal" />
  <img src="docs/images/workspace-files.png" width="49%" alt="Workspace files beside a chat" />
</p>

## Install

On a Linux x64 computer you want to control (Windows: inside WSL):

```bash
curl -fsSL https://get.jask-aran.com/conduit | bash
```

It installs Conduit and the Node it runs on into `~/.local/share/conduit`, then
asks for a login password and who may reach it, and starts it as a service.
Nothing needs root. Manage it with `conduit-server status`, `logs` and
`update`; see [install and operations](docs/DEPLOYMENT.md).

## Start locally

Install Node.js and npm, then run:

```bash
bash .devcontainer/start-conduit.sh setup
node scripts/conduit-auth.mjs set-password
bash .devcontainer/start-conduit.sh restart
```

Open <http://127.0.0.1:4310>. Connect a model provider in **Settings › Services › Integrations**.

## Repository map

| Path | What it contains |
| --- | --- |
| `conduit-web/` | Server, harness adapters, web UI, native clients and tests |
| `templates/` | The durable agent's profiles, tools and skills |
| `scripts/` | Authentication, deployment and release tools |
| `docs/` | Operations and testing guides, brand and images |

Start with [install, clients and operations](docs/DEPLOYMENT.md), [testing](docs/TESTING.md) and [contributing](CONTRIBUTING.md).

## Changing the code

The routes in `conduit-web/src/server/routes/` and the chat wire vocabulary in
`conduit-web/src/chat-backend-contract.d.ts` are the reference. What they do not say:

- Every route, upload and WebSocket upgrade needs a session unless `isAllowlistedPath`
  (`conduit-web/src/auth-middleware.js`) admits it, and an open route gives its reason there. A bearer token never
  goes in a URL: installed clients trade it for a single-use socket ticket (`POST /v0/auth/socket-ticket`).
- The server owns live agent sessions: closing a page never stops a chat's turn.
- Each harness adapter translates its own events into the contract's vocabulary; nothing harness-native reaches the
  browser. A wire change updates the contract in the same change.
- The worker scripts (`sw.js`, `registerSW.js`, `workbox-*.js`) are served `no-store`, not `no-cache`: a CDN turns a
  revalidating header into a TTL of its own, and a cached worker pins clients to a build the server no longer has.
- Inbox entries, even the person's own, never enter `personWords` or count as approval intent.
- The chat meteor field is `@jask-aran/solid-components`: change it in
  [jask-aran/solid-components](https://github.com/jask-aran/solid-components) and release a version, never a copy here.

See what shipped in [GitHub Releases](https://github.com/jask-aran/Conduit/releases).

## License

Copyright (C) 2026 Jaskaran Singh. Licensed under the [GNU Affero General Public License v3.0 only](LICENSE) (`AGPL-3.0-only`): you may use, modify and share it freely, and anyone who runs a modified version as a network service must offer its users the source.
