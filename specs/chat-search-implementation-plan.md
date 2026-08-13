# First-class chat search and management

## Purpose

Conduit has one command palette, but chat navigation has started to split into
several entry points: the root palette, Go to, Ctrl/Cmd+P, and the sidebar's
View all chats action. The product direction is one extensible palette surface
that can search and manage chats now, then add files, artifacts, transcripts,
and host resources later. This document is the implementation record for that
surface. The first slice is shipped in checkpoint `a6e1d94`; the second slice
is specified below and is implemented in the current working tree.

## Product decisions

### One palette surface

The command palette remains the only dialog. Chat search is a first-class page
inside that dialog, not a second modal or a separate View all implementation.
Every entry point must resolve to the same page ID, the same row builder, the
same ranking, the same keyboard model, and the same management actions.

The visible root entry is `Search chats…`. The existing Go to page is removed
from the visible portal list. The old `goto` page ID remains accepted by the
resolver as a compatibility alias so saved commands and older callers do not
break. Ctrl/Cmd+Shift+O also remains a compatibility shortcut, but it opens
the canonical chat-search page and uses its `Search ›` prefix.

### Sidebar View all is a filter, not a surface

The Chats group remains bounded so a large number of unscoped chats does not
consume the sidebar. View all chats opens the canonical chat-search page with a
pre-applied filter for the reserved, unscoped Chats project. Ctrl/Cmd+P opens
the same page without a filter and can search every chat. Removing the filter
returns to the all-chat view without closing the palette or changing pages.

The filter is represented as query syntax and a visible removable chip. It is
not a second `scopeProjectId` mode with separate rendering rules. This keeps
the interaction extensible when file and artifact filters are added.

### Query grammar

The first parser is intentionally small but composable:

- `scope:chats` selects the reserved project with `slug === "chat"`. This is
  the filter seeded by View all chats.
- `scope:all` explicitly clears a project scope. It is useful when a user
  starts from a scoped view and wants to broaden the search by keyboard.
- `in:<slug-or-name>` limits results to a named folder or Workspace. A value
  without spaces is accepted directly; a double-quoted value such as
  `in:"Design notes"` preserves spaces.
- Filter names and values are case-insensitive. Unknown `key:value` text stays
  in the free-text query instead of silently changing search behavior.

The parser returns both the free-text query and structured filter tokens. The
ranker receives only free text, so `scope:chats` and `in:research` do not lower
title matches. The page resolver applies the structured filters to chat rows
and to the relevant “new chat in…” action. The parser does not inspect
transcript bodies in this slice.

The input stores a serializable raw query. A pure parser derives the visible
text and filter chips; a matching serializer writes user edits back without
losing active filters. View all initializes the raw query as `scope:chats `.
The input therefore looks like an ordinary search field with a `Chats ×` chip,
not like a hidden mode switch. Clicking the chip removes only that token and
keeps focus in the input. If the free-text portion is empty, Backspace removes
the last filter token and stays in chat-search mode; it never returns to the
root palette or closes a direct launch.

Project filter resolution is performed against the current catalogue by
project ID, slug, and case-folded display name. An unresolved `in:` value
produces an empty result state that names the filter value; it must not fall
back to all chats, because that would make a restrictive query appear to work
while returning unsafe or surprising rows. The reserved Chats project is
resolved by slug, never by a hard-coded ID.

### Keyboard contract

Ctrl/Cmd+P is the direct chat-search shortcut. The global handler must register
on the window in capture phase and clean up with the same capture option. It
must handle the P shortcut before the generic `defaultPrevented` early return,
call `preventDefault()`, and open the canonical page. This prevents Chrome's
print action from winning when a focused input, a nested dialog, or another
listener handles the event first. The handler must not rely on Ctrl+O or
Ctrl+Shift+O for the primary path.

The rest of the current contract remains shared by all chat-search launches:

- Arrow keys, Home, End, and Enter operate on the same row list.
- Tab enters a highlighted page row rather than moving focus to the close
  button.
- Ctrl/Cmd+E enters selection mode. Space toggles the active chat; R renames
  one selected chat; M opens the destination chooser; C copies links; and
  D/Delete opens the confirmed delete dialog.
- Escape exits rename mode, selection mode, or the page according to the
  existing direct-launch rules.
- Backspace edits free text and, when no free text remains, removes a filter
  token before it can change palette level.

