# Sheet artifact: handoff

The `sheet` artifact (a spreadsheet editor) is heading for Excel parity, measured against the owner's own budget workbook: an
assumptions block, monthly cash flows, accounting format, coloured header bands, bordered total rows and notes. Excel's behaviour
and key sequences are the reference unless there is a reason to differ. Storage, tabs and the xlsx design are in
`sheet-xlsx-and-tabs.md`; this file is where the work stands and how it has been done.

## Where the code is

| Piece | Where |
| --- | --- |
| Editor: keys, context menu, formula bar, cell name field, wiring | `conduit-web/src/components/sheet/sheet.tsx` |
| Grid on Glide Data Grid 6 (`DataEditorCore`); row map (hidden and filtered rows); frozen rows as two views (`.ui-spreadsheet-frozen` head over `.ui-spreadsheet-rows` body); marks (references, comments, find, focus cell) | `components/sheet/grid.ts` |
| Ribbon tools (the `MarkupBar` own tools); Alt key sequences | `tools.tsx` (ids in `host.ts` `SHEET_TOOLS`), `sequences.tsx` |
| Per-tab look: widths, heights, `hidden:`, `freezeRows:`/`freezeCols:`, filter | `sizes.ts`, `filter.tsx` |
| Cell styles (packed codes) and drawing; number formats; dark-theme fit for workbook colours | `sheet-styles.js`, `styles.ts`, `cell-draw.ts`, `formats.ts`, `shade.ts` |
| Find and replace bar | `find.tsx` |
| Hub ops (`fill`, `sort`, `insert-rows`…), look ↔ `sheet.json` translation (`lookOf`/`restoreLook`) | `src/server/sheets.js`, `src/sheet-engine.js`, `src/sheet-format.js` |
| xlsx import/export: SheetJS CE plus our own parts (panes, hidden rows, heights, styles.xml) | `src/server/sheet-xlsx.js`, `src/server/xlsx-styles.js` |
| Settings › Artifacts › Sheet: gridlines, zoom, focus cell, stored per device | `src/client/settings/artifacts-settings.tsx`, `src/client/preferences/sheet-display.ts` |

## Done (commits on main, not pushed)

| Feature | Commits |
| --- | --- |
| Frozen rows and columns | `d7b2a0ab6`, `96b1b753f` |
| Hidden rows | `3d4f148ac` |
| Sweeping along column letters and row numbers, with auto-scroll | `6b6116090`, `a0ca1e7b0`, `e8c7cce01` |
| An active cell kept for whole-row and whole-column selections | `96b1b753f` |
| One round of five features, below | `97d19700f` |
| Workbook-styles fixes | `9b87f8b00` |

`97d19700f` holds:
- **Text style menu:** one menu for bold, italic, underline, strikethrough, wrap and Clear formatting.
- **Fill down / Fill right:** Ctrl+D, Ctrl+R.
- **Find and replace:** Ctrl+F, Ctrl+H.
- **Sort:** moves the range's cells only.
- **Filter:** one per tab; the rows it hides are saved in its look as `hide`.
- **Format as table:** Alt H T.
- **Workbook styles:** fills, fonts, borders, alignment, accounting layout, and row and column line styles.
- **Settings › Artifacts.**

## State, 2026-11-15 (late)

