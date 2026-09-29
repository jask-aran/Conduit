# The dock, the rail and main-pane splits

> **Status (2026-09-28): stages 0 to 4 built; stage 5 (equal panes) next.** Rules this produces move
> into `DESIGN.md` as each stage lands; this file stays the plan and is
> deleted once the last stage is built.

## Decision

Keep the workspace panel, as the **dock**: the place tools open by default,
on the right. A **rail** of icons on the right edge opens it. The dock's
tools -- Files, Source Control, Chat review, Terminal -- are views that can
also be **dragged into the main pane**, where they take one side of a
**main-pane split**. The main pane splits in two, so a chat can sit beside a
file, a file beside a file, and later a chat beside a chat, while the dock
stays the quick place a tool opens without disturbing the chat.

## Why

Every pairing asked for so far -- chat and file, two files, two chats -- is
one view beside another. Today the only way to get two things side by side is
the panel itself, and it does it several unrelated ways:

- **Main pane and panel** are asymmetric. The main pane follows the route;
  the panel follows the open chat's place, with its own width, its own
  "expanded" mode that covers the main pane, and its own open state.
- **The panel splits itself.** Expanded, it shows two of its tabs side by side
  with their own gutter and ratio (`secondaryTab`, `splitRatio`).
- **Files split themselves again.** The Files tab holds two editor slots
  (`primary`, `secondary`) with a third gutter and ratio.
- **Some views live in several places.** The Computer page's file browser is
  the panel mounted with a `computer` scope; Terminal View is a route of its
  own.

The dock is worth keeping: a tool beside the chat, opened and closed from one
edge without rearranging anything, is the common case. What changes is that
the dock stops being the only place a tool can be.

The pieces are ready. Since stage 0 each tool is a component with its own
state owner that can mount anywhere. The chat state already runs twice: the
Computer page drives a harness thread on a second `createActiveChat` beside
the main one (`state/drive-chat.ts`). Keys already follow a tree of regions
that tracks focus, so a split side is one more region.

## The model

**Views.** A view is a kind plus what it shows:

| Kind | Shows | Lives in |
|---|---|---|
| Chat | a chat id (or a new-chat draft) | main pane |
| Page | the Conduit dashboard, a project or workspace page, Computer, a harness page | main pane |
| Files | a place's tree and an open file | dock, or a main-pane split |
| Source Control | a place's Git state and review | dock, or a main-pane split |
| Chat review | a chat's history and agent changes | dock, or a main-pane split |
| Terminal | a place's shells, or one terminal | dock, or a main-pane split |

**What a tool looks at.** Files, Source Control and Terminal belong to a
place; Chat review belongs to a chat. A tool is **attached** by default: it
looks at the place (or chat) of the main pane's chat or page and follows it,
as the panel does today. A tool opened for something specific -- a file link
from another project, "open terminal" on a project row -- is **pinned** to
that place until closed.

**The dock** shows one tool at a time, opened from the rail. It keeps its
width, its resize edge and maximise (today's "expanded", covering the main
pane). Its own two-pane split goes: two tools at once is a tool in the dock
and one in the main pane, or two in the main pane.

