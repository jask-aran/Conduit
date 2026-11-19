# Sheets: workbooks with tabs, and xlsx in and out

A plan, 2026-11-15, for two asks: workbooks with several tabs, and importing from and exporting to `.xlsx` with formulas
that keep working. Evidence is marked **measured** (run here, scripts and raw results in the session's scratch folder
`xlsx-research/`), **read** (in source or docs), or **guess**. The owner's workbooks are called W1 to W9, largest first;
only shapes and counts are given.

## Findings from the Paper xlsx package

**Licence (read).** `paper-xlsx` has `LICENCE.rst`: "This software is under the MIT Licence. Copyright (c) 2010 openpyxl.
Portions Copyright (c) 2026 Paper Instruments, Inc." The `skills` repo is MIT too. Nothing blocks depending on it.

**What it is (read).** It is a hard fork of openpyxl that keeps the import name `openpyxl` (version 0.2.2, "Alpha", last
commit 2026-09-23, one dependency). It is pure Python, so the Node hub could only use it by running Python.

**What it adds for agents (read).** The fork is about editing an existing `.xlsx` in place without losing anything:

- *Preserve mode*: the original zip stays the source of truth, and a save patches only the parts a supported edit owns.
  Anything else raises a typed `PaperRefusal` that names the reason.
- *Save receipts*: what changed, which cached results were removed, and whether a recalculation was asked for.
- *Formula freshness*: when an input changes, cached results go stale. The fork deletes them and asks Excel to recalculate
  on open, and it refuses a `data_only` save that would drop formulas.
- Search, `scan_errors`, `diff_workbooks`, `copy_format`, `append_table_row` and `chart.repoint`.
- Row and column inserts that also rewrite names, tables, charts and filters, and return the address changes.
- A LibreOffice "oracle" to recalculate a workbook (it has no formula engine of its own).

**How it models a workbook (read).** It uses openpyxl's model:

- A workbook holds worksheets. A cell's `value` is either the formula text or a value, and you get one or the other per
  load: cached values need a second load with `data_only=True`.
- Shared formulas are expanded on read, and stock openpyxl dissolves them on write. Array formulas are `ArrayFormula`
  objects.
- Defined names live on the workbook and on each sheet. Tables are `ws.tables`.
- Styles are Font, Fill, Border, Alignment and a `number_format` string. Merged ranges, column and row dimensions (width,
  hidden), `freeze_panes`, data validation, conditional formatting, legacy notes, charts and images are all modelled.
- Pivots, sparklines, slicers and the newer (x14) extensions are kept only as untouched bytes in preserve mode.

**Its evals (read).** The test fixtures are frozen by a hash manifest:

- One fixture per feature: names, tables, merges, validation, hidden parts, shared plus array formulas, a schedule saved
  with and without cached values, and a file written by LibreOffice.
- A "gauntlet" file that combines everything, plus corrupt and legacy files that must be refused, and a 150,000-cell file
  for speed.
- A five-job "battery" that measures how stock openpyxl damages files and asserts the fork ends each job correct or
  loudly refused. The damage it measures: sparklines and conditional formats dropped, shared formulas dissolved, a
  `SUM` range and a defined name left pointing at the old cells after `insert_rows`, and formulas lost on a `data_only`
  save.
- It says plainly that no fixture was written by Excel.

**Lessons for Conduit.** A reader must get formulas and cached values together. A writer must write cached values or ask
for a recalculation, never stale values silently. Shared formulas and `_xlfn.` prefixes are where simple writers break.
Structure edits must rewrite references everywhere (HyperFormula already does this for us). Anything dropped is
reported, never silent: our import report plays the part of their receipt. Conduit converts a workbook rather than
editing the `.xlsx` in place, so preserve mode, the fork's main value, does not apply to us.

## What the owner's workbooks use

**Measured** with openpyxl 3.1.5 and a raw scan of each zip, over the 9 workbooks the previous agent converted:

