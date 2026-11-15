# Handoff: sheet fill-handle series (AutoFill)

Goal: dragging the fill handle fills Excel's series (numbers by trend, "Item 1" counting, month/weekday names cycling,
dates by day/month/year, backwards when filling up/left, per-run patterns in a mixed source; Ctrl+drag on one number counts by 1).
Formulas keep the hub's moved-reference behaviour.

## Design (chosen)
- Pure module `conduit-web/src/components/sheet/series.ts`: one line (a row or column of the source) in, N values after it out.
  Backwards = reverse the line, continue, reverse. Source split into runs of one kind (Excel's per-cell behaviour).
- Client computes literal values (grid.ts `onFillPattern`) and sends the whole destination as `values` of the `fill` op.
- Hub change (src/server/sheets.js `filled`): optional `from` (A1 range of the source on the same tab). With it, formula cells in
  `values` are moved by HyperFormula's getFillRangeData from the source block (room's own inputs) instead of being placed at range.top.
  Without `from`, the op behaves as before (paste, Ctrl+D/R, agents' fill).
- Date detection: `formats.dated(row, col)` (formats.ts) -> `SheetColumns.dated` (grid.ts type, wired in sheet.tsx columns object).
- Ctrl while dragging: grid tracks ctrlKey from window pointer/key events.

## Files / status
- [ ] series.ts (new)
- [ ] grid.ts onFillPattern + SheetColumns.dated + ctrl tracking
- [ ] formats.ts dated
- [ ] sheet.tsx: `dated: formats.dated` in columns, `from` passed through events.fill (host.ts SheetGridEvents.fill signature?)
- [ ] sheets.js `from`
- [ ] scratch script verify: scratchpad series-check.mjs (run with node --experimental-strip-types)
- [ ] typecheck; sourceLines in scripts/check-conventions.mjs

## Gotchas
- Glide's fillDestination includes the source. Fill doesn't copy number formats (dates land as serials in unformatted cells) - existing gap.
- Hidden rows: grid fills each run of shown rows separately; series positions count drawn rows.
