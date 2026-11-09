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
- **Heavy pieces load when used.** The text editor brings CodeMirror, so it is never exported from the library's barrel: it is imported from its own file, lazily where the app loads it, keeping the first load inside the bundle budget.
- **A cut-over piece has no classic path**: replacing a piece deletes the old one, its CSS and any fallback in the same change.
- **Overlays go through the shared adapters**: a palette, search or Settings is `OverlayDialog`; a confirm, a one-field prompt or a small form `Dialog` (`alert` for a destructive choice); a menu or pick list the menus adapter; a card that floats without covering the page a frost card alone; a toast the notifications adapter. The build rejects a hand-rolled dialog or a direct notification call. Inside them, material, dim, radius and arrival come from the pieces, and a surface's own CSS sets only its layout.
- **A confirmation is awaited** through `createDecisionScope` before state changes, with a `valid` guard where its target can change within the same view. Only the browser's own tab-close protection stays native.

# Surfaces

Every surface is one of three materials. Choose it first, before any colour, border or radius.

| Surface | Material | Holds |
| --- | --- | --- |
| **Frame** | near-black `frame` | permanent navigation: the sidebar, the collapsed rail, the workspace rail |
| **Pane** | charcoal `background`, no borders | where you work: chats, pages, file viewers, tools |
| **Frost** | `Frost` | anything that floats |

**The test is "does it float?", not "is it where you work?".** Frost is for overlays (palettes, menus, Settings, dialogs; where one covers the page, the page dims) and for floating chrome inside a pane (the composer, user bubbles, the header pill, scroll to latest, riders), centred on the reading column. Inside frost, content follows the pane's rules: one-line rows, headings and space, no boxes. Never frost a row, a list, a tree or the transcript. Something genuinely new is composed inside these surfaces, not beside them.

**Controls take their look from the surface under them.** A surface sets `--tint` (its lines and washes) and `--well` (the fill under an input or an outline button), and controls read only those. Over frost there is no well: an input is a hairline with nothing inside. A surface says what it is with `data-surface`; no control has a rule per surface.

**On a phone an overlay is a full-screen bubble** inside the status and navigation bars, with larger tap targets. It stays a dialog, never a route -- Settings included.

# Interaction

One grammar for every list, menu, picker, palette, tab and setting, taken from the sidebar.

- **Rest.** Grey text, muted icons, harness marks greyed with their row.
- **Cursor.** The row under the pointer, under keyboard focus or being pressed takes the `accent` wash and goes white; a harness mark shows its own colour. One cursor, one row at a time, pointer and keyboard moving the same one. It never changes weight. On something already washed (a chosen segment) it brightens that wash a step. It stays put while the window is in the background.
- **Current.** Where you are -- the open chat and what holds it, the active tab, the chosen option -- is white at the current weight with a heavier icon stroke, and **no fill**. Open but not where you are is white at the resting weight. Cursor and current can always be told apart.
- **Selection.** Several chosen items are the wash on each. A checkbox column appears only in an explicit edit mode.
- **Never** focus rings or outlines, in any colour; coloured bars or slivers; boxes round a row; a tick for the current choice. Keyboard focus is the wash.
- **Nothing hides behind hover.** A choice is made by a click and its actions are visible buttons; a chosen item is the only wash in its list. Hover only says "this one thing is a target": every settings row washes when pointed at or focused, a switch's row too. (A menu row's trailing actions are the one exception: they appear on hover or focus, always on touch.)
- **Fold, don't squeeze.** Controls keep their size. When a row of them stops fitting, the least used fold, last first, into a ⋯ listing only what folded; what must stay (a title, the active tab) truncates only once nothing is left to fold. The fold point is measured from the controls, never a tuned width.

# Colour

The app is locked to dark; the light tokens are leftovers, never painted. The charcoal is cool-neutral at a very low chroma, and that grey is the brand: do not raise it to "read as blue".

