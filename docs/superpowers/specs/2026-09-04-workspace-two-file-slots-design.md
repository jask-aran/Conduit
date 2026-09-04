# Two file slots in the workspace Files view

**Date:** 2026-09-04
**Status:** Approved and implemented 2026-09-04
**Component:** `conduit-web/src/client/workspace/workspace-file-slot.tsx` (new),
`workspace-panel.tsx`, `workspace.css`

## Implementation notes

Three details settled during the build, each a deviation worth recording:

- **The discard prompt stayed in the parent.** The spec put it inside the slot, but the
  parent owns the paths, so it must ask *before* retargeting a slot. `openInSlot` consults
  that slot's `hasUnsavedChanges()` — same guarantee, one owner.
- **The slot's load effect is keyed.** `openPaths()` hands down a fresh object whenever
  *either* slot moves, so a naive effect on `props.path` re-ran and silently discarded the
  other slot's draft. The effect now compares a `projectId\0path` key and no-ops when its
  own file has not changed. The regression test for this is
  "an unsaved draft in one file slot survives opening another file".
- **`preview` left the workspace cache.** With both paths persisted per chat, caching the
  file content only saved one fetch on project switch while adding a second source of truth
  for the open file. The cache still holds directories, diff, expansion and scroll.

## Goal

The Files view opens one file at a time. Make it open two side by side, independently of
the pane split, so the workspace can show two files *and* Source Control at once:

```
┌───────────────────────────────────────────┬──────────────────────┐
│ [Files]                                   │ [Source Control]     │  header strips
├────────┬──────────────┬───────────────────┼──────────────────────┤
│ tree   │ a.ts   ◀focus│ b.ts              │ staged / changes     │
│ a.ts ◀ │              ║                   │                      │
│ b.ts ◀ │              ║                   │                      │
└────────┴──────────────┴───────────────────┴──────────────────────┘
```

The two file slots live *inside* the Files view. They are not a third workspace pane, and
the existing pane split (`splitActive()`) is unchanged by this work.

## Decisions

| Question | Decision |
|---|---|
| Arrangement | Always side-by-side columns, with a draggable divider. No stacked fallback — a cramped split is the user's call to make. |
| Opening the second slot | "Open to the side" in the tree context menu, plus modifier-click (Alt) on a tree row as an accelerator. |
| Plain tree click target | The focused slot, marked with a focus ring on its header. Both open paths stay marked in the tree. |
| Persistence | Both paths persist per chat, mirroring `:secondary-tab`. Paths only — never draft text. |

## Architecture

### The problem being solved

Single-file state is spread across the component: `preview`, `draft`, `editing`, `saving`,
`hasUnsavedChanges()`, the `loadFile`/`openFile`/`editFile`/`saveFile`/`downloadFile`
family, the `pollFiles` staleness check (`workspace-panel.tsx:724`), and
`cacheWorkspace(projectId, { preview })`. Duplicating each of those into `preview2`,
`draft2`, … would double the surface and guarantee the two copies drift.

### The unit

Extract **`workspace-file-slot.tsx`**: one component owning exactly one open file.

- **What it does:** loads, previews, edits, saves, downloads and polls a single file.
- **How you use it:** `<FileSlot projectId path onPathChange onFocus focused />`. The
  parent owns only *which paths are open* and *which slot is focused*; the slot owns
  everything about the file at that path.
- **What it depends on:** `api`/`authorizedFetch`, `WorkspaceEditor`, and the workspace
  cache. It does not read the tree, the diff, or any panel geometry.

Everything currently between `.workspace-preview`'s `<ContextMenuTrigger as="section">` and
its closing tag moves into this component, along with `loadFile`, `openFile`, `editFile`,
`saveFile`, `downloadFile`, `hasUnsavedChanges`, and the per-file half of `pollFiles`.
That is the change that makes two slots cheap and keeps `workspace-panel.tsx` from growing.

### Parent state after the extraction

```ts
type FileSlotId = "primary" | "secondary";
const [openPaths, setOpenPaths] = createSignal<{ primary: string | null; secondary: string | null }>(…);
const [focusedSlot, setFocusedSlot] = createSignal<FileSlotId>("primary");
const [fileSplitRatio, setFileSplitRatio] = createSignal(50);
```

`preview`, `draft`, `editing`, `saving` leave the panel entirely.

### Data flow

- Plain tree click → `openInSlot(focusedSlot(), path)`.
- Alt-click / "Open to the side" → `openInSlot("secondary", path)` and focus it.
- A slot's own close button → clears its path; closing `primary` promotes `secondary`
  into it so there is never a hole on the left.
- Each slot polls its own file on the existing `FILE_POLL_INTERVAL_MS` timer, which stays
  in the panel and fans out to the mounted slots; the tree half of `pollFiles` is unchanged.
- The tree marks a row selected when its path matches *either* open path
  (`workspace-panel.tsx:337,342` become an `isOpen(path)` check), with the focused slot's
  file getting the stronger treatment.

### Layout

`.workspace-files[data-wide="true"]` is already a grid:
`tree | 9px | preview`. With two slots the last track splits:

```
grid-template-columns: var(--workspace-tree-width) 9px minmax(0, var(--file-split-ratio)) 9px minmax(0, 1fr);
```

The second divider reuses the `startSplitResize` pointer-drag helper the pane split already
uses, with its own ratio and storage key. When only one file is open the template collapses
back to today's three tracks, so the single-file layout is byte-identical to now.

Narrow (`filesWide() === false`) keeps today's stacked tree-over-preview layout and shows
only the focused slot — the second slot stays open in state, it simply has nowhere to go.

### Unsaved changes

`hasUnsavedChanges` becomes per slot. The existing confirm-on-replace prompt
(`workspace-panel.tsx:601`) moves into the slot and fires only for that slot's own file, so
editing on the left can never be discarded by opening something on the right.

### Error handling

Unchanged in kind, narrowed in scope: a slot's load/save failure sets the panel-level
`error()` as it does today, and a file deleted underneath a slot clears that slot only
(today's `path_not_found` branch at `workspace-panel.tsx:749`), toasting the same message.

## Persistence

| Key | Scope | Value |
|---|---|---|
| `conduit:workspace-panel:<chatId>:file` | chat | primary path (replaces today's cached preview restore) |
| `conduit:workspace-panel:<chatId>:file-secondary` | chat | secondary path, absent when closed |
| `conduit:workspace-panel:<projectId>:file-split-ratio` | project | divider position, matching `:split-ratio` |

Drafts are never persisted. On restore, each slot loads its path fresh; a path that no
longer exists clears that slot silently.

## Testing

`test/browser/app.spec.js`, desktop-chromium:

1. Alt-click a second file → two slots, both rows marked in the tree, both headers show
   their own path.
2. Plain-click a third file → replaces the focused slot only; the other slot is untouched.
3. Edit in the left slot, open a file in the right → no discard prompt, left draft intact.
4. Close the secondary → primary keeps its file and reclaims full width.
5. Reload → both paths restore; a draft does not.

Plus the existing single-file tests, which must pass unchanged — they are the regression
guard for the extraction.

## Out of scope

- More than two slots.
- Tabs within a slot (each slot holds exactly one file).
- Dragging a file between slots, or from the tree onto a slot.
- Any change to the pane split shipped alongside this.
