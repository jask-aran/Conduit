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

## In flight when this was written

- **Undo for hub-made changes.** A builder agent is giving the page one linear undo/redo history, with named steps in an Undo
  dropdown, that also covers hub-made changes: fill, sort, insert/delete rows. The page's `Y.UndoManager` only tracks its own
  transactions. The intended fix is to apply the hub's updates caused by this page's ops with a tracked origin. The owner wants
  it very fast. Excel's linear model was chosen, not a branching tree.
- **Text sitting high.** In the cell name field and formula bar, the text sits about 1.6 px above centre in Windows Chrome:
  Paper Mono at 11.7 px, measured caps on rows 16–24 against a box centre of 21.6. Headless Linux draws it centred. The probable
  cause is Paper Mono's vertical metrics. Options:
  - `ascent-override`/`descent-override` on its `@font-face`, but that applies app-wide;
  - `text-box: trim-both cap alphabetic`, which works on the formula text but not inside an `<input>`.

Builders running when this was written each keep an uncommitted resume note beside this file:
- `handoff-sheet-undo.md`: the undo history;
- `handoff-sheet-rules.md`: conditional formatting;
- `handoff-sheet-merges.md`: merged cells;
- `handoff-sheet-series.md`: the fill handle's series.

State at the pause, 2026-11-15: everything is committed in `993391e5d`. It typechecks, it runs on :4310, and the headless
smoke test passes.

- **Undo:** works in the browser. Ctrl+D followed by Ctrl+Z and Ctrl+Y on probe-sheet checked out. Its code review is still owed.
- **Merges, rules and series:** part-built, with what is left in each note.
  - The rules are imported and exported, but the page doesn't draw them yet.
  - Series has its module, but it is not wired to the fill handle.

Continue each with a fresh builder from its note. That beats resuming the old threads, which are large.

To continue one, start a fresh builder from its note and the working tree, not the old thread. Delete each note once its work is
committed.

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
- **The source ceiling.** It is `sourceLines` in `conduit-web/scripts/check-conventions.mjs`, now 131,500. It may be raised for
  planned feature work.
- **Testing.** Headless Chromium via `conduit-web/scripts/probes/lib.mjs` `open()`, on the owner's test sheet "probe-sheet"
  (`/?panes=artifact%3A802d93d7cfbe2968`):
  - use scratch columns Z and beyond, and clear them after;
  - a sort test once reordered the sheet's real rows, back when sort moved whole rows;
  - never drive or reload the owner's own Chrome tabs on :9222;
  - read the formula bar through `.ui-spreadsheet-formula` as well as its input.
- **Verifying exports.** Check exported xlsx with openpyxl: `/home/jask/jaskNEM/.venv/bin/python -I`.
- **The owner's workbook** is private. Read it locally only, and never copy it into the repo.
