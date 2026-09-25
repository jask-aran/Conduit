# Chat search and keyboard navigation: handoff

This note records the navigation work through commit `0f2a05a` and the product
direction behind it. Read `DESIGN.md` for the visual rules and
`docs/ui-polish-sketch.md` section 8 for the wider keyboard model. The current
code is the source of truth when either document differs from behavior.

## Product direction

`Ctrl/Cmd+Shift+K` is a fast way to find a chat and understand its state. It is
separate from the `Ctrl/Cmd+K` command palette, although both use the same
overlay shell and visual language. Search must work with the keyboard first.
The pointer and keyboard share one highlighted row. The current chat has its
own text treatment; it does not hold the cursor wash.

The root is a small index, not a flat list of every chat. It shows five recent
chats, then Chats, project, and workspace folders. Right expands a folder to
show up to five recent chats, including the current chat if it is older. A
`Browse all` row appears when more chats exist. Enter or Right on that row
opens a flat list limited to the folder. Left or Escape returns to the same
folder row and restores the prior list position. Slash on a folder or one of
its chats enters search within that folder. Typing at the root searches chat
titles and folder names across the app. This gives frequent chats a short path
and keeps large folders out of the initial navigation sequence.

Do not split projects and chats into separate tabs. They form one navigation
tree. Workspaces are folder rows in that tree; they are not a second search
surface. Keep the path above the input and the activity view, sort, and shortcut
rail at the bottom. Edit mode keeps its selected count in that rail. It shifts
chat rows right for checkboxes without adding a header that moves the results.

## Changes now in the repo

- Region focus was simplified before this search work. Main and workspace
  clicks can set the active shortcut context; a bare sidebar click does not
  give the sidebar the held-region treatment. The bottom held-focus line and brief arrival cue
  belong to the go-to-region shortcuts, not ordinary clicks. The main pane has
  no permanent inset hairline or native transcript focus outline. Relevant
  files: `conduit-web/src/client/main.tsx`,
  `conduit-web/src/client/chat/transcript.tsx`, and `DESIGN.md`.
- The scroll-to-latest button now appears only when the transcript is away
  from its tail. A click scrolls smoothly unless reduced motion is requested.
  Relevant files: `conduit-web/src/client/chat/transcript.tsx` and
  `conduit-web/src/client/chat/transcript-tail-follow.ts`.
- The leader menu, command palette, and chat search gained the ink-dark overlay
  surface, compact one-line rows, and keycap rail. Their layout and purpose
  remain distinct. Chat search rows use the sidebar's quiet text weight, with
  white semibold text for the current chat. Relevant files:
  `conduit-web/src/client/navigation/leader-palette.tsx`,
  `conduit-web/src/client/navigation/command-menu.tsx`, and
  `conduit-web/src/client/styles.css`.
- Chat search uses live `ChatSummary` and runtime data. Its rows retain the
  sidebar's harness, unread, and activity indicators. The view filter can
  limit results to attention, progress, or unread; sort can use latest or
  created. Selection, rename, move, copy links, and confirmed delete remain
  in the same overlay. Relevant files:
  `conduit-web/src/client/navigation/runtime-indicator.tsx`,
  `conduit-web/src/client/palette/command-registry.ts`, and
  `conduit-web/src/client/navigation/command-hint-bar.tsx`.
- The latest search change adds the root tree and scoped list. Its state is
  held in `command-menu.tsx`: the query contains the scope filter, a set holds
  expanded folders, and one return frame holds the prior query, row key, and
  scroll position. `PaletteActions.openProject` makes Enter on a folder open
  that project. Right expands it inside search. This change is commit
  `0f2a05a`; the earlier live chat index is `b9cb591`.

## Keyboard behavior to preserve

Up and Down move through visible rows; Home and End reach the first and last.
Right expands a folder, enters its first child when expanded, or enters
`Browse all`. Left returns from a child to its folder, collapses an expanded
folder, or leaves a scoped list. Enter opens a chat or project. Slash starts
folder-scoped search. Typing while the list has focus moves to the search
input. Escape clears typed search first, then steps out through a child or
scope, then closes the overlay. A direct `View all chats` launch starts in the
Chats scope. The command palette keeps its own page navigation.

## Next review pass

The last implementation passed `npm run typecheck` and the production build,
and Conduit restarted on port 4310. It did not receive a browser interaction
check. Drive the overlay with a large project, an empty project, a workspace,
an unread chat, and a running chat. Check cursor and focus handoff between the
input and tree, return position after `Browse all`, Escape at each level,
folder previews under each activity filter, narrow layouts, and whether the
footer stays legible. Record any observed mismatch before changing the state
model. Keep one query scope and one return frame; avoid a second independent
project filter or separate tabs unless the user changes this direction.

At the time of this note, unrelated working-tree changes exist in
`bugs/README.md`, `.claude/`, `bugs/bulk-delete-outside-installation/`, and
`docs/palette-sketches/`. Preserve them when doing further work.
