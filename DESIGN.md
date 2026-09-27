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
  overlay-face: "oklch(0.165 0.005 264)"
  overlay-face-top: "oklch(0.205 0.005 264)"
  overlay-rail: "oklch(0.135 0.004 264)"
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

This file is the whole design language: read it before building or changing any UI. Choose the surface first (Surfaces), then follow the one interaction grammar (Interaction); components, motion and keyboard follow from those two. The HTML pages under References are visual companions, not further rules. A surface that does not match yet is listed under Being migrated -- do not copy it.

Stack: SolidJS, Kobalte primitives, Geist Variable, tokens in `conduit-web/src/client/styles.css`. Do not add React, extra icon kits, or a second palette.

# Surfaces

Every surface is one of three materials. Choose it first, before any colour, border or radius.

| Surface | Material | Reference | Holds |
|---|---|---|---|
| **Frame** | near-black `{colors.frame}` | the sidebar | permanent navigation: the sidebar, the collapsed rail |
| **Pane** | charcoal `{colors.background}`, no borders, single-line rows grouped by heading and space | the dashboards | where you work: the chat, the dashboards, the workspace panel |
| **Frost** | the composer's frost (Elevation & Depth) | chat search and the palette | anything that floats |

**The test is "does it float?", not "is it where you work?".** Frost covers two kinds of floating thing:

- **Overlays** -- anything that opens on top of the app: chat search, the command palette, the model selector, the leader menu, dropdown menus, Settings, dialogs and confirms. Where one covers the page, the page dims behind it.
- **Floating chrome** inside a pane -- the composer, user bubbles, the header pill, scroll-to-latest, the attachment strip, the composer takeover. It floats over the transcript, so it is frost even though it is where you work. It is centred on the reading column where it applies, at a larger radius (Shapes).

Inside frost, content follows the pane's rules: one-line rows, headings and space, no boxes, and never frost on a row of its own.

**Build an overlay from the shared pieces**, not a copy of another overlay: `FrostOverlay` (`components/frost.tsx`) gives the dim, the pinned card, the arrival and the phone bubble; inside it, rows take `frost-row` (the cursor wash on `data-highlighted`, where you are by `aria-current`), keys the `Keycap` / `keycap` class, and the foot `frost-rail`. The styles are the `frost-*` block at the end of `styles.css`. A card that floats without covering the page (the leader menu) takes `frost-card` alone.

**On a phone an overlay is a full-screen bubble:** it fills the visual viewport with a small inset and larger tap targets, and stays a dialog, never a new route -- Settings included. Frost over a full-screen overlay gets a darker core (`linear-gradient(frost-fill, frost-fill)` over the ink at ~72%), because nothing around it is dimmed and the page behind would otherwise show through at full contrast. Desktop overlays keep plain frost over the dim.

# Interaction

One grammar for every surface -- frame, pane or frost -- taken from the sidebar. Lists, menus, pickers, palettes and settings all follow it; none invents its own.

- **Rest.** Grey text, muted icons, harness marks greyed with their row.
- **Cursor.** The row under the pointer, under keyboard focus, or being pressed takes the `{colors.accent}` wash and goes white; a harness mark shows its own colour. There is one cursor, only one row at a time, and pointer and keyboard move the same one. The cursor never changes weight. On something already washed -- the chosen segment of a segmented switch -- the cursor brightens that wash a step toward the text colour instead. It stays where it was while the window is in the background.
- **Current.** Where you are -- the open chat, the folder or workspace holding it, the current section, the chosen option in a menu or picker -- is white and semibold (~660) with its icon at a heavier stroke (2px), and **no fill**. The cursor and the current item can always be told apart.
- **Selection.** Several chosen items are the cursor's wash on each: no edge bar, tick column or other marker. A checkbox column appears only in an explicit edit mode (chat search's Edit).
- **Never.** Focus rings or outlines, from the browser or a component, in any colour; coloured bars or slivers; boxes drawn around a row to mark it. Keyboard focus is the wash and nothing else.

The keys that move the cursor are in Keyboard; the row itself is List row (Components).

# Colors

The app is locked to `.dark` on `<html>`. Light `:root` tokens exist as leftovers; never paint them.

The charcoal is cool-neutral at chroma ~0.004–0.006. That gray is the brand. Do not raise chroma to make it "read as blue."

- **frame** — page ground behind inset panes (body, `#root`, mobile sidebar).
- **background** — inset pane fill (chat main, settings shell).
- **foreground / muted-foreground** — type. Muted for timestamps, hints, empty states, icons at rest.
- **border** — 1px hairlines: inputs, a header or footer rule, and dividers. Grouping is a heading and space, with at most one hairline between groups -- not a hairline box and not a fill. Do not outline the main or workspace pane with a hairline.
- **accent** — white at 6–7% opacity. This is hover, pressed, and selected. Selection is a gray wash, never a hue.
- **card / popover** — slightly raised solids, left on tool cards and on dialogs until they move to frost (Being migrated). Overlays -- palettes, the leader, menus, Settings, dialogs -- are frost (Surfaces). The `overlay-*` tokens are the leader's old ink-dark face; they go once no code uses them.
- **primary** — near-white. Default buttons and the one bright action.
- **destructive** — errors and destructive actions only.
- **live / warn** — tiny runtime dots and git-ish status. Never as fills, rails, or card washes.
- **frost-fill / frost-stroke / glass-bg / glass-border** — the signature floating material. Default to it for anything that floats (Surfaces). Shared recipe in Elevation & Depth.