| Feature | Workbooks (of 9) | How much |
| --- | --- | --- |
| Several tabs | 6 | 2 to 28 tabs; 35 of the 49 readable workbooks found have 2 or more |
| Hidden tabs | 2 | 25 |
| Cross-tab references | 6 | 138,143 of 862,755 formulas (16%) |
| Defined names | 4 | 126 (36 user-visible); none used in a cell formula |
| Tables / structured references | 1 | 2 tables / 0 formulas |
| Array (CSE) formulas / dynamic arrays | 3 / 0 | 55 / 0 |
| Shared-formula groups | 7 | 1,065 |
| `_xlfn.` functions | 2 | 14 (FLOOR.MATH, STDEV.S; COVARIANCE.S, VAR.S elsewhere) |
| Bare `TRUE`/`FALSE` in formulas | 2 | 801 formulas |
| Number formats other than General | 9 | 7 to 25 per workbook: currency, thousands, %, dates |
| Date cells | 8 | 64,232 |
| Bold / fill / borders | 6 / 7 / 7 | 2,551 / 98,323 / 125,475 cells |
| Column widths set | 9 | 919 columns |
| Frozen panes | 3 | 28 tabs |
| Merged ranges | 5 | 521 (477 in one) |
| Hidden rows / columns | 3 / 3 | 8,951 / 12 |
| Data validation / conditional formats | 3 / 5 | 277 rules / 367 ranges |
| Notes (comments); threaded comments | 4; 0 | 957 (953 in one) |
| Charts / pivot tables / images | 6 / 1 / 2 | 20 / 4 / 5 |
| Hyperlinks / external links | 4 / 1 | 42 / 1 (no formula uses it) |
| Macros, 1904 dates, sparklines, slicers | 0 | |

Three more facts from the files:

- **No cached values.** W6 was written by openpyxl and has no cached values at all: all 66,003 formulas have an empty
  `<v>`. Three of the 49 files have this producer. Import must not trust an empty cache.
- **Used range.** W6 also claims 16,384 columns because empty cells carry formatting. Size a tab by its content, not by
  its stated range.
- **Size.** W1 has 1.28 million cells and 704,038 formulas across 28 tabs, 19 of them hidden.

## Formula compatibility

**How xlsx stores formulas (read and measured).**

- `<f>` holds the text without the `=`.
- *Shared formulas* store the text once, on the group's first cell (`t="shared"`, `ref`, `si`). The other cells carry
  only the group number, and the reader shifts the references for each cell.
- *Array formulas* (`t="array" ref=…`) sit on the range's first cell; the other cells hold only values. *Dynamic
  arrays* add a `cm` attribute and `xl/metadata.xml`.
- Functions newer than Excel 2007 are written `_xlfn.NAME`; FILTER and SORT are written `_xlfn._xlws.`. Excel shows
  `#NAME?` when the prefix is missing (read; not checked in Excel here).
- References are A1 in the file. R1C1 is only a display setting.
- Dates are serial numbers in the 1900 system, including Excel's false 29 February 1900. A date is told apart only by
  its number format.

**What HyperFormula 3.5.0 does with each (measured, `scripts/hf-gaps*.cjs`).**

