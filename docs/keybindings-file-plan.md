# Keybindings as a file

> **Status (2026-09-22): not started.** Nothing in the tree is named
> `keybindings`. Overrides remain where the plan says they are, inside
> `shortcutOverrides` in preferences. The "What already exists" section below
> is a reading of the code as it stood on 2026-09-14 and is worth checking
> before trusting a line number.

Make Conduit's keyboard overrides a readable JSON file on the server that a
person — or an agent — can edit directly, instead of an opaque object buried in
`preferences.json`.

## What already exists

Most of this feature is built. `ShortcutManager`
(`conduit-web/src/client/shortcuts/shortcut-manager.ts:69`) owns command
definitions, context priority, two-stroke sequences, and dispatch. Commands are
declared in `client/commands/command-registry.ts` with
`contexts`, `defaultBindings`, `configurable`, `allowRepeat`, and
`allowInExclusiveTarget`. Conflicts are detected against browser and system
shortcuts (`shortcuts/browser-conflicts.ts`), against other Conduit commands, and
against context reuse (`shortcuts/shortcut-conflicts.ts:98`).

Overrides are already durable and already cross-device. They persist to
localStorage (`shortcut-preferences.ts:5`, key `conduit:shortcuts:v1`) and to the
server as the `shortcutOverrides` UI preference — declared at
`preferences-store.js:28`, validated by `validShortcutOverrides` at
`preferences-store.js:77`, exposed at `server/routes/runtime.js:160`, pushed from
`main.tsx:1512`, and applied back through `replaceOverrides` at `main.tsx:1565`.

Conduit's context model is better than T3 Code's `when` expressions for the cases
it covers: `SHORTCUT_CONTEXT_PRIORITY` (`shortcut-types.ts:1`) is an explicit
14-level stack with exclusive contexts and an `ownsEditableTarget` flag, rather
than a boolean expression evaluated per keystroke.

## What is missing

| Gap | Consequence |
| --- | --- |
| The stored shape is `{ code, key, modifiers[] }` per stroke | A human cannot read or write it. `"mod+shift+g"` is the format people expect |
| No file on disk | Editing means driving the settings UI; an agent cannot set up a machine |
| No string parser | `formatShortcutBinding` renders for display only; nothing parses back |
| Contexts are fixed at definition time | A user cannot re-scope a command they rebind |
| `primary+KeyS` is not in `BROWSER_SHORTCUT_CONFLICTS` | Save Page is unflagged, and the [prompt stash](./prompt-stash-plan.md) wants that key |

## Design

`data/keybindings.json` beside `preferences.json`, using `PreferencesStore`'s
atomic temp-then-rename write (`preferences-store.js:237-240`).

```json
{
  "version": 1,
  "bindings": [
    { "key": "mod+g", "command": "workspace-panel.terminal" },
    { "key": "mod+shift+g", "command": "workspace-panel.terminal", "context": "workspace-panel" },
    { "key": "mod+k mod+t", "command": "open-workspace-views" },
    { "key": "mod+p", "command": "open-command-palette", "disabled": true }
  ]
}
```

A flat list, not a map keyed by command, because one command can hold several
bindings and one key can serve different commands in different contexts. That is
also what makes the last-match-wins rule below expressible.

| Field | Meaning |
| --- | --- |
| `key` | One or two space-separated strokes. `mod` is Command on Apple, Control elsewhere — it maps to the existing `primary` modifier |
| `command` | A command id from `COMMAND_IDS` (`commands/command-registry.ts:15`) |
| `context` | Optional. One of `SHORTCUT_CONTEXT_PRIORITY`. Defaults to the command's declared contexts |
| `disabled` | Optional. Removes a default without assigning a replacement |

Rules, stated so the file is predictable:

- **The file is the override layer, not the whole registry.** A command with no
  entry keeps its defaults. New defaults in a release apply to commands the file
  does not mention, which is what T3 Code gets right and what
  `effectiveShortcutBindings` (`shortcut-preferences.ts:54`) already implements.
- **Entries for one command replace that command's defaults entirely.** Two
  entries for the same command mean two bindings, not a merge with the default.
- **Last matching entry wins** when two entries collide on key and context. Order
  in the file is meaningful; put the specific one after the general one.
