# Handoff: sheet hidden columns

## Design
Glide 6 has no hidden columns. Rows are mapped (`createRowMap`); columns are not: a hidden column keeps its index and is drawn 0 wide.
Read in Glide's source: a column with a numeric `width` skips `minColumnWidth` (that clamps only auto-size and drag), grid lines skip
`width === 0`, and header and cells clip to their rect, so a 0-wide column draws nothing. `getColumnIndexForX` can never hit it.

- Look key `hidden:<colId>`, the same prefix as rows (`hidden:<rowId>`): ids never repeat across rows, columns and tabs (`fresh` in
  sheet-engine.js), and the hub's `lookOf`/`restoreLook` already turn `what:<colId>` into `what:C` and back, so xlsx sees `hidden:C`.
- Glide gives a press just right of a hidden column's line to the hidden column's resize (data-grid.js, `previousCol`). As in Excel that
  drags it open: the live drag width wins over 0, and `setWidths` deletes `hidden:` for the columns it sizes (also Column width…).
- The keys: `nextShown`/`shownAt` in grid.ts. Plain arrows, Tab and Shift+Tab, Shift+arrow, Ctrl(+Shift)+arrow, an arrow out of a merge or
  out of whole rows/columns, and `api.select` of one cell all step past hidden columns. A header line (HIDDEN_LINE) at the side of a
  letter next to a hidden column.

## Files
- `conduit-web/src/components/sheet/sizes.ts`: `hiddenCols`, `setHiddenCols`, shared `hide`; `setWidths` unhides.
- `conduit-web/src/components/sheet/grid.ts`: `SheetColumns.hiddenCols`, read once in `reach()`; widths, keys, header line.
- `conduit-web/src/components/sheet/sheet.tsx`: column menu Hide column(s) / Unhide columns (`history.act`); Unhide also offers the
  hidden run just beside the menu's columns, since a hidden column A can't be spanned.
- `conduit-web/src/server/sheet-xlsx.js`: import `!cols[i].hidden` as `hidden:C` (no longer dropped), export `!cols` hidden.

## Done / left
- Done: all of the above. Typecheck clean. xlsx round trip checked with node (scratchpad `hidcols.mjs`, `hidcols2.mjs`).
- Done since: copy, cut, clear and paste skip hidden columns (grid.ts `colsFrom`, which the grid now writes the clipboard through; sheet.tsx
  `shownCols`); the fill handle, Fill down and Fill right fill each run of shown columns on its own; Find skips them; Home and Ctrl+Home step
  past a hidden column A; Ctrl+0 hides the selection's columns and Ctrl+Shift+0 shows those hidden in it.
- Not checked: anything in the browser (drawing at 0 wide, drag open, keys, menu, the clipboard, Ctrl+Shift+0, which Windows may take for
  switching input language).
- Left: a fill handle source wider than one column with a hidden column inside it: the hub moves each formula by its place in the whole
  source, so it can come from the wrong source column. Find does not find again when a column is hidden or shown while it is open.

## Gotchas
- The row Hide (sheet.tsx) is not wrapped in `history.act`; its step name comes from `LOOKS.hidden` ("Hide rows"), so any column
  hide must be named explicitly or it is listed as "Hide rows".
- SheetJS writes `hidden="true"`, not `"1"`; it reads both.
