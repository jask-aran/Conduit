---
name: Conduit
description: In-app visual language for Conduit. Dark charcoal control plane, inset panes holding plain lists grouped by heading and space, frosted glass for everything that floats. No blue anywhere.
note: "Colours are the dark theme's values in client/styles.css. Every other value (space, type, radius, motion) is a token in components/ui/styles/foundations.css; the body names them, the code holds them."
colors:
  frame: "oklch(0.138 0.004 264)"
  background: "oklch(0.186 0.005 264)"
  foreground: "oklch(0.93 0.003 258)"
  muted-foreground: "oklch(0.63 0.006 262)"
  accent: "oklch(1 0 0 / 7%)"
  border: "oklch(1 0 0 / 7%)"
  card: "oklch(0.225 0.006 264)"
  primary: "oklch(0.95 0.002 258)"
  destructive: "oklch(0.645 0.19 18)"
  ring: "oklch(0.78 0.008 258)"
  frost-fill: "#ffffff2b"
  frost-stroke: "#ffffff4d"
  live: "oklch(0.62 0.17 145)"
  warn: "oklch(0.75 0.15 75)"
---

# Overview

Conduit is a self-hosted, always-dark agent control plane. The look is charcoal and quiet: a darker frame, inset rounded panes, plain lists grouped by a heading and space, and frosted glass for everything that floats. It is not a marketing site, not a light theme, and not a colourful dashboard.

Three surfaces are the references; copy them before inventing anything:

- **The sidebar** -- how everything is interacted with: grey at rest, the wash as the one cursor, the current item bold with no fill, driven as easily from the keyboard.
- **Chat search and the command palette** -- what anything that opens on top of the app looks like.
- **The dashboards** -- laying things out on grey without borders, in single lines grouped by heading and space.

This file holds the rules. Values live in code and examples in the gallery:

| For | Look in |
| --- | --- |
| The rules a surface, control or move follows | this file |
| Token values (space, type, radius, motion, frost) | `conduit-web/src/components/ui/styles/foundations.css` |
| The pieces themselves | `conduit-web/src/components/ui/`: one module and one `styles/` file per family, re-exported by `index.tsx` |
| Every piece drawn, measured, in every state and density | the gallery (`npm run gallery`, docs/TESTING.md) |

Write rules here, not specs: sizes, timings, exact copy, counts and fold orders belong to the code. How to verify a rule goes in docs/TESTING.md.

Stack: SolidJS, Kobalte for behaviour, Geist Variable and Paper Mono, Lucide icons. Do not add React, another icon kit, a chart library for chrome, or a second palette.

# Components v2