Reviews are in `review-sheet-undo.md`, `review-sheet-merges-rules.md` and `review-sheet-xlsx-styles.md`. Fixed since then, each in its own
commit (`611ec8dfa`..`2e8bfc8b9`):
- merges draw (Glide copies a spanned cell as `{...cell, span}`: the merged cell's fields must be its own); a tall merge redraws every row;
  Enter/Tab leave a merge from its far edge; deleting a merge's edge row or column shrinks it; Merge empties cells as they are when it runs;
- imported merges are cut at the tab's edge; imported rules are stored by ids (`rulesIds`), so they move with rows and columns; `stopIfTrue`
  round-trips as `stop`;
- xlsx import grows a tab only through styled cells, rows and columns touching its values, as far as the limits allow; LibreOffice's
  whole-row runs become row styles; hand-set row heights are kept; lost line styles are reported; export joins alike columns;
- Undo waits for every tagged update a hub op sent (the hub's reply counts them as `tagged`); deleting a tab clears the history;
- the fill handle steps a typed `2026-01-30` by days.

Then: undoing an insert or delete of rows moves formulas typed since (the hub's model is `owner`, keeps its engine's rewrite and writes it);
conditional-format rules draw, and Alt H L adds one and lists the tab's rules with Delete (`rules.tsx`); a sort across a merge is refused;
overlapping merges in a sheet.json are left out; Fill past hidden rows keeps a tab name's digits.

Then keys, as Excel's: Ctrl+arrow to the data's edge (Shift selects), Ctrl+End to the last cell used, Alt+= AutoSum, Ctrl+; today,
Ctrl+Shift+= / Ctrl+- insert and delete whole rows or columns; the grid keeps Ctrl+- and Ctrl+Shift+1..5 from the application's chords
(`data-own-keys`). Copy and paste in the grid move a formula's relative references (`shiftRefs`; a cut keeps them; another tab's
references don't move yet), and Ctrl+Shift+V pastes values. Merges: nothing writes into their hidden cells (a hub `set` there is refused),
and the merge question holds its corners by ids. `review-sheet-fixes.md` is done but for #6 (quadratic import growth), #7 (Undo gives up on
an op after 9 s) and #9 (deleting a merge's top row leaves it empty, as Excel's does).

Still open: the context menu's Paste reads the clipboard and moves no references, and has no Paste values row; arrows at a frozen merge's edge; prefix sums for tall
merges; the low xlsx ones (row/column crossings outside the grid, `<c r=` attribute order); rules can't be edited or reordered, only added
and deleted. Notes from xlsx are waiting on the owner: sheet comments are markup items sent to a listener, so 16 imported notes would hand
16 items to agents. Phone width is still unchecked (the headless probe opened with the sidebar drawer over the pane).

## Open, in rough order

1. **Undo** (above). After it, every new hub op must land on that history as one named step.
2. **Merged cells:** the budget workbook has D26:O26 and A63:O64. Needs grid drawing and selection, import and export.
3. **Conditional formatting:** the budget's red negatives come from it, as `<0` rules. Read, draw and export the simple
   cell-value rules first.
4. **Notes and comments from xlsx:** 16 in the budget workbook, counted but not imported. They would become comments.
5. **Smarter fill handle:** series such as 1, 2, 3, dates and month names.
6. **Small gaps:**
   - Ctrl+T is taken by Chrome; Alt H T works.
   - Fill down below hidden rows can garble a tab name that looks like a cell (`'Q1 2024'!A1`): `lowered` in `sheet.tsx`.
   - The in-cell editor doesn't zoom.
   - The find and focus-cell washes don't recolour on a theme change until the next move.
   - The new Ctrl keys are not commands in the registry; nor are Ctrl+B, I or U.
   - "View settings…" in the context menu breaks DESIGN's rule that menu rows don't open settings. The owner hasn't decided.
7. **Not yet checked:**
   - phone width;
   - Excel opening an exported file without offering a repair;
   - lag in sideways scroll between frozen rows and the body;
   - Windows performance traces.
8. **Charts:** parked by the owner.

## How the work has gone well

- **Parallel builders.** Split a round across 4–5 Opus builder agents by file ownership, all in the shared checkout:
  - narrow edits only; no git writes, builds or restarts;
  - typecheck through `flock /tmp/conduit-typecheck.lock` with a 4 GB heap, because RAM is tight and one OOM kill stops all of WSL;
  - one reviewer agent per feature, given the code and not the builder's conclusions. The reviews caught real bugs: sort scrambling
    neighbouring columns, filtered rows disagreeing between grid and page, Fill growing the tab.
- **Restarts are refused at a budget.** `bash scripts/start-conduit.sh restart` will not start the server when the initial JS
  bundle is over 437,000 B gzip. Sheet-only icons go in `components/ui/sheet-icons.tsx`, which loads lazily, never in the library's
  `icons.tsx`.
- **The source ceiling.** It is `sourceLines` in `conduit-web/scripts/check-conventions.mjs`, now 132,700. It may be raised for
  planned feature work.
- **Testing.** Headless Chromium via `conduit-web/scripts/probes/lib.mjs` `open()`, on the owner's test sheet "probe-sheet"
  (`/?panes=artifact%3A802d93d7cfbe2968`):
  - use scratch columns Z and beyond, and clear them after;
  - a sort test once reordered the sheet's real rows, back when sort moved whole rows;
  - never drive or reload the owner's own Chrome tabs on :9222;
  - read the formula bar through `.ui-spreadsheet-formula` as well as its input.
- **Verifying exports.** Check exported xlsx with openpyxl: `/home/jask/jaskNEM/.venv/bin/python -I`.
- **The owner's workbook** is private. Read it locally only, and never copy it into the repo.
