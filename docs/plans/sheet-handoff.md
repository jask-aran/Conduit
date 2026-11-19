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

Three reviews (undo, merges and rules, xlsx styles) were fixed, each finding in its own commit (`611ec8dfa`..`2e8bfc8b9`); what they left
open is in the list below:
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
and the merge question holds its corners by ids. `review-sheet-fixes.md` is done but for #7 (Undo gives up on
an op after 30 s) and #9 (deleting a merge's top row leaves it empty, as Excel's does).

Later: the context menu's Paste moves references too (checked in the browser); rules can be edited and moved up; Ctrl+Shift+& outlines,
Ctrl+Shift+_ takes borders off.

Then Paste values in the cell menu, and row 1's top border drawn just inside the header's line.

Then hidden columns. What a later builder must know:
- Glide 6 has none. Rows are mapped (`createRowMap`); a hidden column keeps its index and is drawn 0 wide (a numeric `width` skips
  `minColumnWidth`, lines skip `width === 0`, cells clip to their rect), so the grid's columns stay the sheet's.
- The look key is `hidden:<colId>`, as rows' `hidden:<rowId>` (ids never repeat across rows, columns and tabs); xlsx sees `hidden:C`.
- Keys step over it through `nextShown`/`shownAt` (grid.ts); copy, paste, clear, fill and Find skip it (`colsFrom`, `shownCols`).
- Glide gives a press just right of a hidden column's line to its resize: dragging there opens it, and `setWidths` deletes `hidden:`.
- The row Hide isn't wrapped in `history.act`, so its step is named by `LOOKS.hidden` ("Hide rows"): name any column hide explicitly.
- SheetJS writes `hidden="true"`, not `"1"`, and reads both.

Then the keys and paste review, all fixed: Ctrl+- acts only on whole rows or columns the grid picked; the grid writes its own clipboard text
(quoted TSV, hidden rows and columns left out) and every paste moves each formula by its own cell's offset; Paste values reads the clipboard
and keeps text as text; a queued Undo is dropped when a step is made first; `shiftRefs` moves `A:A` and `1:1`. Hidden columns are now
skipped by copy, cut, clear, paste, fill and Find, Home steps past column A, and Ctrl+0 / Ctrl+Shift+0 hide and show columns.