| Gap | Owner's files | Fix |
| --- | --- | --- |
| Cross-tab references | 138,143 formulas | Tabs in one engine. Measured: W7's 314 formulas, 156 of which failed before, all now equal Excel's cached values |
| `OFFSET` with cell or `ROW()` arguments (HyperFormula only parses constant arguments) | 72 in 2 workbooks; in W8 55 roots break 304 dependants | Freeze (below). A function of our own cannot take over the name `OFFSET`, and `INDEX(…):INDEX(…)` does not parse |
| RANK (also RANK.EQ) | 95; 190 over all 49 | A function plugin (verified) |
| AVERAGEIFS | 175 | A plugin that calls the built-in SUMIFS and COUNTIFS (verified with 1 and 2 conditions) |
| Bare `TRUE`/`FALSE` give `#NAME?` | 801 formulas | Engine-wide named expressions `TRUE` = `=TRUE()` and `FALSE` = `=FALSE()` (verified). The text is left as typed |
| `_xlfn.` prefix gives a parse error | 14 | Removed on import; added back on export from a list. Verified: the exported formulas match the originals exactly |
| CSE arrays (`SUM(A*B)`) give `#VALUE!` | 55 | `=ARRAYFORMULA(…)` on the anchor, or the `useArrayArithmetic` setting (both verified to give 14 on a toy) |
| 3D references, structured references, `[1]` external references, INDIRECT, IMPORTRANGE, DUMMYFUNCTION | 0 to 4 cells | Freeze |
| XNPV rejects its arguments | 1 root cell, 5 dependants | Freeze. Cause not found |
| Dates before March 1900 off by one | none | `leapYear1900: true` with `nullDate` 1899-12-31: DATE(1900,1,1) = 1 and DATE(2024,1,1) = 45292, as in Excel |
| NETWORKDAYS on text dates | 2 to 12 cells in W1 | None: `dateFormats: []` is a decision already made. Reported |

**Custom functions (read in the typings and measured).** A class extends `FunctionPlugin`. Its static
`implementedFunctions` maps a name to `{ method, parameters, repeatLastArgs }`, and
`HyperFormula.registerFunctionPlugin(Plugin, { enGB: names, enUS: names })` registers it before any engine is built:

```js
class ExcelGaps extends FunctionPlugin {
  rank(ast, state) { return this.runFunction(ast.args, state, this.metadata("RANK"), (n, range, ascending) => { /* 1 + how many beat n */ }); }
  averageifs(ast, state) { /* SUMIFS(...) / COUNTIFS(args minus the first), #DIV/0! when nothing matches */ }
}
ExcelGaps.implementedFunctions = { RANK: { method: "rank", parameters: [NUMBER, RANGE, BOOLEAN default false] }, "RANK.EQ": { ...same }, AVERAGEIFS: { method: "averageifs", parameters: [RANGE, RANGE, NOERROR], repeatLastArgs: 2 } };
```

It belongs in a module that `sheet-format.js` imports, so the hub and the page compute the same values.

**Freezing.** When a formula cannot be parsed or names a function we do not have, import stores Excel's cached value as
the cell's input. It also keeps `{ formula, value, anchor }` under `excel:<rowId>:<colId>` in `look`. Export writes the
original formula back only while the cell still holds that value, so a later edit simply wins. The hub's row, column and
tab ops rewrite these formulas as the engine rewrites any (OFFSET goes into a scratch engine under a name it does not
know, so it parses); a sort moves them as a fill does, from `anchor`. Dependent cells, through ranges too, compute from
the kept value (measured on a generated workbook; W8 not run).

**What round-trips and what cannot.** Exact (measured on the exported files): values, formula text (`_xlfn.` restored),
tab names and order, number formats, merges and defined names. Written by our own parts beside SheetJS's: fonts, fills,
borders and alignment, cell-value and formula conditional formats, row heights, hidden rows and columns, and frozen panes.
Lost: validation, charts, images, pivots (their cells survive as values), notes, hyperlinks and print settings. Shared
formulas are written out per cell, so the file grows, but Excel reads them the same.

## Library choice

**Measured** (`scripts/libtrial.cjs`, `trials.sh`, `compare.py`): read, write back, reopen with openpyxl, compare.