## Slice already shipped: checkpoint `a6e1d94`

The checkpoint establishes the shared primitives that the next slice must
extend rather than replace.

### Command registry and ranking

`conduit-web/src/client/palette/command-registry.ts` carries typed chat
metadata on palette rows: the chat, owning project, date section, entity type,
and search keywords. Chat rows include the current chat, sort newest first,
group by Today, Yesterday, Previous 7 days, and Older, and search title plus
folder/workspace metadata. The old Go to source is still an alias at this
checkpoint and is the duplicate that the next slice removes from the visible
portal list.

`conduit-web/src/client/palette/palette-search.ts` breaks equal-score ties by
chat creation time before label order. Any query parser must pass its free-text
portion into this existing ranker and must not duplicate ranking logic.

### CommandMenu management mode

`conduit-web/src/client/navigation/command-menu.tsx` already uses one Kobalte
Dialog shell for root commands, settings pages, chat rows, move destinations,
inline rename, and confirmed deletion. It keeps selected IDs across query
changes, resolves targets from the catalogue, and retains failed IDs after a
partial move or delete. The optional detail pane is reserved for future
previews; this slice does not render transcript summaries.

The next slice must replace the current project-ID scope prop with parser-
derived filters or make that prop an internal compatibility adapter. It must
not fork the chat row renderer for View all chats.

### Main and sidebar integration

`conduit-web/src/client/main.tsx` owns palette launch state, chat management
actions, and the global shortcut handler. It also persists the sidebar chat
limit through `conduit-web/src/client/navigation/sidebar-preferences.ts`.

`conduit-web/src/client/navigation/sidebar.tsx` limits the reserved Chats
group, keeps the selected chat visible when it falls outside the recent window,
and opens the palette from View all chats. It also reveals and scrolls to a
chat's parent after palette navigation. The reveal effect currently reads the
collapsed-project signal while deciding whether to reveal; that reactive read
causes a manual collapse to be undone immediately when the selected chat is
inside the folder. The next slice removes that dependency.

`conduit-web/src/client/navigation/runtime-indicator.tsx` already rolls child
chat activity up to a project/workspace row. Generation spinners, waiting
states, failure states, and multi-agent counts must remain unchanged.

### Sidebar limit and settings

The current default is 20 Chats rows. `Settings → UI` stores an integer from 5
through 100, clamps invalid values, and leaves project/workspace groups
uncapped. View all is shown only when rows are omitted from the bounded window.

## Second implementation slice: canonical filters and folder state

### 1. Canonicalize entry points

Update `PALETTE_PAGES` so only `chat-search` appears as a chat navigation
portal. Keep `resolvePaletteCommands({ page: "goto" })` as a compatibility
mapping to `chat-search`, but do not expose a second page label, prefix, or
heading. Change the Ctrl/Cmd+Shift+O handler to request `chat-search` directly.
Update `CommandMenu` page checks so legacy `goto` is normalized once at the
boundary and all subsequent rendering uses `chat-search` metadata.

Remove the duplicate Go to assertion from the browser suite and add an
assertion that the root palette shows Search chats once and no Go to portal.
Retain a unit test proving that the legacy resolver input returns the same row
IDs as `chat-search`. Update `conduit-web/README.md` so it describes one chat
page and names Ctrl/Cmd+Shift+O as a compatibility alias only.

Risk: external code may still pass `goto` and depend on its old label. The
resolver alias and shortcut preserve the callable behavior; only the visible
duplicate portal is removed. Risk: page metadata may be read before the
normalization. Normalize the signal at launch or use a canonical page memo so
the prefix, CSS class, row source, and Escape semantics cannot diverge.

### 2. Add the pure chat-query parser

Add a focused parser module, preferably
`conduit-web/src/client/palette/chat-query.ts`, with a small exported contract:

- `parseChatQuery(raw)` returns free text, recognized filter tokens, and their
  normalized values.
- `serializeChatQuery(filters, text)` produces the raw query used by the input
  signal.
- `removeChatQueryFilter(parsed, token)` removes one token without changing
  free text.
- `resolveChatQueryScope(parsed, projects)` maps `scope:chats` and `in:` to a
  project constraint or an explicit unresolved state.

