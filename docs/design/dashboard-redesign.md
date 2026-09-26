# Dashboards

How the Conduit, project and workspace dashboards work, what any change must
keep, and the one piece still to build. `DESIGN.md` has the visual language
and the composition; harness dashboards are designed separately. The
sketches are in `docs/design/dashboard-layout/` and
`docs/design/conduit-home-dashboard/`.

## How they work

- **One layout** (`dashboard/primitives/split.tsx`): a header with a line of
  context and text shortcuts; the composer with the chats list under it on
  the left; places and state on the right. One column on a narrow pane; on a
  phone the shortcuts are large targets and the composer docks at the foot.
- **The Conduit dashboard is the new-chat screen.** New chat without a place
  of its own lands here with the composer focused. Its right column is the
  folder shelf (project folders as folders), then Workspaces and Terminals.
- **Project and workspace dashboards** show Terminals (workspace) and
  Changes when the tree is dirty, else the folder's recent files. Manage
  actions sit behind the header's ⋯.
- **The chats heading is the same everywhere** (`primitives/chat-list.tsx`):
  - Left: Recent chats / Unread. A workspace adds Conduit chats / Not in
    Conduit beside it, remembered per workspace.
  - Right, in order: the Profile filter, the sort menu (Latest activity /
    Created), search scoped to where you are. On Not in Conduit the harness
    filter replaces the profile and sort menus.
  - Rows are grouped by day as the search overlay groups them, 40 at a time
    with Show more. A running chat stays in the list, its dot and activity
    saying so. Not in Conduit threads open in the harness's Drive view,
    untracked.
- **The composer's place.** A folder button beside attach (on a phone, the
  plus menu's Project row) moves the open chat, draft or not, into a project
  or workspace, and shows that place's own mark once it has one.
- Empty lists read "Nothing here yet." with no action of their own: the
  sidebar already holds the ways to start something.

## What a change must keep

- **The first open.** Only the frame shows until the page is laid out; then
  the composer is simply there and everything around it fades in, once
  (`DESIGN.md`, Motion). Anything that shapes the layout is in place first.
- **Sending from a dashboard.** The message goes at once; the dashboard
  leaves (~200ms) and the chat arrives with its composer travelling from the
  dashboard's spot to the foot in one move (`sendFromDashboard`, `main.tsx`).
- **Entering the page.** Opening a dashboard from the sidebar, Ctrl+Shift+2,
  or a route change that drops focus puts focus in its composer. Opening the
  Conduit dashboard while on it changes nothing.

## To build: keyboard

Move like the sidebar (`navigation/sidebar-cursor.ts`) rather than growing
keys of its own, ideally by making its cursor a shared list cursor that takes
a region and its rows:

- The cursor is the wash alone, one row at a time, no focus ring; pointer
  and keyboard move the same cursor.
- In the chats list ↑/↓ and Home/End move through rows across day headings;
  Enter opens; Menu or Shift+F10 opens the row's menu; Esc returns to the
  composer.
- Tab moves between the chats list and each group of the right column, where
  ↑/↓ stay within the group; the folder shelf moves with ←/→ as well.
- Its region is in the context tree and its keys show in the leader.
- Reduced motion and the phone layout behave.
