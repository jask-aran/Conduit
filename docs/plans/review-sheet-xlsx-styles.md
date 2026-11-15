# Review: sheet xlsx styles follow-up (9b87f8b00)

Read-only review. Line numbers are at HEAD (eb57066a1; 993391e5d touched the same files after 9b87f8b00, but not the lines below).
All repros ran: synthetic workbooks were written by `exportXlsx`, their `sheet1.xml` was swapped through `XLSX.CFB`, and the result was fed to `importXlsx`.
Scripts are in the reviewer's scratchpad (t1/t3/t5/t6.mjs).

## 1. High: one stray filled cell grows a tab to 16,384 columns
`sheet-xlsx.js:102-103`, `xlsx-styles.js:98-101`. `reach` is the bounding box of every cell whose format can be seen. The only checks are `cols <= COL_LIMIT` (18,278) and `rows*cols <= SHEET_LIMIT`.
- Ran: values in A1:A10 plus `<c r="XFD1" s=fill/>` gives a tab of **10 x 16384**. The CSV becomes 16k columns of commas, and nothing is reported.
- Ran: row 2 filled as cells B2:AMJ2 (LibreOffice writes whole-row formatting like this) gives **10 x 1024**, plus 1,023 `style:` keys.
- Fix: grow only through contiguous styled lines next to the values. Stop at the first gap of more than a few empty rows or columns, and report the rest as dropped. Also fold a run of one `s` that ends at the sheet's last column (1024 or 16384) into a row style rather than keeping it as cells.

## 2. Medium-high: row and column styles past the last value are lost silently, including this commit's own export
`sheet-xlsx.js:198-199` keeps `colStyles`/`rowStyles` only for `c < tab.cols` / `r < tab.rows`. `reach` (`xlsx-styles.js:98-101`) counts only `<c>` cells, never `<row s customFormat>` or `<col style>`, and nothing is added to `dropped`.
This commit now writes line styles only on `<col>`/`<row>`, so a sheet's own round trip loses them.
- Ran: look `{"style:2":"i bt"}` or `{"style:C":"f=blue","height:2":40}` on a 4x3 grid whose only value is A1. Export, then import, gives a 1x1 tab with no styles or heights and `dropped: {}`.
- Ran: crafted `<row r="5" s=fill customFormat="1"/>`, and `<col min="4" max="4" style=fill>` with values only in A1. Both are lost and not counted.
- Fix: in `sheetStyles`, add rows with a seen row style to `reach.rows`. Add columns with a seen column style to `reach.cols`, except a run that reaches column 16384 (a whole-sheet style, which must not grow the tab). Count the lines still outside the tab (and their heights) in `dropped`.

## 3. Medium: growth is all-or-nothing
`sheet-xlsx.js:103`: if the full bounding box does not fit, the tab does not grow at all.
- Ran: values in A1:D10 with a filled band A11:D11 grows to 11x4 and keeps the band. Add a stray filled cell at Z60000 (60000x26 is over SHEET_LIMIT): the tab stays 10x4 and the band is dropped too (`styled cells past the tab's last value: 5`).
- Fix: clamp growth to what fits (the limits and `room`) rather than skipping it. With the fix in item 1, this mostly goes away.

## 4. Low-medium: height import drops real custom heights, including the sheet's own
`xlsx-styles.js:94-97`: only `ht > 1.25 x defaultRowHeight` (18.75pt) is kept.
- Ran: `<row ht="16.5" customHeight="1">` is not imported. Exporting a sheet row of 21-25 px writes 15.75-18.75pt, which is lost when the file is read back.
- `defaultRowHeight` with `customHeight="1"` on `<sheetFormatPr>` (a whole sheet with taller rows) is never imported as the default.
- Fix: import every row with `customHeight="1"` whose `ht` differs from the default. Keep the 1.25x threshold only for rows without `customHeight` (heights Excel sized to fit the text).

## 5. Low: a row and column crossing outside `size` is written as the row style only
`xlsx-styles.js:154-160` writes the cell where a row and column cross (merged) only within `size`. A `style:N` row past `typed.length`, crossing a styled column, gets no `<c>`. Excel then shows the row's style alone, while the sheet shows row over column, attribute by attribute (col bold + row 9 fill: Excel shows A9 not bold).
- Fix: for every row in `across`, write `<c>` at each column in `cols` whose merged style differs from the row's, whether or not it is inside `size`.

## 6. Low: one `<col>` per styled column
`xlsx-styles.js:162-165`. A 16k-column tab (see item 1) writes 16k `<col>` elements. The file is valid but bloated.
- Fix: join adjacent columns with the same rest and style into one `min..max` element.

## 7. Low, existed before this commit: cells without `r` first, or without `r` at all, are not seen
`xlsx-styles.js:99` and `:149` match `<c r="..."` only. `r` is optional in the schema, and attribute order is free (`<c s="1" r="A1">`), so such cells' styles are ignored and, on export, their `s` is not rewritten.

## 8. Note: foreign colours are mapped to inks
`xlsx-styles.js:46` (`inkOf`). Any workbook's font `#C00000` (Excel's standard "Dark Red") or fill `#DDEBF7` becomes the theme ink, drawn the theme's own way. The comment says Excel's Bad/Neutral/Good, but Bad's font is `9C0006`, so the Bad cell style comes in as ink-red fill with hex text. This is accepted behaviour, recorded so it is deliberate.

## Checked and found correct (ran)
- `<cols>` is placed before `<sheetData>` (replaced in place, or inserted right before it). Elements are one per column, 1-based, sorted, never overlapping. A column styled past SheetJS's `<cols>` gets `width="9.140625"`.
- `<row>`: `s` and `customFormat="1"` are appended once (SheetJS writes no `s`), alongside `ht`/`customHeight`. Rows are sorted, and cells are in column order within each row.
- Export precedence: a cell with a value always carries a merged `s`, because a `<c>` without one would show style 0. An empty `<c>` is skipped only when its style equals the row's, else the column's. A row and column crossing gets a merged `<c>`. A cell's `-b` under a bold column is written as `s` 0 (plain).
- Import precedence: the cell's own over (row over column). A `<c>` without `s` under a styled line imports as explicit defaults (`-f`).
- A whole-column `<col min="1" max="16384" style>` does not grow the tab (1x1 stays 1x1). A stray cell at XFD1048576 or D1048576, or 60000x4 filled cells, is refused and counted.
- Height conversion: points to px (`ht/0.75`) and back (`hpt = px*0.75`) round-trips (40pt to 53px to 39.75pt).
- Upper-case hex: `f=#00FF00` reads back as `#00ff00`. The `HEAVY` rewrite matches the old mapping. Decoding the sheet XML without a copy works on the Buffer views CFB returns.