New UI is built from components v2 (`components/ui`) and its tokens alone, so a change to a token or a piece reaches every use. The library draws shapes: behaviour (Kobalte menus, dialogs, the app's state) is the caller's, wrapped round the piece.

- **Nothing styles itself per component.** Sizes come from the space, control, icon and type tokens; corners from `--radius-*`; colour from the surface (Surfaces). A value a piece needs and no token gives is a new token or a new rule here, not a local number.
- **A piece owns its moves.** Entering, leaving and removing are its `motion` prop or its own state, on the Motion tokens. Callers never animate a library piece from outside.
- **One gallery family per piece.** A change to a piece updates its source and its gallery family together; the gallery's In use, Anatomy and Forms views go through the shared `gallery/specs.tsx`, never markup of their own.
- **The app opts in through `components/ui/swap.ts`.** `LibraryContext` draws the app's real screens with v2 inside the gallery's previews; `useLibraryPiece(piece)` graduates one piece into the app itself, and `localStorage conduit:classic = "<piece>"` draws it the old way again to compare. Rules that draw an app piece with the library live in `styles/bridge.css`. A piece is done when its old code, its `useLibrary()` branch and its bridge rules are deleted.

## Migration

What each v2 family replaces and where it stands. Update a row in the commit that moves it; remove it once the old code is gone. Until a family is in the app, the old piece in the "Replaces" column is what app code uses.

| v2 family (gallery) | Replaces | In the app |
| --- | --- | --- |
| Controls: `Button` | `Button` in `components/primitives.tsx`; raw `<button>`s in the terminal pane, sidebar, `main.tsx`, command menu, Computer dashboard | previews |
| Controls: `Segmented` | `settings/settings-controls.tsx`; `.sidebar-area-toggle`, `.split-heading-switches`, `.workspace-history-toggle` | old |
| Controls: `Input`, `TextArea`, `SelectTrigger`, `Field` | `Field*`, `Input`, `Textarea` in `primitives.tsx` | old |
| Controls: `Slider` | `chat/step-slider.tsx` | previews |
| Controls: `Keycap` | `Keycap` in `components/frost.tsx` | old |
| Controls: Switch, Spinner, StatusDot (the runtime dot) | `settings-controls.tsx`, `primitives.tsx`, `navigation/runtime-indicator.tsx` | gallery only (v2 pieces exist; the app still draws its own) |
| Frost | `.composer-surface-material`, `chat/composer-surface.ts` | previews |
| Popover: `Menu`, `Section`, `Item` | `Menu*`, `ContextMenu*`, `Popover*`, `PopoverSearchList` in `primitives.tsx`; `.menu-row` (terminal pane, leader, context gauge, place picker) | each section's menus with its section (the composer's are graduated with it); previews elsewhere |
| Card | `FrostDialog` (`frost.tsx`) | gallery only |
| Toast | solid-sonner's toasts | gallery only |
| Overlay, Glance | `FrostOverlay` (`frost.tsx`), command menu, chat search, Settings | gallery only |
| Leader | `navigation/leader-palette.tsx`, `frost-card` | gallery only |
| DesktopComposer | `chat/composer.tsx` (desktop) | graduated (`composer`) |
| Rider | queued messages, attachment strip, question card | in the app (v2 classes, not components) |
| Pill, PhoneComposer | phone header pills, sidebar header, `chat/composer.tsx` (phone: the voice bar, a phone's only composer) | graduated in the composer (`composer`); previews elsewhere |
| Trace | `chat/turn-trace.tsx`, `tool-card.tsx` | graduated (`trace`) |
| Transcript, CodeBlock | `chat/transcript.tsx`, the Markdown's `.artifact`, `chat/disclosure.tsx` | previews (`StopLine` in the app) |

**Overlays until Card and Overlay graduate:** build them from `components/frost.tsx`, never a copy of another overlay. `npm run build` fails on a hand-rolled Kobalte dialog (`scripts/check-bundle.mjs`; update that check when Card and Overlay replace them).

| Building | Use |
| --- | --- |
| a palette, search or anything that filters | `FrostOverlay` (`placement="center"` for one that does not filter, like Settings) |
| a confirm, a one-field prompt, a small piece of content | `FrostDialog` (`alert` for a destructive choice, `size="wide"` for content, `close`, `actions`) |
| a menu, context menu or submenu | `Menu*` / `ContextMenu*` (`primitives.tsx`) |
| a pick list anchored to a control | `PopoverContent` holding `PopoverSearchList` |
| a card that floats without covering the page | `frost-card` alone |

Inside them rows take `frost-row`, keys `Keycap`, the foot `frost-rail`, a dialog's buttons `frost-dialog-actions`; material, dim, radius and arrival come from those pieces and the `--frost-*` tokens, and a surface's own CSS sets only its layout.

# Surfaces

Every surface is one of three materials. Choose it first, before any colour, border or radius.

| Surface | Material | Holds |
| --- | --- | --- |
| **Frame** | near-black `frame` | permanent navigation: the sidebar, the collapsed rail, the workspace rail |
| **Pane** | charcoal `background`, no borders | where you work: chats, pages, file viewers, tools |
| **Frost** | `Frost` | anything that floats |

**The test is "does it float?", not "is it where you work?".** Frost is for overlays (palette, chat search, model selector, leader, menus, Settings, dialogs; where one covers the page, the page dims) and for floating chrome inside a pane (the composer, user bubbles, the header pill, scroll to latest, the attachment strip, a composer takeover), centred on the reading column. Inside frost, content follows the pane's rules: one-line rows, headings and space, no boxes. Never frost a row, a list, the workspace tree or the transcript. Something genuinely new is composed inside these surfaces, not beside them.

**Controls take their look from the surface under them.** A surface sets `--tint` (its lines and washes) and `--well` (the fill under an input or an outline button), and controls read only those. Over frost there is no well: an input there is a hairline with nothing inside. Set `data-surface` on the surface, never a per-surface rule on a control.

**On a phone an overlay is a full-screen bubble** filling the visual viewport inside the status and navigation bars (`--phone-overlay-padding`, never its own inset), with larger tap targets. It stays a dialog, never a route -- Settings included.

# Interaction

One grammar for every list, menu, picker, palette, tab and setting, taken from the sidebar.

- **Rest.** Grey text, muted icons, harness marks greyed with their row.
- **Cursor.** The row under the pointer, under keyboard focus or being pressed takes the `accent` wash and goes white; a harness mark shows its own colour. There is one cursor, only one row at a time, and pointer and keyboard move the same one (`moveCursor`). It never changes weight. On something already washed (a chosen segment) it brightens that wash a step. It stays where it was while the window is in the background.
- **Current.** Where you are -- the open chat and the folder or workspace holding it, the active tab, the current section, the chosen option -- is white at the current weight with a heavier icon stroke, and **no fill**. Open but not where you are (the other pane's chat) is white at the resting weight. Cursor and current can always be told apart.
- **Selection.** Several chosen items are the wash on each. A checkbox column appears only in an explicit edit mode (chat search's Edit).
- **Never** focus rings or outlines, from the browser or a component, in any colour; coloured bars or slivers; boxes round a row; a tick for the current choice. Keyboard focus is the wash.
- **Fold, don't squeeze.** Controls keep their size. When a row of them stops fitting, the least used fold, last first, into a ⋯ listing only what folded; what must stay (a title, the active tab) truncates only once nothing is left to fold. The fold point is measured from the controls, never a tuned px width.

# Colour

The app is locked to `.dark`; the light tokens in `styles.css` are leftovers, never paint them. The charcoal is cool-neutral at chroma ~0.005, and that grey is the brand: do not raise it to "read as blue".

- **Near-monochrome.** Muted text for timestamps, hints, empty states and icons at rest. `border` hairlines for inputs, a header or footer rule and dividers; grouping is a heading and space, with at most one hairline between groups, never a box or a fill. `card` solids are left on tool cards only. `primary` is the one bright action.
- **Hue only for state:** `destructive` for errors and destructive actions, `live` and `warn` as small dots and glyphs (never fills, rails or washes). Workspace glyph colours and git dots are data, kept on the glyph.
- **No blue anywhere** -- not for selection, focus, links, status, audio, waveforms or "active" surfaces, and no `--accent-cool` or slate tint. Connecting states are muted; success is foreground or `live`. Two exceptions: syntax highlighting inside code, and a status dot's own colour. Leftover blue (`--accent-cool` in `project/dashboard.css`, `styles.css`, `sidebar.css`) is removed when touched. It is frontend-design skill output: don't follow that skill's urge for a signature accent colour; frost is the signature.

# Typography, scale and shape

- **Faces.** Geist Variable for UI; Paper Mono (shipped) for section labels, keycaps, data (model ids, paths, times, counts) and code; Meslo Nerd Font for the terminal, the one face the user is expected to change. No serif but the first-launch wordmark. Tabular figures wherever numbers tick or line up.
- **Roles, not sizes.** Five sizes (`--text-label`, `caption`, `row`, `body`, `heading`) and four weights (`--weight-rest`; `lift`, for text over frost, which reads thinner; `strong`, for titles, buttons and values; `current`, for where you are and a match lit while typing). Every section heading is the section label: Paper Mono, uppercase, letter-spaced, muted. Meta is muted mono beside a row's title, right-aligned, truncating before the title does.
- **Everything is drawn in the density unit** (12.8px desktop, 16px phone) times a scale: **UI scale** (Settings, Interface size) for everything, **transcript scale** (Text size) for what you read. Gaps are one of the `--space-*` steps, controls one of the `--control-*` heights, icons one of the `--icon-*` sizes, and a width of its own (a card, a column, an overlay) one of the `--measure-*` lengths. Lines are `--hairline`, `--stroke-thin`, `--stroke` or `--track-size` (whole pixels, never scaled); line heights a `--leading-*`; text falling back from the foreground a `--tone-*`; a faded part an `--opacity-*`; an effect's time a `--duration-*`. Rows keep a finger's height on a phone (44px floor). An offset that lines something up is worked out from what it lines up with. Never a one-off multiplier or a px gap.
- **Radii.** `--radius-control` (rows, buttons, inputs, chips; `--radius-inset` nests it for keycaps and inline code), `--radius-surface` (popovers, cards, overlays: the control's plus the inset, so rows nest), `--radius-message` (the composer and the user's message: a capsule at one line, held as it grows), `--radius-round` (pills, which never grow, and small round bits), and the pane's. Do not round section titles or metadata.
- **Icons** are Lucide, muted at rest, one size per context; a stroke a tenth of the icon's size, an eighth when current. Harness marks and the context gauge draw their own. The composer's + and mic wear the text colour, as live actions.
- **Depth.** Panes and lists have none. Frost carries it: one material, resting or raised (`data-lift`), never redeclared per component. No stacked shadows, coloured glows, mesh gradients or SaaS card grids; the voice composer's Aura is the one allowed colour field.
- **The top line.** The sidebar header and every pane header centre on one line. A chat's breadcrumb names its place in caps before the title, with no slash; a page that is a place has no crumb.

# Motion

Motion explains a change of place. A surface that does not change place does not animate.

- **Quick out, gentle in.** Leaving is `--duration-quick` on `--ease-leave`; arriving is `--duration-gentle` on `--ease-arrive`; a change in place is quick on `--ease-change`. A move is a fade, a rise, a drop back the way it came, a grow or a slide (`styles/foundations.css` keyframes). Effects that are not moves (the copied wash, a breathing mic) keep their own time.
- **Leave the way you came, then arrive.** Something of the bottom edge leaves downward; a panel leaves toward its control's edge. The outgoing surface goes first; they never cross-fade in place.
- **Transform and opacity only**, except a Disclosure unfolding, pane widths easing, the composer across a layout switch, and the phone composer's pills.
- **The invariants every piece's moves keep** (`styles/foundations.css`): parts stack in one order in every state; one transition list per part, states setting only values; room opens before a part fades in and goes after it fades out; two parts never share a spot at once; a change is one move from its first frame; a frost fades itself, never through an ancestor. A new state fits these, never an exception: state them per piece and check every pair of states, not one-off fixes.
- **Hold the reading position.** A swapped surface keeps its room while away; the transcript moves only through its tail spring.
- **The first open settles, then shows.** Only the frame shows until every pane's document is laid out and holding still; then every region fades in once, with no rise. Nothing arrives or moves after the fade starts.
- **A send moves at once.** A new chat's first message, or one sent from a dashboard, takes the composer to the chat's foot in the frame the layout changes.
- **Cards belong to the composer.** Queued messages and attachments rise out of it and drop back into it when it takes them; removed by hand, a card fades in place. Anything keyed for animation is keyed by identity, so an update never replays an entrance.
- **A layout switch** happens in the frame the width crosses. Nothing crosses the pane: a section that changes place fades in where it now is; the composer alone eases to its new column. Both layouts share their gutters.
- **Floating controls follow.** Anything anchored to a surface is re-measured when that surface is swapped or lands.
- `prefers-reduced-motion` drops the move and keeps the end state (the meteor field excepted).

# Layout

Desktop is a darker frame with inset rounded panes; the frame's margin is also the gutter you drag. Mobile drops the inset and goes full-bleed, with safe-area padding on edge controls. Layouts change at widths measured from their content, never a tuned breakpoint.

- **Chat.** The sidebar on the frame; the chat in its pane; the workspace rail on the right and, when open, the dock -- a second inset pane showing one tool at a time (Files, Source Control, Chat review, Terminal), not a floating card. Answers fill the reading column with no bubble; the user's message is a frosted bubble at the right; the composer floats at the foot in frost. A phone keeps the tools as tabs in the dock's header.
- **Dashboards** (Conduit, project, workspace, harness pages) are one layout (`dashboard/primitives/split.tsx`): a header with the place's mark, name, a one-line muted status and quiet quick actions -- only verbs nothing else on the page offers; managing the place lives in its ⋯. Below, the composer with the chats under it beside a narrower column of places and state, each scrolling on its own; one column when narrow. On a phone, sections fold under their headings, filters fold into one Filters menu, and the composer docks at the foot. No hero of metric boxes.
- **The Conduit dashboard is the new-chat screen**, the composer focused; a new chat in a place lands on that place's page. Where a chat lives is chosen from the composer's place button.
- **The chats list is one component everywhere** (`primitives/chat-list.tsx`), scoped to where you are, rows grouped by day. Empty lists read "Nothing here yet." with no action of their own.
- **Untracked threads.** A harness's own thread that no Conduit chat owns is still a whole chat page, hidden from Conduit's lists, with a pill offering Track.
- **Palettes** (command palette, chat search, model selector) pin near the top so filtering shrinks them from the bottom. One search row: a leading mark, chips for scope or view (`in:Japan`; Backspace on an empty query removes the last, Esc steps out), the query, a quiet close. A drill-down puts Back in the header, never a Back row. Rows are one line, keeping their groups, best match first; typing lights the matched letters. Chat search previews the highlighted chat beside the results once the cursor rests. A footer rail of the view's actions and its keys; on a phone, a bar of buttons. `docs/design/palette-sketch/` is the reference.
- **Settings** is a centred frost overlay whose rail is drawn as the sidebar is (on a phone, a screen of its own). It saves as it changes: no Save button; the header says Saving, Saved, or Not saved with Retry; a value not valid yet says why under its field. Credentials and one-off actions keep their own buttons.

# Panes and windows

The panes smoke and `test/file-tabs.test.js` assert these; a change to a rule changes its test.

**Documents and room**

- **A pane holds one document** (chat, page, file viewer, tool, shell). Pane A holds the route; panes beside it are opened, never navigated to.
- **A document declares its minimum width** (chats and pages `MIN_MAIN_PANE_WIDTH`, viewers and tools `MIN_SPLIT_PANE_WIDTH`; the dock takes whatever it shows). Containers lay out from those, never their own guesses. A desktop window too narrow for the sidebar beside a chat at its minimum scrolls sideways; the chat is never drawn narrower.
- **Room runs out in one order.** The dock narrows first, then panes move to the dock, last first, document and state kept, and come back when the width holds them. A dragged edge takes room from its neighbour down to its minimum, then the next. Up to three panes, with Equalise and presets at the rail's foot; not on a phone.

**Focus and opening**

- **One pane has the keyboard**; a click anywhere in it gives it. Everything that acts "here" acts on it: the palette, the leader, the model selector, the composer's keys and dictation, the dock's Files. Ctrl+Shift+2 and Alt+Shift+[ / ] go round panes, landing where each one's focus last was; Alt+[ / ] step tabs. In a pane with columns, the current column receives what opens.
- **One verb per modifier** from every place you open from: plain replaces what the focused pane shows, Ctrl keeps it as a tab, Alt opens it beside (a new pane when the width holds it, else the neighbour) and leaves the keyboard where it was. A document is open once; opening it again goes to it.
- **A pane says it is loading**, never shows an empty chat meanwhile. Opening a chat hands focus to its composer; a file viewer takes the keyboard once its editor has drawn, unless focus has moved.

**Tabs**

- **A pane of chats or a viewer's column holds documents as tabs**, its header the tab row; a lone document is a row of one. Where you are is text alone: the active tab at the current weight with its ×, the others grey.
- **Switching moves nothing**: tabs keep their order and their bold width; drafts and scroll are kept per document.
- **Chat tabs group by place**, the place named once in caps. A full row drops the tab used longest ago, never the one showing or one with a draft; closing the active tab goes to the one used last. Headers fold, then truncate.
- **A file viewer can stand empty** ("No file open") and split into two columns; a chat pane cannot stand empty.

**Dragging, the dock and the window**

- **Anything that opens can be dragged**, and a drop says what it will do: the target washes the band it lands in and a pill names the result. An edge opens a new pane; the middle replaces, joins as a tab, or swaps two panes; a drop that would do nothing does not wash.
- **The rail opens the dock**, one tool at a time; pressing the open tool closes it. Files follows the pane with the keyboard. Tools open in the dock by default; Alt or dragging opens one as a pane. Any pane can move into the dock (its header, the leader's D, or dragging) and back, keeping its document, state and tabs, with a rail icon of its own; pane A docks only while another can take its place. The dock sits beside the panes or over them, per device.
- **A pane's swap and close** sit once at its right edge.
- **The layout is in the address**: every pane, tab and column is in the URL; Back restores it, a copied link reproduces it.
- **Resizing holds the content still.** Pressing a handle moves nothing, not a pixel. While dragging, a transcript keeps its shape and slides to stay centred until it would clip, then reflows keeping the reader's place; releasing lays it out once.
- **Panes ease; documents don't travel.** Opening eases the others to their new widths, then fades the pane in; closing fades it out, then the rest ease into its room; a swap holds both panes' last frames until loaded, then crossfades. None of this on first load, Back, a phone or reduced motion.

# Keyboard

One model for every surface, so no surface grows keys of its own.

- **Regions.** The app is a tree of regions following focus; shortcuts resolve innermost first, then outward. Ctrl+Shift+1/2/3 go to the sidebar, the panes and the dock, opening and focusing, never closing; Ctrl+B and Ctrl+. stay plain toggles.
- **The leader** (Ctrl+G, then a key) acts within the current region, innermost first, and lists only keys that would do something. Numbers inside a region mean positions, never other regions.
- **Lists:** ↑/↓ move skipping headings, Home/End, →/← into and out of a level, Shift+↑/↓ extends, Menu or Shift+F10 opens the row's menu. ↑ from the top reaches a segmented switch above.
- **Tab** is one stop per section, landing where the cursor last was; entering a page puts focus in its composer. **Enter** acts. **Esc** steps outward a level at a time and always gets back to the composer. A key on a bare pane goes to the composer or the list.
- **New global chords** go in the settings shortcut manager; every scoped key is findable in the leader under its region.
- **Held focus.** A region reached by a go-to shortcut shows a thin `ring` line along its bottom edge, the rest dimming briefly; it stays while focus is in it or nowhere, and goes when focus reaches another region another way. A click or Tab never lights one. Not on a phone.

# Transcript

**Nothing moves once drawn**, at every width and pixel density:

- Every block holds its real height before it is drawn, so scrolling back or a reload's fade moves nothing.
- Starting or ending an interaction (pressing a handle, opening a panel, hovering) shifts no text, not even a device pixel.
- Only the reader (opening a trace, a resize) and the tail spring following new content move an answer.

A "sizzle" -- text that shifts and settles -- is a broken rule: find the structure that changes geometry, not a delay that hides it. docs/TESTING.md has the probes.

- **Answer.** Markdown with no bubble at the body role, in a gutter the composer shares. One gap between blocks and none outside the first and last. Wide tables and code may grow past the column up to the composer's gutters, centred, then scroll inside themselves; the page never scrolls sideways. Links are the text colour with a muted underline; everything else is monochrome but code's syntax colours. The transcript's scrollbar is hidden; panes that scroll as ledgers keep thin thumbs.
- **Formulas.** A display formula is centred; one wider than the column starts at its left and scrolls, never clipped at both ends. Inline math sits on the baseline at the text's size. Partial TeX never shows raw, and a drawn formula never blinks out.
- **Code blocks** fold when long (a fading cut, a foot saying how many lines it hides); the caption stays pinned while the block scrolls by. **Copied** turns Copy's icon to a check and washes what was copied with the tint, fading -- never a ring or a toast.
- **Streaming** appears at a steady pace, not in network bursts; the optional fade is opacity, never colour. An answer's actions and time wait until it has finished appearing. A stopped answer inside a formula draws what was written of it.
- **Message time** is a muted caption at the head of the message's action row, never a line of its own.
- **Trace.** Every turn that answers has a trace header, live and settled: the orb, then `Status · time · work`, and the trail's latest line under it, held open while live. A turn starts as its header. A turn with no thinking or tools is its first line alone. A stopped turn is one row: Interrupted, with discarded text struck under "Not kept".
- **Thinking orb.** Its motion says what the turn is doing; changes hold briefly and crossfade, so bursts don't flicker and no frame is empty. Settled, it turns slowly for Done and sputters in `destructive` for Interrupted and Failed. Every orb shares one frame loop; reduced motion is a still frame. Frames: `docs/design/orb-catalogue/`.
- **Trace trail.** The opened trace: one light line per step, no boxes; repeated steps of one kind are one line; any line opens in place to its output or text.
- **Harness prompt.** A turn the harness started itself opens on one muted line with a bell where the prompt sits, with no bubble and no actions.
- **Disclosure.** Everything that folds is one piece: a header, one turning chevron, a body that unfolds in height and folds to nothing. Opened at the tail, it lets go of the tail rather than being chased.

# Pieces

What each kind of piece does; how it looks is its gallery family.

- **List row.** Follows Interaction exactly. In the sidebar the current row and the folder or workspace holding it are white at the current weight, so where you are reads up the tree. A pinned row looks like its unpinned row. A sidebar action is a row, not a small button by a heading, and is also on the collapsed rail.
- **Menu.** A section label, then one-line rows: an optional mark, the title, muted meta at the right, trailing actions that appear on hover or focus (always on touch). One footer action ("+ New …") under a hairline. Use a popover rather than a menu when rows hold inputs.
- **Choosing in a menu.** The current choice is bold, not ticked. A choice not available here is dimmed and struck through, with no note. No Manage rows: settings are reached from Settings. A menu over a long list starts with "Search all …", which opens the matching palette. It stays open when the follow-up is in the same menu. Ordered choices are a slider whose label opens the levels. A pick list that is not a menu still uses menu rows, the search keeping focus while the arrows walk them. Something edited in place is an inline form in its row; a one-field rename is a dialog. A tap ends where it lifts.
- **Dialog.** A narrow frost card over the dim, centred, small on a phone too. The title and the choice, nothing else: no line repeating the title; a detail only when it asks something; a one-field prompt drops its label. An input is a hairline that brightens on focus. The primary action a white outline, the others a ghost outline, a destructive confirm filled red.
- **Settings list.** The sidebar's language, not tiles: section labels over one-line rows, no box, no dividers between rows, one light hairline between groups. A value is quiet (a select is its muted value and a chevron); descriptions go in a title. Every row's control sits in one column of one width, and the name truncates before the control. Buttons are ghost unless they are the one action waiting. Focus anywhere in a row is the row's wash.
- **Segmented choice** for two to four named peers; a long or open list stays a select. **Switch** for on or off; a checkbox is for choosing items, not settings.
- **Composer.** Controls in tiers by how often they are reached for: the model and the primary slot at full weight, settings showing their value muted, folding into the + as the composer narrows, least used first, and coming back exactly when they fit. The primary slot is one fixed button: Send, Stop while the agent works, Send again with Stop beside it once a draft is typed. Nothing in the row is a white filled button; recording, the mic breathes, with no fill, ring or colour. On a phone: +, the draft, mic and the primary slot, every setting in the + menu.
- **Takeover.** Anything the agent is blocked on (questions, approvals, choices) replaces the composer in its slot rather than stacking above it, and never scrolls inside itself. One question at a time, several as tabs ending in a Submit tab that summarises them; answers are numbered one-line rows, a typed answer last. It takes the keyboard (arrows, a number or Enter chooses, Tab turns the page), and Esc dismisses (a dismissed approval is a denial). A single question with a single answer skips the tabs.
- **User bubble.** A message being edited goes muted and italic in its bubble with no outline, and a frost "Cancel editing" pill floats above the composer.
- **Attachment strip.** Every attachment for the draft in one short strip directly above the composer: images as thumbnails, files as chips. Remove on hover or focus (always on touch); uploading a thin ring; failed a red outline with retry. More scroll sideways, fading at the edge.
- **Toast.** One sentence about what just happened, never a second line or a title: its kind a glyph in the state's colour, at most one action, a ×. Bottom right on desktop, the top on a phone.
- **Leader menu.** What Ctrl+G can do from here, shown after a pause: a small frost card above the composer, the page dimmed but the current region. The region path along its top, rows with keycaps at the left, the go-to chords in its rail.
- **Pane header.** The document's name or tab row at the left; its modes as a segmented switch; quiet ghost controls at the right in the order they are reached for, folding into a ⋯; the pane's swap and close last.
- **Workspace rail.** Mirrors the sidebar's collapsed rail on the right edge: one icon per tool, the dock's tool current; chat search and the palette below a hairline. It is out of the tab order; the tool keys and Ctrl+Shift+3 reach the dock.
- **Harness mark.** Greyed with its row; its own colour on the cursor or the current row. Live activity or an unread reply shows in its place first.
- **Runtime dot.** Colour on the dot only, a label only when it has something to say, a spinner in its place while busy, one per surface, worst state first.
- **App icons.** Only platform-required assets, derived from `public/favicon.svg`: the release C white on black, every dev build inverted; the Windows caption keeps the icon but no text. The Conduit mark is `public/brand/conduit-mark.svg`.

# Intentional exceptions

- **Phone header pills** -- buttons sharing a pill are capsules narrower than tall, concentric with it -- several controls read as one floating object over the transcript.

# References

- `docs/design/palette-sketch/palette-sketch.html` -- chat search, the command palette and their states (serve the repository root).
- `docs/design/orb-catalogue/contact-sheet.html` -- every thinking-orb frame and which state uses it.
- `docs/design/dashboard-layout/`, `docs/design/conduit-home-dashboard/` -- the dashboard sketches.