**The main pane** holds one view, or two side by side split by a gutter that
drags. The left side owns the URL; back and forward move it. The right side's
view and the ratio are remembered per device, as the panel's open state and
width are today. Minimum widths come from the views' own controls, measured,
never tuned (DESIGN.md, Do's); when the window cannot hold both sides and the
dock at their minimums, the dock gives way first, then the right side.

**Moving a tool.** A tool's header is its handle. Dragged from the dock onto
the main pane, it shows where it will land (the left or right half) and drops
into a split there; dragged from a split onto the dock, it docks. The same
moves are commands -- "Move to main pane", "Move to dock" -- in the tool's ⋯
and the leader, so nothing is drag-only.

## The rail

- **Where:** the right edge, on the frame (black) surface, mirroring the
  sidebar's collapsed rail: the same width, 14px icons, the tenth-of-size
  stroke, the same wash and current rules (DESIGN.md, Interaction).
- **What:** one icon per tool -- Files, Source Control, Chat review,
  Terminal. Source Control is disabled without a repository, as its tab is.
- **Behaviour:** an icon shows its tool where it is: in the dock by default,
  opening the dock; in its split if it has been moved into the main pane. The
  tool the dock shows is the current icon (white, the heavier stroke, no
  fill); a tool open in a split is marked open without being current.
  Pressing the current icon closes the dock. The rail replaces the header's
  panel toggle and the dock's tab strip.
- It is not a region of its own; its icons are reached from the dock.

## Surfaces and headers

- The dock and each side of a split are the grey pane surface with the main
  pane's corners, separated by the frame gutter, so side-by-side views read as
  sheets on the frame rather than one sheet divided.
- A Chat or Page keeps the header it has today. A tool's header, in the dock
  or a split, sits in the same row: the tool's name, its modes as the
  heading's segmented switch (Source Control's Changes / Review / Graph /
  Patch; Chat review's History / Agent changes), its ⋯ and close. Headers side
  by side share one line, as the sidebar and main header now do.
- The side with the keyboard is the current region: the composer, the leader
  and Esc resolve inside it first.

## Design language

Every stage builds to `DESIGN.md`; read it before each one. What it means here:

- **Surfaces.** The rail is frame. The dock and each split side are panes: no
  hairline boxes, one-line rows grouped by heading and space. Drop targets,
  menus and anything that floats while dragging are frost. Choose the surface
  before any colour, border or radius.
- **Interaction.** The rail, tool headers and every list in a tool follow the
  one grammar: grey at rest, the wash as the one cursor, the current item
  white and semibold (its icon at an eighth-of-size stroke) with no fill. No
  focus rings, outlines, coloured bars or blue: a drop target shows where a
  tool will land with the wash, not an outline or a tint.
- **Migrating the panel.** The workspace panel is on DESIGN.md's Being
  migrated list (hairline tiles and `outline: var(--ring)` focus rings). Each
  view moves to the pane language as it is touched in stage 1 or 2, and comes
  off that list once it is there.
- **Headers.** Tool headers follow Pane header and share the top line of the
  app: 14px icons centred on the breadcrumb's capitals. A mode switch is the
  Segmented choice and takes ↑ from its list's first row (Keyboard).
- **Breakpoints.** Side and dock minimums are measured from each view's
  controls; controls never squeeze, they draw together and then fold into a
  ⋯. DESIGN.md's "~420px" for the main pane becomes that measured minimum.
- **Motion.** The dock leaves toward the rail and returns from it; a tool
  moving between dock and split fades in where it lands rather than crossing
  the pane (A layout switch); a split side slides over its neighbour instead
  of squeezing it. Transform and opacity only, removed under reduced motion.
- **Held focus.** Each split side is a region, so it gets the held-focus line
  along its bottom like the dock does.
- **DESIGN.md changes with each stage.** Stage 1 rewrites its workspace panel
  lines (the "tiled split" in Layout, "the workspace panel's tabs" in
  Keyboard) for the dock and rail; stage 2 adds the split. Anything cut from
  DESIGN.md is confirmed first.

## Keyboard

- **Ctrl+Shift+1/2/3** stay sidebar, main pane, dock. In a split, 2 goes to
  the side last used, and a key moves between the sides.
- **Tool keys** (the leader's Files, Source Control, Chat, Terminal) show that
  tool where it is, as the rail does.
- **Open beside** (stage 3): a command, and Alt+click where it exists today,
  opens a file, diff, chat or terminal in the other side of the main pane.
- **Esc** from a tool goes to the main pane's composer, as from the panel.

## Phone

No splits and no drag. The dock stays a full-screen view over the chat, as
the panel is today. Nothing here commits the phone to more than that.

## Tabs: not now

The sidebar, chat search and the command palette already switch between
chats; tabs would repeat them and add the chrome the design language keeps
out. The dock and a two-way split answer the need, two things at once. If
tabs come later they are per side, after splits have been lived with.

*Superseded by stage 6:* splits were lived with, and tabs come per pane,
inside the pane's sheet.

## Stages

Each stage builds, ships and is usable before the next starts.

### 0. The views stand alone -- built

`workspace-panel.tsx` was one file of ~2,300 lines. Each view is now its own
component with a controller the panel creates, so its state survives the view
being hidden: `workspace-files.tsx`, `workspace-source-control.tsx`,
`workspace-chat-view.tsx`, `workspace-terminal-view.tsx`. Shared machinery is
`workspace-shared.ts` (the per-project request scope, the workspace cache)
and `workspace-poll.ts` (the change poll). The panel keeps its chrome and the
navigation between views. No visible change.

### 1. The rail and the dock -- built

- The rail on the right edge opens the dock on a tool. The dock's tab strip
  and the header's panel toggle go.
- The dock shows one tool at a time; its internal split goes.
- Tool headers take the layout above.
- Acceptance: everything the panel does today is reachable from the rail;
  keys, held focus and the leader work as before; phone unchanged.

**Starting stage 1** (paths under `conduit-web/src/client/`):

- Read first: `DESIGN.md` (whole), `AGENTS.md`, the Design language section
  above.
- `workspace/workspace-panel.tsx` is the dock. Its tab strip is the
  `role="tab"` buttons (`changePaneTab`); its internal split is
  `secondaryTab`, `splitRatio`, `splitActive`, `panePosition`, the
  `workspace-split-resize-handle` and `toggleSplit`. The views (`FilesView`,
  `SourceControlView`, `ChatView`, `TerminalView`) and their controllers do
  not need to change beyond the `position`/`expanded` props the split fed.
- `main.tsx` mounts the panel (`lazy(() => import("./workspace/workspace-panel"))`)
  and owns `panelOpen`, `togglePanel`, `toggleWorkspaceExpanded`,
  `maximizeWorkspacePanel`, `focusWorkspacePanel` and the header's
  `PanelRightIcon` toggle (desktop button and the ⋯ menu item). The rail
  mounts here, beside the panel, and the panel's `requestedTab` is how it
  asks for a tool.
- `commands/command-registry.ts`: `workspaceSplit` goes; the per-tool
  commands stay and show their tool as the rail does.
- `workspace/workspace-panel-storage.ts` holds the remembered tab, split and
  widths per scope; drop the split's keys and keep reading old values
  harmlessly.
- Styles: `workspace/workspace.css`. The sidebar's collapsed rail
  (`navigation/sidebar.tsx`, `navigation/sidebar.css`) is the reference for
  the right rail's size, icons and fade-in.
- The Computer page mounts the same panel with a `computer` scope
  (`initialDirectory`); it keeps working, with or without a rail of its own.
- Validate per `AGENTS.md`: one surgical probe of the touched behaviour (the
  panel's Playwright probe pattern: open each tool from the rail, maximise,
  Ctrl+Shift+3, Esc), no new tests, then
  `bash .devcontainer/start-conduit.sh restart` from the repository root.
- Update `DESIGN.md` (Layout, Keyboard and Being migrated lines for the
  panel) in the same change, and this file's status.

### 2. Main-pane splits -- built

- The main pane holds one view or two. A tool moves from the dock into a
  split by drag or command, and back.
- The split's right side is remembered per device; the dock gives way before
  either side squeezes.
- Acceptance: a chat with Files beside it in the main pane and Source Control
  in the dock, all live; keys reach each side; a narrow window folds the dock,
  then the split.

### 3. Open beside -- built, except a chat beside a page

A chat beside its project page needs a second chat state and composer, which
is stage 4's work, so it moves there.

- Files, diffs, terminals and chats open in the other side of the main pane.
  Two files side by side are two sides, and the Files view's second editor
  slot goes.
- A chat can open beside its project page.

### 4. Two chats -- built

- A second chat state per chat side, on the existing `createActiveChat`. The
  composer, drafts, attachments and dictation belong to the side with the
  keyboard.
- The sidebar's current row is the focused side's chat; the other open chat
  is marked open without being current.
- The left side still owns the URL.
- A chat can open beside its project page (moved from stage 3).

### 5. Equal panes

Stage 4 built the second chat as a *side chat*: `state/side-chat.ts` repeats
the main chat's stores, `main.tsx` repeats its header, transcript and
composer, and the left pane is still the real chat -- leader commands act on
it whatever has focus, tools reach the main pane only borrowed from the dock,
and a page cannot sit on the right. The goal is two equal panes, each a
first-class consumer of the main pane, holding any view: a chat, a page, a
file, a terminal or a tool.

- **5a. A chat session** -- built. Everything per-chat that `main.tsx` holds -- the
  `createActiveChat` store, models, permissions, service levels,
  attachments, the manifest and capabilities, the profile and switching it,
  the composer's status and attach input -- moves into one factory
  (`state/chat-session.ts`). The main chat is built from it; no visible
  change.
- **5b. One chat view** -- built. Header, transcript and composer become one
  component that takes a session. The main pane renders it; no visible
  change.
- **5c. Panes** -- built. `side-chat.ts` stays as pane B's thin catalogue slice. A new chat opens in pane A; one reaches pane B only from a dashboard opened there (5d). The main pane holds two panes, A and B, each a view plus
  (for a chat) its own session. The split's `chat:<id>` becomes pane B's
  chat on the same component; `side-chat.ts` and the repeated markup go.
  Leader commands, the model selector, stash and the rest act on the focused
  pane's session.
- **5d. Pages as pane views** -- built for the dashboard, project pages and Computer (a pane beside A browses its own folder); harness pages too: each pane's composer draft is a hidden chat on its own session, and a thread started there runs in that pane until it lets go. Opening an existing thread still goes to pane A. The dashboard, project pages, Computer and
  harness pages can sit on either side, their composers on that pane's
  session.
- **5e. Tools as pane views** -- superseded by 6c. Files, Source Control, Chat review and
  Terminal get state per place that a pane can host directly; the dock
  becomes one more host instead of the owner the split borrows from.
- **5f. The URL and restore** -- built. The path stays pane A's route; `a`
  is a view pane A shows over it (a file viewer or a tool -- pane A holds
  anything now), each `pane` a pane beside A in order, `focus` the position
  of the pane with the keyboard; widths and the dock stay per device. Every
  address the app writes goes through one helper, so a route change carries
  the panes; a pane changing rewrites the address in place, and Back and
  forward restore both. A URL naming panes restores exactly those; the app
  opened at its start page restores the device's last layout; any other URL
  opens pane A alone. Pane A's route changing clears what showed over it; a
  swap, a close or Back restoring an address does not.

**The bar.** Two panes should feel like two Conduit tabs side by side: the
reader never thinks about which one "the window" is. So every per-chat or
per-page thing follows the pane with the keyboard, not the left one:

- leader and palette commands (stop, regenerate, stash, rename, the model
  selector), Esc to the composer, and the dock's place (it looks at the
  focused pane's project);
- Ctrl+Shift+2 goes to the pane last used, and pressed again moves to the other, each landing where its focus last was;
- a page can open in either pane, and a new chat started from a dashboard in pane B stays there;
- the URL, back/forward and a shared link carry both panes (5f).

Stage 4 meets none of these yet; 5c carries the first three, 5d pages, 5f
the URL.

Each step builds, ships and is usable before the next, as the stages are.

**Going back.** Two local tags mark the states to return to:

- `panes-side-chat` (c94ab5f) -- stage 4 with its fixes: the side chat.
- `panes-pre-side-chat` (fe579fb) -- stage 3: files, changes and terminals
  beside, no second chat.

Other work lands on main between these commits, so going back is `git
revert` of the pane commits, newest first, never a reset to a tag. Each
stage 5 commit is listed below as it lands.

- *Back to the side chat:* revert every stage 5 commit listed here.
- *Back to before the side chat:* that, then `git revert 5d5ab96` (the side
  chat), then reverse the `main.tsx` half of c94ab5f
  (`git show c94ab5f -- conduit-web/src/client/main.tsx | git apply -R`),
  keeping its transcript-motion half, which file and tool splits need too.
- Check with `git diff panes-side-chat -- <the pane files>` (or
  `panes-pre-side-chat`); other agents' changes to the same files show there
  too and stay.

Stage 5 commits:

- 5a: d6e9c5a (the chat session factory)
- 5b: bff14ae (one chat surface)
- 5c: 9c0ba55 (commands, palette, dock and Ctrl+Shift+2 follow the pane)
- 5c: 1e7201c (pane B's chat renames, deletes, moves place, opens the model selector)
- 5d: 4e2872b (the dashboard and project pages in either pane)
- Sidebar focus: 70b3b23 (a sidebar row for what pane B shows focuses pane B). A header row on the frame above each sheet was tried (cb0462e..4bbd855) and reverted.

### 6. Panes with tabs, tools as navigators

Stage 5 made two equal panes. Stage 6 takes the rest of VS Code's model:
the main pane holds one to three panes, each owning tabs of *documents*,
and the dock holds *navigators* that open documents into the focused pane.
It comes before the rest of 5d (Computer and harness pages, which become
two more document kinds) and 5f (the URL and restore, which then carry the
whole layout).

- **Documents** open in panes, as tabs: a chat, the dashboard, a project
  page, Computer, a harness page, a file (viewer or editor), a file's diff,
  a terminal. Ids: `chat:<id>`, `page:dashboard`, `page:project:<id>`,
  `computer`, `harness:<id>`, `file:<path>`, `diff:<path>`, `term:<id>`.
- **Navigators** live in the dock, one of each, following the focused pane:
  Files (tree and file search), Changes (the changed-files list),
  Terminals (the running terminals, and the dock's quick terminal, which
  stays), Chat context (the focused chat's artifacts and comments).

Steps:

- **6a. Search and the palette on the rail.** Both move from the headers to
  the right rail, below the dock tools and set apart from them: they run
  actions rather than open dock views. Phone headers keep them.
- **6b. Panes as a list.** The layout is one to three panes, the focused
  one, and their ratios, kept per device. Pane A and pane B become entries
  in it; a drag edge sits between each pair; Ctrl+Shift+2 cycles them. Each
  pane has one chat session (5a).
- **6c. Chat tabs per pane.** (Decided 2026-09-29, after 6d and 6e were lived with.)
  Only chats take tabs, for now. A pane showing a chat holds a list of up to
  five chats and shows one, the active tab. Every other document -- a page,
  a file viewer, a terminal, a tool -- has its pane to itself, as now; the
  file viewer keeps its one or two files side by side, and may later get
  tabs of its own (more files than the two it shows).
  - *One mounted.* Only the active chat is mounted; switching tabs unmounts
    it and mounts the next in place, as a document switch in a pane does
    today (no fade; the pane keeps the keyboard). A background tab keeps
    only what a remount would lose: its scroll position and its composer
    draft. A pane's session follows its active tab; background tabs hold no
    live session (the runtime store tracks their streams).
  - *The row.* With one chat the header is as now (`Place / Title`, swap and
    close at the right). With two or more it is the tab row: the active tab
    keeps the breadcrumb, white at 660 (the current rule); the others their
    title alone in grey, truncating first, each with an X on hover and a
    live dot while their chat runs. Swap and close stay at the right and act
    on the pane; a tab's X closes the tab, and closing the last closes the
    pane. Tabs that no longer fit fold, last first, into a ⋯ menu. Which pane
    has the keyboard is drawn as now, apart from which tab is active.
    Ctrl+Tab moves within the pane.
  - *Opening a chat.* A plain click opens into the focused pane: into a pane
    of chats as its preview tab (italic), replacing the preview tab there if
    there is one -- typing, sending, editing or a double-click on the tab
    keeps it; into a pane showing anything else, in its place as now. Alt
    opens a new pane as now; with no room it opens a new tab in the focused
    pane when that pane shows chats. A sidebar row goes to the tab already
    showing it, in whichever pane.
  - *Opening anything else* into a pane of chats puts it in the pane's place,
    as now; the chats' tabs close with it (the chats stay in the sidebar).
  - *Dragging.* A chat dropped on the middle of a pane of chats joins it as a
    tab; anything else keeps today's rules (the middle swaps, the far edge
    moves past). Tabs drag between panes of chats, and to a pane's edge,
    which opens a pane there.
  - *The cap.* A sixth chat drops the tab used longest ago, never one with
    an unsent draft; if every tab has one, it is refused with a toast.
  - *The URL.* A pane of chats carries its tabs and which is active; pane
    A's active tab is its route. A folded pane's rail tile is named for its
    active tab.
  - *Build order.* 6c-1 the model and URL (a pane of chats as a tab list,
    one mounted, state kept per tab); 6c-2 the row; 6c-3 opening, preview
    tabs, the cap and dragging.
- **6d. Files as a navigator, files as documents.** Files in the dock is
  the file navigator only: the tree and file search. Source Control stays as
  it is -- a dock tool that can move to a pane whole -- for now. Steps:
  - *6d-1. The navigator follows places.* The dock shows the place of the
    last chat or page pane that had the keyboard; focusing a file or
    terminal pane does not move it. With every pane in one place it never
    moves; across places it switches, and its header names the place.
  - *6d-2. The file viewer.* A pane view `files:<entries>` holding one or two
    `<projectId>:<path>` entries, side by side as the dock's Files once
    showed two files -- denser than two panes for two files, and still one
    document. Each entry is an editor slot of its own with its unsaved
    guard; Files' fixed primary/secondary slots become slots per pane. The
    dock loses its editor. A click in the navigator (and a chat's file link,
    a review's Open working file) opens in the **file pane** -- the pane that
    last showed a file viewer, wherever the keyboard is -- so opening files
    never replaces the chat being typed in; with no file pane it behaves as
    Alt. Alt+click puts the file beside one already open: the second side
    of a viewer showing one (the file pane's first), and a new file pane
    only once every viewer shows two (at three panes, the neighbour). The
    viewer's own control opens a second file beside the
    first in the same pane. The one-tool-pane limit goes: terminals and file
    viewers sit in any pane.
  - *6d-3. Changes as a mode.* A diff is the same CodeMirror base
    (`workspace-editor-base.ts`) as the editor, drawn by
    `workspace-comparison.tsx`. An entry gets a mode -- contents, changes,
    staged -- switched in its header, in place of today's jump to Source
    Control's Review.
- **6e. Opening.** (Built, drag to a pane included -- thirds, sources the sidebar, pages' chats, navigator files and rail tools; pane headers move their documents.) A click opens in the focused pane, replacing its active tab; Ctrl-click adds a tab (6c).
  Alt+click, or the pane's split button, opens to the side: the next pane,
  or a new one up to three. A tab dragged to a pane's edge splits there. A
  sidebar row goes to the pane already showing it.

Phone: one pane, no tab row (the sidebar is the tab list), the dock a sheet.

**Going back.** Tag `panes-pre-stage-6` marks main before stage 6. As for
stage 5, going back is `git revert` of the stage 6 commits listed here,
newest first.

Stage 6 commits:

- 6a: 5f51f03 (search and the palette on the rail)
- 6b: 0052905, 2db3a91 (up to three panes, each slot its own session; a pane's chat closes it only when deleted)
- 6e (part): 7ef24b5 (a sidebar row or chat search result replaces the focused pane's document; Alt opens a new pane right of the focused one). 6c (tabs) was deferred until 6d and 6e were lived with; now decided (6c above).
- 6d-1: 6103cea (the dock follows places); 6d-2: 708a451 (the file viewer: Files as the navigator where panes fit, a file pane of one or two files). Not yet in the viewer: a review comment's reveal, Replace with upload (the navigator keeps it).
- 6d-3: 9cf1925, 2758f60 (an entry shows its unstaged or staged changes in place, with its Git status mark; a header that no longer fits drops its copy and download actions; Alt from Files fills a viewer's second side before opening a new pane).
- Pane actions: swap and close on each pane's breadcrumb, pane A included; A swaps right, the others left; the swap fades, slides and fades (DESIGN.md, Two chats). File viewer headers gather their actions into an overflow menu before the name goes, and a review comment on a file scrolls its viewer.
- 6c-1/6c-2 and most of 6c-3: 1a18b37.. (chat tabs, the row, Alt with no room, the cap, the URL; preview tabs were tried and dropped -- a plain click replaces the active tab, Ctrl-click adds). Then: Ctrl-click opens as a tab (sidebar selection moves to Shift), a chat dropped on a pane of chats joins it, background tabs drag. Not yet: the ⋯ overflow, a key to move between tabs (the browser keeps Ctrl+Tab), tabs in the per-device layout.
- 5f: see the commits after 91c6af1 (the URL carries every pane; pane A holds anything).

## Open questions

- **Two or three sides.** Three, from stage 6.
- **Pages in the right side.** Whether a project page can sit beside a chat,
  or only chats and tools can.
- **Remembered layouts.** One per device (as the panel is now), or one per
  place.
- **Dock and split at once on a narrow desktop.** Whether a split folds the
  dock automatically, or the reader chooses.
