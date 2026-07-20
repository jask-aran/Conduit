# Conduit runtime data

This directory contains ignored mutable data:

```text
chat/files/       working files visible to chat sessions
pi/               isolated Pi home and sessions for ordinary profile chats
conduit.json      stable project IDs and display metadata
sessions.json     atomic session metadata and private Pi mappings
preferences.json  app preferences (default profile for new chats)
runtime.json      warm-pool and generation policy
```

`chat/files/` is the working directory for unstructured chats. Managed named
projects are direct children. Linked and cloned Workspaces store catalog metadata
in `conduit.json` and use an allow-listed absolute path as Pi `cwd`. A Workspace's
nullable `defaultTemplateId` is `null` when it inherits `preferences.json` and an
ordinary profile id or `host-pi` when explicitly overridden. Unavailable Host Pi
defaults are cleared back to `null`. Each working
root may contain a Conduit-owned `.conduit/chats/<chat-id>/` tree holding
per-chat `attachments/` and a transient `.partial/` upload directory. Pi
associates sessions with these working directories and stores their JSONL under
`pi/sessions/`; no `.pi` directories or Pi configuration are generated inside
working directories.

`sessions.json` contains no transcript entries. Empty drafts stay out of the
sidebar until a completed attachment or first message; only startup cleanup
removes empty drafts older than 24 hours, and a draft with a completed
attachment is never removed automatically. Each row stores its immutable
runtime kind, installation identity, creation-time binary version, and profile
identity alongside the stable Conduit chat metadata. It exists so listing chats does
not require reading every JSONL and is reconciled against native session files
when Conduit starts. Pi JSONL remains authoritative if the registry is missing
or stale after an interrupted response.
`pi/settings.json` is the shared authority for Isolated Pi web and terminal model scope and
the next-chat default model. Native session JSONL remains authoritative for each
chat's transcript, tool calls, model, and thinking level. `conduit.json` contains
only Conduit-owned project identity and display metadata.

Host Pi Workspace chats do not use `data/pi`; they use the server user's
login-shell Pi home (`PI_CODING_AGENT_DIR` or normally `~/.pi/agent`) and store only the exact private session mapping
in `sessions.json`. Their scoped models and future-chat default also come from
that host home; Conduit Settings reports them read-only. Host Pi chats cannot
move between working roots (moving would re-home host-native JSONL through
Conduit's isolated session store).

Repository-owned behavior belongs in `../templates/`, not in runtime data.
Back up or mount this directory as one unit to preserve files, project identity,
Isolated Pi credentials/preferences, and Isolated Pi session history.
Back up the host Pi home separately when Host Pi Workspace history must be
recoverable; `sessions.json` remains required to retain its Conduit chat mapping.