## Forbidden color

No blue anywhere. There is no blue accent token. Do not introduce `--accent-cool` (`oklch(0.72 0.045 246)`) or any steely, slate, or "intelligent blue", for any purpose:

Syntax highlighting inside code is the sole exception. A language theme can
use blue as a semantic token colour for functions or headings. The exception
does not apply to editor chrome, selection, focus, status, navigation or other
application controls.

- selected rows, cards, or nav items
- a left-edge sliver / inset rail that wraps a highlight
- a gradient wash on a selected control
- status strips, current-item cards, or "this is active" surfaces
- focus (focus is the `{colors.accent}` wash, never a ring or an outline, in any colour)
- runtime dots, waveform bars, audio/connecting states, success text, icon tints -- except a status dot that already carries its own colour (the unread/recent dot on a chat row): the rule is against blue injected into chrome, not a state's own mark

Replacements: active/connecting states use `{colors.muted-foreground}`; live stays `{colors.live}` green, warn amber, danger red; success/ready text uses `{colors.foreground}` or `{colors.live}`; waveform bars and audio chrome use foreground/muted tints.

That treatment is leftover frontend-design skill output. It has stained Settings (selected nav, status strip, current workspace card), the sidebar, chat-selected rows, and voice/search chrome. Do not encode it, copy it, or extend it. For the cursor or a selection, use the `{colors.accent}` full-row wash; for the current item, white and semibold (Interaction).

Workspace glyph colors and git file dots are user/data colors, not brand. Leave them on the glyph; do not echo them into chrome.

# Typography

Geist Variable everywhere for UI. `ui-monospace` (not Geist Mono) for model ids, paths, keycaps, status, waveforms.

- **display** — dashboard title only ("Start where the work is."). Weight 560, tight tracking.
- **heading** — settings/modal titles ~18–20px, weight 600, slight negative tracking.
- **sans 12–14px** — body, chat, lists.
- **row-title ~10.5px / 580** — dashboard row titles (see `{typography.row-title}`).
- **caption 8.5–9px** — section subtitles, timestamps, empty copy.
- **uppercase tracked meta** — terminal pane tags. Scarce.
- **keycaps** — 8px mono in a 16px rounded square, muted stroke.

Do not invent further type sizes. Do not use serif except the Capacitor first-launch wordmark (legacy).

# Layout

Desktop is a darker **frame** with **inset rounded panes** (chat ~16px radius, 8px margin, no pane-edge hairline). Mobile drops the inset and goes full-bleed, keeping safe-area padding on edge controls.

Chat composition:

- Sidebar on the frame (transparent).
- Chat pane inset; workspace pane is a second full-bleed tiled split (tree | preview), not a floating card.
- Assistant markdown is the full reading column. User messages are a right-aligned frosted glass bubble (~640px max, `{rounded.bubble}`).
- Composer sits at the bottom of the pane, same column width as dashboard composer — frosted glass, the reference material for all floating chrome.

Dashboards -- the Conduit, project and workspace dashboards -- are one layout (`dashboard/primitives/split.tsx`), listed content with no tiles. Sketches: `docs/design/dashboard-layout/`, `docs/design/conduit-home-dashboard/`.

- **The layout.** A header across the top: the page's mark (the sidebar's), centred on the name and the **status row** under it -- small muted words saying where things stand for that kind of page (Conduit: running, unread; a project: kind, path, last active, running, unread; a workspace: kind, path, branch → upstream, ahead/behind, running, unread). Quiet text shortcuts sit at its right, with manage actions behind a ⋯. Two columns when the pane is 760px or wider: the composer with the chats list under it at the composer's width on the left, places and state on the right, each column scrolling on its own. Narrower, one column: header, composer, chats, the rest. On one column the chats heading's switches and filters fold into one Filters menu (a group per choice, counts beside the options) beside search, with the list showing and its count as the heading; Terminals and Changes fold under their headings, folded until opened (remembered per device); and change rows go muted -- grey file marks, counts and status letters -- so they sit quietly under the chats. On a phone the shortcuts become a row of large targets and the composer docks at the foot.
- **The Conduit dashboard is the new-chat screen** (`dashboard/app-dashboard.tsx`): New chat without a place of its own lands here with the composer focused. Its header context is running and unread, its shortcuts Search chats, New project, Terminal, Settings. The right column is the folder shelf -- project folders drawn as folders in a wrapping grid, name and "N chats · age" under each, a live dot when one of its chats runs, ending in New project -- then Workspaces and Terminals as lists. On one column the shelf is a single sideways strip above the chats.
- **Project and workspace dashboards.** The context line is path, branch → upstream, ahead/behind; the shortcuts are Files, Changes or Search chats, Terminal or Copy path, Settings. The right column holds Terminals for a workspace, and Changes when the tree is dirty, else the folder's recent Files. Changes rows are the workspace panel's change rows: file mark, name, folder, −/+ line counts, status letter.
- **The chats heading is the same everywhere** (`primitives/chat-list.tsx`). Left: Recent chats / Unread; a workspace adds Conduit chats / Not in Conduit (threads its harnesses ran there that no Conduit chat owns) beside it, remembered per workspace. Right, in order: the profile filter, the sort (Latest activity / Created), search scoped to where you are; on Not in Conduit the harness filter replaces the profile and sort. Rows are grouped by day as chat search groups them, 40 at a time with Show more; a row carries the harness mark, title, where it lives (live activity first) and age. A running chat stays in the list, its dot and activity saying so. Not in Conduit threads open in the harness's Drive view, untracked.
- **The composer's place.** A folder button beside attach (on a phone, the plus menu's Project row) moves the open chat, draft or not, into a project or workspace, and shows that place's own mark once it has one.
- **Empty lists** read "Nothing here yet." with no action of their own: the sidebar already holds the ways to start something.
- **Entering.** Opening a dashboard from the sidebar, Ctrl+Shift+2, or a route change that drops focus puts focus in its composer; opening the Conduit dashboard while on it changes nothing. The first open and sending from a dashboard are in Motion.
- **Keyboard** (`primitives/split-cursor.ts`). The sidebar's cursor: ↑/↓ and Home/End within a section (across day headings; the folder shelf also ←/→), ↑ from the first row into the heading's controls, Enter opens, Menu or Shift+F10 the row's menu, Esc the composer. Tab is one stop per section -- composer, chats, then the right column's groups, and round -- landing where the cursor last was. Each page declares its sections, and the leader offers only those: C composer, L chats, P Projects, W Workspaces, T Terminals, D Changes, F Files. A key on the bare main pane goes somewhere: typing, Enter and Esc to the composer, ↑/↓ into the chats.

