# Handoff: panes, dock, DeX (2026-11-15)

For the next agent. The model is DESIGN.md "Places and panes", "Focus and opening", "Tabs"; the steps are
`panes-and-dock.md` beside this file. Delete this file once its open items are done.

## Working rules the user set this session

- Builders may work in worktrees; the parent cherry-picks their commits onto `main` in /home/jask/Conduit, runs
  `bash scripts/start-conduit.sh restart` (check exit code; output ending at "Web tools:" means it failed and the
  old build still runs), then `cd conduit-web && npm run smoke:panes -- --project Japan` (13 scenarios; after branch `panes-smoke` is merged, 11 pass and 2 skip is expected, not yet run).
- Briefs small: one landable chunk, well under ~30 minutes; parallel builders only on disjoint files. Everything
  in `src/client/main.tsx` is one file, so pane chunks go one after another.
- Commit only own files (`git commit -- <paths>`); other sessions commit sheet work on main at the same time. No push.
- Old links and stored layouts may break. Dashboard and project pages are session views (decided).

## Where it stands

- Landed on main: DESIGN.md model (`c97c298ee`), plan (`4d2b264aa`), the pure store
  `conduit-web/src/client/panes/pane-store.ts` (`b22750d73`), every pane on that store (`a4f4c5f4c`): verbs through
  `openView(view, { beside, tab })` with modifiers read once by `verbNow()`, `panes=` address, `main-layout`
  storage key, Undo/Redo pane change (Ctrl+Alt+Z / Ctrl+Alt+Shift+Z), "Closed N tabs" notice with Undo.
- `76010fa44`: opening an artifact through `openView` left the pane `data-pending` (hidden) forever, because `gate`
  marked it arriving and nothing cleared it. This was the user's "sheet or paper sits on opening for ages". `gate`
  now calls `leaves(pane)` when it passes. Verified in Chrome on :4310 (below) and by a builder at 6x CPU; not yet seen on the
  phone.
- `9698a03ea`: overlay scrollbars show for any fine pointer (`any-pointer: fine`), for a mouse in Samsung DeX.

## Checking in Chrome :9222

A new tab there is served the previous client by the service worker (`sw.js`) after a restart; set CDP
`Network.setBypassServiceWorker` (or reload twice) before judging a fix. Opening timed 2026-11-15 on :4310: sheet
539 ms, paper 576 ms from a project page.

## Open items

1. Landed (`57274bdd4`, `e0fd7908a`): docking shows the docked pane at once, docking over a held pane gates
   unsaved edits, Ctrl from a document pane joins the nearest session pane (store `openRules`), focus kept on the
   paper/thread switch, old-model leftovers removed. Not run: Ctrl-opening jbot, jbot in a side pane.
2. Landed (`896bb060f`): closing the shown tab goes to the one shown before it (`Pane.recent`); a tab past five is
   refused with the old notice when every tab holds a draft. Not clicked through in the browser.
3. Added `test/pane-store.test.js`: Ctrl/Alt, document uniqueness, draft retention, recent-tab close/eviction,
   dock/summon URL round-trip, undo/redo. Paid for by consolidating test-stream assertions and its reader fixture.
4. Summons (`Layout.summon`) drive desktop Files/terminal/jbot and survive reload; dismiss restores the dock's held
   pane. File documents hold one file and have no tabs; `file-tabs.ts` became `panes/pane-drop.ts`.
5. The folder viewer (`workspace/folder-viewer.tsx`): `createFolderViewer` holds a tree, its one open file and the
   workspace's changes; `FolderView` draws both modes kept mounted (`ToolKept`), so Files ↔ Changes keeps the tree,
   the open file and its edit; `FolderModes` is the Files | Changes switch. Two hosts: the dock (the Files summon,
   following the focused pane's workspace, its mode the dock's `files`/`diff` tab so the phone strip still picks it)
   and a row pane, view `folder:<project>` (`FolderPane`, lazy, keeping its workspace; mode not kept over reload).
   In the tree plain opens in the viewer; Alt, Ctrl and Open beside open a `files:` document pane (Alt on a change
   opens it `@changes`/`@staged`). The dock's header "Move to a pane" and dragging that header (`data-doc-view`)
   take the viewer to the row and dismiss the summon; the rail's Files drags as `tool:files`. Agents' `files` and
   `terminal` views become `folder:<focused workspace>` and a `term:` in the bridge. Tool splits are gone (`file`,
   `shell:`, panel tabs as pane views, `splitHost`, `bindSplit`, `FileBesideView`, `TOOL_DRAG_TYPE`, Files'
   navigator-only mode, the second file slot). Pane B's thread header names its project (`side.project()`), as pane A.
   `FilesView` and `SourceControlView` remain only as the two modes' bodies. A narrow viewer (the dock) shows its tree
   while no file is open and folds it after a plain open, as Files did on the phone, leaving the keyboard on the
   page body: a feel question for the owner. Walked headless 2026-11-20 (`smoke:panes` covers it). An unsaved edit
   is never dropped unasked: the dock viewer stays drawn under other tools and summons; while its file has an edit
   the dock keeps that workspace (`dockPlace` in main.tsx) instead of following focus, since a click giving focus is
   no change to ask about; "Move to a pane" and dragging the header carry the open file (its `folder:` scope's
   `file`) and the edit (`carryDraft`, taken by the pane's file slot), unless a folder pane for that workspace is
   open already. Not walked in a browser yet. Open: Alt in a pane's folder viewer leaves the keyboard on the page body,
   not where it was (cause unmeasured); Files → Changes → Files with an edit is unwalked (Japan has no Changes).
   Left of plan step 4: see `panes-and-dock.md`.
6. DeX (user's Samsung S936B, wireless adb, `ANDROID_SERIAL=192.168.20.244:37125`):
   - On-screen keyboard with a physical keyboard is Samsung's setting `show_ime_with_hard_keyboard=1`, not the app.
   - Dragging handles "isn't good" in DeX: cause unmeasured (DeX wasn't attached). Suspect: tab/header/sidebar drags
     use HTML5 drag and drop (`onDocDragStart` in main.tsx sets only `application/x-conduit-doc`), which Android
     WebView may not start for a mouse. When DeX is attached, read over the WebView devtools socket
     (`adb shell cat /proc/net/unix | grep devtools`, `adb forward`) `matchMedia('(pointer: coarse)')`,
     `(any-pointer: fine)`, a mouse pointerdown's `pointerType`, `innerWidth`, and whether `dragstart` fires.
     Read only; don't tap or type on the phone.
7. A probe session minted by a builder, `/N0JcoUs` (label `artifact-open-probe`), is still signed in; the auth hook
   blocked the agent from revoking it, so it is the user's call.
