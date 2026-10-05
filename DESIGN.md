---
name: Conduit
description: In-app visual language for Conduit. Dark charcoal control plane, inset panes holding plain lists grouped by heading and space, frosted glass floating chrome. No blue anywhere.
note: "Frontmatter tokens are roles and ranges. Body copy wins on conflict."
colors:
  frame: "oklch(0.138 0.004 264)"
  background: "oklch(0.186 0.005 264)"
  foreground: "oklch(0.93 0.003 258)"
  card: "oklch(0.225 0.006 264)"
  popover: "oklch(0.208 0.006 264)"
  primary: "oklch(0.95 0.002 258)"
  primary-foreground: "oklch(0.2 0.006 264)"
  secondary: "oklch(1 0 0 / 6%)"
  secondary-foreground: "oklch(0.93 0.003 258)"
  muted: "oklch(1 0 0 / 5%)"
  muted-foreground: "oklch(0.63 0.006 262)"
  accent: "oklch(1 0 0 / 7%)"
  accent-foreground: "oklch(0.96 0.003 258)"
  destructive: "oklch(0.645 0.19 18)"
  border: "oklch(1 0 0 / 7%)"
  input: "oklch(1 0 0 / 9%)"
  ring: "oklch(0.78 0.008 258)"
  sidebar: "transparent"
  sidebar-foreground: "oklch(0.9 0.003 258)"
  glass-bg: "oklch(0.3 0.006 264 / 52%)"
  glass-border: "oklch(1 0 0 / 10%)"
  frost-fill: "#ffffff2b"
  frost-stroke: "#ffffff4d"
  live: "oklch(0.62 0.17 145)"
  warn: "oklch(0.75 0.15 75)"
typography:
  sans:
    fontFamily: Geist Variable
    fontSize: 13px
    fontWeight: 400
    lineHeight: 1.45
  heading:
    fontFamily: Geist Variable
    fontSize: 20px
    fontWeight: 600
    letterSpacing: -0.035em
    lineHeight: 1.05
  display:
    fontFamily: Geist Variable
    fontSize: 31px
    fontWeight: 560
    letterSpacing: -0.035em
    lineHeight: 1.05
  label:
    fontFamily: Geist Variable
    fontSize: 12px
    fontWeight: 620
  caption:
    fontFamily: Geist Variable
    fontSize: 9px
    fontWeight: 400
  row-title:
    fontFamily: Geist Variable
    fontSize: 10.5px
    fontWeight: 580
  meta:
    fontFamily: ui-monospace, SFMono-Regular, Consolas, monospace
    fontSize: 11px
    fontWeight: 400
  keycap:
    fontFamily: ui-monospace, SFMono-Regular, Menlo, monospace
    fontSize: 8px
    fontWeight: 500
rounded:
  sm: 5px
  md: 8px
  lg: 10px
  pop: 11px
  bubble: 15px
  xl: 16px
  composer: 22px
  pill: 999px
spacing:
  xs: 4px
  sm: 8px
  md: 12px
  lg: 20px
  xl: 28px
  pane-inset: 8px
components:
  pane:
    backgroundColor: "{colors.background}"
    textColor: "{colors.foreground}"
    rounded: "{rounded.xl}"
  tile:
    backgroundColor: "transparent"
    textColor: "{colors.foreground}"
    rounded: "{rounded.lg}"
  card:
    backgroundColor: "{colors.card}"
    textColor: "{colors.foreground}"
    rounded: "{rounded.lg}"
  popover:
    backgroundColor: "{colors.popover}"
    textColor: "{colors.foreground}"
    rounded: "{rounded.pop}"
  frost-chrome:
    backgroundColor: "{colors.frost-fill}"
    textColor: "{colors.foreground}"
    rounded: "{rounded.composer}"
  user-bubble:
    backgroundColor: "{colors.glass-bg}"
    textColor: "{colors.foreground}"
    rounded: "{rounded.bubble}"
  row-hover:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.accent-foreground}"
    rounded: "{rounded.md}"
  row-selected:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.foreground}"
    rounded: "{rounded.md}"
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.primary-foreground}"
    rounded: "{rounded.md}"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.foreground}"
    rounded: "{rounded.md}"
  input-quiet:
    backgroundColor: "transparent"
    textColor: "{colors.foreground}"
    rounded: "{rounded.md}"
  input-bordered:
    backgroundColor: "transparent"
    textColor: "{colors.foreground}"
    rounded: "{rounded.md}"
---


# Overview

Conduit is a self-hosted, always-dark agent control plane. The look is charcoal and quiet: a darker frame, inset rounded panes, plain lists grouped by a heading and space, and frosted glass for everything that floats. It is not a marketing site, not a light theme, and not a colorful dashboard.

Three surfaces are the references; copy them before inventing anything:

- **The sidebar** -- how everything is interacted with: grey at rest, the wash as the one cursor, the current item bold with no fill, no outlines, driven as easily from the keyboard.
- **Chat search and the command palette** -- the frost overlay: what anything that opens on top of the app looks like (`docs/design/palette-sketch/palette-sketch.html`).
- **The dashboards** -- the pane: laying things out on grey without borders, in clean single lines grouped by heading and space.

This file is the whole design language and the one place its rules live: read it before building or changing any UI. It holds the general rules; where a detail is not here, the code is the record of it. Choose the surface first (Surfaces), then follow the one interaction grammar (Interaction); components, motion and keyboard follow from those two. Numbers here are current values unless a rule says otherwise: a size or duration written as `~` describes what the code does today, not a constraint on changing it. A surface that does not match yet is listed under Being migrated -- do not copy it.

