# Panes and the rail

> **Status (2026-09-27): proposed.** Stage 0 is under way. Nothing below is
> built past it. Rules this produces move into `DESIGN.md` as each stage lands;
> this file stays the plan and is deleted once the last stage is built.

## Decision

Retire the workspace panel as a component of its own. The main area becomes a
row of **panes**, each showing one **view**, and the panel's four parts --
Files, Source Control, Chat review, Terminal -- become kinds of view that any
pane can show. A **rail** of icons on the right edge opens them. The first
visible step reproduces today's behaviour (a chat on the left, a tool on the
right); the model underneath is what later lets a chat sit beside a chat, a
file beside a chat, or two files side by side.

## Why

Every pairing asked for so far -- chat and file, two files, two chats -- is
one pane beside another. Today there are several unrelated ways of putting two
things side by side, and each new pairing would need building again:

- **Main pane and panel** are asymmetric. The main pane follows the route; the
  panel follows the open chat's place, has its own width, its own "expanded"
  mode that covers the main pane, and its own open state.
- **The panel splits itself.** Expanded, it shows two of its tabs side by side
  with their own gutter and ratio (`secondaryTab`, `splitRatio`).
- **Files split themselves again.** The Files tab holds two editor slots
  (`primary`, `secondary`) with a third gutter and ratio.
- **The same views live in several places.** The Computer page's file browser
  is the panel mounted with a `computer` scope; Terminal View is a route of
  its own; dashboards list terminals and changes that open the panel.

The pieces are ready for it. The chat state already runs twice: the Computer
page drives a harness thread on a second `createActiveChat` beside the main
one (`state/drive-chat.ts`). Keys already follow a tree of regions that tracks
focus, so a pane is one more region.

## The model

**A pane shows one view.** A view is a kind plus what it shows:

| Kind | Shows | Today |
|---|---|---|
| Chat | a chat id (or a new-chat draft) | the main pane on `/chat/:id` |
| Page | the Conduit dashboard, a project or workspace page, Computer, a harness page | the main pane on those routes |
| Files | a place's tree and an open file | panel tab, Computer page |
| Source Control | a place's Git state and review | panel tab |
| Chat review | a chat's history and agent changes | panel tab |
| Terminal | a place's shells, or one terminal | panel tab, Terminal View |

**What a tool looks at.** Files, Source Control and Terminal belong to a
place; Chat review belongs to a chat. A tool opened from the rail is
**attached**: it looks at the place (or chat) of the pane beside it and
follows that pane when it moves, which is how the panel behaves today. A tool
opened for something specific -- a file link from another project, "open
terminal" on a project row -- is **pinned** to that place until closed.

**Panes on desktop: one or two.** The model allows more; the first stages cap
it at two, side by side, split by a gutter that drags. Minimum widths come
from the views' own controls, measured, never tuned (DESIGN.md, Do's). When
the window cannot hold two at their minimums, the second pane gives way
before the first squeezes. One pane can be **maximised** to fill the area,
which replaces the panel's "expanded" mode.

**The left pane owns the URL.** Back and forward move it. The second pane's
view and the split ratio are remembered per device, as the panel's open state
and width are today.

## The rail

- **Where:** the right edge, on the frame (black) surface, mirroring the
  sidebar's collapsed rail: the same width, 14px icons, the tenth-of-size
  stroke, the same wash and current rules (DESIGN.md, Interaction).
- **What:** one icon per tool -- Files, Source Control, Chat review,
  Terminal. Source Control is disabled without a repository, as its tab is.
- **Behaviour:** an icon opens its tool in the second pane, making the split
  if there is one pane. The tool showing is the current icon (white, the
  heavier stroke, no fill). Pressing the current icon closes that pane. The
  rail replaces the header's panel toggle and the panel's tab strip.
- **Held focus and arrival** use the existing region cues; the rail itself is
  not a region, its icons are reached from the pane beside it.

## Panes

- **Surface:** each pane is the grey pane surface with the main pane's
  corners, separated by the frame gutter, so two panes read as two sheets on
  the frame rather than one sheet divided.
- **Header:** a Chat or Page pane keeps the header it has today (breadcrumb,
  actions). A tool pane gets a header in the same row: the tool's name, its
  modes as the heading's segmented switch (Source Control's Changes / Review /
  Graph / Patch; Chat review's History / Agent changes), and close. The
  headers of side-by-side panes share one line, as the sidebar and main
  header now do.
- **Focus:** the pane with the keyboard is the current region; the composer,
  the leader and Esc resolve inside it first.

## Keyboard

- **Ctrl+Shift+1/2/3** become sidebar, left pane, right pane. 3 with one pane
  opens the last tool used, as it opens the panel today.
- **Tool keys** (the leader's Files, Source Control, Chat, Terminal) open that
  tool in the right pane, or switch the right pane to it.
- **Open beside** (stage 2): a command, and Alt+click where it exists today,
  opens a file, diff, chat or terminal in the other pane.
- **Esc** from a tool pane goes to the left pane's composer, as from the panel.

## Phone

One pane at a time, no split. The tools stay reachable the way the panel is
today, as a full-screen view over the chat. Nothing here commits the phone to
more than that.

## Tabs: not now

The sidebar, chat search and the command palette already switch between
chats; tabs would repeat them and add the chrome the design language keeps
out. Splits answer the actual need, two things at once. If tabs come later
they are per pane, and they come only after splits have been lived with.

## Stages

Each stage builds, ships and is usable before the next starts.

### 0. The panel's views stand alone

Split `workspace/workspace-panel.tsx` (~2,300 lines) into its views, each with
its own state owner, mountable outside the panel. No visible change. This
finishes step 6 of `workspace-editor-diff-split.md`.

- Files, Source Control, Chat review and Terminal are components in their own
  files; each view's state lives in a controller the panel creates, so it
  survives the view being hidden, as it does now.
- Shared machinery -- the per-project request scope, the workspace cache, the
  change poll -- is its own module.
- The panel file keeps only its chrome: tabs, its internal split, width and
  resize, open and close, phone focus, shortcuts, and the navigation between
  views (review a file, open the working file, reveal a comment).

### 1. Panes and the rail

- The main area becomes a row of one or two panes. The right pane shows a
  tool; the rail opens it. The workspace panel component, its header toggle
  and its tab strip are removed.
- "Expanded" becomes maximise. The panel's internal split goes: two tools at
  once is two panes.
- The Computer page shows the Files view directly instead of mounting the
  panel.
- Acceptance: everything the panel does today is reachable from the rail;
  keys, held focus and the leader work per pane; the second pane gives way on
  a narrow window; phone unchanged.

### 2. Open beside

- Files, diffs and terminals open in either pane. Two files side by side are
  two panes, and the Files view's second editor slot goes.
- A chat can open beside a page (a chat next to its project page).

### 3. Two chats

- A second chat state, created per chat pane on the existing
  `createActiveChat`. The composer, drafts, attachments and dictation belong
  to the pane with the keyboard.
- The sidebar's current row is the focused pane's chat; the other open chat
  is marked as open without being current.
- The left pane still owns the URL.

## Open questions

- **Two or three panes.** Two is the cap for stages 1-3; whether a third is
  ever worth its chrome is for after stage 3.
- **Pages in the right pane.** Whether a project page can sit beside a chat,
  or only chats and tools can.
- **Remembered layouts.** One layout per device (as the panel is now), or one
  per place.
- **Phone tool switcher.** Whether the phone gets the rail's icons in its
  header, or keeps the current panel overlay.
