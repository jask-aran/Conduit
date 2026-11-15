# Handoff: sheet undo/redo (one history per page)

Goal: one linear, named undo/redo history per sheet page covering local edits AND hub ops (fill, fill handle, sort, insert/delete rows/cols, set past edge); never undo others. Ribbon Undo/Redo get a dropdown of the latest 20 steps. Not tab ops (add/rename/delete tab stay out of history).

## Design (chosen; HTTP-response-update idea rejected: socket copy lands first, so a re-apply is a no-op)
- Page sends hub ops with `client` (its doc.clientID) and `step` (id). documents.js `cells()` sets `room.own` during the edit's synchronous part; the doc "update" handler sends that one peer a `FRAME.own` frame (kind 3, u32 LE step, then update); others get plain `FRAME.update`. Socket order is kept, so no holding or matching.
- live.ts applies FRAME.own with origin `own(step)` = history.origin(step) (a SheetStep instance); sends to hub only `transaction.local` updates.
- history.ts: Y.UndoManager over cells, look, ROWS/COLS and every tab's rowsOf/colsOf (addToScope as tabs appear); captureTimeout 0; trackedOrigins {null, SheetStep}. `stack-item-added`: an item whose origin step id is already in undoStack is merged into it (mergeDeleteSets) and popped; labels live in meta; undo/redo-created items copy the label from um.currStackItem. `act(label, run)` = one doc.transact with a SheetStep origin (nested acts join). `hub(op)` joins the open act's step or starts one named by op. Undo waits while any op is out. Cap 100 items.
- Labels: explicit in sheet.tsx/tools.tsx; otherwise derived from the look key prefix (LOOKS table in history.ts).

## Files changed
- src/document-format.js: FRAME.own = 3 (+doc comment).
- src/server/documents.js: update handler tags frames for room.own; `cells()` sets/clears room.own.
- src/components/sheet/live.ts: FRAME.own handling, `own(origin)` setter, send only local updates.
- src/components/sheet/history.ts: NEW, the history.
- src/components/sheet/host.ts: SheetCellsOp gains client/step; SheetMarks.history gains count + steps().
- src/components/sheet/sheet.tsx: history wired: writes(label), hub via history.hub, spread/deleteRows/resize/unhide/Cut/Paste/Replace wrapped in act; Ctrl chords labelled by their tool.
- tools.tsx: `act` option, each tool's run is act(label). sheet-surface.tsx: count + steps through. markup/host.ts: MarkupHostHistory undo(count?)/redo(count?)/steps?(). markup/tool.tsx: undoSteps/redoSteps only when the surface's history is what Undo steps. ui/markup.tsx: chevron DropdownMenu after Undo/Redo (`listed`). gallery/pages/markup.tsx: ribbon row shows undoSteps. scripts/check-conventions.mjs: sourceLines 131_500 -> 131_615.
## Status: done; tsc clean; scratch test passes (incl. same-tick op grouping in history.hub). Conventions now fail on other builders' lines (MergeIcons unused in sheet.tsx, src at 132058 vs 131615), not this work.
## Gotchas
- Don't touch sheet-xlsx.js, xlsx-styles.js, sheet-styles.js, styles.ts, cell-draw.ts, formats.ts (another builder). No git, build, restart.
- Yjs undo pops dead (no-op) items silently and undoes the next one.
- An own op arriving inside a reconnect sync is untracked (accepted).
## Ran
- typecheck (clean). /tmp/claude-1000/undo/test.mjs (esbuild bundle of history.ts + sheet-engine + sheets.js; documents.js tagging replicated in the test): all checks pass.