The parser must preserve quoted names, normalize case only for matching, and
retain the user's original free-text spelling. It must not treat a URL,
ordinary colon punctuation, or an unknown filter name as a recognized filter.
Token removal must be deterministic when the same filter appears twice: keep
one normalized filter token and remove duplicates during serialization rather
than applying the same constraint twice.

Add unit tests for empty input, mixed terms and filters, quoted project names,
case-insensitive matching, unknown `key:value` text, duplicate filters,
`scope:all`, unresolved project names, and serializer round trips. Keep these
tests independent of Solid and browser globals.

Risk: controlled input updates can move the caret if the raw query and visible
query are represented by different strings. Keep the input value bound to the
parser's free-text output and update only the raw query on input; filter chips
must own token editing. Add a browser assertion that typing after a seeded
scope does not insert text before the chip or lose the scope.

### 3. Replace project-ID scope with parsed filters

Change the palette launch state in `main.tsx` and the Sidebar callback so View
all passes an initial raw query (`scope:chats `), not a project ID. Keep direct
launch and page arguments separate from the query so Ctrl/Cmd+P always opens an
unfiltered page.

In `CommandMenu`:

1. Parse the raw query with a memo.
2. Render one chip per recognized filter before the combobox. The chip label
   uses the resolved project display name (`Chats`, `Research`, or the quoted
   filter value when unresolved), and its close control removes only that
   token.
3. Pass parsed free text to `rankPaletteResults`.
4. Filter chat commands and “new chat in…” actions using the resolved scope.
5. Keep date sections, selection state, rename state, and failed operation IDs
   independent of query edits.
6. When no rows match an unresolved or restrictive filter, show a specific
   empty message that includes the active scope rather than “No matching
   commands.”

The input must remain the only text field. Filter chips are ordinary buttons
with visible focus, a concise accessible name, and a title that explains the
scope. On Backspace with an empty free-text value, remove the last filter token
and keep focus in the combobox. On Backspace with free text, preserve ordinary
editing behavior.

Risk: selection IDs may point to rows hidden by a new filter. Keep selected
IDs in state, show the count of resolvable targets, and do not silently delete
hidden selections. Before a destructive action, operate on the selected target
set from the catalogue, not only visible rows. Risk: project name changes can
make a serialized `in:` token resolve differently; resolve against the live
catalogue each render and retain the original token text for display.

### 4. Capture Ctrl/Cmd+P before Chrome print

In `main.tsx`, register the global handler as
`window.addEventListener("keydown", keydown, { capture: true })` and remove it
with the same option. Handle the unshifted P branch before the existing
`event.defaultPrevented` guard. Require Ctrl or Meta, reject Alt and Shift,
call `preventDefault()`, and open `chat-search` direct mode. Do not call
`stopImmediatePropagation`; other app listeners may still need ordinary
keyboard events after the shortcut is handled.

Add a browser test that focuses the composer and presses Control+P, verifies
that the chat-search dialog opens, and asserts that a stubbed `window.print`
is not called. Run the same test path on the mobile palette smoke test where
the shortcut is supported. Keep Ctrl/Cmd+K behavior unchanged.

Risk: capture-phase handling can intercept a shortcut while a nested text
editor is active. Ctrl/Cmd+P is intentionally global because Chrome reserves
it for printing; the app must own it whenever the Conduit page has focus.
Avoid broad capture handling for the other shortcuts.

### 5. Fix parent reveal without blocking manual collapse

In `sidebar.tsx`, keep the reveal-and-scroll effect dependent on selected ID
and project catalogue changes only. Do not read `collapsedProjectIds()` in the
effect's tracking scope. Use a setter callback that returns the existing Set
when the owner is already expanded, and removes the owner only when a selected
chat change requires reveal. The effect may queue a scroll after the DOM row
mounts, but it must not run again merely because the user toggles the chevron.

Keep the chevron button's `aria-expanded`, label, and click propagation rules.
Manual collapse must hide the child chat rows even when the selected chat is
inside the folder. Opening a different chat through palette search must still
expand the owner before scrolling to its row.

Add browser coverage for both directions: select a chat, collapse its owning
folder, assert the child row is hidden and `aria-expanded="false"`; then open a
chat in a collapsed folder through chat search and assert the folder expands
and the row is visible. Keep existing project/workspace chevron tests.

