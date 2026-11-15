# Sheet conditional formatting: resume note (builder, not tracked; don't git-add)

Goal: Excel cell-value (cellIs) and expression ("formula is") rules per tab: model in look, drawn, xlsx in/out, a small dialog, Alt H L.

## Design
- Look key `rules:<tabId>` → JSON array, highest priority first:
  `{ ranges: [[fromKey, toKey], ...], anchor: "B5", kind: "value"|"formula", op?, a: "0", b?, style: "c=#9c0006 f=... b i s", stop? }`.
  Relative refs in `a`/`b` are relative to `anchor`. sheet.json uses A1 ranges (`rulesA1`/`rulesIds` in src/sheet-rules.js).
- Page: components/sheet/rules.tsx. `createRuleStyles(text, model)` (pure, no Solid): rules compiled once per look text + tab id; each cell's
  matches cached by row×COL_LIMIT+col until `changed()`; laid styles cached per (base style object, match set) so the grid's theme map sees stable
  identities. Of two matching rules that set the same attribute the higher wins; a `stop` rule that holds ends the list for that cell.
- sheet.tsx: `style: rules.style(filters.style(styles.at(..)))`; in `sheet.onChange`, `rules.changed()` then `update(rules.wide() ? null : cells)`
  (wide = some rule's formula reads cells; a value rule with constant operands only depends on its own cell, which `cells` already redraws).
  Look changes already redraw everything (`restyled`).

## Files / status
- [x] src/sheet-rules.js + .d.ts, server/sheets.js, xlsx import/export (earlier commits).
- [x] components/sheet/rules.tsx: drawing (createRuleStyles, layStyle), createSheetRules (add/clear/count), RulePrompt dialog.
- [x] sheet.tsx hooks (style, onChange, RulePrompt, `rules` in the sequence context); sequences.tsx `HL` → dialog.
- [x] typecheck + conventions clean (no sourceLines raise needed).
- [x] node check: scratchpad rules-check.ts (bundled by stub-plugin.mjs, ui pieces stubbed) — priority, stop, between, errors, anchors, cache.
- [ ] Browser check on :4310 after a restart (not done: restart not allowed for the builder).
- [ ] Dialog is minimal: new rule on the selection only, Excel's presets for the look, "Clear sheet's rules". No list/edit/reorder of rules,
  no "clear from selection", no context-menu row. Form keeps its last values between openings.

## Gotchas
- `.tsx` generic arrows need `<T,>`.
- `matched` grows with every cell drawn between changes (bounded by cells visited); fine so far.
- Budget dxf solid fill colour is in `bgColor` (dxf quirk), fgColor indexed=64.
- Schema order: conditionalFormatting after mergeCells/phoneticPr, before dataValidations/hyperlinks/printOptions/pageMargins/...
