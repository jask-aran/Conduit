# Review: merged cells and conditional-formatting rules (commit 993391e5d)

Read-only review. "Ran" means I ran a Node script (in the session scratchpad); everything else is from reading the code.

## Findings, worst first

0. **High: merged cells probably draw blank** (`grid.ts` `merged()`, ~350; from reading the code, not seen drawn).
   `merged()` returns `Object.create(own(...), { span: { value }, data, block, line })`. That puts every base field (`kind`,
   `displayData`, the `data` getter on `TextCell`) on the prototype, and the new fields are not enumerable. The grid has
   `rowMarkers: "clickable-number"` (`grid.ts:305`), so Glide's `getMangledCellContent`
   (`node_modules/@glideapps/glide-data-grid/dist/esm/data-editor/data-editor.js:422-427`) rebuilds every spanned cell as
   `{ ...result, span: [...] }`. That copy keeps only `span`, with no `kind`, so `getCellRenderer` gives undefined
   (`data-grid-render.cells.js:342`) and neither the cell nor our `drawCell` (block text, `line`) draws. Every merge is affected,
   because every merged cell has a `span`. Cells that only get `line` have no span and aren't spread.
   Fix: return a fresh object whose fields are its own and enumerable (`kind`, `data`, `displayData`, `copyData`, `allowOverlay`,
   `contentAlign`, `themeOverride`, `worn`, `frozen`, `mark`, `span`, `block`, `line`), reading `data` eagerly only for the top-left,
   or a `TextCell` subclass with the extra fields as own properties. Then check it in the gallery or headless.

1. **High: rules imported from an xlsx are stored as raw A1 objects, never as ids** (`src/server/sheets.js:207-223`).
   `rulesA1` and `rulesIds` are imported at line 8 but never called. Because `lookOf`/`restoreLook` have no `rules` branch,
   `restoreLook` sets `rules:<tab>` to the plain array `[{ ranges: "B5 B29:O29", … }]` (line 222). The handoff ticks this as done; it isn't.
   - Wrong cells: `keepCorners` calls `readRules(room.look.get(...))` (line 169). `String(array)` gives `"[object Object]"`, so the parse
     fails and the result is `[]`. Rule ranges never move when rows or columns are inserted or deleted. Example: import a file with a rule on
     B5:B10, delete row 2, export. The rule still covers B5:B10, which is now one row below the data it was for.
   - The planned `rules.tsx` will see nothing: `readRules` gives `[]` for imported rules, so they won't draw, and the first save from the
     dialog overwrites them.
   - Export crash (latent, since nothing writes a string `rules` value yet): `exportXlsx` checks `tab.look.rules?.length` (`sheet-xlsx.js:274`), which is true for a string as well as an array.
     `writeRules` then calls `.map` on the string and `escaped(rule.ranges)` on whatever `ranges` is. Any `rules` value in sheet.json
     that isn't an array of `{ranges: string}` throws.
   - Fix: in `lookOf`, `what === "rules"` → `rulesA1(sheet, value)`. In `restoreLook`, `what === "rules"` → `rulesIds(sheet, value)`.
     Guard the export with `Array.isArray` and filter to string `ranges`. Rooms also load from `state.yjs`
     (`documents.js:707`, `774`), so raw arrays already in a live look would survive the fix and then be dropped by `readRules`. Have
     `readRules` (or a one-time pass on load) turn a raw A1 array into ids with `rulesIds`.

2. **Medium-high: `keepCorners` doesn't handle merges** (`sheets.js:150-174`). The handoff says it shrinks merges; the code only handles
   `RANGED = ["filter","table"]` and rules. If you delete a merge's first or last row or column, a corner id disappears, so
   `rangedArea` fails and the whole merge drops silently (client `merges.ts:20`, hub `mergesA1` line 194). Excel shrinks the merge instead.
   Deleting a middle row and inserting rows or columns are fine: the corners are ids, so the merge shrinks, grows or moves with them.
   Fix: parse `merges:<tab>` in `keepCorners`, pass each range through `moved()`, drop any left as one cell, and write the result back.

3. **Medium: importing an xlsx drops merges that reach past the last value** (`sheet-xlsx.js:210`). Ran: a file with "Title" in A1,
   data in A–C, and merges A1:F1 and A5:B6 imports with `look = {}` and the report "merged ranges past the tab's last value": 2. Title rows
   merged across a table are common. Fix: clip each merge to the tab and keep it if more than one cell is left, or grow the tab to the merge's reach, as styles do.

4. **Medium (drawing, not data): editing a multi-row merge's top-left only redraws its top row** (`grid.ts` `update(changed)`, ~line 483).
   `updateCells` is called only for the changed cell. The rows below draw their slice of the top-left's text from their own cells (`merged()`
   → `own(one.top, one.left)`), so they keep the old text until a full redraw. Fix: in `update`, widen a changed cell that is a merge's
   top-left to every cell of the merge. Not seen in a browser.

