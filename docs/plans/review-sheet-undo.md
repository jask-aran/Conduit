# Review: sheet undo/redo history (commit 993391e5d)

Read-only review. Nothing was run; every claim comes from reading the code (Yjs 13.6.33 UndoManager/redoItem source included).

## Findings, ranked

1. **Undo is released when the HTTP reply lands, not when the tagged frame does** (medium-high). `history.ts:67`
   decrements `out` in `send().finally`, and any queued Undo (`owed`) runs at that moment. The tagged update travels
   on the WebSocket, and the reply comes back on a separate HTTP connection. The handoff assumes "socket copy lands
   first"; this finding is an argument about ordering across two connections, not something I reproduced. If the socket lags the reply, the queued
   or next Undo undoes the step *before* the op, which is exactly what `out` is meant to stop. The socket can lag
   because `ws` buffers the frame under backpressure (a big sync or a burst of others' updates), because the socket is
   `away`, or because it dropped after the hub sent the frame. When the late frame does arrive, it is a tracked
   non-undo transaction, so Yjs runs `clear(false, true)` and wipes the redo stack, losing the step the user just undid
   from Redo. It then pushes the op as a new top item. If the socket had dropped, the op comes back untagged in the
   reconnect diff and can never be undone.
   *Scenario:* type in A1 (step X), then Fill down. Under load the fetch resolves first. Ctrl+Z undoes X, not the fill.
   The fill frame then arrives, X can no longer be redone, and the next Undo undoes the fill.
   *Fix:* have the hub return the number of tagged updates it sent to that peer (`own: n` in the cells reply; it is
   known in the `doc.on("update")` handler). In `hub()`, wait until n `FRAME.own` frames for that step have been
   applied, or until the socket closes, before `out--`. Alternatively, drop the `out` gate and have live.ts call back
   into history when a step's frames land.

2. **Undoing a structure change does not move other people's later formulas** (medium). An undo of Insert/Delete rows
   or columns reaches the hub and the worker as a raw edit of a peer's ROWS/COLS arrays. `sheet-engine.js:128-136`
   takes the non-`self` path: the engine rewrites every formula for the row change, then line 136 forces each formula
   back to the doc's text. The formulas the step itself rewrote are restored correctly, because they are in the step.
   A formula someone else typed after the step is left as typed, so it now points at shifted cells.
   *Scenario:* I insert 2 rows at row 3. A colleague types `=A10` in C1, meaning the row that is now 10. I undo. Rows
   3-4 go away, the engine would make it `=A8`, line 136 resets it to `=A10`, and C1 silently reads a different row.
   The same happens to formulas on other tabs that name this tab. Concurrent structure merges already behaved this
   way; undo makes it routine and deterministic.
   *Fix:* on the hub, when a peer update changes ROWS/COLS, keep the engine's rewrite for every formula cell the update
   did not itself write, and write those back (as the hub, untagged) so the worker and pages follow. Or run a
   structure undo as the inverse hub op instead of a Yjs undo.

3. **Steps on a deleted tab come back as invisible no-ops that write orphan data** (medium-low). Tab ops are rightly
   outside the history (`tabs.ts:99` sends no client/step). Once a tab is deleted, by me or anyone, the undo stack
   still holds items for its cells, look keys and `rowsOf`/`colsOf` arrays, which stay in scope (`sheet.tsx:50`).
   There are two cases. (a) The step overwrote an earlier value: Undo re-sets that old value under the dead tab's
   cell key, because `redoItem` sees the overwriting item in the step's own insertions. A Delete rows undo likewise
   re-inserts row ids into the dead tab's array. Nothing visible changes, an Undo press is used up, and orphan keys are
   synced to the hub doc. (b) The cell was empty before the step: the item is dead (its insertion is already deleted),
   so Yjs skips it silently and the *same* press undoes the next older step, which the user did not ask for.
   *Fix:* do what Excel does and clear the history (`um.clear()`) when a tab id leaves `order`. At minimum, drop the
   stack items whose deletions and insertions are all under that tab.

4. **The 100-step cap skips Yjs's un-keep** (negligible). `history.ts:43` `stack.shift()` leaves the dropped item's
   deleted structs marked `keep`. But Yjs collects garbage only over the delete set of the transaction it is cleaning
   up (`Transaction.js:328 tryGcDeleteSet(ds, …)`), so un-keeping them later would free nothing in this session
   anyway, and stock `um.clear()` has the same limit. The deleted content lives until the page reloads. No fix is
   worth making.

5. **"Undo N steps" can undo more than N** (low). Yjs `popStackItem` silently skips dead items, meaning steps whose
   every change someone else has since overwritten, and goes on to the next one. `labels()` (`history.ts:55`) still
   lists dead items, and `walk(count)` calls `um.undo()` count times. Picking the 3rd entry can therefore undo 4 or
   more real steps, and the list shows names of steps that will do nothing.
   *Fix:* accept it and document it, or before stepping walk the stack and count only items with a live insertion or
   a redoable deletion.

6. **Opening a filter can make a "Filter" step** (low). `filter.tsx:150` `reapply()` is called when the filter popover
   opens (`sheet.tsx:130, 334`). If others' edits changed which rows the filter hides, it writes the look with origin
   null. That becomes a tracked step labelled "Filter" and clears the redo stack. One Undo then brings back the stale
   hide list, and the user loses any pending Redo just by opening the popover.
   *Fix:* make that write with an untracked origin (for example the live doc's `hub` symbol, exposed), or fold it into
   the step that follows.

7. **A send that never settles blocks Undo for good** (low). `out` is only decremented in `.finally`. If the cells
   fetch hangs (the hub stalls, or a proxy holds the request), Undo and Redo queue forever with no feedback. Worth a
   timeout in the fetch, or on `out`.

## Checked and clean

- **(1) Tagging window.** `cells()` (`documents.js:1083-1087`) sets `room.own` after `await current()` and clears it
  in `finally` around a call that returns at its first `await`. No other JS can run in between, so no other page's
  socket update or agent call can be tagged, and a throw cannot leak the tag. Peer updates are `applyUpdate`
  (`local=false`), so they are never tagged even inside the window. Every page-sent op path is synchronous with no
  `for` and no tab op: `hub.as`, multi-transaction ops (`grow` then `writeCells`, sort then `refilter`, `sized` then
  `structure`) and the engine's `self` structure transaction. All their transactions are tagged. The one path with an
  `await` before its writes is `for:` and add-tab on a CSV. Pages never send either with a step, and if one did it
  would just go untagged. `cells(id, "read", as…)` destructures a string, so it is harmless.
- **(2) Papers and other kinds.** `room.own` is only set in `cells()`, so papers always get `FRAME.update`, and
  `components/document/live.ts` is unaffected. Kind 3 is sent only to the peer whose handshake `client` matches; an
  older cached sheet page never sends `client`/`step`, so it never receives kind 3, which it would have dropped.
- **(3) Nothing goes unsent.** UndoManager undo and redo transact with `local=true`, so they are sent. `FRAME.own` and
  `FRAME.update` applies are `local=false`, so they are correctly not echoed. Offline local edits still go up in the
  reconnect `have` reply. The page had no other non-local source of updates that the old `origin !== hub` rule was
  covering.
- **Never undoing others.** `redoItem`'s map check refuses to restore an old value once another client has
  overwritten the key after my step. My hub-made items are in the step's insertions, so they are skipped, not fought
  over. Tab ops and other people's frames use `hub` as the origin and are not tracked.
- **Merging by step id** (`history.ts:37-40`): local and hub halves of one step, and multi-transaction hub ops, merge
  into one item, and `mergeDeleteSets` gives correct undo/redo even when the hub overwrote the step's own local write.
- **Per-keystroke cost.** For the hub, it is one boolean check per update, plus one copy for tagged updates. For the
  page, the UM handler returns early for untracked origins. `findLast` over at most 100 items runs only for step
  items. Each Ctrl chord opens an empty `act` transaction and burns a step id (the `steps` map is capped at 200):
  cheap. The worker view (`sheet-format.js createSheetView`) posts every update regardless of origin, so hub-tagged
  updates still reach the engine.
- **Structure undo vs engines, apart from #2.** The hub and worker flush (`sheet-engine.js:128-136`) handle a peer
  structure change: the engine adds or removes rows, and formulas are set to the doc's text. So the hub, the worker
  and every page compute the same values. Redo re-creates the same row ids, so cells keyed by them come back.
- **UI files.** In `ui/markup.tsx` the step menu's `count = index + 1` matches the newest-first labels. In
  `tools.tsx`, the tool `act` wrap nests correctly into an enclosing `act`. `sheet-surface.tsx` passes count and
  steps through. The step menu inherits Finding 5's over-undo.

## Not proven / not read

- Nothing was executed: no tests, no repro. Every finding is from reading the code.
- Findings 2, 3 and 5 rest on reading the Yjs 13.6.33 source (`redoItem`, `popStackItem`) and `sheet-engine.js`
  flush.
- I did not read `stepsOwn` in `markup/tool.tsx` (which decides when the surface's steps are shown), or what
  `sheetCells` / `api` send as `by`.
