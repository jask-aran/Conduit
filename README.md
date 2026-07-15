# Conduit

[![Open in GitHub Codespaces](https://github.com/codespaces/badge.svg)](https://codespaces.new/jask-aran/Conduit?quickstart=1)

![architecture](interface_first_platform_architecture.svg)

Conduit is an interface-first personal agent platform. The web application owns
one `pi --mode rpc` process per live chat while Pi remains authoritative for
authentication, models, tools, and JSONL session history.

## Repository structure

```text
conduit-web/
  src/                 Express server and Pi RPC lifecycle
  src/client/          React/Vite interface
  test/                Node test suites

templates/
  chat/                selected Pi system prompt and resource manifest

scripts/
  conduit-pi.mjs       template-aware terminal launcher
  pi-runtime.mjs       template loading and Pi argument construction

data/
  chat/files/          chat working directories and agent-visible files
  pi/                  isolated Pi agent home
  conduit.json         Conduit project catalog
```

`conduit-web/`, `templates/`, and `scripts/` are tracked product source.
`data/` is ignored mutable application data and forms one backup or mount
boundary for working files, project metadata, credentials, preferences, and
session history.

## Data model

### Projects and working files

`data/conduit.json` is the Conduit-owned project catalog. Each project contains:

```json
{
  "id": "project_…",
  "slug": "example",
  "name": "Example",
  "kind": "project",
  "createdAt": "2026-01-01T00:00:00.000Z"
}
```

The reserved `chat` project has ID `project_chat`, kind `unstructured`, and
working directory `data/chat/files`. Every named project uses
`data/chat/files/<slug>`. Working directories contain only files available to
the corresponding chats; they do not contain Conduit metadata, Pi configuration,
or session JSONL.

All unstructured chats share `data/chat/files` and therefore share access to its
files. Named projects provide separate filesystem scopes beneath that root.

### Pi runtime and sessions

`data/pi` is Conduit's app-wide Pi agent home:

```text
data/pi/
  auth.json
  settings.json
  trust.json                 when Pi creates it
  sessions/
    <encoded-cwd>/
      <timestamp>_<id>.jsonl
```

Conduit sets `PI_CODING_AGENT_DIR=data/pi` but does not set
`PI_CODING_AGENT_SESSION_DIR` or pass `--session-dir`. Pi derives its native
session directory from the process working directory and records the canonical
`cwd` in every JSONL header. Conduit associates a session with a project by
matching that header exactly, rather than trusting the lossy encoded directory
name.

Pi JSONL is the authoritative transcript. `data/conduit.json` stores only
application metadata Pi does not model: stable project IDs, display names,
kinds, and creation times. Live process state, connected WebSockets, and recent
RPC events are held in server memory; persisted sessions remain resumable after
a server restart.

Do not let two Pi processes write the same JSONL simultaneously.

### Templates

Templates are tracked Conduit launch presets, not project-local `.pi`
directories. `templates/chat/template.json` selects a system prompt, allowed
tools and models, extensions, skills, and prompt templates. The web server and
`conduit-pi` translate the selected template into explicit Pi arguments while
independently selecting the Pi home, working directory, and session.

The configured template is applied when a session process starts or resumes.
Template identity is present in live process state but is not persisted as part
of the current project catalog.

## Interface development

The interface uses a Shadcn-first component policy. New controls, dialogs,
menus, forms, navigation, feedback, and layout primitives should use Shadcn
components whenever an appropriate component exists. Compose and theme those
primitives before writing bespoke interaction code; custom components are for
Conduit-specific behavior that the component set does not cover.

Shadcn components are added to the repository as source when needed, keeping
their standard accessibility and interaction behavior intact. Application tests
remain necessary for Conduit-specific state, RPC, and composition behavior.

## Setup and development

Requirements: Node.js 22+, npm, and Pi Coding Agent 0.80.6 available as `pi`.

```bash
cd conduit-web
npm ci
npm test
npm run build
```

Authenticate Conduit's isolated Pi runtime from the repository root:

```bash
./scripts/conduit-pi.mjs
```

Enter `/login`. The launcher uses the current directory as Pi's working
directory. To share a named project's native history with the web app:

```bash
cd data/chat/files/project-name
../../../../scripts/conduit-pi.mjs
```

Run the production server from `conduit-web/` with `npm start`, then open
<http://127.0.0.1:4310>. For development, run `npm run dev:server` and
`npm run dev` in separate terminals.

The devcontainer installs Pi and project dependencies, builds the client,
installs `conduit-pi` in `~/.local/bin`, starts Conduit, and forwards port 4310.

## Verification

```bash
cd conduit-web
npm test
npm run build
```