Stack: SolidJS, Kobalte primitives, Geist Variable, tokens in `conduit-web/src/client/styles.css`. Do not add React, extra icon kits, or a second palette.

# Surfaces

Every surface is one of three materials. Choose it first, before any colour, border or radius.

| Surface | Material | Reference | Holds |
|---|---|---|---|
| **Frame** | near-black `{colors.frame}` | the sidebar | permanent navigation: the sidebar, the collapsed rail, the workspace rail |
| **Pane** | charcoal `{colors.background}`, no borders, single-line rows grouped by heading and space | the dashboards | where you work: chats, pages, file viewers, tools |
| **Frost** | the composer's frost (Elevation & Depth) | chat search and the palette | anything that floats |

**The test is "does it float?", not "is it where you work?".** Frost covers two kinds of floating thing:

- **Overlays** -- anything that opens on top of the app: chat search, the command palette, the model selector, the leader menu, dropdown menus, Settings, dialogs and confirms. Where one covers the page, the page dims behind it.
- **Floating chrome** inside a pane -- the composer, user bubbles, the header pill, scroll-to-latest, the attachment strip, the composer takeover. It floats over the transcript, so it is frost even though it is where you work. It is centred on the reading column where it applies, at a larger radius (Shapes).

Inside frost, content follows the pane's rules: one-line rows, headings and space, no boxes, and never frost on a row of its own.

**Build an overlay from the shared pieces in `components/frost.tsx`**, never a copy of another overlay -- the build fails on a hand-rolled Kobalte dialog:

| Building | Use |
| --- | --- |
| a palette, search or any surface that filters | `FrostOverlay` (pinned near the top; `placement="center"` for one that does not filter, like Settings) |
| a confirm, a one-field prompt, a small piece of content | `FrostDialog` (`alert` for a destructive choice, `size="wide"` when it holds content, `close` for a ×, `actions` for its buttons) |
| a menu, context menu or submenu | `Menu*` / `ContextMenu*` (`components/primitives.tsx`) |
| a pick list anchored to a control | `PopoverContent` holding `PopoverSearchList` |
| a card that floats without covering the page (the leader menu) | `frost-card` alone |

Inside them: rows take `frost-row` (the cursor wash on `data-highlighted`, where you are by `aria-current`), keys `Keycap`, the foot `frost-rail`, a dialog's buttons `frost-dialog-actions`. Material, dim, radius and arrival come from those pieces and the `--frost-*` tokens; a surface's own CSS sets only its layout. Something genuinely new (the context usage readout) is composed inside these, not beside them.

**On a phone an overlay is a full-screen bubble:** it fills the visual viewport inside the status and navigation bars (`--phone-overlay-padding`, never its own inset) with a small margin and larger tap targets, and stays a dialog, never a new route -- Settings included. Frost over a full-screen overlay gets a darker core, because nothing around it is dimmed and the page behind would otherwise show through at full contrast. Desktop overlays keep plain frost over the dim.

# Interaction

One grammar for every surface -- frame, pane or frost -- taken from the sidebar. Lists, menus, pickers, palettes, tabs and settings all follow it; none invents its own.

- **Rest.** Grey text, muted icons, harness marks greyed with their row.
- **Cursor.** The row under the pointer, under keyboard focus, or being pressed takes the `{colors.accent}` wash and goes white; a harness mark shows its own colour. There is one cursor, only one row at a time, and pointer and keyboard move the same one. The cursor never changes weight. On something already washed -- the chosen segment of a segmented switch -- the cursor brightens that wash a step toward the text colour instead. It stays where it was while the window is in the background.
- **Current.** Where you are -- the open chat, the folder or workspace holding it, the active tab, the current section, the chosen option in a menu or picker -- is white at the current weight (Typography) with its icon at a heavier stroke (Icons), and **no fill**. Something open but not where you are (the other pane's chat, a tab showing in an unfocused pane) is white at the resting weight. The cursor and the current item can always be told apart.
- **Selection.** Several chosen items are the cursor's wash on each: no edge bar, tick column or other marker. A checkbox column appears only in an explicit edit mode (chat search's Edit).
- **Never.** Focus rings or outlines, from the browser or a component, in any colour; coloured bars or slivers; boxes drawn around a row to mark it; a tick column for the current choice. Keyboard focus is the wash and nothing else.
- **Fold, don't squeeze.** Controls keep their size and only draw together. When a row of them stops fitting, the least-used fold, last first, into a ⋯ that lists only what has folded; what must stay (a title, the active tab) truncates only once nothing is left to fold. The fold point is measured from the controls, never a tuned px width.

The keys that move the cursor are in Keyboard; the row itself is List row (Components).

# Colors

The app is locked to `.dark` on `<html>`. Light `:root` tokens exist as leftovers; never paint them.

The charcoal is cool-neutral at chroma ~0.004–0.006. That gray is the brand. Do not raise chroma to make it "read as blue."

- **frame** — page ground behind inset panes.
- **background** — inset pane fill.
- **foreground / muted-foreground** — type. Muted for timestamps, hints, empty states, icons at rest.
- **border** — 1px hairlines: inputs, a header or footer rule, and dividers. Grouping is a heading and space, with at most one hairline between groups -- not a hairline box and not a fill. Panes have no edge hairline.
- **accent** — white at 6–7% opacity. This is hover, pressed, and selected. Selection is a gray wash, never a hue.
- **card / popover** — slightly raised solids, left on tool cards. Overlays are frost (Surfaces).
- **primary** — near-white. Default buttons and the one bright action.
- **destructive** — errors and destructive actions only.
- **live / warn** — tiny runtime dots and git-ish status. Never as fills, rails, or card washes.
- **frost-fill / frost-stroke / glass-bg / glass-border** — the signature floating material (Elevation & Depth).