Menus and pane headers follow the component entries below. The command palette, chat search and model selector share one language, with separate layouts; **`docs/design/palette-sketch/palette-sketch.html` is the visual reference** (serve the repository root and open it -- each state is drawn live beside the palette as it was):

- **Card.** The composer's frost (`frost-fill`, `frost-stroke`, blur 24px, top specular inset) at 14px radius, over a ~42% dim. Pinned near the top, not centred, so filtering shrinks it from the bottom. It rises ~8px and fades in over ~220ms.
- **Search row.** One line, ~44px: a leading mark -- the search icon in chat search, `>` in the command palette -- then any chips, then the query (13px), then the row's controls and a quiet close. No path row above it and no Back row in the results; a drill-down page puts Back in the header.
- **Group labels** are the sidebar's: sentence case, 9.6px/700, about half the text colour.
- **Rows** are one line, ~30px, 9px radius: a 14px Lucide icon or harness mark, a 12px/520 title a step under the text colour, then muted meta right-aligned -- times, counts and model ids in tabular mono -- and shortcuts as 16px keycaps, brighter on the cursor. The cursor is the row wash with white text; it never changes weight. The current chat, folder or model is white at 680 with no fill (Interaction). In the model selector a scoped model's name is white at 560 and an unscoped one the sidebar's grey at 450. No tick column and no coloured rail.
- **Typing lights the match.** The letters a query matched are white at 700 and the rest of the label goes muted -- the substring when there is one, otherwise the letters in order. A result that matched only on a keyword is left plain.
- **Command palette.** Grouped by intent: This chat, Go to (pages such as Search chats and Settings, with a chevron), Create, View, Profiles, Thinking level, App, then Danger zone. Search results keep those groups, each once, the group with the best match first.
- **Chat search** is its own surface (Ctrl Shift K), not a page of the command palette. The row is search icon, chips, query, then Latest/Created as a segmented choice. A scope is only ever a mono chip (`in:Japan`), as is an activity view (`is:unread`, `is:running`, `is:attention`, typed with a trailing space or chosen); Backspace on an empty query removes the last chip and Esc steps out. The root is Recent (the five latest chats from anywhere), then Chats -- the chats outside any folder, one row with a speech-bubble mark that expands like a folder but stands apart from them -- then Folders, projects and workspaces in one list, each with a live (green) or unread (white) dot, its chat count and last activity. Right expands a folder to five chats and a Browse all row; Enter scopes into it and Ctrl Enter opens its page; slash searches inside it. Chat rows are harness mark or runtime indicator, title, then the folder (left out once scoped) and the time. Edit mode is the one place a checkbox column appears; its selected count sits in the rail, so the results do not move.
- **Preview column** (chat search, wide screens): 380px at the right under a hairline, the card widening to ~1040px; toggled with Ctrl P and remembered per device, hidden below ~1000px and on a phone. For the highlighted chat: its mark and title, one mono line of harness · folder · updated, the last prompt in a small user bubble, the turn's outcome as a trace header line (the settled orb, Done/Interrupted/Failed, time, tool counts), then the start of the answer, muted and cut to a few lines. It reads the chat once the cursor rests (~140ms) and keeps it until the chat changes.
- **Footer rail.** On the same frost under a faint hairline, one line: the view's actions first (clickable ones in the text colour, no button box), then the keys that move at the right. Keycaps are 16px, hairline, mono. It holds keys only -- sort and filters live in the search row.
- **Widths.** Commands ~512px, models ~576px, chat search ~720px (~1040px with the preview). Mobile: the full-screen bubble with the darker core (Surfaces). Chat search on a phone swaps the key rail for a bar of buttons at the foot -- Edit, the sort, and Open <folder> once scoped; in edit mode Move N, Delete N and Done -- chips scroll sideways, a tap on a folder scopes into it and its chevron expands it.
- **Leader menu**: a smaller card (360px) above the composer, in the same frost, with the region path in the crumb style at the top and keys aligned at the left of each 12px/520 action row.

