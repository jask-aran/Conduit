# Conduit runtime data

This directory contains ignored mutable data:

```text
chat/files/       working files visible to chat sessions
pi/               Conduit's isolated Pi agent home and native sessions
conduit.json      stable project IDs and display metadata
sessions.json     atomic, rebuildable session metadata registry
preferences.json  app preferences (default profile for new chats)
runtime.json      warm-pool and generation policy
```

`chat/files/` is the working directory for unstructured chats. Managed named
projects are direct children. Linked workspaces store only catalog metadata in
`conduit.json` and use an allow-listed absolute path as Pi `cwd`. Each working
root may contain a Conduit-owned `.conduit/chats/<chat-id>/` tree holding
per-chat `attachments/` and a transient `.partial/` upload directory. Pi
associates sessions with these working directories and stores their JSONL under
`pi/sessions/`; no `.pi` directories or Pi configuration are generated inside
working directories.

`sessions.json` contains no transcript entries. It exists so listing chats does
not require reading every JSONL and is reconciled against native session files
when Conduit starts. Pi JSONL remains authoritative if the registry is missing
or stale after an interrupted response.
`pi/settings.json` is the shared authority for web and terminal model scope and
the next-chat default model. Native session JSONL remains authoritative for each
chat's transcript, tool calls, model, and thinking level. `conduit.json` contains
only Conduit-owned project identity and display metadata.

Repository-owned behavior belongs in `../templates/`, not in runtime data.
Back up or mount this directory as one unit to preserve files, project identity,
Pi credentials and preferences, and session history.