| | SheetJS CE 0.20.3 | exceljs 4.4.0 |
| --- | --- | --- |
| W1 read (1.28M cells) | 14.6 s, 1.44 GB peak memory (dense and no text: 8.7 s, 658 MB) | 13.4 s, 4.6 GB |
| W1 write | 8.5 s | 16.6 s |
| W2 (563k cells) read / write / memory | 2.1 s / 1.1 s / 448 MB | 1.8 s / 2.4 s / 754 MB |
| W4 (61k formulas, 14 tabs) | 1.4 s, 429 MB | 1.3 s, 547 MB |
| Failed to read | 0 of 9 | W6: a crash in its drawing parser that no option avoids |
| Written file reopens | all checked | W4 unreadable: it writes `<v>NaN</v>` for error results |
| Formulas, cached values, tab names | all survive (`_xlfn.` removed on read, then restored by us) | all survive where readable |
| Styles / defined names | fills read, nothing written / all kept | kept / 31 of 33 dropped in W9 |
| Release, licence, size | 2024, Apache-2.0, 0 dependencies, 7.8 MB | Oct 2023 (prerelease Dec 2024), MIT, 9 dependencies, 23 MB |

**Recommendation: SheetJS Community Edition 0.20.3** for both import and export. It read every file, its memory is a
third of exceljs's, it has no dependencies, and it gives formulas and cached values in one pass. It has three traps, all
measured:

- Read with `sheetStubs: true`. Without it SheetJS silently drops formula cells whose cached result is empty: it lost all
  65,996 of W6's.
- Its dense writer needs every row present.
- It strips `_xlfn.` on read unless `xlfn: true`.

Its gaps (read in source): it writes no fonts, fills, borders, frozen panes or `calcPr`. Distribution: the npm package
`xlsx` stops at 0.18.5, which has published security advisories (from memory). Current versions come only as a tarball
from `cdn.sheetjs.com`.

**Runner-up: exceljs**, if styles become worth its failures and memory. **Python** (openpyxl, or the Paper fork) is the
leanest reader: in streaming mode it held 33 to 39 MB with both passes taking 1.9 s on W4 and 4.4 s on W2. But it would
put Python on every hub and device, so it stays a test oracle in the scratch checks only.

## Tabs design

**On disk.** A one-tab sheet stays `<name>.csv`, unchanged. A workbook is a folder `<name>.sheet/` with one
`<tab name>.csv` of computed values per tab; Conduit's state stays in the side folder.

- *Tab names as file names.* Excel already forbids `\ / ? * [ ] :` in tab names and keeps them unique ignoring case.
  `" < > |`, control characters and a trailing dot or space are written as `%XX`.
- *Becoming a folder.* The first time a tab is added to a `.csv` sheet, the file moves to `<name>.sheet/<name>.csv`. Its
  id is kept by `paths.json` (`BY_PATH.renamed`).
- *Alternatives weighed.* A folder for every sheet would change today's files. A `.xlsx` as the live file is not a plain
  result file and cannot be diffed. A manifest beside the folder would be Conduit state in the project folder.
- *Finding workbooks.* Discovery (`git ls-files '*.csv'` or `walk` in `documents.js`) already finds the tab files. A
  CSV whose parent folder ends in `.sheet` belongs to that folder's artifact. `at()` refuses to open one alone ("a tab of
  workbook X").
- *What `disk` needs.* `localDisk` and `deviceDisk` gain `list(dir)`, `mkdir`, folder `rename` and `removeTree`.
- *Edits outside Conduit.* A tab file edited outside goes through today's `take`, for that tab. A new CSV in the folder
  is a new last tab. A missing file whose content shows up under a new name is a rename. A tab file deleted alone is
  written back.

**Yjs** (`SHEET_FORMAT` becomes 2):

- `tabs`: a Y.Array of tab ids in order.
- `tab`: a Y.Map holding `name:<tabId>` and `hidden:<tabId>`.
- Tab `main` keeps the root `rows`/`cols`; any other tab has `rows:<tabId>`/`cols:<tabId>`.
- `cells` and `look` stay one map each: row and column ids are unique across the whole doc, so `rowId:colId` already
  names its tab. The hub checks new ids against the doc.
- A version-1 doc has no `tabs`: it reads as `["main"]`, named after its file. **Migration writes nothing until a second
  tab is added.**