Workspace glyph colors and git file dots are user/data colors, not brand. Leave them on the glyph; do not echo them into chrome.

## Forbidden color

No blue anywhere. There is no blue accent token. Do not introduce `--accent-cool` or any steely, slate, or "intelligent blue", for any purpose: selected rows, cards or nav items; a left-edge sliver or inset rail; a gradient wash on a selected control; status strips or "this is active" surfaces; focus; links in an answer (they are the text colour with a muted underline); runtime dots, waveform bars, audio or connecting states, success text, icon tints.

Two exceptions. Syntax highlighting inside code may use blue as a semantic token colour; the exception does not reach editor chrome, selection, focus, status or navigation. A status dot that already carries its own colour (the unread/recent dot on a chat row) keeps it: the rule is against blue injected into chrome, not a state's own mark.

Replacements: active/connecting states use `{colors.muted-foreground}`; live stays `{colors.live}` green, warn amber, danger red; success/ready text uses `{colors.foreground}` or `{colors.live}`; waveform bars and audio chrome use foreground/muted tints.

That blue treatment is leftover frontend-design skill output. Do not encode, copy or extend it; remove it where you find it (Being migrated).

# Typography

Geist Variable everywhere for UI. `ui-monospace` (not Geist Mono) for model ids, paths, keycaps, times and counts in meta, status, waveforms. Tabular figures wherever numbers tick or line up.

A handful of roles, each defined once in `styles.css`; components name a role rather than a size:

- **display** — the dashboard title only. Tight tracking.
- **heading** — settings and dialog titles.
- **body** — chat, answers, inputs.
- **row** — the sidebar row: every list, menu, palette and settings row takes it (a touch larger on a phone, a touch heavier and brighter over frost, since text over frost reads thinner).
- **group label** — the sidebar's: sentence case, bold, about half the text colour. Every group heading in a list, menu or palette is this; the breadcrumb's place caps are the one uppercase label.
- **caption** — section subtitles, timestamps, empty copy.
- **meta** — muted mono beside a row's title, right-aligned, truncating before the title does.
- **keycap** — small mono in a rounded hairline square, muted; in the text colour on the cursor row or a clickable rail action.

Two weights carry state: the resting weight and the **current weight** (semibold). Every surface uses the same pair; a match lit while typing is the one heavier step. Do not invent further sizes or weights per component. No serif except the Capacitor first-launch wordmark (legacy).

# Layout

Desktop is a darker **frame** with **inset rounded panes**, separated by the frame's margin, which is also the gutter you drag. Mobile drops the inset and goes full-bleed, keeping safe-area padding on edge controls. On either side of the phone layout, things only draw closer; layouts change at widths measured from their content (Interaction: Fold, don't squeeze).

- **Chat.** The sidebar on the frame; the chat in its pane; the workspace rail on the right edge and, when open, the **dock** -- a second inset pane showing one tool at a time (Files, Source Control, Chat review, Terminal), not a floating card. Assistant markdown is the full reading column; user messages are a right-aligned frosted bubble. The composer sits at the bottom of the pane in frost, the reference material for all floating chrome. A phone keeps the tools as tabs in the dock's header.
- **Dashboards** -- the Conduit, project, workspace and harness pages -- are one layout (`dashboard/primitives/split.tsx`): listed content, no tiles. A header carries the page's mark and name, a one-line muted **status row** saying where things stand, and quiet text **quick actions** -- only verbs for the place nothing else on the page offers; managing the place lives in its ⋯, and actions fold into it as room runs out. Below, two columns while the left holds its controls at full size: the composer with the chats under it, beside a narrower column of places and state, each scrolling on its own. Narrower, one column in that order. The switch is the only point the layout changes (Motion: A layout switch). On a phone, sections fold under their headings, filters fold into one Filters menu, and the composer docks at the foot.
- **The Conduit dashboard is the new-chat screen.** New chat lands here with the composer focused; a new chat in a place lands on that place's page. The composer is at the centre of every dashboard. Where a chat lives is chosen from the composer's place button.
- **The chats list is one component everywhere** (`primitives/chat-list.tsx`): the same heading, switches, filters and search scoped to where you are; rows grouped by day as chat search groups them, each with its harness mark, title, where it lives (live activity first) and age.
- **Untracked threads.** A harness's own thread that no Conduit chat owns is still a whole chat page -- transcript, composer, every chat action -- hidden from Conduit's lists, with a pill offering Track.
- **Empty lists** read "Nothing here yet." with no action of their own.
- **Entering a page** puts focus in its composer; each page declares its sections, and Tab and the leader go one stop per section (Keyboard).

**Palettes** -- the command palette, chat search and model selector -- share one language with separate layouts; `docs/design/palette-sketch/palette-sketch.html` is the visual reference.

