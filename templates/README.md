# Conduit Pi templates

Each child directory is a versioned Conduit launch preset. `template.json`
selects the system prompt, tools, model scope, extensions, skills, and prompt
templates passed explicitly to Pi.

These are not project-local `.pi` directories. Working directories remain
clean, and `conduit-pi` or the web server can apply a template independently of
the selected working directory and session.
