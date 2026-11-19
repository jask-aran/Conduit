# Review: sheet keys, paste and merge commits (570f4bcca..817ccf2b9)

Read-only review. Line numbers are at 817ccf2b9 (`git show HEAD:<file>`); another session has uncommitted edits in grid.ts/sheet.tsx.
RAN = reproduced with a Node script in the scratchpad (pure functions, no browser). READ = from the code only.

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

Checked and fine: Ctrl+- and the border keys don't fire from the cell or bar editor (outside the island); Alt+= starts no Alt sequence;
Ctrl+Shift+_ goes to styles.key first; the grid's own Ctrl+V decodes quoting via text/html; the row-1 inset and the height cap look right.
