# Review: sheet commits 611ec8dfa..2e8bfc8b9

Read-only review, 2026-11-15. Worst first. RAN means I reproduced it with a script in `/tmp/claude-1000/-home-jask-Conduit/de97e3d2-5930-4b7d-a784-8cdaaf288147/scratchpad/` (a scratch folder that can be cleared); READ means from the code only.

1. **Undo can still undo the step before a hub op** (d922e57dd). `src/components/sheet/history.ts:83`, `live.ts:36`.
   live.ts calls `own(step)` while it builds the arguments to `Y.applyUpdate`, so `origin()` runs before the update is applied. When the reply
   comes first (the one order this commit adds handling for), the last frame takes `owedFrames` to 0, and `settle()` runs the queued Undo
   inside `origin()`, before the frame is applied. RAN (`rev-hist.ts`): type in A, fill (reply `{tagged:1}` first), Undo, then the frame →
   A's typing is undone, and `Fill` stays on the undo stack with the hub's cell. Fix: `if (--owedFrames === 0) queueMicrotask(settle)`.
   I ran that patched copy and it undoes `Fill`.
   The count is also one number for the whole session: frames that land after the 3 s reset (`:35`), or frames from an op whose reply has no
   `tagged` (an error reply after a write), push it below 0 for good. After that, the next op's reply only gets it back to 0, so Undo stops
   waiting again. READ. Fix: count owed frames per step id (`Map<step, n>`) and drop a step's entry when its op times out.

2. **A LibreOffice whole-sheet column style adds hundreds of empty columns** (701d594fa). `src/server/xlsx-styles.js:123`.
   `wide` only treats `<col max>=16384` as "to the sheet's edge". The row-run rule at `:111` treats AMJ (column 1024) as LibreOffice's edge,
   so a LibreOffice file probably writes `max="1024"` here too (a guess: I have not opened a LibreOffice file). RAN (`sheetStyles` only):
   `<col min=1 max=1024 style=fill>` on a 50x3 tab gives `reach.cols` 1024. Computed, not run: `sheet-xlsx.js:107` then grows the tab to 403
   columns (`most` = 150 + 20 000) and writes 400 `style:<col>` keys. It also reports about 620 "column styles past the tab's edge". Fix:
   count `max >= 1024` as wide, the same as the row-run rule.

3. **Perf trap: redrawing a tall merge grows the changed list by the merge's height for every cell** (7d36885fe). `src/components/sheet/grid.ts:485`.
   Each changed cell inside a merge over rows becomes `bottom-top+1` entries, with no de-duplication. Merging, unmerging, or undoing a merge of
   a filled N-row x C-column block clears about N*C cells (`merges.losing`), so the list grows to about N^2*C entries. That is 20 M objects for
   2000x5, and both parts then run `flatMap`/`clip` over the list. READ. Under 50 000 keys the engine reports cells one by one
   (`sheet-engine.js:124,145`), and `sheet.tsx` passes that list on unless a rule is `wide`. I have not checked whether `merges` already holds
   the new merge when that list arrives. Undoing a merge, where the cells come back while the merge is still listed, is the likeliest case. Fix: collect the merges hit in a `Set`, then push each one's rows
   once, and only the rows inside `p.view`.

4. **A run of cell styles to AMJ is turned into a row style even when the row already has another one** (701d594fa). `xlsx-styles.js:116-119`.
   The run's cells are deleted, but `rows.set` only happens `if (!rows.has(r))`, so those cells lose their style and wear the old row style.
   RAN: a row with `s=1 customFormat` and cells A..AMJ `s=2` keeps row style 1 and 0 cell styles, so A1:C1 lose style 2. Fix: only take the
   run when the row has no style or the same one; otherwise leave the cells as they are.

5. **Row heights have no cap** (701d594fa widens an old gap). `xlsx-styles.js:99`. The old rule (`> 1.25x` default) had no cap either.
   Now every `customHeight="1"` row whose `ht` differs from the default is kept. Rows 1:100000 set by hand to 14.4 pt (default 15) become 100 000 `height:<row>` look keys. Styles are capped at
   STYLES_PER_TAB; this is not. RAN (`heights.size` 100000). Fix: cap it like styles (count the rest as dropped), or keep a height only when
   at least ~half the rows don't share it.

6. **The growth fixed-point loop can be quadratic** (701d594fa). `xlsx-styles.js:127`. Each pass rescans every seen cell, and a pass may add
   only one column. RAN: a staircase of M styled cells running up and to the right takes 36 ms at M=2000 and 256 ms at M=8000 (growing as
   M^2), and blocks the hub's thread. It is unusual in real files. Fix: break out once `reach` passes the limit-bound `most`, or grow from a
   queue of the cells newly reached.

7. **A slow op now lets Undo through after 9 s** (d922e57dd). `history.ts:75`. Before this commit Undo waited for `out` however long it
   took. Giving up on a hung op is on purpose, but a slow op looks the same. `gaveUp` drops `out` at 9 s while the hub is still working on
   a `history.hub` op (a set, a fill, or a row/column insert or delete on a big tab), so a queued Undo undoes the step before it. READ.
   Tab ops do not go through `history.hub` (`tabs.ts:99`). Fix: keep waiting while the request is pending, and use the timer only for frames
   owed after a reply.

8. **Merge after the "keeps only the upper-left value" question still uses the area by index from when it asked** (d9f104964).
   `sheet.tsx:97` (HEAD). The emptied cells are now found again when it runs, but `area` is still the row/column indexes from when it asked.
   If someone inserts or deletes rows while the question is open, the merge and the clearing land on other cells. READ. Fix: when asking, hold
   the corners by ids (`rowAt`/`colAt`), and resolve them again in `run`.

9. **Deleting a merge's top row (or left column) keeps the merge but loses its value** (c9520ce8b). `sheets.js:170-175` shrinks the merge
   to the rows left, but nothing in the delete path (`sheets.js:480-488`) moves the top-left value to the new top-left. A1:B3 merged with "X"
   in A1, then deleting row 1, leaves an empty merge over A1:B2. The value went with its row before this commit too (the merge was dropped
   then), so the data loss is not new. What is new is a merge that is still there but shows nothing. READ. I have not checked what Excel
   does here (it may move the value). Fix, if Excel keeps it: in `keepCorners`, when the corner row or column goes, write its value into the
   new top-left.

10. **OOXML booleans spelled `true` are not read** (f97e14b8a, 701d594fa). `xlsx-styles.js:241` (`stopIfTrue`) and `:99` (`customHeight`)
   compare against `"1"` only, but `"true"` is valid too. READ. Low: Excel writes `1`, and I have not checked what LibreOffice writes. Fix:
   `/^(1|true)$/`.

Checked and no problem found: the merged-cell spread in 611ec8dfa (the `TextCell` fields it needs are its own; it reads `data`/`copyData`
through the getter); the shrink bounds on row/column delete (apart from 9) and the import merge cut (c9520ce8b); restoring `rules` by ids (keeps `stop`);
`stopIfTrue` over an xlsx round trip and the lossy count (RAN, `rev-rules.mjs`); the `<col>` range merge on export (RAN, `t1.mjs`); ISO
date fill (RAN, `rev-ser.ts`: days, month ends, backwards, Ctrl copy, mixed with a real date, before 1900); and the far-edge exit from a merge
on Enter/Tab.
