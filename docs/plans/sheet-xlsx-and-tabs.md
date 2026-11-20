# Sheets: workbooks with tabs, and xlsx in and out

How the `sheet` kind keeps workbooks and reads and writes `.xlsx`, and what the code cannot say about it. The formats
and look keys are in the headers of `sheet-format.js`, `sheet-styles.js`, `sheet-types.js`, `server/sheets.js` and
`server/sheet-xlsx.js`. Open work is in `surfaces-roadmap.md` under "Sheet".

## What real workbooks hold

Measured over the owner's nine largest workbooks (only shapes and counts):

- **No cached values.** A file written by openpyxl has an empty `<v>` on every formula. Import never trusts an empty
  cache.
- **Used range.** A file can claim 16,384 columns because empty cells carry formatting. A tab is sized by its content,
  never by its stated range.
- **Size.** The largest has 1.28 million cells and 704,038 formulas across 28 tabs, 19 hidden: more than
  `WORKBOOK_LIMIT` (500,000 cells; the engine and the Yjs doc grow together in every page), so such a workbook is
  imported a few tabs at a time.
- 16% of formulas name another tab; shared formulas, `_xlfn.` functions, bare `TRUE`/`FALSE`, CSE arrays and
  `OFFSET` with cell arguments all occur.

## Decisions

- **Formulas Conduit cannot compute are frozen**: the cell holds Excel's cached value, and `excel:<rowId>:<colId>` in
  the look keeps `{ formula, value, anchor }`. Export writes the formula back only while the cell still holds that
  value, so a later edit wins. Dependants compute from the kept value.
- **SheetJS Community Edition** (from `cdn.sheetjs.com`: the npm `xlsx` package stops at 0.18.5) for import and
  export, with our own parts written beside its output (styles, panes, rules, charts, notes, pictures). It read every
  workbook with a third of exceljs's memory; exceljs crashed on one and wrote unreadable files for another. Python
  (openpyxl) stays a test oracle only, so no hub needs Python.
- **FILTER cannot resize**: HyperFormula sizes an array before computing it, so FILTER reserves its whole source
  range to spill into, and its "if empty" value shows `#SPILL!` where cells under that range are filled.
- **Conduit's chords win over Excel's** where they clash: Ctrl+G stays the leader (F5 goes to the name box), Ctrl+.
  the workspace panel (Excel's corners of the selection is not offered); the sheet took Ctrl+/ (the paper's Block menu
  chord) for its keys list. The grid keeps Ctrl+B, Ctrl+-, Ctrl+0 and others from the application through
  `data-own-keys` (`OWN_KEYS` in `sheet.tsx`).
- **A browser tab keeps its reserved keys**: Ctrl+T, Ctrl+N, Ctrl+W, Ctrl+Tab, Ctrl+Page Down/Up, Ctrl+Shift+T/N/W/Q
  never reach the page (so Format as table is Alt H T, and tabs also step with Ctrl+Shift+Page Down/Up). F5, F6,
  Shift+F11 and Ctrl+1–9 reach the page when it holds them back (Chromium's reserved list, from memory).
- **HyperFormula traps**: `moveCells` moves only references wholly inside the block (`shiftCells` resizes the rest
  itself), and `getCellFormula` spells every formula its own way, so compare its reading before and after, never
  with the typed text.

## The round-trip scorecard

`conduit-web/scripts/xlsx-roundtrip.mjs` (how to run: `docs/TESTING.md`, "Sheets") makes one workbook per feature
with openpyxl (`xlsx-roundtrip-features.py`), with Excel's cached values put back by hand, imports and exports each
through the hub's document service in a temporary data root, and reads both back. Each export is also held to what
Excel is strict about (content types, relationship targets, `r:id`s, schema order, counts, style and dxf ids); any
fault fails the run. openpyxl cannot write dynamic-array metadata, so spilling formulas are tested as legacy array
formulas; threaded comments are written into the generated file by hand.

| Feature | Result |
| --- | --- |
| values (numbers, text, booleans, dates, times, errors, long text, leading zeros, text like numbers) | kept |
| formulas (relative, absolute, another tab, whole column, XLOOKUP, TEXT) | kept (`TEXT` frozen: it gives another value here) |
| array formulas (CSE), spilling formulas (UNIQUE, SEQUENCE, SORT) | kept, live; spills exported as Excel's dynamic arrays |
| functions the engine lacks (LAMBDA, LET, CELL, GETPIVOTDATA) | kept frozen; LAMBDA and LET written with `_xlfn.`/`_xlpm.` as dynamic arrays; CELL read with an implicit @, as Excel reads the original |
| defined names | kept, computed |
| number formats, fonts, fills, borders, alignment | kept |
| widths, heights, hidden rows and columns, frozen panes | kept (sizes exact) |
| merges, data validations, hyperlinks, tables, autofilter, filter conditions, charts, tabs (odd names, colours, hidden) | kept |
| conditional formats of every kind | kept; ranges follow inserts and moves |
| notes, threaded comments, images | kept on their cells, not drawn |
| row and column groups | kept |
| print settings, protection | kept |

33 of 33 kept. With `--excel` every export opens in real Excel with no repair, and Excel reads the same number of tabs,
charts, tables, formulas, notes, pictures and hidden columns as were written. The one repair Excel ever asked for was a
table whose header cell held a number: such a table is written as its filter alone. COM's repair modes refuse broken
files too, so they cannot say what Excel would change.

## Other files

SheetJS reads them all; only `.xlsx` and `.xlsm` have the parts our own readers use. Every export is an `.xlsx`.

| File | What comes across |
| --- | --- |
| `.xlsx` | everything in the scorecard |
| `.xlsm` | as `.xlsx`; its macros are reported left out, never run, and not exported |
| `.xlsb`, `.xls` | values, formulas and number formats; no styles, rules, charts or notes (formulas unchecked) |
| `.ods` | values and formulas |
| `.csv`, `.tsv` | values; separators `,` `;` and tab guessed, quoted newlines kept; UTF-8 with or without a byte-order mark, UTF-16 with one, else Latin-1 |

## A large workbook

200,000 cells over 5 tabs (half formulas, every tenth row styled), no cached values: import 3.1 s, first open 5.0 s,
export 2.7 s (3.2 MB), peak memory 809 MB. At 400,000 cells: 4.8 s, 8.3 s, 4.0 s, 1,559 MB, so time and memory grow
about as the cells do. An export passes through the zip three times (SheetJS writes it, then our styles and our parts
each read and write it). Excel's check of the 200,000-cell export timed out at two minutes; why was not found.

## What is lost

Pivots (their cells survive as values), slicers, sparklines, macros, and a data bar's solid fill (it lives in an
extension list that is not kept). Shared formulas are written out per cell, so the file grows, but Excel reads them
the same.