- **Card.** The overlays' frost, pinned near the top rather than centred, so filtering shrinks it from the bottom.
- **Search row.** One line: a leading mark (search icon, or `>` for commands), any chips, the query, the row's controls and a quiet close. A scope or view is a mono chip (`in:Japan`, `is:unread`); Backspace on an empty query removes the last chip, Esc steps out. A drill-down puts Back in the header, never a Back row.
- **Rows** are one line: icon or harness mark, title at the row role, muted meta right-aligned, shortcuts as keycaps. Results keep their groups, best match first.
- **Typing lights the match.** The matched letters are white and heavier and the rest of the label goes muted. A keyword-only match is left plain.
- **Preview.** Where there is room, chat search shows the highlighted chat beside the results: its last prompt in a small bubble, the turn's outcome as a trace header line, and the start of the answer, muted, its formulas drawn as the transcript draws them at the preview's size, fading out at its foot rather than ending on a cut line. It loads once the cursor rests.
- **Footer rail.** One line under a faint hairline: the view's actions first, the keys at the right. Keys only; sort and filters live in the search row.
- **Phone.** The full-screen bubble; the key rail becomes a bar of buttons at the foot.

**Settings** is a frost overlay, centred since it does not filter. Its rail is drawn as the sidebar is, About in quiet lines at its foot; on a phone the rail is a screen of its own. Content is the Settings list (Components). **Settings save as they change**: no Save button; the header says Saving, Saved, or Not saved with Retry in the danger colour; a value not valid yet says why under its field. Credentials and one-off actions keep their own buttons.

# Panes and windows

How panes, tabs, the dock and the window behave. Every arrangement follows these; a new one follows them before it gets rules of its own. The panes smoke and `file-tabs` tests assert the current behaviour.

**Documents and room**

- **A pane holds one document**: a chat, a page, a file viewer, a tool or a shell. Pane A holds the route; panes beside it are opened, never navigated to.
- **A document declares its minimum width to its pane**, and nothing is drawn narrower. Chats and pages declare the dashboard composer's least plus its gutters (420px, `MIN_MAIN_PANE_WIDTH`); file viewers and tools declare the dock's (240px, `MIN_SPLIT_PANE_WIDTH`). The dock imposes no minimum of its own: it takes the minimum of whatever it shows. Containers lay out from those declarations, never from their own guesses.
- **Room runs out in one order.** Panes show while the width holds every one at its minimum. The dock narrows to its minimum first, then panes move to the dock, last first, exactly as a docked pane: a rail icon, shown in the dock on a click, document and state kept. They come back to the row by themselves once the width holds them again. A dragged edge takes room from its neighbour down to that neighbour's minimum, then from the next.
- **Up to three panes.** The rail's foot offers Equalise and share presets while panes are open. Not on a phone.

**Focus**

- **One pane has the keyboard.** A click anywhere in a pane gives it the keyboard. Everything that acts "here" acts on it: the palette, the leader, the model selector, the composer's keys and dictation, and the place the dock's Files shows. Its chat is the sidebar's current row; another pane's open chat is white at the resting weight.
- **Focus is a pane's, not a column's.** Ctrl+Shift+2 and Alt+Shift+[ / ] go round panes, each landing where its focus last was; Alt+[ / ] step tabs within the focused pane. Inside a pane with columns, a current column receives what opens and keeps DOM focus, so switching a tab keeps the keyboard there.

**Opening**

- **One verb per modifier**, the same from every place you open from (sidebar, pages, chat search, Files, Source Control): plain replaces what the focused pane shows, Ctrl (Cmd) keeps it as a tab, Alt opens it beside -- a new pane right of the focused one when the width holds it, otherwise in the neighbouring pane -- and leaves the keyboard where it was, so several opened beside land in the same place.
- **A document is open once.** Opening one already open anywhere goes to it.
- **A pane says it is loading** ("Loading chat…"); it never shows an empty chat's welcome meanwhile.
- **Opening a chat hands focus to its composer**; a file viewer takes the keyboard as soon as its editor has drawn, unless focus has gone elsewhere meanwhile.

**Tabs**

- **A pane of chats, or a file viewer's column, holds a few documents as tabs**, and its header becomes the tab row. A lone document is a row of one, so it is named once. Other documents have their pane to themselves.
- **Where you are is text alone**: the active tab at the current weight with its X; the others grey, with an X on the pointer and a live dot while running. The wash is only the pointer.
- **Switching moves nothing.** Tabs keep their order and reserve their bold width; one tab is mounted and the switch is in place, with drafts and scroll positions kept per document.
- **Chat tabs group by place**: each run of tabs from one place is one breadcrumb, the place named once in caps and white when it holds the active tab, as the sidebar marks the folder holding the current chat. A new tab joins its place's run.
- **A full row drops the tab used longest ago**, never the one showing and never one with an unsent draft. Closing the active tab goes to the one used last.
- **Headers fold, then truncate** (Interaction): other tabs fold into the tabs' ⋯, then the header's actions into its ⋯, least-used first; the active tab never folds and cuts its title only last.
- **A file viewer can stand empty** ("No file open") and split into two columns sharing its width by a rule between them; a chat pane cannot stand empty. A tab dragged out leaves its column empty rather than closing it.

**Dragging**

- **Anything that opens can be dragged**: a sidebar row, a page's chat, a file, a tab, a place's label (all its tabs), a rail tool, and a pane's header (its whole document).
- **A drop says what it will do.** The target washes exactly the band it would land in, and a pill by the pointer names the result in words. An edge opens a new pane there; the middle replaces the document, joins a pane of chats as a tab, or swaps two open panes; a drop that would do nothing does not wash. Inside a file viewer, columns are targets named by the pill alone.

**The dock and the split**