- **Near-monochrome.** Muted text for timestamps, hints, empty states and icons at rest. `border` hairlines for inputs, a header or footer rule and dividers; grouping is a heading and space, with at most one hairline between groups, never a box or a fill. `card` solids are left on tool cards only. `primary` is the one bright action.
- **Hue only for state:** `destructive` for errors and destructive actions, `live` and `warn` as small dots and glyphs (never fills, rails or washes). Workspace glyph colours and git dots are data, kept on the glyph.
- **No blue anywhere** -- not for selection, focus, links, status, audio, waveforms or "active" surfaces, and no cool accent or slate tint; leftover blue is removed when touched. Connecting states are muted; success is foreground or `live`. Two exceptions: syntax highlighting inside code, and a status dot's own colour. Frost is the signature, not an accent colour.

# Typography, scale and shape

- **Faces.** Geist Variable for UI; Paper Mono for section labels, keycaps, data (model ids, paths, times, counts) and code; Meslo Nerd Font for the terminal, the one face the user is expected to change. No serif but the first-launch wordmark. Tabular figures wherever numbers tick or line up.
- **Roles, not sizes.** Text takes a size role (`--text-*`) and a weight role (`--weight-*`: light for data under a heavier line, rest, lift for text over frost, strong for titles, buttons and values, current for where you are and a match lit while typing). Every section heading is the section label: Paper Mono, uppercase, letter-spaced, muted. A dashboard's group name is the one strong section name (Geist strong, sentence case, a count in data) beside the quiet label. Meta is muted mono beside a row's title, right-aligned, truncating before the title does.
- **Everything is drawn in the density unit** times a scale: the user's Interface size (the one control they get) times the region's size, tuned so regions sit right against each other. Browser zoom is never the app's scale. Gaps, controls, icons, measures, lines, leadings, tones, opacities and durations are each one of their token steps (lines in whole pixels, never scaled), and a popover sits a token gap from the control that opens it; an offset that lines something up is worked out from what it lines up with. Never a one-off multiplier or a px value. Rows keep a finger's height on a phone.
- **Radii.** `--radius-control` (rows, buttons, inputs, chips; `--radius-inset` nested inside one), `--radius-surface` (popovers, cards, overlays: the control's plus the inset, so rows nest), `--radius-message` (the composer and the user's message: one line is a rounded box, not a pill), `--radius-round` (pills, which never grow, and small round bits), and the pane's. Section titles and metadata are never rounded.
- **Icons** are Lucide, muted at rest, one size per context, the stroke heavier when current. Harness marks and gauges draw their own. The composer's + and mic wear the text colour, as live actions.
- **Depth.** Panes and lists have none. Frost carries it: one material, resting or raised, never redeclared per component. No stacked shadows, coloured glows, mesh gradients or card grids; the voice composer's Aura is the one colour field.
- **The top line.** The sidebar header and every pane header centre on one line. A chat's breadcrumb names its place in caps before the title, with no slash; a page that is a place has no crumb.

# Motion

Motion explains a change of place. A surface that does not change place does not animate.

