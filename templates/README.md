# Conduit agent profiles

Each child directory contains a versioned profile for the Conduit durable agent.
`template.json` selects the system prompt, tools, model scope, extensions, skills,
and prompt templates. The server loads these files with
`scripts/pi-runtime.mjs` and applies the selected profile to the pi-durable
conversation. It does not start a classic Pi process.

Shipped profiles:

| id | Label | Role |
|----|-------|------|
| `assistant` | Assistant | Workspace tools and model-agnostic web research |
| `coding` | Coding | Workspace tools, development skills and pi-durable codemode |
| `runtime` | Runtime | Special chat for Conduit runtime management |

`templates/chat-naming/SYSTEM.md` is the prompt for the separate chat-title
service. Settings can edit it, but it is not a selectable profile.

## Discovery and identity

Conduit discovers each `templates/*/template.json` at server start. Settings →
Profiles selects the default for new chats (`data/preferences.json`). Each chat
stores `templateId` and `templateVersion` in `data/sessions.json`. On open, the
server loads the current template and configures the durable conversation.

Assistant and Coding are selectable profiles. Runtime is special: it cannot be
a global or workspace default and does not appear in ordinary profile
switching. Settings → Profiles provides **Open runtime chat**, which creates a
new management chat.

The server converts classic Pi chats at startup. It reads the active JSONL
branch, writes it to a durable conversation, and replaces the stored session
path. The JSONL parser remains for this one-time conversion and legacy cleanup;
new turns use the durable conversation store.

## Workspaces

Projects may be managed folders, linked folders, or cloned repositories. These
are catalog origins; they do not select a different agent. Each workspace may
inherit the global profile or set its own default.

The durable agent uses the selected workspace as its working directory. For a
folder on a paired device, file and shell calls run through that device's node.
The browser remains connected to the head server.

## Manifest fields

Paths resolve relative to the template directory:

- `id`, `version` — required identity
- `label`, `description`, `posture` — profile details
- `systemPrompt` — defaults to `SYSTEM.md`
- `tools` — tools available to the profile
- `models` — model scope when `data/pi/settings.json` has no enabled-model list
- `extensions`, `skills`, `promptTemplates` — profile resources

The Assistant and Coding profiles load the `pi-web-access` extension. Coding
also uses pi-durable's codemode extension. Skills appear as `/skill:<name>`
commands and are included in the profile instructions.

Provider credentials and model settings stay under the configured agent
settings directory, normally `data/pi`. Web-search routing may use a derived
model file there. Shell tools prepend `working-files/.venv/bin` (or `Scripts` on
Windows) to `PATH`; this is done by `buildManagedToolEnvironment`. The
environment is shared by workspaces and does not write inside them.

## Managing plugins and skills

Add an extension entry file or skill directory to the relevant `template.json`.
Keep these profile resources in the repository. There is no database-backed
marketplace.