Settings pattern (illustrative, non-normative — current shell ~1120×820, rail ~190px). Settings is a frost overlay (`FrostOverlay`), centred rather than pinned since it does not filter, and on a phone the full-screen bubble. Its content:

- **Nav = the app sidebar.** The rail is drawn as the sidebar is, at its sizes, with About (versions, how it is running) in quiet lines at its foot as the connection is at the sidebar's: sentence-case group labels (9.6px/700, about half the text colour), rows of grey text (10.4px/400) with 12px Lucide icons 6.4px from their label, left edges on one line with the title. The current section is white and semibold (660) with its icon white at a heavier stroke, and no fill; the wash is only the cursor. On a phone the rail is a screen of its own, at the sidebar's phone sizes, with no current row. No sliver, gradient or border emphasis.
- **Content = a settings list** (Components): muted group headings over one-line rows, as the sidebar is drawn. Some sections are still hairline tiles from before; they move over. No status-strip card, no multi-column card grid as chrome.
- **Settings save as they change.** No Save button: a valid edit is stored after a short pause (typing) or at once (a toggle, a choice). The section header says how it stands, beside the close button and holding its width -- a small spinner and "Saving", then "Saved" in muted text, or "Not saved" and a Retry button in the danger colour, which stays until retried. A value that is not valid yet is not saved; it says why under its field, in the danger colour. Credentials and one-off actions keep their own buttons.
- New settings chrome must follow these two patterns, not the legacy blue selected nav.

# Elevation & Depth

Almost none on listed content. Frosted glass carries the depth.

- Panes: hairline only. Lists: nothing.
- Palettes/modals: one dark outer shadow and a subtle edge. Every overlay uses the composer's frost, dropdown menus included.
- Frost chrome (the signature): translucent `frost-fill`, 1px white-alpha `frost-stroke`, blur 19–24px, optional top specular inset. No heavy drop. Composer, user bubble (`glass-bg` + blur), header pill, and future floating toolbars share this one material — do not redeclare it per component.
- Primary buttons: top specular inset + short lift. Ghost buttons: no fill until hover.

No stacked card shadows, no colored glows, no frost on a row or a list. Anything that floats takes the composer's frost (Surfaces).

# Shapes

- Inset panes: 16px.
- Tiles (legacy, dashboard and workspace panel only): 10px.
- Rows / small controls: 6–8px.
- Composer and header pill: 22px (squircle, not a circle, not a sharp box).
- Icon buttons in chrome: ~8–10px radius inside the frost pill.
- Pills only for true pills (scope toggle, runtime dots). Do not pill section titles or metadata.

Icons are Lucide at a 1.5px stroke, 13–16px, muted at rest. The stroke is screen pixels at any size (`vector-effect: non-scaling-stroke`): in Lucide's own 24-unit box a small icon's stroke thins to a hairline that does not render cleanly. A heavier stroke is set in pixels too -- 2px for a current or selected icon. The composer's mic and Send are the exception: 1.75px, in the text colour, because they are the row's weight.

# Motion

Motion explains a change of place: where something went, and what took its place. It is not decoration, and a surface that does not change place does not animate.

- **Leave the way you came.** Something that belongs to the bottom edge leaves downward and returns upward; a panel leaves toward the edge its control sits on.
- **One leaves, then the other arrives.** The outgoing surface goes first and the incoming one starts ~150ms later, so they never cross-fade in place.
- **Quick out, gentle in.** Leaving is ~200ms and accelerates (`cubic-bezier(.4, 0, 1, 1)`); arriving is ~300ms and settles (`cubic-bezier(.2, .8, .2, 1)`), rising ~32px with a fade.
- **Hold the reading position.** A surface that is swapped keeps its room while it is away, so the swap itself moves nothing. The transcript moves only through its tail spring, when what replaced the surface is taller.
- **Transform and opacity only.** Animate `transform`/`translate` and `opacity`; never width, height, or layout. A panel slides over its neighbour rather than squeezing it (the maximised workspace panel is the reference). One exception: a row the reader opens or closes -- a trace or a line of its trail, one Disclosure -- unfolds its body in height (~200ms, with a short fade), because pushing what is below is what they asked for; a step that arrives in an open trace only fades in with a 4px rise.
- **A stopped turn is one row.** Its trace says "Interrupted", and text the stop discarded is a step of the trace, struck through under its own small "Not kept" -- the loss is that step's, not the turn's, so the header's summary is still the last step that was kept, and the discarded text is never a row of its own. A turn stopped before it did anything is its trace header alone -- "Interrupted" and its time -- with Regenerate under it.
- **A turn starts as its header.** From the prompt until its first step, a live turn is the trace header it will become -- the orb connecting, `Starting · 02s`, one line held under it -- and its trace takes that place at the same height when the first step arrives, moving nothing.
- **The first open settles, then shows.** Until the page is laid out -- everything that shapes it in place, the workspace panel included -- only the frame shows. Then the composer is simply there and every other region fades in around it, once (~300ms, settling), with no rise, since nothing is changing place. Nothing may arrive or move after the fade starts: a part that decides the layout is loaded before it, not revealed after it.
- **A send moves at once.** A new chat's first message, or one sent from a dashboard, takes the composer from where it sat to the foot of the chat straight away -- one move (~420ms, settling), started in the frame the layout changes -- rather than when the agent has started. It waits there holding the message beside "Starting agent…", usually done by the time it lands; the empty chat's welcome is hidden meanwhile. From a dashboard, the dashboard around the composer leaves first (~200ms, quick), then the chat fades in as the composer travels.
- **Cards belong to the composer.** Queued messages and the attachment strip rise out of the composer (~8px and a fade, ~300ms, gentle) and drop back into it when it takes them -- sent, or put back to edit (~200ms, quick); removed by hand, a card fades in place (~150ms), and a failed removal puts it back. In the strip, an added chip fades and scales in at the end, and a removed one fades while the chips after it slide over by transform. Anything keyed for animation is keyed by identity, so a progress update never replays an entrance.
- **Floating controls follow.** Anything anchored to a surface — scroll-to-latest over the composer — is re-measured when that surface is swapped or lands, never left behind.
- `prefers-reduced-motion` removes these transitions; the end state is identical.