- **Invalid entries are skipped, not fatal.** An unknown command id, an
  unparseable key, or a context outside the priority list drops that entry and is
  reported. An unparseable file falls back to defaults and surfaces a warning,
  matching `parseShortcutOverrides`'s existing `catch { return {} }`
  (`shortcut-preferences.ts:34`).
- **`configurable: false` commands are not overridable.** The file cannot widen
  what the settings UI refuses.

## Work

### 1. Parser and formatter

`shortcuts/shortcut-syntax.ts`, pure, tested against
`test/shortcut-manager.test.js`'s style.

```ts
export function parseShortcutKey(key: string): ShortcutBinding | null;
export function formatShortcutKey(binding: ShortcutBinding): string;
```

`parseShortcutKey` splits on whitespace into at most two strokes, each stroke on
`+`. Modifier words: `mod` → `primary`, plus `cmd`/`meta`, `ctrl`/`control`,
`alt`/`option`, `shift`. The final segment is the key, resolved to a `code`
through the existing `codeForKey` (`shortcut-normalize.ts:47`) so the stored
shape stays exactly what `ShortcutManager` already consumes. Round-trip property:
`parse(format(binding))` equals `binding` for every default binding in the
registry — assert that over `COMMANDS` in the test, which also guards against a
default that cannot be expressed in the file syntax.

### 2. Server store and routes

`conduit-web/src/keybindings-store.js` — load, validate, save, atomic write —
and `server/routes/keybindings.js`:

| Route | Purpose |
| --- | --- |
| `GET /v0/keybindings` | The file's entries plus any parse diagnostics |
| `PUT /v0/keybindings` | Replace the entries |
| `GET /v0/keybindings/commands` | Every command id, label, group, contexts, defaults |

The commands route is what makes the file writable by hand or by an agent: it is
the discoverable index that `docs/user/keybindings.md` in T3 Code substitutes
with prose. The client already holds the registry, so this route is a thin
projection of `COMMANDS` for anything that is not the client.

### 3. Migration

On first load, if `data/keybindings.json` is absent and `shortcutOverrides` in
`preferences.json` is non-empty, convert the stored strokes with
`formatShortcutKey` and write the file. Then treat the file as the source of
truth and stop writing `shortcutOverrides`, leaving the preference key in place
and readable so a client that predates this change still receives its overrides.
Do not delete the key: `normalizePreferences` will keep accepting it, and a
one-way migration that removes the old field makes a downgrade lose bindings.

The client keeps localStorage as the offline cache. The load order stays what
`main.tsx:1565` does today — server value replaces local on connect.

### 4. Settings UI

`client/settings/shortcuts-settings.tsx` gains a link that reveals the file path
and an **Edit as JSON** view: a textarea, the parse diagnostics, and Save. The
per-command recorder stays the primary path. The file is the escape hatch, and
the point of showing diagnostics rather than silently dropping entries is that a
typo in a hand-edited file is otherwise invisible.

### 5. Conflicts

Add `primary+KeyS` (Save page) to `BROWSER_SHORTCUT_CONFLICTS` with
`kind: "browser"` across chrome, chromium, edge, firefox, and safari. Run
file-sourced bindings through `shortcutConflicts`
(`shortcut-conflicts.ts:98`) the same way recorded ones are, and surface the
result as diagnostics rather than as a refusal — a user who writes a conflicting
binding into a file has made a choice the UI would have warned about.

## Verification

| Check | How |
| --- | --- |
| Round-trip over every default | `node --test test/shortcut-syntax.test.js` |
| `mod` resolves per platform | Parse on macOS and Linux environments |
| Two-stroke sequences | `"mod+k mod+t"` parses to a 2-stroke binding |
| Invalid entry is skipped, file still loads | Unknown command id among valid ones |
| Unparseable file falls back | Truncated JSON; defaults apply, warning shown |
| Last-match-wins | Two entries, same key, same context |
| `disabled` removes without replacing | Default no longer fires |
| `configurable: false` is refused | Entry for a non-configurable command is dropped |
| Migration is idempotent | Run twice; file unchanged, preference intact |
| Old client still gets overrides | Read `shortcutOverrides` after migration |