Then the grid round (checked in headless Chromium on :4310 first): arrows leave a merge at or across the frozen rows' edge; tall merges
sum their rows' heights once; a fill-handle drag over hidden lines moves its formulas on the page (`sourceLine` in series.ts; another
tab's references don't move there); marks recolour on a new theme; the in-cell editor writes at the cell's size; a press on a popover's row
in a pane no longer closes it (the filter's values could not be picked).

Notes from xlsx are waiting on the owner: sheet comments are markup items sent to a listener, so 16 imported notes would hand 16 items to
agents.

Then the cell menu round (checked in headless Chrome on :4310 before the fixes; the fixes themselves unseen there). What a later builder must know:
- The menu is `cell-menu.tsx` `SheetMenu`: groups of entries built in `sheet.tsx` `menuGroups`, each label counted from the range it was opened on
  (plain cell, block, whole rows by their numbers, whole columns by their letters). The search filters those entries and their submenus' rows;
  the `after` sections (merges, Formatting, Conditional formatting, Number format, View settings) show only while nothing is typed.
- Moves (`move-rows`, `move-cols`) move the lines' ids in the Y.Array (`sheet-engine.js` `structure`), so whatever is held by ids goes with them:
  cells, styles, sizes, hidden, a column's type, comments, `excel:` entries (their formulas rewritten by `keepFrozen`). Filters, tables and
  conditional formats keep their places (`keepPlaces`), as their two corners would come apart. A page or the hub seeing ids put back where others
  were taken out (a move, or its undo) builds its engine again from the doc (`flush`). A comment over several cells whose corner moves alone stretches.
- Sort sheet keeps row 1 when rows are frozen or row 1 is text alone over a column of numbers or dates.
- Ctrl+Alt+M asks the one comments go to (the paper's comment key does the same); Comment has no chord. Comment and Ask the agent exist while
  Markup's tool is mounted, which is whenever the pane is not `quiet`; Ask needs a listener too.

Then the ribbon, charts and ask box, walked in headless Chrome on :4310 (2026-11-20); the fixes on branch `sheet-check-2` were not seen there. What a later builder must know:
- The ribbon's tools are `tools.tsx` in `SHEET_TOOLS`' order, each showing the first selected cell's state. The any-colour swatch puts on the last
  colour picked (Markup's own ink rule) as it opens the picker; drags in the picker join one step (`history.act`'s `join`: the step on top of the
  history is reused while the same thing changes).
- The grid keeps Ctrl+B from the application's sidebar chord through `OWN_KEYS` (`data-own-keys`), as it does Ctrl+- and Ctrl+0.
- Glide's column resize ends a still press at its least width (its last width starts at -1): `grid.ts` sizes a column only once its edge has moved.
- Charts (`charts.tsx`, `chart-draw.ts`, `sheet-charts.js`): Glide's `getBounds` lags the region it reports until React commits, so the layer places
  charts again two frames after a scroll or a tab shown. The layer is `overflow: clip`, as a focused chart would scroll a `hidden` one. A range whose
  corners crossed is read as the box they span (`spanned`).
- Ctrl+V of plain text parses it with `fromCsv` (`grid.ts` `pasted`). A chart redraws only when changed cells meet its range, and draws at most 200
  lines along its labels (`charts.tsx` `POINTS`).
- Make chart, the ribbon's Chart menu and Ask the agent (Ctrl+Alt+M) go through Markup's ask box under the tools, which also shows "Making the chart…".
  None was sent in the walk, as a listener was held.

## Open, in rough order

1. **Notes and comments from xlsx:** 16 in the budget workbook, counted but not imported. They would become comments.
2. **Small gaps:**
   - Ctrl+T is taken by Chrome; Alt H T works.
   - The sheet's Ctrl keys (and Ctrl+B, I, U) are not commands in the registry. They would be palette-only `ARTIFACT_COMMANDS` with no
     binding (the grid keeps the chords; Ctrl+B, Ctrl+0 and Ctrl+- are application chords), but the registry is in the initial bundle,
     which has no room to spare: the owner's call.
   - Find doesn't search again when a column is hidden or shown while it is open.
   - Paste values of text from outside keeps `=1+1` a live formula; whether it should land as text is the owner's call.
   - "View settings…" in the context menu breaks DESIGN's rule that menu rows don't open settings. The owner hasn't decided.
   - Ctrl+- on a block of cells does nothing; Excel asks whether to shift cells up or left, or delete whole rows or columns.
   - The cell menu's search field breaks DESIGN's "a popover rather than a menu when rows hold inputs"; the library's `SearchList` holds no submenus,
     keys or groups. The owner asked for the field.
   - FILTER reserves the whole source range's size to spill into (HyperFormula sizes an array before computing it), so its "if empty" value shows
     #SPILL! where cells under it are filled.
   - Shift+click on a row number or column letter extends a row or column pick, but from a cell it starts a new pick (Excel extends from the active cell).
   - A wrapped cell's row is fitted when Wrap is set, not when text is typed into it: nothing refits after a write. Excel refits only rows whose height
     was not set by hand, which the look does not tell apart (`height:` is written by a fit and by a drag alike).
   - More decimals on a General cell of text gives `0.0` to the range, not the number cells' own decimals plus one.
   - Ctrl+Z does nothing while a ribbon button has the focus (after Escape from one of its menus): the undo keys are the grid's alone.
   - Undoing an insert or delete of rows can leave other formulas re-cased (`=sum(a1)` back as `=SUM(A1)`).
3. **Left by the reviews:**
   - xlsx export: where a styled row past the tab's cells crosses a styled column, only the row's style is written (`xlsx-styles.js`).
   - xlsx: a rule's number format or border (its dxf) is counted as dropped, not kept.
   - Merge with an empty top-left blanks the only value; Excel may keep the first value in reading order (not checked).
   - "Undo N steps" can undo more than N: Yjs skips steps others have since overwritten, and the list still names them.
   - Opening a filter can make a "Filter" step: `reapply()` writes the look as a tracked change when others' edits moved what it hides.
   - Frozen formulas (`excel:` in the look): Undo putting back the entries the hub rewrote is unproven; row and column changes outside
     `cells.edit` (growing at the edge, `retake`, the page's Undo) don't rewrite them; `documents.js` still passes the import report to
     `exportXlsx`, which ignores it.
   - A column's `date` type can't be read from text without `dateFormats`, which was decided against: that item waits on the owner.
4. **Not yet checked:**
   - phone width, by touch: at 390 px nothing overflows, a tap selects, a double tap edits and a long press opens the cell menu, but
     headless touch scrolling moves nothing anywhere (not the grid, not a menu), so swiping the grid is unproven;
   - Excel opening an exported file without offering a repair;
   - lag in sideways scroll between frozen rows and the body: headless, the two parts' `scrollLeft` matched on all 68 frames of a 1,440 px
     wheel; what each canvas paints per frame needs a Windows trace;
   - Windows performance traces;
   - Ctrl+Shift+0 on Windows, which may take it to switch the input language.
5. **Charts, waiting on the owner:** a selected chart's edge brightens (close to DESIGN's no-outline rule); the series inks were not run through a
   palette check; charts draw over frozen rows; a moved chart snaps to the cell under its corner. A bar chart's last value label can be clipped at the
   right edge. The ask box under the tools at 1,100 px is as wide as the folded ribbon, wraps its text and covers the margin's top card.

## How the work has gone well

- **Parallel builders.** Split a round across 4–5 Opus builder agents by file ownership, all in the shared checkout:
  - narrow edits only; no git writes, builds or restarts;
  - typecheck through `flock /tmp/conduit-typecheck.lock` with a 4 GB heap, because RAM is tight and one OOM kill stops all of WSL;
  - one reviewer agent per feature, given the code and not the builder's conclusions. The reviews caught real bugs: sort scrambling
    neighbouring columns, filtered rows disagreeing between grid and page, Fill growing the tab.
- **Restarts are refused at a budget.** `bash scripts/start-conduit.sh restart` will not start the server when the initial JS
  bundle is over 437,000 B gzip. Sheet-only icons go in `components/ui/sheet-icons.tsx`, which loads lazily, never in the library's
  `icons.tsx`.
- **The source ceiling.** It is `sourceLines` in `conduit-web/scripts/check-conventions.mjs`, now 134,400. It may be raised for
  planned feature work.
- **Testing.** Headless Chromium via `conduit-web/scripts/probes/lib.mjs` `open()`, on the owner's test sheet "probe-sheet"
  (`/?panes=artifact%3A802d93d7cfbe2968`). No Playwright Chromium is cached here, so `open()` installs Playwright into `.smoke-tools`
  and fails after minting a session: launch `/opt/google/chrome/chrome` headless instead and sign the session out. Read cells with
  `GET /v0/document/<id>?as=cells`; a cell's box on screen is the in-cell editor's after F2.
  - use scratch columns Z and beyond, and clear them after;
  - a sort test once reordered the sheet's real rows, back when sort moved whole rows;
  - never drive or reload the owner's own Chrome tabs on :9222;
  - read the formula bar through `.ui-spreadsheet-formula` as well as its input.
- **Verifying exports.** Check exported xlsx with openpyxl: `/home/jask/jaskNEM/.venv/bin/python -I`.
- **The owner's workbook** is private. Read it locally only, and never copy it into the repo.

## Cell types, overflow, refit and links (branch `sheet-cells`, 2026-11-20; typechecked, not seen in a browser)

- Look keys: `type:<colId>` or `type:<rowId>:<colId>` (`boolean`, `date`, `plain` under a typed column); a dropdown is a list entry of the tab's
  `validations:<tabId>` (the xlsx import's shape, A1 ranges) plus our own `inks: { value: ink }`; `link:<rowId>:<colId>` (the import's hyperlinks);
  `fitted:<rowId>` marks a height a fit set; style flag `x` is Clip. `src/sheet-types.js` writes types for the page and the hub's `type` op.
- Dropdowns are A1 ranges, so they do not follow rows put in, taken out, moved or sorted; checkboxes and dates do (ids).
- Date cells keep ISO text (as Ctrl+; writes) and draw it through their date format; formulas see text.
- Overflow: an empty cell draws the share of text running into it (`spillInto`, grid.ts) from a per-row list of filled columns made once a change;
  a changed cell redraws its row to the right in view. Gridlines still cross overflowing text.
- Refit runs in `sheet.onChange` for wrapped cells, as a transaction of origin `refit`, outside the history.