5. **Medium (per-frame cost): `merged()`'s `sum()` loops over every row above in the merge** (`grid.ts` ~350). This runs for each visible
   cell of a merge on every draw. A tall merge (A1:A5000, or a whole-column merge) costs O(visible cells × merge
   height) per frame. Every cell in a row whose line is cut also gets an `Object.create` per draw. Fix: cache prefix sums per part when
   `rowHeights` changes, or read the block's top from the grid's bounds. Not measured.

6. **Medium: conditional-format details are lost on a round trip without being reported** (`xlsx-styles.js` `readDxfs`/`sheetRules`).
   - A dxf's numFmt and border are lost. A rule whose dxf is only a number format or a border imports with an empty style and exports as `<dxf></dxf>`.
   - `stopIfTrue` is dropped, so Excel applies lower-priority rules again after the round trip.
   - Neither is counted in `dropped`.
   - Fix: count them as dropped, or keep the raw dxf XML and the `stopIfTrue` attribute.

6b. **Medium: Enter and Tab after editing a merge leave the cursor on it** (`formula-editor.tsx:126`). `commit` selects
   `now.row + 1` (or `col + 1`). That cell is inside the merge, so `api.select` → `grown()` selects the same merge again with its
   top-left active. Only plain arrows have code to step past a merge's edge. Fix: in `commit`, step from the merge's
   bottom or right edge (`merges.at(row, col)`).

6c. **Medium-low: the merge confirmation can blank the wrong cells** (`sheet.tsx:85-95`).
   - `area` and `losing` are worked out before the async `decisions.confirm`. A row inserted, or a cell edited by someone else, while
     the dialog is open blanks the old positions. Fix: work out `losing` inside `run`.
   - If the top-left is empty and another cell holds the only value, that value is blanked. I believe Excel keeps the first value in
     reading order; I haven't checked this.

7. **Low-medium: arrows out of a merge get stuck at the frozen-rows edge** (`grid.ts:285-289`). The merge block requires
   `drawn < size.head` for the head part. When a merge's bottom is the head's last row, the move falls through: the frozen-crossing code
   checks the active cell (the merge's top-left), not the merge's bottom, so Glide moves one row down inside the merge and `fit` snaps
   back to the top-left. Arrow down never leaves the merge. Also, an arrow into a merge and out again comes out at the merge's left
   column, not the column it came in by (Excel keeps that column). Fix: in the merge block, hand off to the other part when the step
   crosses the frozen edge.

8. **Low: nothing guards a merge's hidden cells.** Paste, fill and an agent's `set` can write into a merge's non-top-left cells. The
   values stay hidden and are exported (Excel would refuse the write). Neither the fill handle nor sort knows about merges. Sort (`reorder`, `sheets.js:115`) moves cell contents, not row ids, so merges stay put while
   values move under them, and a value can land hidden in a merge. No corruption, just surprises. One thing could corrupt: neither `restoreLook` nor `exportXlsx` checks merges for overlap. If an agent's
   sheet.json carries overlapping `merges`, the export writes overlapping `<mergeCell>` refs, which I believe Excel repairs (not tested).
   The page's own `merge()` removes overlaps, so it can't cause this.

9. **Info: `series.ts` is wired in, not unused** (`grid.ts:13`, `242-255`). Every fill-handle drag now goes through `seriesFill` with
   `from`, and the hub handles that (`sheets.js:85-103`, 427). So fill behaviour changes now:
   - A lone number is copied (Ctrl counts it up), runs extend by trend, and "Item 1" continues to "Item 2".
   - Ran: typed "2026-01-30" gives 2026-01-31, 2026-01-32, 2026-01-33 (the engine has `dateFormats: []`, so a typed date is text),
     and "1/30/2026" gives 1/30/2027…
   - Not checked: with hidden rows and a multi-row source, the hub's HyperFormula fill may pick a different source row's formula than
     the page's series for later runs.

10. **Checked and OK.**
    - Ran export with merges, a rule, a style, a frozen pane and a filter. The sheet XML order is
      `sheetData [autoFilter] mergeCells conditionalFormatting ignoredErrors`, and styles.xml has `cellStyles dxfs tableStyles` with
      SheetJS's own `<dxfs>` replaced. Both are valid schema order. Re-importing gives back the same `merges` and `rules`.
    - Not opened in Excel.
    - The `withDxfs` fallback (insert before `</styleSheet>`) would be wrong if there were `<colors>`/`<extLst>` and no `<tableStyles>`,
      but SheetJS output always has `tableStyles`.
    - `x14:cfRule` rules may be counted twice in `dropped` (cosmetic).
    - The merge confirmation is there: `sheet.tsx:88-95` asks "Merging keeps only the upper-left value" only when `losing` (every
      non-top-left cell with input, hidden rows included) isn't empty, then blanks those cells in the same undo step.
    - Merge & Center on an existing merge unmerges it.

## Unfinished
- Rules: `components/sheet/rules.tsx` (evaluator cache, style overlay, dialog), the `sheet.tsx` hooks, Alt H L, the sourceLines raise,
  and the `lookOf`/`restoreLook` rules branches (finding 1).
- Merges: shrinking merges in `keepCorners` (finding 2); the planned Node scratch run on the budget workbook with openpyxl; a headless probe of merge drawing (lines, block text, frozen columns through a merge).
