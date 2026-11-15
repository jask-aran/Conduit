# Sheet conditional formatting: resume note (builder, not tracked; don't git-add)

Goal: Excel cell-value (cellIs) and expression ("formula is") rules per tab: model in look, drawn, xlsx in/out, a small dialog, Alt H L.

## Design
- Look key `rules:<tabId>` → JSON array, highest priority first:
  `{ ranges: [[fromKey, toKey], ...], anchor: "B5", kind: "value"|"formula", op?: ">"|"<"|">="|"<="|"="|"<>"|"between"|"notBetween", a: "0", b?: "...", style: "c=#9c0006 f=... b i s" }`.
  `a`/`b`/formula: Excel formula text without `=`; relative refs are relative to `anchor` (the A1 the text was written at), so a
  range that moves keeps meaning (target row = cell row + R - anchorRow).
- sheet.json (lookOf/restoreLook in server/sheets.js): `rules: [{ ranges: "B5 B29:O29", kind, op, a, b, style }]`, formulas rebased
  to the ranges' current top-left (bounding box), anchor dropped.
- Page: components/sheet/rules.ts parses formulas with its own small evaluator (engine is in a worker; SheetView has only values):
  AND OR NOT IF ISNUMBER ISTEXT ISBLANK ISERROR ABS ROUND MOD SUM MIN MAX AVERAGE COUNT, refs/ranges on the same tab. Formula results
  cached per cell, cleared on every model change; `wide()` says a change must redraw the whole grid.
- Hook: sheet.tsx `style: (row, col) => rules.style(filters.style(...), row, col)` (not cell-draw.ts: fill/ink flow through the theme map there by style identity).

## Files / status
- [x] src/sheet-rules.js + .d.ts (NEW, shared): evaluator (compileFormula/compileRule), shiftRefs, readRules, ruleAreas, rulesA1/rulesIds.
- [x] server/sheets.js: import; lookOf/restoreLook `rules` branch; keepCorners refactored to a `moved()` helper, also moves rule ranges on delete.
- [x] server/xlsx-styles.js: appended readDxfs, sheetRules (import, `unread` by type), writeRules, withDxfs, withRules.
- [x] server/sheet-xlsx.js: stylesXml/themeXml split, dxfs read, rules into look.rules, dropped counts only unread kinds; export gated on rules too.
- [x] verify: /tmp/claude-1000/cf/verify.mjs budget.xlsx → out.xlsx; read.py via openpyxl: 6 rules round-trip, dropped has no CF.
- [ ] components/sheet/rules.tsx (page: cache, style overlay, dialog)
- [ ] sheet.tsx hooks (style, onChange, menu row, dialog)
- [ ] sequences.tsx Alt H L
- [ ] typecheck, raise sourceLines

## Gotchas
- Budget dxf solid fill colour is in `bgColor` (dxf quirk), fgColor indexed=64.
- Schema order: conditionalFormatting after mergeCells/phoneticPr, before dataValidations/hyperlinks/printOptions/pageMargins/...
