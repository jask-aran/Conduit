# Prompt stash

Park one half-written prompt and get it back later, with its attachments. One
shortcut saves; the same shortcut on an empty composer restores. A new stash
replaces the previous one.

Note the name collision: `conduit-web/src/prompt-store.js` is the system-prompt
override store (templates under `templates/`), unrelated to this. The new server
module is `draft-store.js` to keep them apart.

## Why this is worth building

Conduit discards drafts silently. `active-chat.ts` `reset()` calls `setDraft("")`
(line 288 inside `reset()` at line 277), and `reset()` runs from `initialize()` at line 747 on every
chat switch. Type half a prompt, click another chat to check something, come
back: the text is gone.

Attachments do not survive either, and the reason is worse than losing text:
`select()` calls `clear()` before loading the next chat, and `clear()` issues a
`DELETE` for every `done && !restored` upload belonging to the chat being left
(`state/attachments.ts:120-141`). Leaving a chat destroys its un-sent uploads on
the server. So the store has to hold text *and* attachment ids, and `clear()`
needs a `discard` flag so navigation drops local state without deleting rows.

## Two features, one shortcut

**Draft persistence** is the floor: the current draft is remembered per chat and
comes back when you reopen that chat. No user action, no UI.

**The stash** is one explicit entry the user parks and restores across chats.
This is what T3 Code binds to `Cmd/Ctrl+S`.

Build persistence first. It is smaller, it removes the actual daily annoyance,
and the stash reuses its storage.

## Storage

Server-side, under the existing runtime data directory beside `preferences.json`
(`PreferencesStore`, `conduit-web/src/preferences-store.js:214`, which already
does the atomic temp-file-then-rename write at lines 237-240 — copy that).

`data/drafts.json`:

```json
{
  "version": 1,
  "drafts": { "<chatId>": { "text": "...", "attachmentIds": [], "savedAt": "..." } },
  "stash": [
    { "id": "st_...", "chatId": "<origin>", "text": "...",
      "attachmentIds": ["..."], "savedAt": "..." }
  ]
}
```

Caps, enforced server-side: 128 KiB per draft (matching `MAX_PROMPT_BYTES` at
`prompt-store.js:4`), 200 drafts, one stash entry, and 8 attachment ids. Oldest
drafts evict. A new explicit stash replaces the old stash.

Not localStorage. The draft has to be there from the phone as well as the
browser that typed it, and the same argument that put `shortcutOverrides` in
server preferences (`preferences-store.js:28`) applies.

### Attachments are references, not copies

A stash entry holds attachment ids. Those rows are owned by their origin chat
(`server/routes/attachments.js`), and `attachments.clear()` at
`state/attachments.ts:120` **deletes uploads from the server** when a chat is
deselected, for any item with `status === "done" && !restored`. Two consequences:

1. Navigation must stop deleting. `clear({ discard: false })` from `select()`
   leaves the rows alone; the persisted draft is what now references them.
   `DraftStore.retainedAttachmentIds()` exposes the set for a future sweeper.
2. Restoring into a different chat cannot reuse the row directly. v1 restores
   the text and reports how many files stayed with the origin chat. Server-side
   copy into the destination is the better answer and is not built.

Retained attachments expire. 24 hours, swept on server start and daily, with the
stash entry kept and its missing files marked so the prose is never lost to a
file cleanup.

## API

| Route | Purpose |
| --- | --- |
| `GET /v0/drafts` | Current drafts and stash entries |
| `PUT /v0/chats/:id/draft` | Save or clear this chat's draft |
| `POST /v0/stash` | Park the current draft; returns the entry |
| `POST /v0/stash/:id/restore` | Claim an entry for a chat; copies attachments |
| `DELETE /v0/stash/:id` | Discard |

New file `conduit-web/src/server/routes/drafts.js`, registered where the other
route modules are. `server/routes/runtime.js:160` is the precedent for exposing
a preference key to the client if the stash ends up piggybacking on preferences
instead of its own file; it should not, but the validation style there is the
one to copy.

## Client

### Persistence

Debounce 400 ms on `chat.draft()` changes, `PUT` the draft. In `initialize()`
(`active-chat.ts:747`), after `attachments.select(chat.id)`, fetch and
`setDraft(saved)` — but only when the draft is empty, so a restore never
clobbers text the user is mid-way through typing.

The one trap: `reset()` clears the draft before `initialize()` repopulates it.
Do not save on the way out of a chat from a `createEffect` watching `draft()` —
the clear will race the save and persist an empty string. Save on change with
the chat id captured at call time, and ignore a save whose chat id is no longer
current.

### Stash

Register `stash-draft` in `COMMAND_IDS` (`client/commands/command-registry.ts:15`)
with a default binding of `primary+KeyS` and contexts `["composer", "chat"]`.
The shortcut system handles the rest: `ShortcutManager` already owns override
storage, conflict detection, and sequence matching.

`Cmd/Ctrl+S` is a browser Save-Page shortcut. `shortcuts/browser-conflicts.ts`
exists precisely to flag this, and the binding must `preventDefault`. Check what
that module already says about `primary+KeyS` before shipping the default; if it
is classed as an error rather than a warning, pick `primary+shift+KeyS` for the
default and leave `primary+KeyS` available as a user override.

Behavior:

| Composer state | `Cmd/Ctrl+S` |
| --- | --- |
| Has text or attachments | Park it, clear the composer, toast with **Undo** |
| Empty, one entry | Restore it |
| Empty, none | Nothing, no toast |

Uploads must be finished before parking — `attachments.items()` carries
`status`, so refuse with a toast while any item is `"queued"` or `"uploading"`,
the same rule `send()` implies at `active-chat.ts:768` by only taking
`pendingIds()`.

No stash manager or extra composer UI is required.

## Verification

| Check | How |
| --- | --- |
| Byte caps, eviction, id validation | `node --test test/draft-store.test.js` |
| Draft survives a chat switch | Type, switch, return |
| Draft survives a reload | Type, F5 |
| Restore does not clobber a live draft | Type in chat A, open A in a second tab, type more |
| Race on reset | Switch chats rapidly; no empty draft persisted |
| Stash retains attachments | Park with an image, switch chats, restore, image is there |
| Cross-chat restore copies | Park in A, restore in B, B owns the attachment |
| Expiry keeps prose | Age an entry past 24h; text restores, files reported missing |
| Browser Save is suppressed | Press the binding; no download dialog |
| New stash replaces old stash | Park twice; only the second prompt restores |
