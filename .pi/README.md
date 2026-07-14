# Conduit Pi experiences

This directory contains versioned, repository-owned Pi experience definitions.
Conduit launches Pi with ambient global and project discovery disabled, then
loads only the resources named by the selected experience manifest.

Each experience lives under `experiences/<id>/` and owns its system prompt,
model scope, extensions, skills, and prompt templates. Increment `version` whenever a change
would alter the runtime behavior of existing sessions. Conduit can then bind a
session to an exact experience revision without making Pi's JSONL the owner of
application metadata.

Runtime credentials and generated Pi state do not belong here. They live in the
ignored `app/state/pi-agent/` directory, including terminal-launcher sessions.
