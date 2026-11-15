# Handoff: sheet merged cells (builder note, not committed)

Goal: Excel's Merge & Center / Merge across / Merge cells / Unmerge in the sheet artifact; xlsx `!merges` import/export.
Read docs/plans/sheet-handoff.md first. Other builders edit sheet.tsx/tools.tsx/live.ts/sheets.js/sheet-engine.js (undo),
cell-draw.ts/sheet-xlsx.js/xlsx-styles.js (conditional formatting), grid.ts fill handler: narrow edits only.

## Design
- Look key `merges:<tabId>` → JSON `[{from,to}, ...]`, corners as `rowId:colId` (like filter's SheetRangedLook).
  sheets.js: `lookOf` gives `merges: ["D26:O26", ...]`, `restoreLook` takes that back; `keepCorners` shrinks each
  merge on row/col delete, drops one left a single cell.
- Client `components/sheet/merges.ts`: read the list (sheet coords), merge(range, kind), unmerge(range).
- Grid (Glide 6 spans are columns within one row only, checked in render/data-grid-render.cells.js + lines.js):
  every row of a merge returns the top-left's cell with `span: [left, right]` (kills vertical lines, one fill per row).
  Multi-row: each row's cell carries `lift` (px of the block above it) and `tall` (block height); drawCell draws the
  text against the block's box, Glide's per-row span clip shows each row its slice. Lines between a merge's rows:
  `getRowThemeOverride` makes that row's horizontal line transparent; cells outside the merge in that row redraw
  their own top line (`line` flag) in drawCell.
- Selection: onGridSelectionChange and select() grow a range to whole merges; an active cell inside a merge moves to
  its top-left; plain arrows from a merge step past its edge.
- Commands: Alt H M C / M A / M M / M U (sequences.tsx), context-menu rows in sheet.tsx; confirmDialog when other
  cells hold values (only top-left kept). Merge & Center also aligns centre.

## Files / status
- [x] src/server/sheets.js: mergesA1 helper; lookOf `merges`, restoreLook `merges`, keepCorners shrinks/drops merges
- [x] src/server/sheet-xlsx.js: import `!merges` -> look.merges (A1 list), export `sheet["!merges"]`
- [x] components/sheet/merges.ts (new): list/at/losing/merge/unmerge/is
- [x] components/ui/sheet-icons.tsx: sheetMergeIcons
- [x] grid.ts: SheetColumns.merges, mergesOf index in reach(), grown(), fit() on selection, arrows out of a merge,
      merged() content wrapper (span/block/line), getRowThemeOverride NO_LINE, drawCell block+line; cell-draw.ts `block` -> text()
- [x] sequences.tsx HMC/HMA/HMM/HMU + `merge` on SheetSequenceContext; sheet.tsx merge() + context-menu section
- [x] typecheck clean; sourceLines raised 131_615 -> 131_785 (+170, mine)
- [ ] Node scratch script on budget workbook + openpyxl; headless probe of drawing (not done yet)

## Gotchas
- Budget workbook private: scratch in /tmp/claude-1000/ only. Typecheck via flock, 4 GB heap.