Risk: an effect that still reads the collapsed set will recreate the bug. The
test must click the chevron after the selected chat is stable, not only test a
fresh page load. Risk: a catalogue refresh can replace project object identity;
derive ownership by IDs and allow the effect to reveal again when the selected
chat's owner is reintroduced.

### 6. Keep parent collapse independent from the active session

Do not add a selected-child marker to folder or Workspace rows. The parent
name, chevron, and existing `ProjectActivityIndicator` already carry folder
identity and work state; an extra dot or ring adds visual noise and does not
solve the memory problem. A user may collapse the parent of the active chat,
and the child row stays hidden until the user expands it or uses Search chats
to find the session again.

Preserve the existing activity indicator's status role, tooltip, stale state,
spinner, and count behavior. Add a browser assertion that a generating child
still renders the existing folder spinner after the parent is collapsed. Do
not add new CSS or accessibility state for active-session ownership.

Risk: a hidden active child is less visible in the sidebar. The canonical chat
search page remains the keyboard-native recovery path, and the existing
chevron remains an explicit reveal control.

## Files and ownership for the second slice

- `conduit-web/src/client/palette/chat-query.ts`: parser, serializer, scope
  resolution, and pure unit tests.
- `conduit-web/src/client/palette/command-registry.ts`: canonical page portal,
  legacy resolver alias, and filter-compatible chat commands.
- `conduit-web/src/client/palette/palette-search.ts`: consume only parsed free
  text; change only if the existing matchable type needs a narrow helper.
- `conduit-web/src/client/navigation/command-menu.tsx`: canonical page state,
  filter chips, query integration, empty states, and keyboard filter removal.
- `conduit-web/src/client/main.tsx`: capture-phase shortcuts and initial-query
  launch state.
- `conduit-web/src/client/navigation/sidebar.tsx`: View all query seed,
  and one-way parent reveal.
- `conduit-web/src/client/styles.css`: filter-chip and focused-control styling;
  preserve existing palette and sidebar geometry.
- `conduit-web/README.md`: one-surface behavior, query grammar, shortcut
  compatibility, and collapse behavior.
- `conduit-web/test/chat-search.test.js`, a new parser unit test file if
  needed, and `conduit-web/test/browser/palette.spec.js` plus the relevant
  `app.spec.js` cases: contract and browser coverage.

## Verification and acceptance

The slice is accepted only when all of these are true:

1. Root palette shows one Search chats portal; Go to is not a second visible
   page, while the old resolver input and Ctrl/Cmd+Shift+O still work.
2. Ctrl/Cmd+P opens chat search in Chrome without opening print.
3. View all chats opens the same page with a visible removable `scope:chats`
   filter. Removing it returns to all chats without closing the dialog.
4. Typed `scope:chats`, `scope:all`, and quoted `in:` filters behave as
   specified, and ordinary title/folder terms still rank correctly.
5. Backspace never leaves chat-search because its free text is empty; it
   removes a filter token first when one exists.
6. A selected chat's parent can be manually collapsed and stays collapsed.
   Opening a chat from search still reveals and scrolls its parent.
7. A folder or Workspace can be collapsed while its chat is selected, and
   existing generation indicators remain correct.
8. Existing management actions, bounded sidebar rows, settings persistence,
   mobile palette behavior, and current project/workspace navigation remain
   intact.

Run, from `conduit-web/`:

- `npm run typecheck`
- `npm test`
- `npm run build`
- `npm run test:browser -- test/browser/palette.spec.js --project=desktop-chromium --workers=1`
- `npm run test:browser -- test/browser/pwa-mobile.spec.js --project=mobile-chromium --workers=1 --grep palette`
- `npm run test:browser -- test/browser/app.spec.js --project=desktop-chromium --workers=1 --grep "folder expansion|project chevron|compact sidebar groups|selects chats"`
- `git diff --check`

Future file, artifact, transcript-body, host-system, and preview search are
explicitly out of this slice. The shared page, parser contract, filter chips,
typed row metadata, and reserved detail pane are the extension points for that
later work.

## Current implementation status

The second slice is implemented after checkpoint `a6e1d94`. The visible root
palette has one chat-search portal; `goto` remains a resolver alias and
Ctrl/Cmd+Shift+O remains a compatibility shortcut. Ctrl/Cmd+P is handled in
capture phase before Chrome print. View all chats seeds the same page with a
removable `scope:chats` chip. The parser supports `scope:chats`, `scope:all`,
quoted `in:` values, case-folded project matching, unresolved filter states,
and free-text ranking. Backspace removes a filter before it can change palette
level. Parent reveal no longer defeats manual collapse. Folder and Workspace
rows keep their existing identity and runtime activity indicator without a
separate active-chat marker.

