# Conduit Pi templates

Each child directory is a versioned Conduit launch preset. `template.json`
selects the system prompt, tools, model scope, extensions, skills, and prompt
templates passed explicitly to Pi.

These are not project-local `.pi` directories. Working directories remain
clean, and `conduit-pi` or the web server can apply a template independently of
the selected working directory and session.

Pi's saved `enabledModels` setting overrides a template's model list; the list
in `template.json` is used only when Pi has no saved scope. Templates do not own
the next-chat default model or an existing session's recorded model and thinking
level.

`template.json` fields (paths resolve relative to the template directory):

- `id`, `version` — required template identity, recorded on live process state
- `systemPrompt` — system prompt file; defaults to `SYSTEM.md`
- `tools` — Pi tool allowlist passed as `--tools`
- `models` — fallback model scope used only when Pi has no saved `enabledModels`
- `extensions`, `skills`, `promptTemplates` — resource files passed explicitly

Templates launch Pi with `--no-approve` and with ambient extensions, skills,
prompt templates, themes, and context files disabled: the template's explicit
lists are the entire resource surface, and every allowed tool runs without
interactive approval. Treat a template's tool list and resources as trusted
executable configuration and review additions accordingly.