- **Quick out, gentle in.** Leaving is quick on the leave ease; arriving is gentle on the arrive ease; a change in place is quick; panes easing to new widths start from rest. A move is a fade, a rise, a drop back the way it came, a grow or a slide. Effects that are not moves (the copied wash, a breathing mic) keep their own time.
- **Leave the way you came, then arrive.** Something of the bottom edge leaves downward; a panel leaves toward its control's edge. The outgoing surface goes first; they never cross-fade in place.
- **Transform and opacity only**, except a fold unfolding, a menu's edge running with it, pane widths easing, the composer across a layout switch, the phone composer's pills, and room opening or closing for a part. Words arriving come in by colour; a growing block glides its lines up.
- **Every piece keeps the motion invariants**: parts stack in one order in every state; one transition list per part, states setting only values; room opens before a part fades in and goes after it fades out; two parts never share a spot at once; a change is one move from its first frame; a frost fades itself, never through an ancestor. A new state fits these: check every pair of states, never a one-off fix.
- **What happens to a part's room decides its move**, from the library's named moves: its room goes to a neighbour, it tucks; something takes its place, it fades where it stands; it holds others and its room goes, it collapses. Nothing that gives room jumps; every pill that comes and goes with what there is tucks, on every surface. Whatever holds a part says when it is out, so a frost still fades itself. A new piece uses these moves (fade, tuck, collapse, wipe, give), never a list of its own.
- **Hold the reading position.** A swapped surface keeps its room while away; the transcript moves only through its tail spring.
- **Only the final interface is ever shown.** Every launch, reload, interface swap and server switch is the dark launch screen until every pane's document is laid out and holding still, then every region fading in once, with no rise and nothing arriving or moving after. Never a provisional one: not a snapshot of the last run, a page still loading, or an interface built for another server. A reopen should not reload at all.
- **A send moves at once.** A new chat's first message, or one sent from a dashboard, takes the composer to the chat's foot in the frame the layout changes.
- **Cards belong to the composer.** Queued messages and attachments rise out of it and drop back into it when it takes them; removed by hand, a card fades in place. Anything keyed for animation is keyed by identity, so an update never replays an entrance.
- **A layout switch** happens in the frame the width crosses. Nothing crosses the pane: a section that changes place fades in where it now is; the composer alone eases to its new column. Both layouts share their gutters.
- **Floating controls follow** the surface they are anchored to when it is swapped or lands.
- **Touch is felt, crisply.** A piece's haptic kind (select, press, hold, fold, open, dismiss) names an effect token: short and crisp or a thump, never a timed buzz. Only what a touch did is felt, scaled by the person's Haptics setting. A new meaning gets a kind; a new feel gets a token.
- **Size changes ease, never snap**, the content holding the width it lands at while the frame clips it, so nothing re-wraps mid-motion.
- `prefers-reduced-motion` drops the move and keeps the end state (the meteor field excepted).

# Layout

Desktop is a darker frame with inset rounded panes; the frame's margin is also the gutter you drag. A phone drops the inset and goes full-bleed, with safe-area padding on edge controls. Layouts change at widths measured from their content, never a tuned breakpoint.

- **Chat.** The sidebar on the frame; the chat in its pane; the workspace rail on the right and, when open, the dock -- a second inset pane showing one tool at a time, not a floating card. Answers fill the reading column with no bubble; the user's message is a frosted bubble at the right; the composer floats at the foot in frost. A phone keeps the tools as tabs in the dock's header.
- **Dashboards** (Conduit, project, workspace, harness pages) are one layout: a header with the place's mark, name, a one-line muted status and quiet quick actions -- only verbs nothing else on the page offers; managing the place lives in its ⋯. Below, the composer with the chats under it beside a narrower column of places and state, each scrolling on its own; one column when narrow. On a phone, sections fold under their headings, filters fold into one Filters menu, and the composer docks at the foot. No hero of metric boxes.
- **The Conduit dashboard is the new-chat screen**, the composer focused; a new chat in a place lands on that place's page. Where a chat lives is chosen from the composer's place button.
- **The chats list is one list everywhere**, scoped to where you are, grouped by day. An empty list says so plainly, with no action of its own.
- **Untracked threads.** A harness's own thread that no Conduit chat owns is still a whole chat page, hidden from Conduit's lists, offering Track.
- **Palettes** pin near the top so filtering shrinks them from the bottom. One search row: a leading mark, chips for scope (Backspace on an empty query removes the last, Esc steps out), the query, a quiet close. A drill-down puts Back in the header, never a Back row. Rows are one line, keeping their groups, best match first, the matched letters lit. Chat search previews the highlighted chat beside the results once the cursor rests. A footer rail of the view's actions and keys; on a phone, a bar of buttons.
- **Settings** is a centred frost overlay whose rail is drawn as the sidebar is (on a phone, a screen of its own). It saves as it changes: no Save button; the page says Saving, Saved, or Not saved with Retry; a value not valid yet says why under its field. Credentials and one-off actions keep their own buttons.

# Panes and windows

The panes smoke and the file-tabs test assert these; a change to a rule changes its test.

**Documents and room**

- **A pane holds one document** (chat, page, file viewer, tool, shell). The first pane holds the route; panes beside it are opened, never navigated to.
- **A document declares its minimum width**, in the unit so it grows with the Interface size; containers lay out from those, never their own guesses. A window too narrow for the sidebar beside a chat at its minimum scrolls sideways; the chat is never drawn narrower.
- **Room runs out in one order.** The dock narrows first, then panes move to the dock, last first, document and state kept, and come back when the width holds them. A dragged edge takes room from its neighbour down to its minimum, then the next. Up to three panes, with Equalise and presets at the rail's foot; not on a phone.

