# Shortcut Manager Implementation Plan

## Goal

Build one shortcut system for Conduit. It must own shortcut definitions,
matching, context priority, display, conflict warnings, user overrides, and
command execution. The Shortcuts settings page must expose the stable command
registry rather than maintain a second list of actions.

This is a client-side capability. Shortcut choices are specific to the current
browser, operating system, keyboard, and installed-app mode, so the first
version stores overrides in this browser profile. It does not write shortcut
preferences to the Conduit server.

## Browser boundary

A normal web page cannot connect to Chrome's shortcut manager or inspect which
browser command consumed a key. It only receives `KeyboardEvent` objects that
the browser and operating system deliver. If Chrome consumes `Ctrl+P`, there is
no missing-event API that can prove the user pressed it.

The implementation will therefore use two forms of evidence:

1. A versioned browser and operating-system conflict catalogue based on the
   published shortcut sets for Chrome and Firefox, plus a conservative common
   set for Safari and unknown browsers.
2. The recorder itself. A chord that reaches Conduit is shown immediately as
   captured. A chord that never reaches the page cannot be recorded, and the UI
   continues to show the recording prompt.

Warnings are advisory for browser conflicts because browser behavior can vary
with focus, installed-app mode, extensions, accessibility tools, desktop
environment, and browser version. An overlapping Conduit binding in the same
active context is a blocking error because Conduit can determine that conflict
exactly.

Chrome extensions have a separate `chrome.commands` API, but operating-system
and Chrome commands can still take priority. Conduit will not require an
extension or a DevTools connection. The environment classifier will be an
interface so a future native host or companion extension can supply stronger
conflict information without changing the registry or settings UI.

Reference behavior:

- Chrome's published desktop shortcuts include `Ctrl+P` for Print,
  `Ctrl+Shift+D` for Bookmark all tabs, `Ctrl+K`/`Ctrl+E` for address search,
  and other browser-owned commands:
  https://support.google.com/chrome/answer/157179
- Firefox publishes a similar platform-specific shortcut set:
  https://support.mozilla.org/en-US/kb/keyboard-shortcuts-perform-firefox-tasks-quickly
- Chrome's extension command API states that some Chrome and operating-system
  shortcuts always take priority:
  https://developer.chrome.com/docs/extensions/reference/api/commands
- Web pages receive keyboard input through `KeyboardEvent`; the API describes
  delivered events but provides no browser-command registry:
  https://developer.mozilla.org/en-US/docs/Web/API/KeyboardEvent

## Product decisions

### One command identity

Every stable action has one command ID, label, description, group, availability
rule, and optional default bindings. The command palette and Shortcuts settings
are projections of that data.

Dynamic entities do not become permanent shortcut commands. A chat search row
such as `open-chat:<session-id>` remains dynamic palette data. Stable actions
that operate on the highlighted row, such as Rename highlighted chat, do have
stable command IDs and register a handler while the chat-search context is
active.

### Contexts are explicit

Bindings declare the context in which they can run. Initial contexts, from
highest to lowest priority, are:

1. `shortcut-recorder`
2. `confirmation`
3. `chat-search.rename`
4. `chat-search.move`
5. `chat-search.edit`
6. `chat-search.browse`
7. `palette.page`
8. `palette.root`
9. `settings`
10. `application`

The terminal is an exclusive input owner. If an event target is inside an
active terminal, application shortcuts do not run. A future terminal-specific
command can opt into a terminal context explicitly.

The manager checks the highest active context first. A binding in a lower
context cannot also run. The same chord can be valid in disjoint contexts, such
as `D` in a focused edit list and `D` in another future modal.

### Navigation keys stay fixed

Arrow keys, Enter, Escape, Tab, Space selection, and text-editing behavior are
interaction controls, not application commands. The first version does not
make these controls configurable. This avoids broken dialogs, inaccessible
focus movement, and shortcuts that type commands into a composer.

### Bindings support sequences

A binding contains one or two strokes. Each stroke stores:

- A normalized physical key code such as `KeyK`, `Comma`, or `Delete`.
- A display key captured from the active keyboard layout.
- Abstract modifiers: Primary, Control, Alt/Option, and Shift.

Primary renders and matches as Command on Apple platforms and Control on
Windows/Linux. The physical code is the stable match identity. If
`navigator.keyboard.getLayoutMap()` is available, it supplies the visible key
label; otherwise the recorder's `event.key` or a built-in key label is used.

Two-stroke sequences use a 1.5-second completion window. A context cannot
contain a complete binding that is also the prefix of another binding. The
registry rejects that ambiguity instead of delaying the shorter command.
Context priority permits the current behavior: Primary+K opens the palette when
it is closed, while the same stroke begins a chat action sequence when chat
search owns the keyboard.