# Keyboard

One model for every surface, so no surface grows keys of its own.

- **Regions.** The app is a tree of regions (sidebar, main pane, workspace panel, and what is inside them) following focus. Shortcuts resolve innermost region first, then outward.
- **Go to a region.** Ctrl+Shift+1/2/3 (⌘⇧ on a Mac) take you to the sidebar, the main pane and the workspace panel in screen order. They open and focus, never close: 1 enters the sidebar at the current row (on a phone, the drawer), 2 lands in the composer when there is one, 3 opens the panel if closed. Ctrl+B and Ctrl+. stay plain show/hide toggles. Arriving shows the held-focus line (Components). F6 is not relied on.
- **The leader acts where you are.** Ctrl+G, then a key: only actions within the current region, never moves between regions. Its second key is looked for innermost first and then outward, so an outer key works from inside. The menu lists the current region's keys under a breadcrumb path; ←/→ or Tab steps out to outer levels. A key that would do nothing where you are is not listed. Numbers inside a region mean positions (the workspace panel's tabs), never other regions.
- **Moving in a list.** The cursor is the wash (List row). ↑/↓ move, skipping headings; Home/End go to the ends; →/← step into and out of a level; Shift+↑/↓ extends a selection; Menu or Shift+F10 opens the row's menu. Pointer and keyboard move the one cursor.
- **Enter acts.** Opening a chat hands focus to its composer, because opening one is usually to write in it.
- **Esc steps outward** a level at a time, and from the top of a region goes home to the open chat's composer: pressing Esc enough always gets back to typing.
- Every scoped key can be found in the leader under its region, so nothing is discoverable only from settings.

# Components

Grouped by the surface they live on (Surfaces). Every row in every group follows Interaction.

## Frost

**Frost chrome (signature, use more of it)** — composer, user bubbles, header search/terminal/workspace pill, scroll-to-latest, and future floating toolbars or hero surfaces like the dashboard launch row. Shared material: `frost-fill` / `glass-bg`, `frost-stroke` / `glass-border`, blur, no opaque `--background` slab. When something floats over content or marks the primary action area, default to frosted glass before reaching for a solid card. Do not frost a list, a tree or a row; the surfaces that float -- palettes, menus, Settings, dialogs -- are frosted as a whole (Surfaces).

**Palette / modal** — the composer's frost, 14px radius, pinned near the top: type-to-filter with chips, sentence-case groups, one-line rows with keycaps, the match lit as you type, the gray cursor wash, and the keycap rail. Commands, chat search and models share these and keep their own layouts (Layout; `docs/design/palette-sketch/palette-sketch.html`).

**Leader menu** — what the leader, Ctrl+G, can do from where you are, shown only after a pause by default. The page dims except for the current region, which stays lit with its own corners and changes as the shown level changes. A small card in the palettes' frost sits above the composer. The region path is in 9px uppercase mono at the top; action rows align crisp keycaps at the left and use a neutral wash on hover. The go-to chords and Esc sit in the rail at the foot, on the same frost under a faint hairline. It rises ~8px as it arrives and fades and drops back when a choice or Esc ends it.

**Dropdown menu** — the common case, more often than a palette: sessions, shortcuts, overflow. The overlays' frost, `{rounded.pop}`, ~320px wide; context menus, submenus and popovers too. A 9px uppercase group label, then rows of **one line**: an optional leading mark (a harness mark, a drag grip, or nothing), a 12px/560 title, its muted mono meta inline and right-aligned, truncating before the title does, and trailing 13px icon actions that stay muted and appear with the row on hover or keyboard focus (always shown on touch). The whole row takes the `{colors.accent}` wash, not just the part under the pointer. A single footer action row ("+ New …") sits under a hairline. Something edited in place opens as an inline form inside its row — bordered inputs, a two-state toggle with the selected state as the gray wash, Cancel/Done — and saves on Done; the list has no separate Save. Use a popover rather than a menu when the rows hold inputs, so typing is not taken as menu navigation. A one-field rename stays a dialog.

Choosing in a menu:

- **The current choice is bold, not a tick.** Its row is white and semibold with no fill (Interaction); hover and keyboard focus are the wash. No ✓ column anywhere.
- **No notes in menus.** A choice that is not available is greyed out, and that says enough — no "Locked after the first message" line.
- **No Manage rows.** A menu is for choosing; settings are reached from Settings, not from a "Manage…" row at the foot of a picker.
- **Search opens the palette.** A menu over a long list starts with a "Search all …" row, with its shortcut keycap, that opens the matching palette — not an inline search field.
- **Stay open for the next choice.** Picking something whose follow-up sits in the same menu keeps it open: a model keeps the model menu open for Thinking, and a choice in a phone submenu returns to the options rather than closing them. A choice that ends the task closes the menu.
- **Ordered choices are a slider.** Effort-like ordered levels are a step slider whose label shows the current level; the label opens a submenu listing the levels, never a list expanding in place.
- **A tap ends where it lifts.** When a tap changes what a menu shows — opening a submenu, choosing in one — the mouse events a phone sends after it are dropped, so they cannot choose or highlight whatever the change left under the finger.

**Composer row** — the controls under the draft, in three tiers by how often they are reached for mid-conversation. Nothing leaves the row; lower tiers get quieter, not hidden.

- Desktop, left to right: attach, the context ring, the profile as its harness mark, the model-and-effort chip, permissions; then status, the dictation level while recording, the mic, and the primary slot. The chip and the slot are the only controls at full weight; settings show their value muted; attach and the mic are live actions in the text colour.
- Phone: one row — +, the draft, mic, primary slot. Every setting lives in the + menu, which shows each value rather than its name. The mic and Send stack the moment a draft reaches its third line, and stay stacked until it fits on one.
- The primary slot is one fixed-size button: Send (muted while there is nothing to send), Stop while the agent works, Send again once a draft is typed, with Stop stepping to its left. Its icon scales in ~150ms; the label changes at once.
- Stop is its mark alone: a small solid rounded square in the text colour, no fill. Nothing in the row is a white filled button.
- Recording, the mic breathes from the text colour to muted and back. No fill, ring, size change or wash; audio chrome stays monochrome.

**Composer takeover** — for anything the agent is blocked on until the user answers: the question tool, and every approval, choice or typed request a harness makes. Those are one question of one answer — Approve / Approve for session / Deny as numbered rows, choosing is answering, and Esc reads "deny" where a dismissed approval is a denial. It replaces the composer rather than stacking above it: the composer slides down out of the pane, and the takeover rises into the same slot in the composer's material and width, `{rounded.xl}`. It never scrolls inside itself:

- One step at a time. Several questions are tabs across the top — the current one a gray wash, an answered one a small check — ending in a Submit tab that summarises every answer (header muted, answer at 560, unanswered muted). Dismiss is a quiet × at the right of the tab row.
- The prompt is 14px/560. Answers are one-line rows: muted mono number, 13px/560 label, 12px muted description inline (its own line on a phone), a check at the right — a filled box when several answers are allowed. The keyboard cursor is the row's gray wash. A typed answer is the last numbered row, typed in place.
- It takes the keyboard while it is up: arrows move, a number or Enter chooses, Tab turns the page, Esc dismisses. One footer line explains the keys in keycaps; touch hides it and keeps the Next/Submit button.
- A single question with a single answer skips tabs and Submit: choosing is answering.

**User bubble** — frosted glass (`glass-bg` + blur), `{rounded.bubble}` radius, right-aligned. Assistant has no bubble. The bubble and composer are the same material family — keep them visually related.

**Attachment strip** — every attachment for the draft in one strip directly above the composer, the queued pill's width and material, never taller than ~64px (~56px on a phone); a queued message sits above it. An image is a 48px square thumbnail, cropped, 8px radius, its name the tooltip; a file is a 48px-tall chip -- type icon, name cut at ~160px, size muted beneath. Remove is a small × at the top-right, on hover or keyboard focus and always on touch. Uploading, a thin progress ring over a slightly dimmed chip; failed, a red outline with a retry mark in its place, tapping retries (one restored with a draft has no file, so it can only be removed). More chips scroll sideways with snap and a soft fade at an edge that has more; new chips go on the end and scroll into view. A quiet ⤢ at the right end always opens the list dialog (a bottom sheet on a phone): large uncropped previews, name, size, type and remove, the count and total size in the heading, Remove all and Done.

**Keycap** — 16px square, hairline, muted mono; in the text colour on the cursor row or a clickable rail action.

**Input-quiet** — borderless inside frost composer or palette search.

## Pane

**List row** — transparent, 7–8px radius. The `{colors.accent}` wash is the **cursor**: the row under the pointer, under keyboard focus, or being pressed, and only one row at a time — pointer and keyboard move the same cursor, as in a palette or menu. Keyboard focus on a row is that wash and nothing else: no focus ring, from the browser or a component. Selecting several rows is the cursor applied to each: every selected row takes the same wash, with no edge bar, tick column or other marker. In the sidebar, the current page is not a wash: every row rests at one weight in grey text, and the current row -- chat, project, workspace or page alike -- is white and semibold (660) with no fill, its Lucide icons at a heavier stroke (2px) and a harness mark lit rather than thickened. The folder or workspace holding the current chat is drawn the same way, collapsed or not, so where you are reads up the tree; a pinned row looks exactly like its unpinned row, marks included, and follows the same rules -- a harness mark in its own colours, but the white text is what must carry it, since most marks have none. The cursor and where you are can always be told apart. A current rail icon is white with a heavier stroke. Never an inset coloured bar.

**Sidebar action** — an action of the sidebar is a row, not a small button beside a heading: New project a wide row under New chat, New workspace one under Files, each also on the collapsed rail.

