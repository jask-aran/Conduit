# Conduit Pi templates

Each child directory is a versioned Conduit launch preset (a **profile** in the
web UI). `template.json` selects the system prompt, tools, model scope,
extensions, skills, and prompt templates passed explicitly to Pi.

Shipped profiles:

| id | Label | Role |
|----|--------|------|
| `chat` | General | Restrained tools (`read`, `bash`) for ordinary conversation |
| `workspace` | Coding | Full tools + git/web/develop skills for real folders |
| `runtime` | Runtime | Special one-off admin chat for templates and Pi package management |

## Discovery and durable identity

Conduit discovers every `templates/*/template.json` at server start. Settings →
Profiles chooses the default for new chats (`data/preferences.json`). Each chat
stores `templateId` and `templateVersion` in `data/sessions.json`. Missing
identity is stamped with the app (or project) default the next time the runtime
touches the chat. Resume reloads the template by id from disk.

General and Coding are ordinary selectable profiles. Runtime is special: it
cannot be an app or project default and does not appear in ordinary profile
switching. Settings → Profiles shows its details separately and provides
**Open runtime chat**; each activation creates a fresh management chat.

## Workspaces

Projects may be:

- **managed** — directory under `data/chat/files/<slug>`
- **linked** — allow-listed absolute path already on the machine (unregister does not delete files)
- **cloned** — `gh repo clone` when available for GitHub sources, otherwise
  `git clone`, into a user-selected allow-listed absolute path

These are catalog origins, not separate agent products. The interface presents
linked and cloned roots uniformly as non-owning Workspaces; a clone is
functionally a checkout followed by Workspace registration, and unregistering
does not delete either working tree.

Creating a Workspace chat immediately opens a draft with its default profile.
The composer uses one profile selector. Ordinary profiles launch the
bundled Isolated Pi with the private `data/pi` home; the synthetic **Host Pi**
choice uses the host executable/home/resources plus the additive resources under
`templates/conduit-workspace/`. Host Pi does not load an ordinary tracked
profile, and its mandatory bridge remains hidden from profile selection. The
choice is mutable until the first prompt starts Pi and immutable afterward; any
required Host project trust decision is requested on first send.

Allow-list roots come from `CONDUIT_WORKSPACE_ALLOWLIST` (default: home,
repository root, and the managed files root). Browser-supplied paths never become
Pi `cwd` until the server resolves and allow-lists them.

## Manifest fields

Paths resolve relative to the template directory:

- `id`, `version` — required identity
- `label`, `description`, `posture` — UI metadata
- `systemPrompt` — defaults to `SYSTEM.md`
- `tools` — Pi `--tools` allowlist
- `models` — fallback when Pi has no saved `enabledModels`
- `extensions`, `skills`, `promptTemplates` — explicit resource paths

Templates launch with `--no-approve` and ambient resources disabled. Treat tool
lists and resources as trusted executable configuration.

## Managing plugins and skills

Use a **Runtime** profile chat (Settings → Profiles → Open runtime chat) or the
terminal with `PI_CODING_AGENT_DIR=data/pi`:

```bash
pi install npm:some-package
```

Then add the installed entry file or skill directory to the relevant
`template.json`. There is no database-backed marketplace; the repository remains
the source of truth.