### Overrides are browser-local

Store only differences from defaults under a versioned local-storage key:

```text
conduit:shortcuts:v1
```

Each entry maps a stable command ID to a list of bindings or to an empty list
for an intentionally unbound command. Unknown IDs survive a read/write cycle
so a temporarily unavailable plugin or future command does not lose its
binding. Invalid entries are ignored without discarding valid entries.

The UI provides Reset for one command and Reset all. Reset all removes only
Conduit's shortcut override key.

## Visual and interaction design

The surface belongs in Settings → Shortcuts. It uses the existing Conduit
charcoal tokens, Geist text, and monospace keycaps. No new accent palette or
card language is introduced.

The page has a search field and grouped command rows. Each row contains the
command name, concise description, context label, and one or more binding
buttons. Unbound commands show `Add shortcut`.

Activating a binding button expands a recorder directly below that row:

```text
Rename highlighted chat            Chat search
Change the highlighted chat title  [ Alt R ] [ Ctrl K  R ]
└ Press a shortcut…                 [Clear] [Reset] [Cancel]
  Chrome uses this chord for …
```

The expanded recorder is the page's signature element. It keeps the action,
captured keys, and conflict explanation in one reading path instead of opening
another modal. The rest of the page remains a quiet settings list.

Conflict states:

- `Available`: no known conflict.
- `Context reuse`: the same binding exists only in a disjoint context.
- `Browser conflict`: warn, name the browser action, and allow Save.
- `System conflict`: warn that the operating system can consume the chord and
  allow Save.
- `Conduit conflict`: name the other command and block Save when contexts can
  overlap.
- `Not received`: the recorder cannot claim this automatically. It continues
  waiting and explains that browser-owned shortcuts might not reach Conduit.

The page header shows the detected environment, for example
`Chrome · Windows · Browser tab`. This explains why the warnings can differ
between devices. Environment detection must not claim an exact browser when
the user agent does not provide enough evidence; use `Chromium` or `Unknown
browser`.

## Slice 1: Add the shortcut domain model and conflict engine

Implementation status: complete in the current working tree. The shortcut
modules normalize physical codes separately from display labels, distinguish
Primary from macOS Control, classify the browser/platform/display environment,
load versioned browser-local overrides, preserve unknown command IDs, and
report exact Conduit conflicts plus advisory browser and operating-system
conflicts. The declarative catalogue includes the current Chrome and Firefox
collisions that motivated this work.

Create focused modules under `src/client/shortcuts/`:

- `shortcut-types.ts`: command IDs, contexts, strokes, bindings, overrides,
  conflict results, and environment types.
- `shortcut-normalize.ts`: turn a `KeyboardEvent` into a normalized stroke,
  compare strokes and sequences, and format platform-aware keycaps.
- `shortcut-environment.ts`: detect platform, browser family, and browser-tab
  versus installed display mode.
- `browser-conflicts.ts`: versioned declarative conflict records. Records name
  the owning browser/system action and applicable platforms.
- `shortcut-conflicts.ts`: combine browser/system warnings with exact Conduit
  overlap checks.
- `shortcut-preferences.ts`: validate, merge, read, and write browser-local
  overrides.

The conflict catalogue is data, not conditionals spread through the UI. A
future browser or host integration adds a provider or records without changing
matching code.

Tests must cover normalization, Apple Primary mapping, sequences, timeout
boundaries, invalid stored data, disjoint-context reuse, overlapping-context
errors, and known Chrome conflicts including Primary+P and
Primary+Shift+D.

Risk: `KeyboardEvent.key` follows the current keyboard layout while
`KeyboardEvent.code` follows physical position. The stored model keeps both,
uses `code` for matching, and uses the current layout only for display. Tests
must include a non-US display key so formatting cannot become the match
identity.

## Slice 2: Create the unified command registry

Implementation status: complete in the current working tree. Stable application
and chat-management actions now have one typed definition. Static palette rows
and page portals project their labels, descriptions, groups, icons, keywords,
and command IDs from that registry. Palette keycaps ask the live shortcut
manager for the effective browser-local binding, so future overrides update the
palette without a reload. Dynamic chats, folders, models, profiles, and
workspace destinations remain palette-owned data.

Refactor the current palette registry into stable command definitions plus
palette projections.

Each stable definition contains:

- `id`
- `label`
- `description`
- `group`
- `keywords`
- `icon`
- `contexts`
- `defaultBindings`
- `configurable`
- palette visibility metadata
- availability and execution hooks where the action is globally executable

Add definitions for commands that currently live outside the palette registry:

