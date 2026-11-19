# Panes and the dock

The model is DESIGN.md's "Places and panes", "Focus and opening" and "Tabs" (commit c97c298ee). This file is the
migration to it; delete each step when it lands. Old links and stored layouts may break.

Decided with the user (2026-11-15): two places (row; dock, one pane plus summons); session panes (chats,
terminals, jbot's log, mixed tabs) and document panes (one artifact, mail, browser or folder viewer, no tabs); plain
replaces any pane (Undo notice, no dialog), Ctrl adds a session tab, Alt opens beside; pane undo and redo (own
commands, Ctrl+Alt+Z / Ctrl+Alt+Shift+Z by default); summons are jbot, Files, a terminal (the focused workspace's
last, else new); the folder viewer follows focus in the dock and keeps its workspace in the row; Files and Changes are
its modes; room runs out into a "more panes" control; beside/over stays one setting on the rail foot (two states);
the dock's Chat tool goes. Phone unchanged in this pass.

## Why the order

Today pane A follows the route (`paneARouteView`, `openInPaneA`, `paneAOverride`) while slots follow views; tabs are
inferred from view changes (`reconcileTabs`, `keepNext`) with no stored active tab; modifiers are read off
`window.event` after awaits; `openBeside` is four verbs. Undo, the verbs and the dock all need one stored model first.

## Steps

Steps 1-3 (store, main.tsx on it, verbs and undo) landed; follow-ups are in `panes-handoff.md`.

4. **The dock as one slot plus summons**: remove docked slots (`dockedSlots`, `dockSlot`, `dock=`, `docked-1..3`,
   rail docked buttons), tool splits (`file`, `shell:`, tool in pane A, `splitHost`, `bindSplit`), the dock's tab strip
   and Chat tool; summons for jbot, Files, terminal; overflow becomes the row's "more panes" control.
5. **Folder viewer**: one document kind, tree plus file, Files | Changes modes; replaces FilesView, SourceControlView
   and FileBesideView. File document columns and tabs (`ftabs`, `file-tabs.ts`) have been removed; documents stand alone.
6. **Rail foot**: the beside/over button shows both states; `smoke:panes` rewritten to the new rules.

Checks per step: typecheck, `npm run smoke:panes` (rewritten in step 6; until then expect its tab and column
scenarios to fail and say which), headed look in a tab of its own.
