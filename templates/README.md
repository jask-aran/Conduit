# Conduit Pi templates

Each child directory is a versioned Conduit launch preset (a **profile** in the
web UI). `template.json` selects the system prompt, tools, model scope,
extensions, skills, and prompt templates passed explicitly to Pi.

Shipped profiles:

| id | Label | Role |
|----|--------|------|
| `chat` | Assistant | Workspace files, code-mode shell, and model-agnostic web research |
| `workspace` | Coding | Full tools + git/web/develop skills for real folders |
| `codemode` | Code Mode | Experimental profile exposing only the `pi-code-tool` Python code tool |
| `runtime` | Runtime | Special one-off admin chat for templates and Pi package management |

## Discovery and durable identity

Conduit discovers every `templates/*/template.json` at server start. Settings →
Profiles chooses the default for new chats (`data/preferences.json`). Each chat
stores `templateId` and `templateVersion` in `data/sessions.json`. Missing
identity is stamped with the app (or project) default the next time the runtime
touches the chat. Resume reloads the template by id from disk.

Assistant, Coding, and Code Mode are ordinary selectable profiles. Code Mode is
an experiment: it loads only `pi-code-tool`, exposes only the top-level `code`
tool, and keeps the package's default mutation approval behavior. Runtime is special: it
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

Creating a Workspace chat immediately opens a draft with the app default profile,
unless Settings → Workspaces assigns that Workspace an explicit override.
Host Pi is also available as a synthetic override while detected; failure clears
that override back to global inheritance.
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

The Assistant profile explicitly loads the pinned `pi-web-access` extension.
Its file tools and shell are Pi-native tools, guided by the active-working-
directory instruction in `SYSTEM.md`; this profile does not provide an
OS-level workspace sandbox. Its web tools use OpenAI/Codex search when
available, then the configured provider fallback chain. Conduit sets the
extension workflow to `none` so research does not open Pi's curator UI.

The Code Mode profile explicitly loads the pinned `pi-code-tool` extension. Its
Python workspace mount is read-only, and its bridged `bash`, `edit`, and `write`
calls retain the package's approval gate. Conduit RPC has no native approval
dialog, so mutation behavior must be validated before this profile is used for
write-heavy work.

## Managing plugins and skills

Use a **Runtime** profile chat (Settings → Profiles → Open runtime chat) or the
terminal with `PI_CODING_AGENT_DIR=data/pi`:

```bash
pi install npm:some-package
```

Then add the installed entry file or skill directory to the relevant
`template.json`. There is no database-backed marketplace; the repository remains
the source of truth.
