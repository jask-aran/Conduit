# Review: sheet keys, paste and merge commits (570f4bcca..817ccf2b9)

Read-only review. Line numbers are at 817ccf2b9 (`git show HEAD:<file>`); another session has uncommitted edits in grid.ts/sheet.tsx.
RAN = reproduced with a Node script in the scratchpad (pure functions, no browser). READ = from the code only.

1. **Ctrl+- / Ctrl+Shift+= take whole columns covering every tab column for whole rows** (sheet.tsx:383). The `rows` test runs first and
   only compares the area with the tab's size. On a new tab (8 columns) or a narrow CSV, picking columns A:H (or Ctrl+A) and pressing Ctrl+-
   deletes every row instead of the columns. Ctrl+Shift+= inserts `bottom+1` rows, about 100, because a column pick runs to the grid's spare
   room. On a 1-column CSV, Ctrl+- on any single cell deletes its row, where Ctrl+- used to be "Smaller interface". Dragging a block across
   all columns (A2:H5) deletes those rows with no prompt. READ.
   Fix: ask the grid what kind of pick it is (owner.current.columns/rows length, exposed on SheetGrid) and do nothing for a plain block.

2. **Paste moves every line by the first line's offset, so formulas are wrong when hidden rows are involved** (grid.ts:510-512).
   `copied` and the paste both skip hidden rows, but `moved` uses one delta (`top - copied.top`). With row 2 filtered out, copy A1:A3, where
   A3 holds `=B3`, then paste at A10. The second line lands on row 11 as `=B12`; a spreadsheet gives `=B11`. The same happens when the
   target range has hidden rows. Copying visible rows from a filter is the common case. RAN (`shiftRefs("=B3", 9, 0)` gives `=B12`).
   Fix: keep each copied line's source row, and shift each line by (the row it lands on − its source row).

3. **Ctrl+Shift+V and "Paste values" paste an old grid copy, not what is on the clipboard** (grid.ts:274, 508; sheet.tsx:416).
   `copied` only changes on a copy or cut event while the grid has focus. These leave it unchanged: copying in another app, in the formula
   editor or in chat, and the context menu's Copy and Cut (`navigator.clipboard.writeText` fires no copy event). So: Ctrl+C on A1:B2, then
   menu Copy on D9 (or copy a word in Notepad), then Ctrl+Shift+V pastes A1:B2's values. READ.
   Fix: on Ctrl+Shift+V, read the clipboard and use `copied.values` only when the clipboard text equals `copied.text`. Clear `copied` on any
   copy event outside the grid, and in the menu's copy().

4. **The menu's Paste does not undo the grid's TSV quoting** (sheet.tsx:332). The grid quotes any cell holding `"`, a tab or a newline. For
   example `=IF(A1>0,"yes","no")` is put on the clipboard as `"=IF(A1>0,""yes"",""no"")"`. The menu splits the raw text, so the cell gets that
   quoted text literally (a string, no longer a formula). The quoted cell also makes the `same` check fail, so the line's other formulas are
   not moved. RAN (simulated the grid's escape and paste()). The raw split was already there; the new reference moving inherits it.
   Fix: parse TSV quotes (glide exports `unquote` from data-editor-fns), or read `text/html` with `navigator.clipboard.read()`.

5. **"Clear sheet's rules" leaves the dialog in edit mode** (rules.tsx:154). It calls onClose without `setEditing(null)`, and the dialog stays
   mounted. Steps: Edit rule 1, then Clear sheet's rules, then open the dialog for a new rule. It is titled "Edit formatting rule", and Save
   calls `change(0, …)` on an empty list, which returns without adding the rule. READ. Fix: clear `editing` in that button, or whenever
   `props.area` changes.

6. **Editing a rule drops its stopIfTrue** (rules.tsx:91 with :122). `rule()` has no `stop`, and `change` replaces the whole rule, so an
   imported rule with `stop: true` loses it on Save. READ. Fix: `{ ...was, ...rule(), ranges, anchor }`, or keep `stop` in the form.
   Related, low: clicking Up while editing ends editing but keeps the form filled, so Save then adds a duplicate as a new rule.
   The undo label for an edit is "Conditional formatting", the same as for an add.

7. **Ctrl+- / Ctrl+Shift+= on a cell block now zooms the browser** (sheet.tsx:384 plus `OWN_KEYS`). `data-own-keys` keeps primary+Minus
   from the app's "Smaller interface". When the pick is not whole rows or columns, the handler returns without preventDefault, so Chrome or
   WebView2 zooms the page out (and in, for Ctrl+Shift+=). Ctrl+= still runs the app's "Bigger interface". READ. Fix: preventDefault (no-op)
   or hand the key to the app command when the grid does nothing with it.

8. **An Undo pressed during a slow hub op can fire up to 30 s later on a newer step** (history.ts:58, 77). `walk` is queued while `out > 0`,
   then runs `um.undo()` on whatever is newest. Steps: start a sort the hub is slow to answer, press Ctrl+Z (nothing happens), type in a
   cell. When the reply comes, the Undo removes the typing, not the sort. The commit tripled that window. READ. Fix: queue only the step the
   Undo was aimed at, and drop the queued walk if a new step is added meanwhile (or show that Undo is waiting).

9. **Paste values types values back in as input** (grid.ts:500). A text result such as `=TEXT(A1,"00000")` → `00123` is pasted as the number
   123, and a text result that starts with `=` becomes a live formula. READ (assumes input guessing as `guess` does). Fix: carry the value's
   type and write text that looks like a number or formula as text, in whatever way the sheet stores a forced-text input.

10. **shiftRefs edge cases** (sheet-rules.js:129). RAN. Whole-column and whole-row references (`SUM(A:A)`, `SUM(1:1)`) never move (Excel moves
    the relative ones). A range half off the top becomes `SUM(#REF!:A4)` instead of `#REF!`. Moving past XFD writes `XFE1`. These cases came out
    correct: `$` refs, Data!B2, 'Q1 2024'!B2, 'Bob''s'!A1, strings with `'`, LOG10(, R1C1, 1E5 and Q1!A1.
11. **A merge question held by ids can come back upside down** (sheet.tsx:103). If a sort runs while the confirm is open, the top corner's row
    can now sit below the bottom one. `found` is not normalised, so `made`/`save` store corners that `rangedArea` reads as null: the merge
    silently does nothing, and Merge & Center calls styles.set on an inverted range. READ. Fix: take min/max, or give up when the order flipped.

12. **The hub refuses an empty `set` on a merge's hidden cell** (server/sheets.js:454). The comment says emptying one goes through, and
    writeCells lets it, but the `set` check throws whatever the value, so an agent cannot clear a stray value left under a merge. READ.
    Fix: `op === "set" && text(value) && hiddenUnder(...)`.
13. **xlsx: `customFormat="true"` is still not read** (server/xlsx-styles.js:99), the same flaw the commit fixed for customHeight and
    stopIfTrue (and `auto="true"` at :37). READ.

Checked and fine: Ctrl+- and the border keys don't fire from the cell or bar editor (outside the island); Alt+= starts no Alt sequence;
Ctrl+Shift+_ goes to styles.key first; the grid's own Ctrl+V decodes quoting via text/html; the row-1 inset and the height cap look right.