- Open command palette
- Search chats
- Open Settings
- New chat
- Toggle sidebar
- Toggle Workspace panel
- Chat-search edit mode
- Rename highlighted chat
- Move highlighted chat
- Delete highlighted chat
- Bulk move selected chats
- Bulk delete selected chats

Existing stable palette actions keep their IDs. Page portals refer to stable
command IDs instead of carrying literal shortcut labels. Dynamic model,
profile, chat, folder, and workspace rows remain sources that can reference a
stable command when appropriate but do not appear as permanent customizable
rows.

`PaletteCommand.shortcut` stops being authored display text. The palette asks
the shortcut store for the effective binding and formats it for the current
platform. Commands with no binding show no keycap.

Risk: some palette actions require current chat state while chat-search actions
require internal highlighted-row state. Definitions therefore separate command
metadata from runtime handlers. A stable command can exist in Settings even
when no handler is currently active; availability controls execution, not
whether the user can inspect or configure it.

## Slice 3: Add the scoped runtime dispatcher

Implementation status: complete in the current working tree. The client root
owns one ShortcutManager and one capture-phase keyboard listener. The manager
supports token-scoped context activation, context-checked handlers, live
override changes, sequence state and timeout, repeat and composition guards,
editable-target policy, focus-loss cleanup, and terminal exclusion from the
event path. The former `main.tsx` key switch has been removed. Its application
commands now register through the manager, while chat search retains its local
handlers until Slice 4 and explicitly takes ownership of its Primary+K prefix.

Create one `ShortcutManager` instance owned by the client root. It installs one
capture-phase `keydown` listener and exposes:

- `registerHandler(commandId, context, handler)`
- `activateContext(context, options)`
- `deactivateContext(context)`
- `effectiveBindings(commandId)`
- `setOverride(commandId, bindings)`
- `resetOverride(commandId)`
- `subscribe(listener)`
- `handleKeydown(event)`

Context registrations return cleanup functions so Solid components cannot
leave stale handlers after unmount. Activations use tokens rather than global
booleans; nested surfaces can restore the previous context safely.

The dispatcher must reject:

- `event.isComposing`
- modifier-only events
- repeats unless the definition allows repeat
- events already handled by a higher-priority owner
- printable unmodified bindings from editable controls unless the active
  context explicitly owns that control
- all application bindings from an active terminal target

When a command matches, the dispatcher calls `preventDefault()` and
`stopPropagation()` before execution. When no command matches, it does neither.
Sequence state is cleared on timeout, focus loss, context change, Escape, and
an unmatched second stroke.

Migrate `main.tsx` global shortcuts to registered application commands. Remove
the parallel literal key switch after parity tests pass.

Risk: the existing root handler runs in window capture while some component
guards run later in event propagation. The new dispatcher must identify
exclusive targets from the event path before it considers application
commands. It cannot depend on a terminal's later `stopPropagation()`.

## Slice 4: Migrate palette contexts and generated hints

Implementation status: complete in the current working tree. Palette root,
page, chat-browse, chat-edit, move, rename, and confirmation states now activate
manager contexts. Chat actions and Primary+K sequences dispatch through
registered command handlers. The footer derives command keycaps and valid
prefix completions from effective bindings, while fixed list navigation and
text editing remain component-owned.

Register palette handlers when their states are active:

- Root and page commands in the palette contexts.
- Chat browse actions in `chat-search.browse`.
- Edit actions in `chat-search.edit`.
- Move and rename actions in their dedicated contexts.
- Confirmation arrow behavior stays a dialog interaction, while confirmed
  command execution remains attached to its command identity.

Replace shortcut branches in `command-menu.tsx` only after each path has a
registered equivalent. Keep navigation and editing keys local as fixed
interaction controls.

Generate `CommandHintBar` command keycaps from effective bindings. Labels and
click handlers can remain mode-specific, but they refer to command IDs rather
than duplicate key strings. A changed binding must update the footer without a
reload.

The existing Primary+K then D/M/R behavior becomes ordinary two-stroke
bindings in `chat-search.browse`. The action-prefix footer derives from the
manager's pending sequence and shows only valid completions for the active
prefix. This permits future prefixes without new component state or hard-coded
letters.

Risk: query input, list focus, and edit mode currently decide whether an
unmodified `D`, `M`, or Delete is an action or text editing. Preserve that
boundary through context ownership and editable-target policy. Do not put
unmodified bulk actions in the application context.

## Slice 5: Build Settings → Shortcuts

Implementation status: complete in the current working tree. Settings now has
a searchable Shortcuts section with grouped command rows, effective and custom
bindings, an inline one- or two-stroke recorder, explicit save and cancel,
clear and reset controls, live internal and browser conflict feedback, recorder
focus ownership, screen-reader status, and stacked mobile rows.

Add `shortcuts` to the Settings section registry and command-palette Settings
page. Implement the section as a focused component rather than extending the
already large `settings.tsx` body.

