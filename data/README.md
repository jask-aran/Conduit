# Conduit runtime data

This directory contains ignored mutable data:

```text
chat/files/       working files visible to chat sessions
pi/               Conduit's isolated Pi agent home and native sessions
conduit.json      stable project IDs and display metadata
```

`chat/files/` is the working directory for unstructured chats. Each direct
child is a named project and contains only files scoped to that project. Pi
associates sessions with these working directories and stores their JSONL under
`pi/sessions/`; no `.pi` or `.conduit` compatibility directories are generated
inside working directories.

Repository-owned behavior belongs in `../templates/`, not in runtime data.