**Focus and opening**

- **One pane has the keyboard**; a click anywhere in it gives it. Everything that acts "here" acts on it: the palette, the leader, the model selector, the composer's keys and dictation, the dock's Files. Going round panes lands where each one's focus last was. In a pane with columns, the current column receives what opens.
- **One verb per modifier** from every place you open from: plain replaces what the focused pane shows, Ctrl keeps it as a tab, Alt opens it beside (a new pane when the width holds it, else the neighbour) and leaves the keyboard where it was. A document is open once; opening it again goes to it.
- **A pane says it is loading**, never shows an empty chat meanwhile. Opening a chat hands focus to its composer; a file viewer takes the keyboard once drawn, unless focus has moved.

**Tabs**

- **A pane of chats or a viewer's column holds documents as tabs**, its header the tab row; a lone document is a row of one. The active tab is the current weight with its ×, the others grey.
- **Switching moves nothing**: tabs keep their order and width; drafts and scroll are kept per document.
- **Chat tabs group by place**, the place named once. A full row drops the tab used longest ago, never the one showing or one with a draft; closing the active tab goes to the one used last. Headers fold, then truncate.
- **A file viewer can stand empty** and split into two columns; a chat pane cannot stand empty.

**Dragging, the dock and the window**

- **Anything that opens can be dragged**, and a drop says what it will do: the target washes the band it lands in and a pill names the result. An edge opens a new pane; the middle replaces, joins as a tab, or swaps two panes; a drop that would do nothing does not wash.
- **The rail opens the dock**, one tool at a time; pressing the open tool closes it. Tools open in the dock by default; Alt or dragging opens one as a pane. Files follows the pane with the keyboard. Any pane can move into the dock (its header, the leader, or dragging) and back, keeping its document, state and tabs, with a rail icon of its own; the first pane docks only while another can take its place. The dock sits beside the panes or over them, per device.
- **The layout is in the address**: every pane, tab and column is in the URL; Back restores it, a copied link reproduces it.
- **Resizing holds the content still.** Pressing a handle moves nothing. While dragging, a transcript keeps its shape and slides to stay centred until it would clip, then reflows keeping the reader's place; releasing lays it out once.
- **Panes ease; documents don't travel.** Opening eases the others to their new widths, then fades the pane in; closing fades it out, then the rest ease into its room; a swap holds both panes' last frames until loaded, then crossfades. None of this on first load, Back, a phone or reduced motion.

# Keyboard

docs/plans/keyboard-model.md is the full model (enter, move, act, leave; the Escape ladder; modals exclusive; every key a command); where it and this differ, it wins. One model for every surface, so no surface grows keys of its own.

- **Regions.** The app is a tree of regions following focus; shortcuts resolve innermost first, then outward. Go-to chords open and focus a region, never close it; the sidebar and dock toggles stay plain toggles.
- **The leader** acts within the current region, innermost first, and lists only keys that would do something. Numbers inside a region mean positions, never other regions.
- **Lists:** ↑/↓ move skipping headings, Home/End, →/← into and out of a level, Shift+↑/↓ extends, the menu key opens the row's menu. ↑ from the top reaches a segmented switch above.
- **Tab** is one stop per section, landing where the cursor last was; entering a page puts focus in its composer. **Enter** acts. **Esc** steps outward a level at a time and always gets back to the composer. A key on a bare pane goes to the composer or the list.
- **New global chords** go in the settings shortcut manager; every scoped key is findable in the leader under its region.
- **Held focus.** A region reached by a go-to chord shows a thin `ring` line along its bottom edge, the rest dimming briefly; it stays while focus is in it or nowhere, and goes when focus reaches another region another way. A click or Tab never lights one. Not on a phone.

# Transcript

**Nothing moves once drawn**, at every width and pixel density: every block holds its real height before it is drawn; starting or ending an interaction (pressing a handle, opening a panel, hovering) shifts no text by even a device pixel; only the reader (opening a trace, a resize) and the tail spring move an answer. A "sizzle" -- text that shifts and settles -- is a broken rule: find the structure that changes geometry, not a delay that hides it.

