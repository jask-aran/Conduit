---
name: Conduit
description: In-app visual language for Conduit. Dark charcoal control plane, inset panes holding plain lists grouped by heading and space, frosted glass for everything that floats. No blue anywhere.
note: "Colours are the dark theme's values in components/ui/styles/theme.css. Every other value (space, type, radius, motion) is a token in components/ui/styles/foundations.css; the body names them, the code holds them."
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

This file holds the rules. Values live in the tokens (`components/ui/styles/foundations.css`), the pieces in `components/ui`, and every piece drawn in every state and density in the gallery (`npm run gallery`). Write rules here, not specs: sizes, timings, copy, counts, fold orders, file names and which piece is used where belong to the code and the gallery, and go stale here. How to verify a rule goes in docs/TESTING.md.

Stack: SolidJS, Kobalte for behaviour, Geist Variable and Paper Mono, Lucide icons. Do not add React, another icon kit, a chart library for chrome, or a second palette.

# Components v2

The app is built from the library (`components/ui`) and its tokens alone, so a change to a token or a piece reaches every use. The library draws shapes; behaviour (Kobalte, the app's state) is the caller's, wrapped round the piece.

- **Nothing styles itself per component.** Sizes come from the space, control, icon and type tokens; corners from `--radius-*`; colour from the surface. A value no token gives is a new token, not a local number.
- **The app gives data and behaviour; the library gives markup.** When the app needs something a piece lacks, it becomes a prop or slot of the piece, shown in its gallery family -- never app markup wearing library classes. Something the library has drawn once is not drawn again: a near-copy draws through the shared piece.
- **A piece owns its moves.** Entering, leaving and removing are its own state on the Motion tokens; callers never animate a piece from outside.
- **One gallery family per piece**, changed with it; the gallery's views go through its shared specs, never markup of their own.
- **Overlays go through the shared adapters**: a palette, search or Settings is `OverlayDialog`, a confirm or small form `Dialog`, a menu or pick list the menus adapter, a confirmation awaited through `createDecisionScope`. The build rejects a hand-rolled dialog.

# Surfaces

Every surface is one of three materials. Choose it first, before any colour, border or radius.

| Surface | Material | Holds |
| --- | --- | --- |
| **Frame** | near-black `frame` | permanent navigation: the sidebar, the collapsed rail, the workspace rail |
| **Pane** | charcoal `background`, no borders | where you work: chats, pages, file viewers, tools |
| **Frost** | `Frost` | anything that floats |

**The test is "does it float?", not "is it where you work?".** Frost is for overlays (palettes, menus, Settings, dialogs; where one covers the page, the page dims) and for floating chrome inside a pane (the composer, user bubbles, the header pill, scroll to latest, riders), centred on the reading column. Inside frost, content follows the pane's rules: one-line rows, headings and space, no boxes. Never frost a row, a list, a tree or the transcript.

**Controls take their look from the surface under them.** A surface sets `--tint` (its lines and washes) and `--well` (the fill under an input or an outline button), and controls read only those. Over frost there is no well: an input is a hairline with nothing inside. A surface says what it is with `data-surface`; no control has a rule per surface.

**On a phone an overlay is a full-screen bubble** inside the status and navigation bars, with larger tap targets. It stays a dialog, never a route -- Settings included.

# Interaction

One grammar for every list, menu, picker, palette, tab and setting, taken from the sidebar.

- **Rest.** Grey text, muted icons, harness marks greyed with their row.
- **Cursor.** The row under the pointer, under keyboard focus or being pressed takes the `accent` wash and goes white; a harness mark shows its own colour. One cursor, one row at a time, pointer and keyboard moving the same one. It never changes weight. On something already washed (a chosen segment) it brightens that wash a step. It stays put while the window is in the background.
- **Current.** Where you are -- the open chat and what holds it, the active tab, the chosen option -- is white at the current weight with a heavier icon stroke, and **no fill**. Open but not where you are is white at the resting weight. Cursor and current can always be told apart.
- **Selection.** Several chosen items are the wash on each. A checkbox column appears only in an explicit edit mode.
- **Never** focus rings or outlines, in any colour; coloured bars or slivers; boxes round a row; a tick for the current choice. Keyboard focus is the wash.
- **Nothing hides behind hover.** Actions a row offers are visible on touch and on focus; hover only says "this one thing is a target".
- **Fold, don't squeeze.** Controls keep their size. When a row of them stops fitting, the least used fold, last first, into a ⋯ listing only what folded; what must stay (a title, the active tab) truncates only once nothing is left to fold. The fold point is measured from the controls, never a tuned width.

# Colour

The app is locked to dark. The charcoal is cool-neutral at a very low chroma, and that grey is the brand: do not raise it to "read as blue".

- **Near-monochrome.** Muted text for timestamps, hints, empty states and icons at rest. `border` hairlines for inputs, a header or footer rule and dividers; grouping is a heading and space, with at most one hairline between groups, never a box or a fill. `primary` is the one bright action.
- **Hue only for state:** `destructive` for errors and destructive actions, `live` and `warn` as small dots and glyphs (never fills, rails or washes). Workspace glyph colours and git dots are data, kept on the glyph.
- **No blue anywhere** -- not for selection, focus, links, status, audio, waveforms or "active" surfaces. Connecting states are muted; success is foreground or `live`. Two exceptions: syntax highlighting inside code, and a status dot's own colour. Frost is the signature, not an accent colour.

# Typography, scale and shape

- **Faces.** Geist Variable for UI; Paper Mono for section labels, keycaps, data (model ids, paths, times, counts) and code; Meslo Nerd Font for the terminal, the one face the user is expected to change. No serif but the first-launch wordmark. Tabular figures wherever numbers tick or line up.
- **Roles, not sizes.** Text takes a size role (`--text-*`) and a weight role (`--weight-*`: light for data under a heavier line, rest, lift for text over frost, strong for titles, buttons and values, current for where you are). Every section heading is the section label: Paper Mono, uppercase, letter-spaced, muted. Meta is muted mono beside a row's title, right-aligned, truncating before the title does.
- **Everything is drawn in the density unit** times a scale: the user's Interface size (the one control they get) times the region's size, tuned so regions sit right against each other. Browser zoom is never the app's scale. Gaps, controls, icons, measures, lines, leadings, tones, opacities and durations are each one of their token steps; an offset that lines something up is worked out from what it lines up with. Never a one-off multiplier or a px value. Rows keep a finger's height on a phone.
- **Radii.** `--radius-control` (rows, buttons, inputs, chips; `--radius-inset` nested inside one), `--radius-surface` (popovers, cards, overlays: the control's plus the inset, so rows nest), `--radius-message` (the composer and the user's message: one line is a rounded box, not a pill), `--radius-round` (pills and small round bits), and the pane's. Section titles and metadata are never rounded.
- **Icons** are Lucide, muted at rest, one size per context, the stroke heavier when current. Harness marks and gauges draw their own.
- **Depth.** Panes and lists have none. Frost carries it: one material, resting or raised. No stacked shadows, coloured glows, mesh gradients or card grids; the voice composer's Aura is the one colour field.
- **The top line.** The sidebar header and every pane header centre on one line. A chat's breadcrumb names its place in caps before the title; a page that is a place has no crumb.

# Motion

Motion explains a change of place. A surface that does not change place does not animate.

- **Quick out, gentle in.** Leaving is quick on the leave ease; arriving is gentle on the arrive ease; a change in place is quick; panes easing to new widths start from rest. A move is a fade, a rise, a drop back the way it came, a grow or a slide. Effects that are not moves (the copied wash, a breathing mic) keep their own time.
- **Leave the way you came, then arrive.** Something of the bottom edge leaves downward; a panel leaves toward its control's edge. The outgoing surface goes first; they never cross-fade in place.
- **Transform and opacity only**, except a fold unfolding, a menu's edge running with it, pane widths easing, and room opening or closing for a part.
- **Every piece keeps the motion invariants**: parts stack in one order in every state; one transition list per part, states setting only values; room opens before a part fades in and goes after it fades out; two parts never share a spot at once; a change is one move from its first frame; a frost fades itself, never through an ancestor. A new state fits these: check every pair of states, never a one-off fix.
- **What happens to a part's room decides its move**, from the library's named moves: its room goes to a neighbour, it tucks; something takes its place, it fades where it stands; it holds others and its room goes, it collapses. Nothing that gives room jumps. A new piece uses these, never a list of its own.
- **Hold the reading position.** A swapped surface keeps its room while away; the transcript moves only through its tail spring.
- **Only the final interface is ever shown.** Every launch, reload, interface swap and server switch is the dark launch screen, then the ready interface fading in once, with nothing arriving or moving after. Never a provisional one: not a snapshot of the last run, a page still loading, or an interface built for another server. A reopen should not reload at all.
- **A send moves at once.** A new chat's first message takes the composer to the chat's foot in the frame the layout changes.
- **Cards belong to the composer.** Queued messages and attachments rise out of it and drop back into it when it takes them; removed by hand, a card fades in place. Anything keyed for animation is keyed by identity, so an update never replays an entrance.
- **A layout switch** happens in the frame the width crosses: a section that changes place fades in where it now is; the composer alone eases to its new column.
- **Floating controls follow** the surface they are anchored to when it is swapped or lands.
- **Touch is felt, crisply.** A piece's haptic kind (select, press, hold, fold, open, dismiss) names an effect token: short and crisp, never a timed buzz. Only what a touch did is felt, scaled by the person's Haptics setting.
- **Size changes ease, never snap**, the content holding the width it lands at while the frame clips it, so nothing re-wraps mid-motion.
- `prefers-reduced-motion` drops the move and keeps the end state.

# Layout

Desktop is a darker frame with inset rounded panes; the frame's margin is also the gutter you drag. A phone drops the inset and goes full-bleed, with safe-area padding on edge controls. Layouts change at widths measured from their content, never a tuned breakpoint.

- **Chat.** The sidebar on the frame; the chat in its pane; the workspace rail on the right and, when open, the dock -- a second inset pane showing one tool at a time, not a floating card. Answers fill the reading column with no bubble; the user's message is a frosted bubble at the right; the composer floats at the foot in frost.
- **Dashboards** (Conduit, project, workspace, harness pages) are one layout: a header with the place's mark, name, a one-line muted status and quiet quick actions -- only verbs nothing else on the page offers; managing the place lives in its ⋯. Below, the composer with the chats under it beside a narrower column of places and state, each scrolling on its own; one column when narrow. On a phone, sections fold under their headings and filters into one menu. No hero of metric boxes.
- **The Conduit dashboard is the new-chat screen**, the composer focused; a new chat in a place lands on that place's page.
- **The chats list is one list everywhere**, scoped to where you are, grouped by day. An empty list says so plainly, with no action of its own.
- **Untracked threads.** A harness's own thread that no Conduit chat owns is still a whole chat page, hidden from Conduit's lists, offering Track.
- **Palettes** pin near the top so filtering shrinks them from the bottom. One search row: a leading mark, chips for scope (Backspace on an empty query removes the last, Esc steps out), the query, a quiet close. A drill-down puts Back in the header, never a Back row. Rows are one line, best match first, the matched letters lit. A footer rail of the view's actions and keys; on a phone, a bar of buttons.
- **Settings** is a centred frost overlay whose rail is drawn as the sidebar is (on a phone, a screen of its own). It saves as it changes: no Save button; the page says Saving, Saved, or Not saved with Retry; a value not valid yet says why under its field. Credentials and one-off actions keep their own buttons.

# Panes and windows

The panes smoke and the file-tabs test assert these; a change to a rule changes its test.

**Documents and room**

- **A pane holds one document** (chat, page, file viewer, tool, shell). The first pane holds the route; panes beside it are opened, never navigated to.
- **A document declares its minimum width**, in the unit so it grows with the Interface size; containers lay out from those, never their own guesses. A window too narrow for the sidebar beside a chat at its minimum scrolls sideways; the chat is never drawn narrower.
- **Room runs out in one order.** The dock narrows first, then panes move to the dock, last first, document and state kept, and come back when the width holds them. A dragged edge takes room from its neighbour down to its minimum, then the next. Not on a phone.

**Focus and opening**

- **One pane has the keyboard**; a click anywhere in it gives it. Everything that acts "here" acts on it. In a pane with columns, the current column receives what opens.
- **One verb per modifier** from every place you open from: plain replaces what the focused pane shows, Ctrl keeps it as a tab, Alt opens it beside and leaves the keyboard where it was. A document is open once; opening it again goes to it.
- **A pane says it is loading**, never shows an empty chat meanwhile. Opening a chat hands focus to its composer; a file viewer takes the keyboard once drawn, unless focus has moved.

**Tabs**

- **A pane of chats or a viewer's column holds documents as tabs**, its header the tab row; a lone document is a row of one. The active tab is the current weight with its ×, the others grey.
- **Switching moves nothing**: tabs keep their order and width; drafts and scroll are kept per document.
- **Chat tabs group by place**, the place named once. A full row drops the tab used longest ago, never the one showing or one with a draft; closing the active tab goes to the one used last.
- **A file viewer can stand empty** and split into two columns; a chat pane cannot stand empty.

**Dragging, the dock and the window**

- **Anything that opens can be dragged**, and a drop says what it will do: the target washes the band it lands in and a pill names the result. A drop that would do nothing does not wash.
- **The rail opens the dock**, one tool at a time; pressing the open tool closes it. Tools open in the dock by default; Alt or dragging opens one as a pane. Any pane can move into the dock and back, keeping its document, state and tabs.
- **The layout is in the address**: every pane, tab and column is in the URL; Back restores it, a copied link reproduces it.
- **Resizing holds the content still.** Pressing a handle moves nothing. While dragging, a transcript keeps its shape and slides to stay centred until it would clip, then reflows keeping the reader's place.
- **Panes ease; documents don't travel.** Opening eases the others to their new widths, then fades the pane in; closing fades it out, then the rest ease into its room. None of this on first load, Back, a phone or reduced motion.

# Keyboard

docs/plans/keyboard-model.md is the full model (enter, move, act, leave; the Escape ladder; modals exclusive; every key a command); where it and this differ, it wins. One model for every surface, so no surface grows keys of its own.

- **Regions.** The app is a tree of regions following focus; shortcuts resolve innermost first, then outward. Go-to chords open and focus a region, never close it.
- **The leader** acts within the current region, innermost first, and lists only keys that would do something.
- **Lists:** ↑/↓ move skipping headings, Home/End, →/← into and out of a level, Shift+↑/↓ extends, the menu key opens the row's menu.
- **Tab** is one stop per section, landing where the cursor last was. **Enter** acts. **Esc** steps outward a level at a time and always gets back to the composer.
- **New global chords** go in the settings shortcut manager; every scoped key is findable in the leader under its region.
- **Held focus.** A region reached by a go-to chord shows a thin `ring` line along its bottom edge while focus is in it; a click or Tab never lights one. Not on a phone.

# Transcript

**Nothing moves once drawn**, at every width and pixel density: every block holds its real height before it is drawn; starting or ending an interaction (pressing a handle, opening a panel, hovering) shifts no text by even a device pixel; only the reader (opening a trace, a resize) and the tail spring move an answer. A "sizzle" -- text that shifts and settles -- is a broken rule: find the structure that changes geometry, not a delay that hides it.

## Rhythm

The room above a part is set by how it relates to the part above it, never by what either is. Each relation is a `--flow-*` token, each a step looser than the last, so a change of kind never reads as a paragraph: lines of one block; lines of work in rows of their own; something attached to the part above (a foot under its answer); blocks of one text; the next part of one reply; an answer under the work it came from; a reply under its message; one exchange to the next. Parts carry no outer margin: the transcript gives the room, each row saying its relation to the row above. Phone and desktop share the rhythm.

## Turns

One model draws every turn, a chat's and jbot's alike; they differ in one policy, not in renderer.

- **A turn is segments, in the order they came:** reasoning, text and activity (a run of tool calls with no text between). Text is either commentary (the model talking as it works) or the final answer. Conduit carries that label on every text block, live and saved, and the transcript places text by it. docs/plans/transcript-modes.md has what each provider's stream can say.
- **The one policy is who commentary is for.** Folded: working-out for the model, folded into the turn's one trace, the final answer alone standing (a chat's default). Narrated: addressed to the person, every text standing in order with a trace per activity run between (jbot). Reasoning folds under both.
- **Nothing is reclassified on screen.** Labelled text is placed by its label from its first word; unlabelled text is pending until its message shows what it was, and the policy decides only where pending text draws. Nothing provider-specific reaches the browser.
- **A step says what it did, on what, in its kind's face:** icon, verb, subject, then a quieter aside that gives way first, an edit's lines added and removed in the data colours, then its time (only from a second). A query or a page is prose; a command or a file is code. A script is said as its calls, counted by what they were. The adapter states this; the browser never parses a tool's input.
- **The trace is the frontier, not a container.** Only a turn's last segment is live. A settled run says what it did and its time; a live one what it is doing, its counts and its latest step. Folded and Narrated open to the same lines, so the two views never describe the same work differently. Done, Interrupted and Failed head a whole turn, never a step.
- **The orb is Folded's**, on its trace header in the gutter: what the turn is doing and how it ended. Its changes hold briefly and crossfade, so no frame is empty; every orb shares one frame loop; reduced motion is a still frame. Narrated has no orb: its live trail line says what it is doing. Copy, regenerate and the time belong to a turn's last answer only.
- **Hung marks.** Every line of text a turn writes starts on the column's edge; a row that starts with a mark hangs the mark in the gutter, the orb beyond it. Rows inside a fold keep their marks in the column. A phone has no gutter.
- **Disclosure.** Everything that folds is one piece: a header, one turning chevron, a body that unfolds in height and folds to nothing. Opened at the tail, it lets go of the tail rather than being chased.

