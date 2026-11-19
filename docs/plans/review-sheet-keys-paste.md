# Review: sheet keys, paste and merge commits (570f4bcca..817ccf2b9)

Read-only review. Line numbers are at 817ccf2b9 (`git show HEAD:<file>`); another session has uncommitted edits in grid.ts/sheet.tsx.
RAN = reproduced with a Node script in the scratchpad (pure functions, no browser). READ = from the code only.

11. **A merge question held by ids can come back upside down** (sheet.tsx:103). If a sort runs while the confirm is open, the top corner's row
    can now sit below the bottom one. `found` is not normalised, so `made`/`save` store corners that `rangedArea` reads as null: the merge
    silently does nothing, and Merge & Center calls styles.set on an inverted range. READ. Fix: take min/max, or give up when the order flipped.

Checked and fine: Ctrl+- and the border keys don't fire from the cell or bar editor (outside the island); Alt+= starts no Alt sequence;
Ctrl+Shift+_ goes to styles.key first; the grid's own Ctrl+V decodes quoting via text/html; the row-1 inset and the height cap look right.
