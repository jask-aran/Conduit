# Review: sheet keys, paste and merge commits (570f4bcca..817ccf2b9)

Read-only review. Line numbers are at 817ccf2b9 (`git show HEAD:<file>`); another session has uncommitted edits in grid.ts/sheet.tsx.
RAN = reproduced with a Node script in the scratchpad (pure functions, no browser). READ = from the code only.

10. **shiftRefs edge cases** (sheet-rules.js:129). RAN. Whole-column and whole-row references (`SUM(A:A)`, `SUM(1:1)`) never move (Excel moves
    the relative ones). A range half off the top becomes `SUM(#REF!:A4)` instead of `#REF!`. Moving past XFD writes `XFE1`. These cases came out
    correct: `$` refs, Data!B2, 'Q1 2024'!B2, 'Bob''s'!A1, strings with `'`, LOG10(, R1C1, 1E5 and Q1!A1.

11. **A merge question held by ids can come back upside down** (sheet.tsx:103). If a sort runs while the confirm is open, the top corner's row
    can now sit below the bottom one. `found` is not normalised, so `made`/`save` store corners that `rangedArea` reads as null: the merge
    silently does nothing, and Merge & Center calls styles.set on an inverted range. READ. Fix: take min/max, or give up when the order flipped.

Checked and fine: Ctrl+- and the border keys don't fire from the cell or bar editor (outside the island); Alt+= starts no Alt sequence;
Ctrl+Shift+_ goes to styles.key first; the grid's own Ctrl+V decodes quoting via text/html; the row-1 inset and the height cap look right.
