---
name: conduit-runtime
description: Manage Conduit Pi templates, preferences, and package installs. Load for profile editing, pi install, or runtime troubleshooting.
---

# Conduit runtime

## Layout

Typical repository roots (resolve from cwd / git root):

```text
templates/<id>/template.json   # profile manifest
templates/<id>/SYSTEM.md
templates/<id>/skills/...
data/pi/                       # PI_CODING_AGENT_DIR
data/preferences.json          # defaultTemplateId
data/sessions.json             # sticky per-chat templateId
data/conduit.json              # project / workspace catalog
```

## Pi packages (isolated agent home)

```bash
export PI_CODING_AGENT_DIR="${PI_CODING_AGENT_DIR:-$PWD/data/pi}"
pi list
pi install npm:some-package
pi update
```

Conduit launches Pi with `--no-extensions --no-skills` and then passes only the
template's explicit `--extension` / `--skill` paths. Installing a package into
`data/pi` is not enough — also list the resource in `template.json`.

## Edit a profile

1. Read `templates/<id>/template.json`.
2. Add skill directories or extension entry files under that template.
3. Append relative paths to `skills` / `extensions`.
4. Bump `version` when posture changes meaningfully.
5. Tell the user to start a new process (reopen chat / send a message) to load it.

## Workspace registration

Linked and cloned workspaces are owned by Conduit's project catalog, not by
editing files under a random path from the browser. Prefer the UI or
`POST /v0/projects` with `mode: "linked" | "cloned"`.