## Rhythm

The room above a part is set by how it relates to the part above it, never by what either is. Each relation is a `--flow-*` token, each a step looser than the last, so a change of kind never reads as a paragraph: lines of one block; lines of work in rows of their own; something attached to the part above (a foot under its answer); blocks of one text; the next part of one reply; an answer under the work it came from; a reply under its message; one exchange to the next. Parts carry no outer margin: the transcript gives the room, each row saying its relation to the row above (a message -- the person's or one the harness sent -- starts a turn, the row after one an exchange; reports under work are work, an answer under work is an answer; anything else in a reply a step); composed of parts, the parts do. Folded's answer is a step under its trace; Narrated's commentary is attached to the runs either side of it. A line's last glyph ends on the column's edge: a line's wash bleeds past the column by its padding at both ends, and a step's chevron takes the place of its time. Phone and desktop share the rhythm.

## Turns

One model draws every turn. A thread (any chat, jbot's included) is Narrated; jbot's message log is Folded.

- **A turn is segments, in the order they came:** reasoning, text and activity (a run of tool calls with no text between). Text is either commentary (the model talking as it works) or the final answer. Conduit carries that label on every text block, live and saved, and the transcript places text by it. docs/plans/transcript-modes.md has what each provider's stream can say.
- **The one policy is who commentary is for.** Narrated (every thread): addressed to the person, every text standing in order with a run of work between. Folded (jbot's message log, where only replies stand): one trace per turn above the message it led to, opening to the turn's whole trail. It is one line that speaks as jbot, in the turn digest's words (turn-digest.js: each step an act on an object in the person's terms, plumbing left out, ranked by how far it reached into their world): live, what it is doing ("jbot is checking Gmail") and its time, "jbot is thinking" from the moment it is sent (waiting on the model is not jbot waking up), the orb doing what jbot is doing; settled, what it did ("jbot checked Gmail and searched the web · 12.4s", the top two and how many more; "jbot worked for 3.1s" when it did nothing to tell), or "jbot was interrupted", "jbot failed" with what it did beside it. No latest line and no trail: the line opens the raw home thread, where the work is. Its orb is kept at rest once settled, standing in the column (its left edge the transcript's and the composer's), not hung in the gutter. A background agent jbot sends from its chat is a row of its own (an AgentRow on one line: its id, task, how it is doing and its time; it opens the agent's thread): under the reply of the turn that sent it while it works, then, once it reports, where it came back, over what jbot made of it. A reply arriving fades in whole (a thread's answer fades in word by word); a reply with no work to show waits for the live row to fade out where it stands. The live trace is the reply's header in waiting: it stays in place as the reply arrives under it, and the person's message shows the moment it is sent. Reasoning folds under both.
- **A run is drawn one way**, as Settings says (Appearance › Reasoning & tool use): its steps, one line (its run header: what it did, its time), or not at all (Turn header only, where the turn header opens to the turn's steps instead); a run is never a header opening to its steps under it, and no control in the transcript changes how runs are drawn. A turn's one run, as a line, is left to its turn header.
- **The turn header** sums the whole turn since the person's message in one line, no orb and no latest line, set apart from the run above and close over the text under it: right after the turn's latest run, under its lines as they come and over the text after it. When a new run starts, the header fades out quickly where it was before the new run shows, then fades in anew under it, so over a final answer it stays. Live, its status is the digest's step under way ("Searching the web", "Checking Gmail"); settled it stays the counts ("1 search, 1 command · 15.7s"). An agent's activity on its row is the same words, said by the hub.
- **Provisional rows** (the turn's starting row, the turn header, jbot's live trace) never fade between their own states: words, time and orb change in place. They fade out (`--duration-quick`) where they were when they make way for other rows, which wait for it, and fade in where they arrive. Only in a turn running now: opening or switching to a chat fades nothing.
- **Nothing is reclassified on screen.** Labelled text is placed by its label from its first word; unlabelled text is pending until its message shows what it was, and the policy decides only where pending text draws. Nothing provider-specific reaches the browser.
- **A step says what it did, on what, in its kind's face:** icon, verb, subject, then a quieter aside that gives way first, an edit's lines added and removed in the data colours, then its time (only from a second). A query (in quotes) or a page is prose; a command or a file is code; `site:` is where a search looked, not what it looked for. An edit opens to its changed lines, not its tool's input; open, a trace's latest line hides, the trail being it. A script is said as its calls, counted by what they were (never "4 scripts"); a connector write is Requested, true whether it ran or only asked. The adapter states this; the browser never parses a tool's input.
- **The trace is the frontier, not a container.** Only a turn's last segment is live. A run header is worded as Folded's: a settled run says what it did and its time; a live one what it is doing, its counts and its latest step, the trail's latest line held open under it. Under Folded the same frontier absorbs commentary. Folded and Narrated open to the same lines, so the two views never describe the same work differently. Done, Interrupted and Failed head a whole turn, never a step. A turn starts as its header; one with no thinking or tools is its first line alone. A stopped turn is one row: Interrupted, with discarded text struck under "Not kept".
- **The trail** is one light line per step, no boxes; repeated steps of one kind are one line; any line opens in place to its output. A fold opening or shutting is one movement and keeps its head where it is: the follow does not chase the size it changes (at the foot, opening grows down past the view; shutting drops what is above as the scroll comes back). A call a script makes is drawn as the same call made directly: how the model chose to express it never changes what the person sees.
- **The orb is Folded's**, on its trace header in the gutter: what the turn is doing and how it ended: settled, it turns slowly for Done and sputters in `destructive` for Interrupted and Failed. Its changes hold briefly and crossfade, so no frame is empty; every orb shares one frame loop; reduced motion is a still frame. A phone has no gutter, so the orb takes a line of its own above the latest generation, never indenting its text. Narrated has no orb: its live trail line says what it is doing (a spinner on the step, "Starting" before anything has shown). Copy, regenerate and the time belong to a turn's last answer only.
- **Hung marks.** Every line of text a turn writes starts on the column's edge; a row that starts with a mark hangs the mark in the gutter, the orb beyond it. Rows inside a fold keep their marks in the column, one indent under the fold's head. The text column is the composer's width, edge to edge; what hangs, hangs past it into the pane. Where a narrow pane makes the turns step in for the orb, envelopes step in by as much, so every row keeps one edge; Narrated turns never step in, and a Folded turn only where the pane has no room for its orb. A phone has no gutter: its marks stay in the column.
- **Disclosure.** Everything that folds is one piece: a header, one turning chevron, a body that unfolds in height and folds to nothing. Opened at the tail, it lets go of the tail rather than being chased.

## Blocks

- **Answer.** Markdown with no bubble, in the gutter the composer shares: one gap between blocks and none outside the first and last. Wide tables and code may grow past the column up to the composer's gutters, centred, then scroll inside themselves; the page never scrolls sideways. Links are the text colour with a muted underline; everything else is monochrome but code's syntax colours. The transcript's scrollbar is hidden; panes that scroll as ledgers keep thin thumbs.
- **Formulas.** A display formula is centred; one wider than the column starts at its left and scrolls. Inline math sits on the baseline at the text's size. Partial TeX never shows raw, a drawn formula never blinks out, and a stopped answer inside a formula draws what was written of it.
- **Code blocks** fold when long (a fading cut, a foot saying how much it hides); the caption stays pinned while the block scrolls by. **Copied** turns Copy's icon to a check and washes what was copied, fading -- never a ring or a toast.
- **Streaming** appears at a steady pace, not in network bursts; the optional fade is opacity, never colour. An answer's actions and time wait until it has finished appearing.
- **The message foot** (the time, a muted caption, then actions) shows on hover or focus and on the latest exchange; on touch, the latest exchange's and a tapped message's (a link, code or control keeps its meaning). Its status and Changes always show. Never a line of its own.
- **Riders: message above, state below.** Riders about the message being written ride on the composer's top edge (queued messages, attachments, references, the voice, the question). Riders about work under way sit below it, only while something runs, in three lists under section labels: Foreground (what the turn waits for), Background, then Runs. A rider is what is current, never a history. Its room opens as it comes (the composer, and a transcript following the bottom, gliding up) and closes behind it as it goes, the composer following it down; a takeover taller than the composer closes its room as it goes. Nothing is squeezed, and room that closes under something following it eases evenly at both ends. A phone keeps them above.
- **Subagents branch and join.** A subagent is not a tool call; the calls are its two ends, the spawn where it branches off and the answer where it joins. Every agent has an id (`fg-N` for a turn's own, `bg-N` in the background), so one place names them all. Agents are drawn on one kind of line (mark, id, task, how it is, time), and agents taken together on one quiet line that drops down theirs (a fan-out is one "Delegated" line): foreground agents the turn waits for where they were delegated; background ones a Started line where they began, the composer's rider while they work, and a Reported line where their answers landed, each able to jump to the other. A run enters from outside, with no Started line: a line marks where its report entered; while it works it sits in the rider's Runs list.
- **Messages in and out.** A thread is drawn as the agent had it: nothing it was given or sent is hidden or reworded. Anything crossing the thread's edge other than the person's own words is an envelope, at the left: who and when (Open when it has a transcript), then the text on a hairline rule hung from the mark, folding when long. In: exactly what the agent received (a run reporting back, how an approval was answered), muted -- it is what the agent reads, not what it says -- with what Conduit added labelled "Conduit added" apart, at caption size: its notes before the text (and before the person's own bubble, at its side), the decision a report asks for after it. Out: what the agent sent the person outside the thread, in the text colour, as its own row after the work it ended, never inside a disclosure. A harness prompt with nothing more to read stays one muted line with its mark, no bubble and no actions; a line the agent was never given says so. A run's report and a notification start as their header line, opening in place to the text. What the agent was given besides messages is a step, never left out: the system prompt above its first message, each later change where it was given, a compaction's summary. The step names what changed; opened, each piece's text under its name. Every runtime chat has them, not only jbot's.

# Pieces

What each kind of piece does; how it looks is its gallery family.

- **List row.** Follows Interaction exactly. In the sidebar the current row and what holds it are white at the current weight, so where you are reads up the tree. A pinned row looks like its unpinned row. A sidebar action is a row, not a small button by a heading, and is also on the collapsed rail.
- **Menu.** A section label, then one-line rows: an optional mark, the title, muted meta at the right, trailing actions on hover or focus (always on touch). One footer action under a hairline. A popover rather than a menu when rows hold inputs. A menu is as big as its rows inside its caps (a phone's narrower and shorter) and the room it has, scrolling past them; a phone's submenus open without taking the typing's focus. A row that opens what it holds in place unfolds under it, the menu's edge running with it up to the room it has before it scrolls, and gives the height back when shut; nothing inside draws a rule. Used where a submenu has nowhere to go (a phone), never for a choice.
- **Choosing in a menu.** The current choice is bold, not ticked. A choice not available here is dimmed and struck through, with no note. Settings are reached from Settings, not Manage rows. A menu over a long list starts with "Search all …", which opens the matching palette. It stays open when the follow-up is in the same menu. Ordered choices are a slider whose label opens the levels. A pick list that is not a menu still uses menu rows, the search keeping focus while the arrows walk them. Something edited in place is an inline form in its row; a one-field rename is a dialog. A tap ends where it lifts.
- **Dialog.** A narrow frost card over the dim, centred, small on a phone too. The title and the choice, nothing else: a detail only when it asks something; a one-field prompt drops its label; an input is a hairline that brightens on focus. The primary action a white outline, the others a ghost outline, a destructive confirm filled red.
- **Settings list.** The sidebar's language, not tiles: section labels over one-line rows, no box, no dividers between rows, one light hairline between groups. A value is quiet (a select is its muted value and a chevron); descriptions go in a title. Every row's control sits in one column of one width, and the name truncates before the control. Buttons are ghost unless they are the one action waiting. Focus anywhere in a row is the row's wash. On a phone the page runs nearly edge to edge and a line keeps its name and control on one row, the field shrinking before the line wraps and a title giving way with an ellipsis; a chord, a link or a status never wraps. Saving shows only once its spinner has made one whole turn; a failure shows at once.
- **Workbench.** A settings page that works on one thing at a time: its title is the thing, choosing another from the same place; the rest of the height a side column and one pane, so the page never scrolls. It opens Settings wider, eased. The pane's bar holds what can be done to it (Save, when waiting, the only filled button), its foot what is known of it (its size, where it comes from, how many share it) and where the caret is; nothing about the thing is repeated above. Settings scroll only when there are too many settings: text is edited in a pane, never on the page -- the workspace editor's setup (find and replace, line numbers, Mod-S saves), read-only the same pane without a caret.
- **Segmented choice** for two to four named peers (with arrows: one Tab stop, the arrows moving the choice), as wide as its words, its thumb and a pointed-at segment inset with the same gap between segments, so two washes never touch; a long or open list stays a select. **Switch** for on or off; a checkbox chooses items, not settings.
- **Composer.** Controls in tiers by how often they are reached for: the model and the primary slot at full weight, settings showing their value muted, folding into the + as it narrows, least used first, and coming back exactly when they fit. The primary slot is one fixed button: Send, Stop while the agent works, Send again with Stop beside it once a draft is typed. Nothing in the row is a white filled button; recording, the mic breathes, with no fill, ring or colour. On a phone: +, the draft, mic and the primary slot, every setting in the + menu.
- **Takeover.** Anything the agent is blocked on (questions, approvals, choices) replaces the composer in its slot rather than stacking above it, and never scrolls inside itself. One question at a time, several as tabs ending in a Submit tab that summarises them, a single question with a single answer skipping the tabs; answers are numbered one-line rows, a typed answer last. It takes the keyboard (arrows, a number or Enter chooses, Tab turns the page), and Esc dismisses (a dismissed approval is a denial).
- **User bubble.** A message being edited goes muted and italic in its bubble with no outline, with a frost "Cancel editing" pill above the composer.
- **Attachments** ride in one short strip directly above the composer: images as thumbnails, files as chips, remove on hover or focus (always on touch); uploading a thin ring, failed a red outline with retry; more scroll sideways, fading at the edge.
- **Toast.** One sentence about what just happened, never a second line or a title: its kind a glyph in the state's colour, at most one action, a ×. Bottom right on desktop, the top on a phone.
- **Pane home.** An empty pane shows its Home: a column above the middle of the pane holding library pieces, its status line in data type.
- **Drawers.** A phone's drawers (the sidebar, the workspace panel) dim the page, one layer under each.
- **Pane header.** The document's name or tab row at the left; its modes as a segmented switch; quiet ghost controls at the right in the order they are reached for, folding into a ⋯; the pane's swap and close last, once.
- **Reading.** What a gauge measures, read at a glance as its menu opens: the bar, then its lines (totals, the parts as a legend, the cache and where it compacts beside Compact now, the account's figures as tiles under their name) at the caption's size, numbers in the data face, so nothing outweighs the bar.
- **Leader menu.** What the leader can do from here, shown after a pause: a small frost card above the composer, the page dimmed but the current region; the region path along its top, rows with keycaps at the left, the go-to chords in its rail.
- **Workspace rail.** Mirrors the sidebar's collapsed rail on the right edge: one icon per tool, the dock's tool current; chat search and the palette below a hairline. It is out of the tab order; the go-to chord reaches the dock.
- **Harness mark.** Greyed with its row; its own colour on the cursor or the current row. Live activity or an unread reply shows in its place first.
- **Runtime dot.** Colour on the dot only, a label only when it has something to say, a spinner while busy, one per surface, worst state first.
- **App icons.** Only platform-required assets, derived from `public/favicon.svg`: the release C white on black, every dev build inverted; the Windows caption keeps the icon but no text.

# Intentional exceptions

- **Phone header pills**: buttons sharing a pill are capsules narrower than tall, concentric with it, so several controls read as one floating object over the transcript.

# References

- `docs/design/palette-sketch/` -- chat search, the command palette and their states.
- `docs/design/orb-catalogue/` -- every thinking-orb frame and which state uses it.
- `docs/design/dashboard-layout/`, `docs/design/conduit-home-dashboard/` -- the dashboard sketches.
- docs/plans/persistent-agent.md -- what every thread is given (blocks, documents, roles, slots, notices).