Verified from `conduit-web/` on 2026-08-13:

- `npm run typecheck` passed for this slice before later unrelated turn-row
  edits changed the shared tree.
- `npm test` passed: 378 tests.
- `npm run build` passed. The current shared-tree bundle check reports 151,068 B
  initial JS gzip, 19,875 B initial CSS gzip, and 185,186 B largest lazy JS
  gzip; PWA checks passed.
- Desktop palette browser suite passed: 12 tests.
- Mobile palette smoke test passed: 1 test.
- Focused sidebar/project browser suite passed: 4 tests.
- `git diff --check` passed.

The implementation is not committed. The unrelated
`specs/runtime-toast-recovery-plan.md` remains untouched. Later unrelated
edits in `conduit-web/src/client/chat/turn-trace.tsx` and related turn-row
files now make the shared-tree typecheck fail because Solid's `Index` callback
does not narrow `TraceSegment` before property access. Those files are outside
this slice and remain untouched.

## Additional stage: edit-mode discoverability and mouse ergonomics

I would treat this as a focused “edit-mode discoverability” slice. I would not change the blue selection treatment yet; that belongs in the later visual identity update.

### 1. Add a reusable shortcut footer

Add a small footer directly below the palette shell. I would call the component `CommandHintBar` and the visual treatment a “shortcut footer”.

It should be a stable convention for every palette mode:

- Thin top border.
- Same background as the palette.
- Muted action labels.
- Small, consistent `<kbd>` keycaps.
- No bright accent color, large pills, or hover-only information.
- Context-sensitive contents.

Browse mode:

```text
Edit chats        ↑↓ Navigate   Enter Open   ⌘E Edit   Esc Close
```

Edit mode:

```text
Done              Click Select   Space Toggle   R Rename   More actions…
```

Rename and move modes would show their own short hints, such as `Enter Save` and `Esc Cancel`.

The footer must not depend on hover. Hover can add a tooltip, but the important shortcuts must remain visible for keyboard, mouse, and touch users. On small screens, it should wrap or reduce to the primary actions plus a `More shortcuts` control.

### 2. Add a visible mouse entry point

Add an `Edit chats` button to the chat-search footer. It should:

- Enter the existing selection mode.
- Select the currently highlighted chat.
- Preserve the current query and filter.
- Move focus to the results list.
- Change to `Done` while editing.

This gives users a clear path without knowing `Ctrl/Cmd+E`.

Implementation status: complete in the current working tree. The `Ctrl/Cmd+E`
keycap and `Edit chats` label form one outlined footer button. Clicking it
selects the highlighted chat, preserves the query and filters, and moves focus
to the results list. In edit mode, the same control reads `Done`; clicking it
clears the temporary selection, keeps the dialog open, and returns focus to the
search composer. Both pointer controls call the same selection toggle as the
keyboard shortcut.

### 3. Add Ctrl/Cmd-click selection

Mirror the sidebar behavior:

- In normal search mode, Ctrl-click or Cmd-click on a chat enters edit mode.
- The clicked chat becomes the first selected chat.
- The click must not open the chat or change the URL.
- Once edit mode is active, ordinary clicks on chat rows toggle their checkboxes.
- The user can click several rows in sequence without holding a modifier.
- A selected row remains selected when the query changes, as the current keyboard flow already supports.

The implementation should use `event.ctrlKey || event.metaKey`, so this works on Windows/Linux and macOS.

Implementation status: complete in the current working tree. In chat-search
browse mode, Ctrl-click or Cmd-click sets the clicked row as the active row,
enters the existing bulk selection mode, and selects that chat without running
its navigation command. Once edit mode is active, the existing ordinary-click
path toggles each chat. Selected IDs remain catalogue-backed when a query hides
their rows and reappear selected when the query is cleared.

### 4. Make edit mode mouse-complete

The current keyboard actions should remain, but mouse users should not need to memorise `R`, `M`, `C`, and `D`.

Add a compact `More actions` menu in the footer:

