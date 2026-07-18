# Conduit Pi templates

Each child directory is a versioned Conduit launch preset (a **profile** in the
web UI). `template.json` selects the system prompt, tools, model scope,
extensions, skills, and prompt templates passed explicitly to Pi.

Shipped profiles:

| id | Label | Role |
|----|--------|------|
| `chat` | General | Restrained tools (`read`, `bash`) for ordinary conversation |
| `workspace` | Workspace | Full tools + git/web/develop skills for real folders |
| `runtime` | Runtime | Admin chat for templates and Pi package management |

## Discovery and durable identity

Conduit discovers every `templates/*/template.json` at server start. Settings →
Profiles chooses the default for new chats (`data/preferences.json`). Each chat
stores `templateId` and `templateVersion` in `data/sessions.json`. Missing
identity is stamped with the app (or project) default the next time the runtime
touches the chat. Resume reloads the template by id from disk.

## Workspaces

Projects may be:

- **managed** — directory under `data/chat/files/<slug>`
- **linked** — allow-listed absolute path already on the machine (unregister does not delete files)
- **cloned** — `git clone` into the managed root

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