**Settings list** — the sidebar's language, not tiles: no box, no dividers between rows, no fill behind the page; one light hairline between groups. A group is headed by the sidebar's group label (9.6px/700, sentence case, about half the text colour) over one-line rows (~28px). A row's name is at the sidebar row's size (10.4px/400) in the text colour, and its controls at the same size; its value is quiet -- a select is its value in muted text and a small chevron, with no box, lit with the row -- and the row takes the `{colors.accent}` wash under the pointer (not on touch). State that matters -- stored, installed, a test result, an error -- sits in muted text right after the name on the same line; descriptions go in a title, not under the name. Buttons are ghost and 24px unless they are the one action waiting (Install, Save a key). Every row's control sits in one column of one width (240px; about half the row on a phone), so the boxes line up: a segmented choice, an input or a select fills it, and a lone button or switch sits at its right edge. Focus anywhere in a row is the row's wash, never a ring or outline on the control. Labels are short enough to fit it ("Local", not "This machine" -- the long name is the hover title), the name truncates before the control does, and the page never scrolls sideways. Every settings section is drawn this way; a long text (a prompt) fills the page under its row, and steps a row needs fold under it.

**Segmented choice** — two to four peer choices side by side, for a setting whose options are few and named (Transcription source, Capture, Activation): a hairline box, the current option under the gray wash, which slides to the next (~200ms). An optional 13px Lucide icon before each label. Never a colour, never a tick. A long or open list stays a select.

**Switch** — on or off: a small pill, the track near-white with a dark knob when on, the input gray with a muted knob when off. For a setting that is one or the other; a checkbox is for choosing items, not settings.

**Input-bordered** — 1px hairline inside settings/forms, `{rounded.md}` radius, as tall as its row needs: compact inputs (settings rows, the workspace filter, file search) are fine.

**Pane header** — a hairline-bottomed strip across a pane (terminal today). Left: route buttons if any, then the status indicator, the name (semibold), and one muted mono context line joined with ` · `. Right: groups of quiet ghost controls separated by a 1px, ~14px hairline, in the order the person reaches for them, with anything that does not fit collapsing into a `⋯` menu rather than scrolling.

**Tiled pane (legacy)** — what the dashboard sections, workspace columns and live-terminal empty states still use: hairline, 10px radius, flat, a gray wash on the row inside. Being retired for lists (Layout); not for new surfaces.

## Transcript

**Message time** — muted caption at the head of a message's action row (the agent's on the left, beside Regenerate; the user's beside the edit pencil), never a line of its own above the message.

**Trace header** — two lines, live and settled. The first is `Status · time · work`, after the orb: status is one verb in the foreground at weight 560, always shown -- live, a running tool's kind as a verb (Running, Reading, Editing, Searching, Fetching; Using `<name>` for any other), `Running N tools` for several at once, Thinking between tools, Writing once the answer streams; settled, Done, Interrupted or Failed. Time is muted and tabular, seconds always two digits (`01s` … `59s`, then `1m 02s`), ticking from the prompt while live and prompt to last reply once settled; a settled turn that took under a second is in milliseconds (`420ms`), as is a trail step that did. Work is single-word counts by kind (commands, reads, edits, searches, fetches, tools), every kind, most used first; left out when no tool ran. The second line is the trail's latest line, muted and cut to one line: a running tool's subject as its adapter states it (the command, a search's query in quotes, a path from its end, a page -- for Pi, read out of the call's arguments while the model is still writing them), then that step in the past tense (`Ran pwd && ls -la`) until the next step replaces it, and the thinking whenever it arrives. Settled, the last thinking if there was any, otherwise the last step. It is held open while the turn runs so nothing jumps when it arrives. Every turn that answers has a trace header, live and settled: one with no thinking and no tools is its first line alone -- the orb, Writing then Done, the time -- with no chevron and nothing to open. The chevron sits on the first line.

**Thinking orb** — the trace header's mark, 20px, centred on its two lines: a dotted orb drawn by thinking-orbs' canvas engine (MIT; only its engine is used, Solid drives it). Its motion says what the turn is doing -- connecting while starting, working while thinking (the base), searching for anything on the web, weaving while reading, trailed orbits while editing (three tilted orbits, each drawn behind its running particle), solving for a command, any tool without its own, or several at once, composing while the answer streams. A change holds for a quarter of a second at least, then crossfades over 200ms -- the new state fading in over the old as it fades out, both moving -- so a burst of instant tool calls does not flicker it, it keeps up with the label, and there is never an empty frame. Settled, it is the plain sphere -- the globe's lattice without its scan, in the engine's depth shading: for Done in the ordinary ink, turning slowly (a full turn in about twelve seconds); for Interrupted and Failed tinted `{colors.destructive}` and sputtering -- brief stretches of that turn, each snagging to a stop, between jolts past the mark and back, stutters and kicks backwards, about fourteen seconds before it repeats. The catalogue of every frame -- the library's and Conduit's -- and which state uses each is `docs/design/orb-catalogue/contact-sheet.html`. Reduced motion is a still frame throughout. Listening is kept for dictation.