## Blocks

- **Answer.** Markdown with no bubble, in the gutter the composer shares. Wide tables and code may grow past the column up to the composer's gutters, then scroll inside themselves; the page never scrolls sideways. Links are the text colour with a muted underline; everything else is monochrome but code's syntax colours.
- **Formulas.** A display formula is centred; one wider than the column starts at its left and scrolls. Partial TeX never shows raw, and a drawn formula never blinks out.
- **Code blocks** fold when long (a fading cut, a foot saying how much it hides); the caption stays pinned while the block scrolls by. **Copied** turns Copy's icon to a check and washes what was copied, fading -- never a ring or a toast.
- **Streaming** appears at a steady pace, not in network bursts. An answer's actions and time wait until it has finished appearing.
- **The message foot** (time, then actions) shows on hover or focus and on the latest exchange; on touch, the latest exchange's and a tapped message's. Never a line of its own.
- **Riders: message above, state below.** Riders about the message being written ride on the composer's top edge (queued messages, attachments, references, the voice, the question). Riders about work under way sit below it, only while something runs: a rider is what is current, never a history. Their room opens as they come and closes behind them as they go; nothing is squeezed. A phone keeps them above.
- **Subagents branch and join.** A subagent is not a tool call; the calls are its two ends. Every agent has an id, so one place names them all; agents taken together are one quiet line that drops down theirs.
- **Messages in and out.** A thread is drawn as the agent had it: nothing it was given or sent is hidden or reworded. Anything crossing the thread's edge other than the person's own words is an envelope, at the left: who and when, then the text on a hairline rule, folding when long. In: exactly what the agent received, muted (it is what the agent reads, not what it says), with what Conduit added labelled apart. Out: what the agent sent the person outside the thread, in the text colour, as its own row. What the agent was given besides messages (its system prompt, later changes to it, a compaction's summary) is a step, never left out.

# Pieces

What each kind of piece does; how it looks is its gallery family.

- **List row.** Follows Interaction exactly. In the sidebar the current row and what holds it are white at the current weight, so where you are reads up the tree. A sidebar action is a row, not a small button by a heading.
- **Menu.** A section label, then one-line rows: an optional mark, the title, muted meta at the right, trailing actions on hover or focus (always on touch). One footer action under a hairline. A popover rather than a menu when rows hold inputs. A row that opens what it holds in place unfolds under it, used where a submenu has nowhere to go, never for a choice.
- **Choosing in a menu.** The current choice is bold, not ticked. A choice not available here is dimmed and struck through, with no note. Settings are reached from Settings, not Manage rows. A menu over a long list starts with "Search all …". Ordered choices are a slider. A tap ends where it lifts.
- **Dialog.** A narrow frost card over the dim. The title and the choice, nothing else; a detail only when it asks something. The primary action a white outline, the others a ghost outline, a destructive confirm filled red.
- **Settings list.** The sidebar's language, not tiles: section labels over one-line rows, no box, one light hairline between groups. A value is quiet; descriptions go in a title. Every row's control sits in one column, and the name truncates before the control. Focus anywhere in a row is the row's wash. On a phone a line keeps its name and control on one row, the field shrinking before the line wraps.
- **Workbench.** A settings page that works on one thing at a time: its title is the thing, choosing another from the same place; the rest of the height a side column and one pane, so the page never scrolls. The pane's bar holds what can be done to it, its foot what is known of it; nothing about the thing is repeated above. Text is edited in a pane, never on the page.
- **Segmented choice** for two to four named peers, as wide as its words; a long or open list stays a select. **Switch** for on or off; a checkbox chooses items, not settings.
- **Composer.** Controls in tiers by how often they are reached for: the model and the primary slot at full weight, settings showing their value muted, folding into the + as it narrows. The primary slot is one fixed button: Send, Stop while the agent works, Send again with Stop beside it once a draft is typed. Recording, the mic breathes, with no fill, ring or colour.
- **Takeover.** Anything the agent is blocked on (questions, approvals, choices) replaces the composer in its slot rather than stacking above it, and never scrolls inside itself. One question at a time, several as tabs ending in a summary; it takes the keyboard, and Esc dismisses (a dismissed approval is a denial).
- **User bubble.** A message being edited goes muted and italic in its bubble, with a frost "Cancel editing" pill above the composer.
- **Attachments** ride directly above the composer: images as thumbnails, files as chips; uploading a thin ring, failed a red outline with retry.
- **Toast.** One sentence about what just happened: its kind a glyph in the state's colour, at most one action, a ×.
- **Pane header.** The document's name or tab row at the left; its modes as a segmented switch; quiet controls at the right in the order they are reached for, folding into a ⋯; the pane's swap and close last, once.
- **Reading.** What a gauge measures, read at a glance as its menu opens: the bar, then its lines (totals, the parts as a legend, the account's figures) at the caption's size, numbers in the data face, so nothing outweighs the bar.
- **Leader menu.** What the leader can do from here, shown after a pause: a small frost card above the composer, the page dimmed but the current region; the region path along its top, rows with keycaps at the left.
- **Workspace rail.** Mirrors the sidebar's collapsed rail on the right edge: one icon per tool, the dock's tool current. It is out of the tab order; the go-to chord reaches the dock.
- **Harness mark.** Greyed with its row; its own colour on the cursor or the current row.
- **Runtime dot.** Colour on the dot only, a label only when it has something to say, a spinner while busy, worst state first.
- **App icons.** The release C white on black, every dev build inverted, all derived from `public/favicon.svg`.

# Intentional exceptions

- **Phone header pills**: buttons sharing a pill are capsules narrower than tall, concentric with it, so several controls read as one floating object over the transcript.

# References

- `docs/design/palette-sketch/` -- chat search, the command palette and their states.
- `docs/design/orb-catalogue/` -- every thinking-orb frame and which state uses it.
- `docs/design/dashboard-layout/`, `docs/design/conduit-home-dashboard/` -- the dashboard sketches.
- docs/plans/persistent-agent.md -- what every thread is given (blocks, documents, roles, slots, notices).
