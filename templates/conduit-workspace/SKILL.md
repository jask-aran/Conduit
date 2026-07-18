---
name: conduit-workspace
description: Interpret Conduit attachment paths and control-plane metadata in a Workspace chat.
---

# Conduit Workspace Bridge

Conduit stores uploaded files below `.conduit/chats/<chat-id>/attachments` in
the current working directory. Treat paths inside `<conduit_attachments>` as
server-validated references supplied with the user's message.

- Read the exact supplied path when attachment contents matter.
- Do not search `/tmp`, clipboard folders, or unrelated chat directories.
- Keep `.conduit` application metadata intact.
- The browser UI, process lifecycle, and transcript projection are controlled by
  Conduit even when the host Pi installation and native resources are in use.