The component receives the command registry and shortcut manager. It supports:

- Search by command label, description, keyword, context, or binding.
- Grouping that matches the command palette where possible.
- Effective default and override bindings.
- Inline recording for one binding at a time.
- One- and two-stroke capture.
- Add, replace, clear, reset command, and reset all.
- Immediate internal and browser/system conflict feedback.
- Keyboard use: Enter starts recording, Escape cancels, Backspace clears the
  captured stroke, and Tab leaves the recorder without saving.
- Screen-reader status text for captured strokes and conflict changes.
- Responsive rows that stack metadata above bindings on mobile.

Recording activates the highest-priority `shortcut-recorder` context. It
suppresses normal commands while recording but leaves Escape available to
cancel. The new binding is saved only after the user activates `Save
shortcut`; merely pressing a browser-owned key cannot silently clear or change
an existing binding.

The first release warns about browser/system conflicts but does not provide a
misleading automated pass/fail test. The captured state is evidence that a
stroke reached Conduit in the current focus state. Copy explains this limit in
one sentence near the environment label.

Risk: Settings currently closes from a document-level Escape listener. The
recorder must consume Escape before that listener closes Settings. Replace the
unscoped document listener with the shortcut context or make it defer when the
recorder owns the event.

## Slice 6: Verification, migration safety, and documentation

Implementation status: complete in the current working tree. Pure coverage now
checks registry projections, default normalization and conflicts, environment
records, migration failure, unknown IDs, context priority, sequences, and
recorder exclusivity. Browser coverage exercises live rebinding and footer
updates, recorder suppression and Escape behavior, browser warnings, overlap
blocking, disjoint reuse, resets, query ownership, sequence timeout, and
responsive overflow. `conduit-web/README.md` records the registry, context,
persistence, browser-boundary, and current chat-management contracts.

Pure tests:

- Registry IDs are unique.
- Every displayed shortcut command has a stable definition.
- Every default binding parses and formats.
- No default bindings conflict in overlapping contexts.
- Browser conflict records resolve for the correct browser and platform.
- Preference migration is fail-open and preserves unknown command IDs.

Browser tests:

- Existing application shortcuts still run their command.
- Terminal focus prevents application shortcuts.
- Palette root and chat-search contexts take priority correctly.
- Primary+K sequences show valid completions and time out.
- Query inputs keep ordinary text and Delete behavior.
- A changed binding runs immediately and updates palette/footer keycaps.
- Recording suppresses the command it is replacing.
- Chrome conflict warnings name Print and Bookmark all tabs.
- Internal overlapping conflicts block Save; disjoint reuse is allowed.
- Reset and reset all restore defaults.
- Settings and recorder focus/escape behavior is correct.
- Desktop and mobile Shortcuts layouts have no horizontal overflow.

Update `conduit-web/README.md` with the registry, context, persistence, and
browser-boundary contract. Replace the obsolete description that says bulk
rename is available and ensure all documented default shortcuts come from the
new registry.

Run:

- `npm test`
- `npm run typecheck`
- `npm run build`
- focused browser shortcut and palette suites
- mobile Settings and palette cases

## Non-goals for this sprint

- A Chrome/Firefox extension.
- A DevTools Protocol connection to the user's browser.
- Global shortcuts while the browser is not focused.
- Server-synced shortcut preferences.
- Native host-system shortcuts.
- Configurable dialog navigation or text-editing keys.
- Per-chat, per-folder, or per-workspace bindings.
- Arbitrary macros or user-authored command scripts.

The interfaces deliberately leave room for native and extension environment
providers, plugin-contributed stable commands, and server-synced profiles. None
of those future paths should be required to make the browser implementation
coherent.

## Default search launcher and header affordance

Implementation status: complete.

Replace the browser-owned Primary+P and Primary+Shift+O defaults for Search
chats with one Primary+Shift+K binding. `Primary` resolves to Command on Apple
platforms and Control elsewhere. The shortcut opens Chat search directly when
another surface is active and closes the palette when Chat search is already
open, including browse, edit, move, and rename states.

Keep Primary+P available as a user-selected override with a Print warning.
Record Firefox's Windows/Linux Primary+Shift+K Web Console ownership as a
browser warning; Chrome's published shortcut table does not claim the chord.

Add two adjacent top-bar controls. Search chats uses the Search icon. Command
Palette uses the Terminal icon already associated with command execution in
Conduit. Preserve separate accessible names and the existing icon-button
dimensions on desktop and mobile.

Update registry, toggle, context, header, settings, browser, and documentation
coverage. Verify default keycaps, search open/close behavior, both header
launchers, mobile layout, typecheck, focused tests, and build.