- Tab-level look: `freezeRows:<tabId>` and `freezeCols:<tabId>` (counts); and `fmt:<colId>` or `fmt:<rowId>:<colId>` for number formats.
- Only the hub adds, renames, removes or moves tabs, as with rows today. A page may write `hidden:`.

**HyperFormula.** One engine for the whole workbook (`buildFromSheets`), with each tab id mapped to the engine's sheet
id. That id stays the same when other tabs are removed (measured).

- `Data!A1` and `'My Data'!A1` work (measured).
- `renameSheet` rewrites every formula that refers to the tab (measured). The hub reads the changed formulas back and
  writes them, in all tabs, in the same transaction as the name. A page applies the rename to its own engine before the
  cells.
- `removeSheet` leaves `=Gone!A1` showing `#REF!`, and it works again if a tab of that name comes back (measured).
  Export writes `#REF!` in its place.
- Inserting rows in one tab shifts references to it from other tabs (measured). So `structure` must compare formulas in
  every tab, first narrowed to formulas whose text names the tab.
- Tab order does not matter to the engine (it has no reorder, and 3D references are not supported).

**`sheet-format.js` API.**

- New `createWorkbookModel(doc, { name })` returning:
  - `tabs()`: `[{ id, name, hidden }]`.
  - `tab(id)`: today's `SheetModel` unchanged, plus `id` and `name`. So `grid.ts` does not change.
  - `tabOfRow(rowId)`.
  - `onChange`, with `tab` and `tabs` in each change.
  - `structure(tab, op, at, count, write)` and `tabOp(op, …)` (the hub's alone).
- `createSheetModel(doc)` stays as the first tab's view.
- `serveSheetModel` computes the whole workbook. `createSheetView` gains `tab(id)`; values stay keyed by the cell key.
- New: `TABS`, `TAB`, `rowsOf(tab)`, `colsOf(tab)`, `parseRef("'My Data'!B2:C5")` giving `{ tab, range }`, and
  `WORKBOOK_LIMIT`.
- `CONFIG` gains `leapYear1900` and `nullDate`, the TRUE/FALSE names, and the plugin.

**Hub and agents.**

- Addresses take an optional tab: `at: "Data!B4"`, `range: "'My Data'!B2:C5"`. Without one they mean the first tab, as
  today.
- `GET /v0/document/:id` starts with `# workbook <name>: tabs Summary (20x8), Data (3394x57, hidden); this is Summary`
  and takes `?tab=`. `?as=cells` adds `tab` and `tabs`.
- `POST …/cells` gains `add-tab {name, at?}`, `rename-tab {tab, name}`, `delete-tab {tab}`, `move-tab {tab, at}` and
  `hide-tab {tab, hidden}`. Row and column ops take `tab`.
- `conduit_artifact` gains a `tabs` action; the CLI gains `document tabs <id> [add|rename|delete|move|hide] …`.
- `sheet.json` format 2 is `{ format: 2, tabs: [{ id, name, file, hidden, inputs, look }], names }`. Format 1 is read as
  one tab.

**Comments.** `under.cells` is unchanged, because the row id already gives the tab. `where()` returns `Data!B4:C5`,
`context()` names the tab, and the page switches to the comment's tab when opening it.

## Import and export design

**Where import runs.** On the hub, in a `worker_thread`: W1 alone blocks for 9 to 15 s. The worker:

1. Parses with SheetJS.
2. Translates: adds `=`; removes `_xlfn.`/`_xlws.`; turns CSE arrays into `ARRAYFORMULA`; leaves the members of an array
   empty; prefixes `'` to text that would read as a number, boolean or formula (`00123`); turns dates into their serials
   with the format kept in `look`; takes widths in px from Excel's widths (about 7 px per character, a guess); keeps
   merges; turns names into named expressions; freezes what cannot compute; sizes each tab by its content.
3. Computes everything in a throwaway engine and compares with Excel's cache.
4. Hands back plain data.

The main thread then writes the CSV (or folder), `sheet.json` and an `import.json` report, and adopts the result.

**The report**, shown to the person once as a notice on the new artifact, and readable later with `?as=import`:

- each tab's size and number of formulas;
- `computed: { same, differ, frozen, noCache }`;
- the first 50 differing or frozen cells with the reason, and counts by reason;
- what was dropped, with counts: charts, conditional formats, validation, notes, pivots, styles, images, hyperlinks and
  hidden rows.

**Verbs.**

- `POST /v0/projects/:id/artifacts/import`. Either raw xlsx bytes from the page (drop or file picker; `?name=&folder=`),
  or JSON `{ from: "<a .xlsx in the project>", name?, folder?, tabs?: [..] }` for agents.
- `GET /v0/document/:id?as=xlsx` to download.
- `POST /v0/document/:id/export { to?, replace? }` writes into the project folder and refuses to overwrite unless
  `replace` is set.
- `conduit_artifact` actions `import` and `export`; the CLI's `document import <project> <file.xlsx> [--name] [--tabs]`
  and `document export <id> [to]`.
- An agent imports, reads the report, and fixes or explains the cells listed.

**Limits:** a file of up to 30 MB, at most `WORKBOOK_LIMIT` cells, and a 60 s worker timeout. `tabs` lets someone import
part of a big workbook.

**Export** writes, through SheetJS:

- each formula with `_xlfn.` added back, using a list kept beside the plugin;
- the values Conduit computed, as cached values;
- frozen cells' original formulas;
- number formats, widths (`wpx`), merges, names, hidden tabs and the tab order.

**Verification: the round-trip scorecard** (`conduit-web/scripts/xlsx-roundtrip.mjs`, **measured**). It takes 30 workbooks, one per
feature, written by openpyxl with the cached values Excel keeps put back in by hand. It imports each one and exports it through the hub's
document service in a temporary data root, then reads both files back with openpyxl. Each export is also held to what Excel is strict about:
every part has a content type, every relationship target exists, `r:id`s resolve, children of `<worksheet>`, `<workbook>`, `<styleSheet>`
and `<chartSpace>` are in schema order, every `count` matches, and style and dxf ids are in range. Any fault fails the run.

The features script is kept outside the repo (the script's usage says what it must answer). LibreOffice is not installed here. Whether
Excel opens an export without a repair prompt is **not verified**. openpyxl cannot write threaded comments or dynamic-array metadata
(`cm=`), so those are not tested: the spilling formulas are legacy array formulas with their cached cells.

| Feature | Baseline (main, 2026-11-20) | Import report then |
| --- | --- | --- |
| values | kept | - |
| formulas | kept | 1 frozen |
| array (CSE) | changed: 0/1 kept; Sheet!C1: ["=SUM(A1:A5*B1:B5)","550","C1"] -> ["=SUM(A1:A5*B1:B5)","550",""] | - |
| spilling formulas | changed: 15/18 kept; Sheet!C1: ["=_xlfn.UNIQUE(A1:A5)","3","C1:C4"] -> null | 3 frozen |
| functions the engine lacks | changed: 1/3 kept; Sheet!B1: ["=_xlfn.LAMBDA(x,x*2)(A1)","20",""] -> ["=LAMBDA(x,x*2)(A1)","20",""] | 2 frozen |
| defined names | changed: 2/4 kept; name Rate: "Sheet!$A$2" -> null | left out 2 defined names; 2 frozen |
| number formats | kept | - |
| fonts | changed: 6/8 kept; A7: [false,false,"",false,"",11,"Courier New"] -> [false,false,"",false,"",11,"Calibri"] | - |
| fills | changed: 3/4 kept; A4: ["darkGray","FF0000"] -> ["solid","FF0000"] | - |
| borders | changed: 2/7 kept; D2: ["","","","thin/","thin/"] -> ["","","","thin/",""] | - |
| alignment, wrap, indent, rotation | changed: 4/9 kept; A5: ["left","",false,2,0,false] -> ["left","",false,0,0,false] | - |
| widths, heights, hidden, frozen | changed: 6/8 kept; height 2: 40 -> 39.75 | - |
| merges | dropped: 0/2 kept; B1:D1: true -> null | left out 1 merged ranges past the tab's last value |
| conditional: cell value | kept | - |
| conditional: colour scale | dropped: 0/2 kept; A1:A10 0: ["colorScale","",[],"","",false,"",false,false] -> null | left out 1 conditional formats (colorScale) |
| conditional: data bar | dropped: 0/2 kept; A1:A10 0: ["dataBar","",[],"","",false,"",false,false] -> null | left out 1 conditional formats (dataBar) |
| conditional: icon set | dropped: 0/2 kept; A1:A10 0: ["iconSet","",[],"","",false,"",false,false] -> null | left out 1 conditional formats (iconSet) |
| conditional: formula | kept | - |
| conditional: top 10 | dropped: 0/1 kept; A1:A10 0: ["top10","",[],"FFC7CE","",true,3,false,false] -> null | left out 1 conditional formats (top10) |
| conditional: number format | changed: 0/1 kept; A1:A10 0: ["cellIs","greaterThan",["50"],"","0.0\" big\"",false,"",false,false] -> ["cellIs","greaterThan",["50"],"","",false,"",… | left out 1 conditional formats (number format of a rule) |
| data validations | dropped: 0/5 kept; B1:B10: ["list","","\"Yes,No,Maybe\"","",true,""] -> null | left out 5 validation rules |
| hyperlinks | changed: 1/4 kept; A1: ["https://example.com/page",""] -> null | - |
| notes | dropped: 0/2 kept; A1: "Check this number" -> null | left out 2 notes |
| tables | dropped: 0/1 kept; table Sales: ["A1:C4","TableStyleMedium9"] -> null | - |
| autofilter | changed: 0/1 kept; autofilter: "A1:B6" -> "" | - |
| charts | dropped: 0/3 kept; chart 1: ["bar","col",["Sheet!$A$2:$A$7","Sheet!$B$2:$B$7","Sheet!$C$2:$C$7","Sheet!B1","Sheet!C1"]] -> null | - |
| images | dropped: 0/1 kept; media 0: true -> null | - |
| tabs: names, colours, hidden | changed: 4/6 kept; tab 1: ["O'Brien & Co","visible","FF0000"] -> ["O'Brien & Co","visible",""] | - |
| print settings | changed: 0/7 kept; orientation: "landscape" -> null | - |
| protection | changed: 0/2 kept; workbook structure: true -> false | - |

## Still to build

Steps 1 to 9 of the first build order have landed. Left: an OFFSET plugin, and Excel notes as Markup comments (waiting on
the owner: 16 notes would hand 16 items to agents).

## Open decisions for the owner

1. **Layout.** A folder `<name>.sheet/` with one CSV per tab; `.csv` sheets untouched until they get a second tab, when
   the file moves into the folder. *Recommended.* The other way: a `.csv` never gains tabs, and a workbook is made as one.
2. **Workbook size.** The engine and the Yjs doc grow together (previous agent's bench: W1 would need about 726 MB of
   engine and 434 MB of doc in every page). *Recommend 500,000 cells per workbook*, with W1 imported a few tabs at a time.
3. **Formulas Conduit cannot compute.** *Recommend freezing* them (Excel's value, with the formula kept for export).
   The other way: import them as errors.

## Packages that would be added

| Package | Version | Licence | For |
| --- | --- | --- | --- |
| `xlsx` (SheetJS CE) | 0.20.3, from `https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz` | Apache-2.0 | import and export, on the hub |
| `numfmt` | 4.1.3 (released 2026-11-10; 3.2.6 is the last of the older line) | MIT, no dependencies | drawing number formats in the grid |

`hyperformula` 3.5.0 (GPL-3.0-only) is already in. Python and openpyxl stay in the scratch checks only.