**Trace trail** — the opened trace: one light line per step on the body's rail, no boxes. A tool step is its kind's icon (a spinner while it runs), a verb -- present while running, past once done (Ran, Read, Edited, Searched, Fetched; Used `<name>` otherwise) -- its subject in muted mono, and its duration muted and right-aligned; a failed step's icon takes the destructive tint and says Failed, one a stop cut short says Stopped. A thinking or narration step is its summary line. Two or more tool steps of one kind in a row are one line ("Ran 5 fetches"), folded like every other line, the steps on a rail of their own beneath it. Any line opens in place, under its verb: a tool's output, a thinking step's full text. Hover and focus are the wash; the chevron shows only on the cursor or when open. Discarded text is struck and says Not kept at the right. Reasoning the provider returned only encrypted is one italic note where it first happened -- "Reasoning not shared by the provider" -- not a line per step. Sizes are the header's, a step under the answer: lines, verbs and durations at 0.8125rem, the subject in mono at 0.75rem, and what a line opens to a step up for prose (0.875rem) and at 0.75rem for mono -- in rem, so the desktop's and the phone's bases each place the trail with its header.

**Harness prompt** — a turn the harness started itself, such as a background task finishing, opens on its notice rather than a user bubble: one muted 0.8125rem line where the prompt sits, right-aligned, after a 13px bell. No bubble, no frost and no actions, because nobody wrote it.

**Disclosure** — one component for everything that folds (`chat/disclosure.tsx`): a trace, a tool call, a line of the trail, a discarded answer. A header, one turning chevron, and a body that unfolds in height and folds all the way to nothing, gap included. Opened at the transcript's tail it lets go of the tail rather than being chased, so it opens downward from where it was clicked.

## Anywhere

**Harness mark** — rests greyed with its row, and shows its own colour on hover, focus, or the current chat (Codex's gradient, Claude Code's orange, the rest at full foreground). Live activity or an unread reply shows in its place first. The Conduit mark is the wordmark's Druk Wide capital C (`public/brand/conduit-mark.svg`).

**Runtime dot** — 6–8px, live green / warn amber / danger red / muted. Color on the dot only. Never blue for runtime state (the chat row's unread/recent status dot keeps its own colour; Forbidden color). A healthy indicator is the dot alone; it gains a label only when it has something to say ("Updating", "Reconnecting", "Read only"), and a busy state is a small spinner in the dot's place. One indicator per surface: fold "server" and "this connection" into one, worst state first.

**Held focus** — a region reached by a go-to-region shortcut (Ctrl+Shift+1/2/3: sidebar, main pane, workspace panel) shows a 1.5px line along its bottom edge in the near-neutral `{colors.ring}` tone, fading out at both ends so it sits inside any corner; the regions' bottoms line up, so it reads as one baseline with the held region lit. No outline, and no coloured title. It stays while focus is in that region or in no region (a menu, a dialog), and goes when focus reaches another region any other way; a click, Tab, or a menu handing focus back never lights one. On that arrival the rest of the app dims slightly (~18%) for ~0.8s around it -- the leader menu's lit region, briefly -- and the line stays; the line may prove enough on its own. Not on a phone.

# Being migrated

Surfaces that do not match the language yet. Do not copy them; when you touch one, move it towards its target, and take it off this list once it is there.

- **Dialogs and confirms**: solid cards → frost.
- **Workspace panel, Computer page, harness dashboards**: hairline tiles (Tiled pane) → the pane. Each waits for its own redesign.
- **Leftover blue** (Forbidden color) wherever it is found.

# Do's and Don'ts

Do:

- Design in near-monochrome charcoal. Hue only for live dots, destructive, git/data glyphs.
- Group with a heading and space, not hairline boxes or colored surfaces.
- Choose the surface first: frost for anything that floats -- overlays and floating chrome alike -- pane for where you work, frame for navigation. Frost is the signature material.
- Follow Interaction everywhere: grey at rest, the wash as the one cursor, the current item white and semibold with no fill.
- Keep the composer at the centre of every dashboard; it is the home-screen pattern.
- Stay dark. Match existing Solid/Kobalte slots (`data-slot="button"`, menu, dialog).
- Hide the transcript scrollbar; keep thin thumbs on panes that scroll as ledgers.
- Respect `prefers-reduced-motion` except the existing meteor field.

Don't:

- Do not use any blue for any purpose: no selection, rails, slivers, gradients, status strips, card emphasis, focus, dots, waveforms, or audio states.
- Do not put a colored left-edge sliver on selected cards, nav, or rows.
- Do not follow the `frontend-design` skill's urge to add a signature accent color. Frosted glass is the signature; no hue is needed.
- Do not frost a row, a list, the workspace tree or the transcript. Frost is for what floats — but use it generously there.
- Do not ship a light theme, mesh gradients, glow, or generic SaaS card grid.
- Do not center a hero of metric boxes. Conduit leads with a composer and lists.
- Do not introduce a second font, icon set, or chart library for chrome.
- Do not encode implementation gotchas (density-duplicate CSS, `-webkit-backdrop-filter` pairing, content-visibility) as visual rules.

# References

Visual companions to the rules above; the rules win where they differ.

- `docs/design/palette-sketch/palette-sketch.html` -- chat search, the command palette and their states, live beside the palette as it was (serve the repository root to open it).
- `docs/design/orb-catalogue/contact-sheet.html` -- every thinking-orb frame and which state uses it.
- `docs/design/dashboard-layout/`, `docs/design/conduit-home-dashboard/` -- the dashboard sketches.