- One selection: Rename, Move, Copy link, Delete.
- Multiple selections: Move, Copy links, Delete.
- Rename is disabled for multiple selections.
- Keep the existing confirmation dialog for deletion.
- Keep failed selections after partial move/delete.

The row checkboxes should remain visible and the selection count should stay prominent. `Done` exits edit mode and clears the temporary selection state without closing the search dialog.

The later keyboard-contract correction supersedes the menu shape above. Bulk
edit mode is limited to moving and deleting chats; rename stays a single-chat
browse action, and the footer does not add `More actions` or copy controls.
Render `D Delete` and `M Move` as direct enclosed buttons beside `Done`. They
must call the same confirmed-delete and destination-picker paths as their
keyboard equivalents.

Implementation status: complete in the current working tree. The edit footer
keeps all five edit hints visible and makes `Done`, `D Delete`, and `M Move`
pointer controls. Delete opens the existing count-aware confirmation. Move
opens the existing destination page and operates on every selected catalogue
target. Rename remains absent from bulk mode, and partial failures retain the
existing selection behavior.

### 5. Leave the selection highlight alone for now

I would not redesign the blue left-edge highlight in this slice. It is a broader selection/focus identity issue that affects the sidebar and other surfaces. The edit-mode work should only add discoverability and pointer input. A later visual pass can replace that treatment consistently across the application.

### 6. Verify the interaction contract

Add browser coverage for:

- Footer hints in browse mode.
- `Edit chats` entering selection mode.
- `Done` leaving selection mode.
- Ctrl/Cmd-click entering edit mode without navigation.
- Normal clicks toggling several chats.
- Filtered results retaining selection state.
- Mouse action menu invoking rename, move, copy, and delete.
- Footer changes for rename and move modes.
- Mobile footer layout and touch behavior.

This keeps the change coherent: one mode model, one visible shortcut convention, and equivalent keyboard and mouse entry paths.

### Keyboard contract correction from manual testing

The initial edit-mode footer contract is superseded for the action keys. Rename
is a single-chat action, not a bulk-edit action. In browse mode, the highlighted
chat can be renamed with `Alt+R` or `Ctrl/Cmd+K` followed by `R`, deleted with
`Ctrl/Cmd+K` followed by `D`, and moved with `Ctrl/Cmd+K` followed by `M`.
These shortcuts are handled only while the chat-search palette is open, so
they do not become global application commands. The existing delete
confirmation remains in place. A failed action must leave the search surface
usable for another try.

`Ctrl/Cmd+E` is a toggle. The first press enters bulk selection mode and selects
the highlighted chat. A second press exits bulk selection mode, clears the
temporary selection, and returns focus to the query. `Escape` remains a cancel
fallback. Bulk mode exposes selection, delete, and move as its primary actions;
it must not offer rename. Existing copy-link handling remains compatible for
now, but it is not part of the footer contract. The footer must show `D Delete`
and `M Move`, plus the toggle and selection hints. The redundant
`More actions…` label is removed from this mode. Move mode keeps its own
`Enter Move`, `Esc Back`, and navigation hints.

The footer browse hints must expose the three single-chat actions and the
`Ctrl/Cmd+E` toggle. It must not advertise browser-reserved or unreliable
`Ctrl/Cmd+Shift` or `Alt+Shift` alternatives. `Alt+R` is the quick rename
shortcut; the `Ctrl/Cmd+K` action prefix is the delete and move path and also
provides a second rename path.

Render the primary modifier as `Ctrl` on Windows/Linux and `⌘` on Apple
platforms. Render the quick-rename modifier as `Alt` or `⌥` with the same
platform rule. The action behavior remains `event.ctrlKey || event.metaKey`;
the label must match the user’s keyboard rather than expose a generic Super
symbol.

Chrome can consume `Ctrl+Shift+D` as a browser command before the page receives
the key event, so chat search uses an app-owned two-stroke action path: press
`Ctrl/Cmd+K` while the chat-search page is open, then press `D`, `M`, or `R` for
delete, move, or rename. The palette stays open while this prefix is active
and the footer replaces the normal hints with the three available action keys
plus `Esc` to cancel. Cancelling a delete confirmation returns focus to the
search field, so the next shortcut remains inside the palette. This action path
is scoped to chat search; `Ctrl/Cmd+K` keeps its normal open/close behavior on
every other palette page.