- **The rail opens the dock**, one tool at a time; pressing the open tool again closes it, and a tool that cannot be used here is dimmed. The rail also holds chat search and the command palette, so no pane's header carries them.
- **Files follows the pane with the keyboard**: it shows that pane's place, so focus and the dock never disagree; a pane with no place leaves it where it was.
- **Tools open in the dock by default**, the terminal included; Alt on a rail tool or a shell, or dragging it to a pane, opens it as a pane instead.
- **Any pane can move into the dock**, by its header's button, the leader (D, from a chat or tool; a page keeps D for Changes) or dragging its header onto the dock or the rail. Docking leaves the dock as it was. The pane keeps its document, session, state and tabs, and gets a rail icon of its own: a click shows it in the dock, first at its document's minimum width (again closes the dock), and Alt or dragging it from the rail puts it back in a pane. The dock holds up to three panes in addition to the row's and shows one thing at a time, a tool or a docked pane, at that document's own minimum width. Pane A docks only while another pane can take its place.
- **The dock sits beside the panes or over them**, switched per device from the rail's foot. Beside, it takes its room from the row; over, it floats above the panes with a shadow, takes no room, and nothing beneath it moves.
- **A tool can move out of the dock** into a pane beside the chat, by its header's button, the leader, or dragging its header, and back the same ways. Its rail icon is then white at the resting weight: open, not current.
- **A pane's swap and close sit once at its right edge**, as small quiet icons acting on the whole pane.

**The window remembers**

- **The layout is in the address.** Every pane, tab and column is in the URL and the device's layout; Back restores the layout before, and a copied link reproduces it.

**Resizing**

- **Resizing holds the content still.** Pressing a gutter or panel handle moves nothing, not even a pixel; only dragging does. While an edge moves, a transcript keeps its shape and slides to stay centred on its pane, as long as its column has room beside its gutters. Once sliding would clip it at the pane's edge, it takes real width and reflows. A reflow keeps the reader's place: the first block whose top is on screen stays where it was. Widening back out of a compression restores the column's width before it slides again. Releasing the handle lays the content out once at its final width. The Panel motion setting can choose to reflow on every frame instead.

**Motion**

- **Panes ease; documents don't travel.** Opening a pane eases the others to their new widths, then fades it in; closing fades it out, then the rest ease into its room; a swap keeps both panes' last frames showing until the documents have loaded, then crossfades. A document never slides across another pane -- being compared on Shift is the one exception. None of this runs on first load, Back, a phone or reduced motion.

# Elevation & Depth

Almost none on listed content. Frosted glass carries the depth.

- Panes and lists: nothing -- no edge hairline, no shadow.
- Overlays: the composer's frost, one dark outer shadow and a subtle edge. Dropdown menus included.
- Frost chrome (the signature): translucent `frost-fill`, a 1px white-alpha `frost-stroke`, a strong blur, optional top specular inset, no heavy drop. Composer, user bubble (`glass-bg` + blur), header pill and future floating toolbars share this one material — do not redeclare it per component.
- Primary buttons: top specular inset and a short lift. Ghost buttons: no fill until hover.

No stacked card shadows, no colored glows, no frost on a row or a list.

# Shapes

- Inset panes: the large radius (`{rounded.xl}`).
- Tiles (legacy, dashboard and workspace panel only): `{rounded.lg}`.
- Rows and small controls: `{rounded.md}` or smaller.
- Composer and header pill: `{rounded.composer}` (squircle, not a circle, not a sharp box). Overlay cards sit between rows and the composer.
- Pills only for true pills (scope toggle, runtime dots). Do not pill section titles or metadata.

**Icons** are Lucide, muted at rest, one size per context (the top of the app shares one size and one line). **An icon's stroke is a tenth of its size** (2.4 in Lucide's 24-unit box, `svg.lucide`), so weight scales with the icon and no size needs tuning; a current or selected icon is an eighth (3 units). Rules that set a stroke set it in those units; nothing overrides the ratio for one component. Artwork that is not Lucide (harness marks, the context gauge) draws its own weight. The composer's + and mic wear the text colour rather than muted, because they are live actions.

**The top line.** The sidebar header and every pane's header centre on one line, icons centred on the breadcrumb's capitals. A chat's breadcrumb names its place in caps before the title, with no slash; a page that is a place has no crumb.

# Motion

Motion explains a change of place: where something went, and what took its place. It is not decoration, and a surface that does not change place does not animate.

