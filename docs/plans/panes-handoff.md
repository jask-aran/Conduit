# Handoff: panes, dock, DeX (2026-11-15)

For the next agent. The model is DESIGN.md "Places and panes", "Focus and opening", "Tabs"; the steps are
`panes-and-dock.md` beside this file. Delete this file once its open items are done.

## Working rules the user set this session

- Builders may work in worktrees; the parent cherry-picks their commits onto `main` in /home/jask/Conduit, runs
  `bash scripts/start-conduit.sh restart` (check exit code; output ending at "Web tools:" means it failed and the
  old build still runs), then `cd conduit-web && npm run smoke:panes -- --project Japan` (8/8 expected).
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
   paper/thread switch, old-model leftovers removed. Unfixed: a thread's header names its place "Chats" in pane B but
   the project in pane A. Not run: Ctrl-opening jbot, jbot in a side pane.
2. Landed (`896bb060f`): closing the shown tab goes to the one shown before it (`Pane.recent`); a tab past five is
   refused with the old notice when every tab holds a draft. Not clicked through in the browser.
3. A pure test for the store's verbs, paid for by removing more test lines than it adds (`budgets.json`).
4. Plan steps 4-6: the dock as one slot plus summons (jbot, Files, terminal), the folder viewer (Files | Changes,
   replacing FilesView/SourceControlView/file columns/`ftabs`), the rail foot button's two states, smoke rewritten.
5. DeX (user's Samsung S936B, wireless adb, `ANDROID_SERIAL=192.168.20.244:37125`):
   - On-screen keyboard with a physical keyboard is Samsung's setting `show_ime_with_hard_keyboard=1`, not the app.
   - Dragging handles "isn't good" in DeX: cause unmeasured (DeX wasn't attached). Suspect: tab/header/sidebar drags
     use HTML5 drag and drop (`onDocDragStart` in main.tsx sets only `application/x-conduit-doc`), which Android
     WebView may not start for a mouse. When DeX is attached, read over the WebView devtools socket
     (`adb shell cat /proc/net/unix | grep devtools`, `adb forward`) `matchMedia('(pointer: coarse)')`,
     `(any-pointer: fine)`, a mouse pointerdown's `pointerType`, `innerWidth`, and whether `dragstart` fires.
     Read only; don't tap or type on the phone.
6. A probe session minted by a builder, `/N0JcoUs` (label `artifact-open-probe`), is still signed in; the auth hook
   blocked the agent from revoking it, so it is the user's call.