- **Leave the way you came.** Something that belongs to the bottom edge leaves downward and returns upward; a panel leaves toward the edge its control sits on.
- **One leaves, then the other arrives.** The outgoing surface goes first and the incoming one starts a beat later, so they never cross-fade in place.
- **Quick out, gentle in.** Leaving is short and accelerates; arriving is longer and settles, rising with a fade. The easings are tokens in `styles.css`.
- **Hold the reading position.** A surface that is swapped keeps its room while it is away, so the swap itself moves nothing. The transcript moves only through its tail spring, when what replaced the surface is taller.
- **Transform and opacity only.** Never animate width, height or layout. A panel slides over its neighbour rather than squeezing it. Exceptions: a row the reader opens or closes (a Disclosure) unfolds in height, because pushing what is below is what they asked for; pane widths ease when panes open, close or take a preset; and the composer eases across a layout switch.
- **The first open settles, then shows.** Until the page is laid out -- every pane's document included, and the layout holding still -- only the frame shows. Then every region fades in once, with no rise, since nothing is changing place. Nothing may arrive or move after the fade starts: what decides the layout loads before it.
- **A turn starts as its header.** From the prompt until its first step, a live turn is the trace header it will become, and its trace takes that place at the same height, moving nothing.
- **A stopped turn is one row.** Its trace says Interrupted, and text the stop discarded is a struck-through step of the trace under "Not kept", never a row of its own.
- **A send moves at once.** A new chat's first message, or one sent from a dashboard, takes the composer to the foot of the chat in the frame the layout changes, not when the agent has started; from a dashboard, the page around the composer leaves first.
- **Cards belong to the composer.** Queued messages and attachments rise out of it and drop back into it when it takes them; removed by hand, a card fades in place. Anything keyed for animation is keyed by identity, so an update never replays an entrance.
- **A layout switch** (a dashboard's two columns becoming one) happens in the frame the width crosses, never waiting on an exit animation. Nothing crosses the pane: a section that changes place fades in where it now is. The composer alone eases, from where it was last drawn to its new column, and what it would cover waits for it. Both layouts share their gutters, so nothing moves sideways at the switch.
- **Floating controls follow.** Anything anchored to a surface is re-measured when that surface is swapped or lands, never left behind.
- `prefers-reduced-motion` removes these transitions; the end state is identical.

# Keyboard

One model for every surface, so no surface grows keys of its own.

- **Regions.** The app is a tree of regions (sidebar, panes, dock, and what is inside them) following focus. Shortcuts resolve innermost region first, then outward.
- **Go to a region.** Ctrl+Shift+1/2/3 (⌘⇧ on a Mac) go to the sidebar, the panes and the dock in screen order. They open and focus, never close. Ctrl+B and Ctrl+. stay plain show/hide toggles. Arriving shows held focus (Anywhere).
- **The leader acts where you are.** Ctrl+G, then a key: only actions within the current region, looked up innermost first and then outward. Its menu lists the current region's keys; a key that would do nothing is not listed. Numbers inside a region mean positions, never other regions.
- **Moving in a list.** ↑/↓ move, skipping headings; Home/End go to the ends; →/← step into and out of a level; Shift+↑/↓ extends a selection; Menu or Shift+F10 opens the row's menu. Pointer and keyboard move the one cursor.
- **↑ from the top reaches the switch above.** A list headed by a segmented switch takes ↑ from its first row onto the switch's chosen side; ←/→ move between sides, ↓ returns.
- **Tab is one stop per section**, landing where the cursor last was.
- **Enter acts.** Opening a chat hands focus to its composer.
- **Esc steps outward** a level at a time, and from the top of a region goes home to the composer: pressing Esc enough always gets back to typing.
- **A key on a bare pane goes somewhere**: typing, Enter and Esc to the composer, arrows into the list.
- New global chords go in the settings shortcut manager; every scoped key can be found in the leader under its region.

# Components

Grouped by the surface they live on (Surfaces). Every row in every group follows Interaction.

## Frost

**Frost chrome (signature, use more of it)** — composer, user bubbles, header pill, scroll-to-latest, and future floating toolbars or hero surfaces. When something floats over content or marks the primary action area, default to frosted glass before a solid card. Do not frost a list, a tree or a row.

**Leader menu** — what Ctrl+G can do from where you are, shown after a pause. The page dims except the current region, which stays lit. A small frost card above the composer: the region path as a breadcrumb at the top, action rows with keycaps at the left, the go-to chords and Esc in the rail.

**Dropdown menu** — the common case: sessions, shortcuts, overflow, context menus, submenus and popovers. The overlays' frost and `{rounded.pop}`. A group label, then one-line rows: an optional leading mark, the title at the row role, muted meta inline at the right, trailing icon actions that appear with the row on hover or focus (always on touch). The whole row takes the wash. A single footer action ("+ New …") under a hairline. Something edited in place opens as an inline form in its row and saves on Done; use a popover rather than a menu when rows hold inputs. A one-field rename stays a dialog.

Choosing in a menu:

- **The current choice is bold, not a tick** (Interaction).
- **No notes in menus.** A choice that cannot be picked here is dimmer and struck through, and that says enough.
- **No Manage rows.** Settings are reached from Settings, not from a picker.
- **Search opens the palette.** A menu over a long list starts with a "Search all …" row that opens the matching palette, not an inline field.
- **Stay open for the next choice** when the follow-up is in the same menu; a choice that ends the task closes it.
- **Ordered choices are a slider** whose label opens a submenu of the levels.
- **A list that is not a menu still uses menu rows**: a pick list with a search at its head is `PopoverSearchList`, whose rows are the shared `menu-row`, and the search keeps focus while the arrows walk the rows.
- **A tap ends where it lifts.** When a tap changes what a menu shows, the mouse events a phone sends after it are dropped.

**Composer row** — the controls under the draft, in tiers by how often they are reached for mid-conversation. Nothing leaves the row; lower tiers get quieter, not hidden, and desktop controls never squeeze. The model chip and the primary slot are the only controls at full weight; settings show their value muted. The row starts with a +, which holds Attach and the project the chat lives in, and the controls fold into it as the composer narrows rather than squeezing, least used first: permissions and service level, then the profile, the context and last the model. Each comes back exactly when it fits again, and in the menu it opens a submenu as on a phone. On a phone: +, the draft, mic and the primary slot, every setting in the + menu showing its value. The primary slot is one fixed-size button -- Send, Stop while the agent works, Send again once a draft is typed with Stop beside it. Stop is a small solid rounded square in the text colour; nothing in the row is a white filled button. Recording, the mic breathes between the text colour and muted -- no fill, ring or colour.

**Composer takeover** — anything the agent is blocked on until the user answers: questions, approvals, choices. It replaces the composer in its slot and material rather than stacking above it, and never scrolls inside itself. One question at a time: several are tabs ending in a Submit tab that summarises the answers; answers are numbered one-line rows, a typed answer the last of them. It takes the keyboard while up -- arrows, a number or Enter chooses, Tab turns the page, Esc dismisses (a dismissed approval is a denial). A single question with a single answer skips tabs: choosing is answering.

**User bubble** — frosted glass, `{rounded.bubble}`, right-aligned, in the composer's material family. A message being edited goes muted and italic in its bubble with no outline, and a frost "Cancel editing" pill floats above the composer. Assistant text has no bubble.

**Attachment strip** — every attachment for the draft in one short strip directly above the composer, in the queued pill's width and material: images as cropped thumbnails, files as chips with type icon, name and size. Remove on hover or focus (always on touch); uploading a thin progress ring; failed a red outline with retry. More chips scroll sideways with a fade at the edge; a quiet ⤢ opens the full list (a bottom sheet on a phone).

**Dialog** (`FrostDialog`) — confirms and small prompts: a narrow frost card over the dim, centred, small on a phone too. The title and the choice, nothing else; a one-field prompt drops its label. An input is a faint hairline that brightens on focus, never a ring.

**Input-quiet** — borderless inside frost composer or palette search.

## Pane

**List row** — transparent, `{rounded.md}`, follows Interaction exactly. In the sidebar every row rests at one weight; the current row and the folder or workspace holding it are white at the current weight, so where you are reads up the tree. A pinned row looks exactly like its unpinned row. Never an inset coloured bar.

**Sidebar action** — an action of the sidebar is a row, not a small button beside a heading, and is also on the collapsed rail.

**Settings list** — the sidebar's language, not tiles: no box, no dividers between rows, one light hairline between groups. Group labels over one-line rows at the row role. A value is quiet (a select is its value in muted text and a small chevron); state that matters sits muted after the name; descriptions go in a title. Every row's control sits in one column of one width so they line up, and the name truncates before the control does. Buttons are ghost unless they are the one action waiting. Focus anywhere in a row is the row's wash.

**Segmented choice** — two to four named peer choices: a hairline box, the current option under the gray wash, which slides to the next. Never a colour, never a tick. A long or open list stays a select.

**Switch** — on or off: a small pill, near-white track with a dark knob when on, gray when off. A checkbox is for choosing items, not settings.

**Input-bordered** — 1px hairline inside settings and forms, `{rounded.md}`, as tall as its row needs.

**Workspace rail** — mirrors the sidebar's collapsed rail on the right edge, on the frame: one icon per tool, grey at rest, the wash as the cursor, the dock's tool current. Below a short hairline, chat search and the command palette; while panes are open, Equalise and Layouts at its foot. It is out of the tab order; the tool keys and Ctrl+Shift+3 reach the dock.

**Pane header** — shares the top line of the app. A document's name or its tab row at the left; its modes as a segmented switch; quiet ghost controls at the right in the order they are reached for, grouped by short hairlines, folding into a ⋯ rather than scrolling; the pane's swap and close last.

**Tiled pane (legacy)** — hairline, `{rounded.lg}`, flat. Being retired for lists; not for new surfaces.

## Transcript

**Answer** — the assistant's Markdown, with no bubble, filling the reading column. A gutter keeps it off the pane's edges, and the composer shares that gutter, so an answer and the composer line up on both sides.

- *Rhythm.* There is one gap between blocks, everywhere. An answer's first and last blocks have no outer margin, so its height is its content and the action row sits the same distance below every answer.
- *Wide content.* A table or a wide code block may grow past the reading column, up to a set multiple of it. It stays centred on the column, and it never goes past the gutters the composer keeps. A block narrower than the column fills it, so its edges line up with the prose. Anything still too wide scrolls inside itself; the page never scrolls sideways.
- *Formulas.* A display formula is centred in the column. One wider than the column starts at its left edge and scrolls sideways; it is never clipped on both ends. Inline math sits on the text's baseline at the text's size. A formula is drawn from the moment it is readable: partial TeX never shows as raw text, and a formula already drawn never blinks out while the next one arrives.
- *Links* are the text colour with a muted underline, and code keeps its syntax colours (Forbidden color). Everything else in an answer is the pane's monochrome.

**Streaming** — an answer appears at a steady pace, not in network bursts. The Fade option fades each new word in, over a duration set per device, by its opacity and never its colour. Formulas grow piece by piece as they arrive. With "Fade formulas in when complete", a formula is held while it is open, then fades in whole once it closes. An answer's actions and its time wait until it has finished appearing, then fade in, rather than riding the bottom of the stream. A stopped answer that ends inside a formula draws what was written of it.

**Nothing moves once drawn.** This is the transcript's stability rule, and it holds at every width and pixel density:

- Every block holds its real height before it is drawn, so content scrolled out of view and coming back, or a reload's fade-in, moves nothing once the fade starts.
- Starting or ending an interaction (pressing a handle, opening a panel, hovering) shifts no text, not even by a device pixel.
- The only things that move an answer are the reader asking for it (opening a trace, a resize) and the tail spring following new content.

A "sizzle", text that shifts and settles, is a broken rule here, not a tuning matter: look for the structure that changes geometry, not a delay that hides it.

**Message time** — muted caption at the head of a message's action row, never a line of its own.

**Trace header** — every turn that answers has one, live and settled. The first line is the orb, then `Status · time · work`: status one verb (what the running tool is doing, Thinking, Writing; settled Done, Interrupted or Failed); time muted and tabular, ticking while live; work as single-word counts by kind, most used first. The second line is the trail's latest line, muted and cut to one line, held open while the turn runs so nothing jumps. A turn with no thinking and no tools is its first line alone, with nothing to open.

**Thinking orb** — the trace header's mark: a dotted orb whose motion says what the turn is doing (connecting, thinking, searching, reading, editing, running, writing). Changes hold briefly and crossfade, so a burst of tool calls does not flicker it and there is never an empty frame. Settled, it turns slowly for Done and sputters in `{colors.destructive}` for Interrupted and Failed. Every orb shares one frame loop and a settled one draws at a low rate. Reduced motion is a still frame. The frames are catalogued in `docs/design/orb-catalogue/contact-sheet.html`.

**Trace trail** — the opened trace: one light line per step, no boxes. A tool step is its kind's icon (a spinner while running), a verb in present or past tense, its subject in muted mono and its duration right-aligned; failed and stopped steps say so. Repeated steps of one kind in a row are one line. Any line opens in place to its output or full text. Sizes sit a step under the answer, in rem so desktop and phone each place it.

**Harness prompt** — a turn the harness started itself opens on one muted line with a bell where the prompt sits, right-aligned, with no bubble and no actions.

**Disclosure** — one component for everything that folds (`chat/disclosure.tsx`): a header, one turning chevron, and a body that unfolds in height and folds to nothing, gap included. Opened at the transcript's tail it lets go of the tail rather than being chased.

## Anywhere

**Harness mark** — rests greyed with its row, and shows its own colour on hover, focus, or the current chat. Live activity or an unread reply shows in its place first. The Conduit mark is `public/brand/conduit-mark.svg`.

**App icons** — derive only platform-required assets from `public/favicon.svg`: release C is white-on-black, all dev artifacts (Windows and Android) invert it to black-on-white; the Windows caption keeps the icon but no text.

**Runtime dot** — live green / warn amber / danger red / muted, colour on the dot only. A healthy indicator is the dot alone; it gains a label only when it has something to say, and a busy state is a small spinner in its place. One indicator per surface, worst state first.

**Held focus** — a region reached by a go-to-region shortcut shows a thin line along its bottom edge in the near-neutral `{colors.ring}` tone, fading at both ends; the regions' bottoms line up, so it reads as one baseline with the held region lit. On arrival the rest of the app dims briefly around it. It stays while focus is in that region or in none (a menu, a dialog), and goes when focus reaches another region any other way; a click or Tab never lights one. Not on a phone.

# Being migrated

Surfaces that do not match the language yet. Do not copy them; when you touch one, move it towards its target, and take it off this list once it is there.

- **Workspace panel, Computer page**: hairline tiles (Tiled pane) → the pane.
- **Focus rings** in the workspace panel, the Computer page, and project and workspace pages (`project/dashboard.css`) → the wash.
- **Uppercase group labels** in menus and the leader → the sentence-case group label.
- **Leftover blue** (Forbidden color) wherever it is found.

# Do's and Don'ts

Do:

- Design in near-monochrome charcoal. Hue only for live dots, destructive, git/data glyphs.
- Group with a heading and space, not hairline boxes or colored surfaces.
- Choose the surface first: frost for anything that floats, pane for where you work, frame for navigation.
- Follow Interaction everywhere: grey at rest, the wash as the one cursor, the current item white and semibold with no fill.
- Keep the composer at the centre of every dashboard; it is the home-screen pattern.
- Let content set the breakpoints and minimums: controls keep their size, documents declare their minimum, and layouts change at widths measured from them -- never a px width tuned by eye.
- Stay dark. Match existing Solid/Kobalte slots (`data-slot="button"`, menu, dialog).
- Hide the transcript scrollbar; keep thin thumbs on panes that scroll as ledgers.
- Respect `prefers-reduced-motion` everywhere, except the existing meteor field.

Don't:

- Use any blue for any purpose.
- Put a colored left-edge sliver on selected cards, nav, or rows.
- Follow the `frontend-design` skill's urge to add a signature accent color. Frosted glass is the signature.
- Frost a row, a list, the workspace tree or the transcript.
- Ship a light theme, mesh gradients, glow, or a generic SaaS card grid.
- Center a hero of metric boxes. Conduit leads with a composer and lists.
- Introduce a second font, icon set, or chart library for chrome.
- Write specs here: per-component sizes, timings, exact copy, counts and fold orders belong to the code. Write the rule they follow.
- Encode implementation gotchas (density-duplicate CSS, `-webkit-backdrop-filter` pairing, content-visibility) as visual rules; how to verify a rule goes in `docs/TESTING.md`.

# References

Visual companions to the rules above; the rules win where they differ.

- `docs/design/palette-sketch/palette-sketch.html` -- chat search, the command palette and their states (serve the repository root to open it).
- `docs/design/orb-catalogue/contact-sheet.html` -- every thinking-orb frame and which state uses it.
- `docs/design/dashboard-layout/`, `docs/design/conduit-home-dashboard/` -- the dashboard sketches.
- `conduit-web/test/file-tabs.test.js` and `npm run smoke:panes` (`docs/TESTING.md`) -- the current pane, tab, drag and focus behaviour, asserted. A change to a rule under Panes and windows changes its test.
