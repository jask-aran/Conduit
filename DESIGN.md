---
name: Conduit
description: In-app visual language for Conduit. Dark charcoal control plane, tiled hairline panes, frosted glass floating chrome. No blue anywhere.
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

Conduit is a self-hosted, always-dark agent control plane. The look is charcoal, quiet, and tiled: a darker frame, inset rounded panes, hairline lists, and frosted glass floating chrome. It is not a marketing site, not a light theme, and not a colorful dashboard.

The accepted surfaces are the app dashboard, the chat/workspace split, the frosted composer, the header action pill, and the model-picker palette. Copy those patterns. Frosted glass is the signature material — prefer it for floating, transient, or hero chrome, not just the composer.

Stack: SolidJS, Kobalte primitives, Geist Variable, tokens in `conduit-web/src/client/styles.css`. Do not add React, extra icon kits, or a second palette.

# Colors

The app is locked to `.dark` on `<html>`. Light `:root` tokens exist as leftovers; never paint them.

The charcoal is cool-neutral at chroma ~0.004–0.006. That gray is the brand. Do not raise chroma to make it "read as blue."

- **frame** — page ground behind inset panes (body, `#root`, mobile sidebar).
- **background** — inset pane fill (chat main, settings shell).
- **foreground / muted-foreground** — type. Muted for timestamps, hints, empty states, icons at rest.
- **border** — 1px hairlines. Almost every grouping is a hairline, not a fill.
- **accent** — white at 6–7% opacity. This is hover, pressed, and selected. Selection is a gray wash, never a hue.
- **card / popover** — slightly raised solids for menus, palettes, modal cards, tool/attachment cards. Frosted glass is preferred wherever the surface floats or overlays content (composer, user bubbles, header pill, floating toolbars); solid popover remains for dense lists like palettes where blur would hurt legibility.
- **primary** — near-white. Default buttons and the one bright action.
- **destructive** — errors and destructive actions only.
- **live / warn** — tiny runtime dots and git-ish status. Never as fills, rails, or card washes.
- **frost-fill / frost-stroke / glass-bg / glass-border** — the signature floating material. Default to it for new floating chrome: composer, user bubbles, header pill, scroll-to-latest, floating toolbars, dashboard launch row. Shared recipe in Elevation & Depth.

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
- focus rings (use the near-neutral `{colors.ring}`)
- runtime dots, waveform bars, audio/connecting states, success text, icon tints

Replacements: active/connecting states use `{colors.muted-foreground}`; live stays `{colors.live}` green, warn amber, danger red; success/ready text uses `{colors.foreground}` or `{colors.live}`; waveform bars and audio chrome use foreground/muted tints.

That treatment is leftover frontend-design skill output. It has stained Settings (selected nav, status strip, current workspace card), the sidebar, chat-selected rows, and voice/search chrome. Do not encode it, copy it, or extend it. If you need "selected," use `{colors.accent}` full-row wash like the model picker and dashboard lists.

Workspace glyph colors and git file dots are user/data colors, not brand. Leave them on the glyph; do not echo them into chrome.

# Typography

Geist Variable everywhere for UI. `ui-monospace` (not Geist Mono) for model ids, paths, keycaps, status, waveforms.

- **display** — dashboard title only ("Start where the work is."). Weight 560, tight tracking.
- **heading** — settings/modal titles ~18–20px, weight 600, slight negative tracking.
- **sans 12–14px** — body, chat, lists.
- **row-title ~10.5px / 580** — dashboard row titles (see `{typography.row-title}`).
- **caption 8.5–9px** — section subtitles, timestamps, empty copy.
- **uppercase tracked meta** — palette group labels (`SCOPED`, `GOOGLE`), terminal pane tags. Scarce.
- **keycaps** — 8px mono in a 16px rounded square, muted stroke.

Do not invent further type sizes. Do not use serif except the Capacitor first-launch wordmark (legacy).

# Layout

Desktop is a darker **frame** with **inset rounded panes** (chat ~16px radius, 8px margin, inset hairline — not an outer border). Mobile drops the inset and goes full-bleed, keeping safe-area padding on edge controls.

Two pane types:

1. **Tiled content** — dashboard sections, workspace tree + preview, recent-chat lists, settings sections. Hairline box, ~10px radius, transparent/background fill, stacked rows, no drop shadow. Tiles sit adjacent; they do not float in a card grid with gaps of empty brand color.
2. **Floating chrome** — composer, user bubbles, header icon pill, scroll-to-latest, floating toolbars. Frosted glass, larger radius (~22px for pills, 15px for bubbles), centered on the reading column where applicable. This is the signature material — reach for it first for anything that floats or overlays content.

Dashboard composition (canonical):

- Centered ~880px column.
- Display title, then a launch row: frost composer | two quiet quick-action tiles.
- Below: one tall tiled list (recent chats) spanning two rows, two stacked tiles on the right (workspaces, terminals).
- Section heading is a 48px hairline header: title + 9px muted subtitle, trailing quiet controls.
- Rows are 43px, icon + copy + chevron, hover = accent wash.

Chat composition:

- Sidebar on the frame (transparent).
- Chat pane inset; workspace pane is a second full-bleed tiled split (tree | preview), not a floating card.
- Assistant markdown is the full reading column. User messages are a right-aligned frosted glass bubble (~640px max, `{rounded.bubble}`).
- Composer sits at the bottom of the pane, same column width as dashboard composer — frosted glass, the reference material for all floating chrome.

Menus and pane headers follow the component entries below. Palettes (model picker is the reference):

- Centered solid popover, 11px radius, dim 55% behind.
- Search row, hairline, close at right.
- Uppercase 9px group labels.
- Highlighted option = accent wash + 6–7px row radius. No left rail. Model id in muted mono, right-aligned. The current choice keeps a fainter standing wash and a heavier label while the cursor is elsewhere — never a tick.
- Footer hint bar: keycaps + labels. Actionable hints use foreground; the rest stay muted.
- Widths: commands 512px, models 576px, chat search 720px. Mobile: fill the visual viewport with a ~6px inset so it remains a dialog, not a new route.

Settings pattern (illustrative, non-normative — current shell ~1120×820, rail ~190px):

- **Nav = palette selection.** The rail behaves like the model-picker list: full-row `{colors.accent}` wash, `{rounded.md}`, muted icon at rest. No sliver, gradient, border emphasis, or icon recolor.
- **Content = dashboard tiles.** Sections are hairline `10px` groups with stacked rows, a header title + muted subtitle, and trailing quiet controls. No status-strip card, no multi-column card grid as chrome.
- New settings chrome must follow these two patterns, not the legacy blue selected nav.

# Elevation & Depth

Almost none on tiled content. Frosted glass carries the depth.

- Tiles and panes: hairline only.
- Palettes/modals: one dark shadow `0 24px 70px rgb(0 0 0 / 35–45%)` plus hairline. Solid `{colors.popover}` stays for dense lists where blur would hurt legibility.
- Frost chrome (the signature): translucent `frost-fill`, 1px white-alpha `frost-stroke`, blur 19–24px, optional top specular inset. No heavy drop. Composer, user bubble (`glass-bg` + blur), header pill, and future floating toolbars share this one material — do not redeclare it per component.
- Primary buttons: top specular inset + short lift. Ghost buttons: no fill until hover.

No stacked card shadows, no colored glows, no glass on tiled content, no glass on palettes.

# Shapes

- Inset panes: 16px.
- Tiles / dashboard sections: 10px.
- Rows / small controls: 6–8px.
- Composer and header pill: 22px (squircle, not a circle, not a sharp box).
- Icon buttons in chrome: ~8–10px radius inside the frost pill.
- Pills only for true pills (scope toggle, runtime dots). Do not pill section titles or metadata.

Icons are Lucide at 1.5 stroke, 13–16px, muted at rest. The composer's own actions — attach, +, mic, Send — are the exception: stroke 2, in the text colour, because they are the row's weight.

# Motion

Motion explains a change of place: where something went, and what took its place. It is not decoration, and a surface that does not change place does not animate.

- **Leave the way you came.** Something that belongs to the bottom edge leaves downward and returns upward; a panel leaves toward the edge its control sits on.
- **One leaves, then the other arrives.** The outgoing surface goes first and the incoming one starts ~150ms later, so they never cross-fade in place.
- **Quick out, gentle in.** Leaving is ~200ms and accelerates (`cubic-bezier(.4, 0, 1, 1)`); arriving is ~300ms and settles (`cubic-bezier(.2, .8, .2, 1)`), rising ~32px with a fade.
- **Hold the reading position.** A surface that is swapped keeps its room while it is away, so the swap itself moves nothing. The transcript moves only through its tail spring, when what replaced the surface is taller.
- **Transform and opacity only.** Animate `transform`/`translate` and `opacity`; never width, height, or layout. A panel slides over its neighbour rather than squeezing it (the maximised workspace panel is the reference). Two exceptions. An answer discarded while on screen has to give its room back, so it folds once into its "Interrupted · not kept" row (~320ms), and an answer loaded already discarded is simply the row. And a row the reader opens or closes -- a trace, a tool call, a discarded answer, all one Disclosure -- unfolds its body in height (~200ms, with a short fade), because pushing what is below is what they asked for; a step that arrives in an open trace only fades in with a 4px rise.
- **The first open settles, then shows.** Until the page is laid out -- everything that shapes it in place, the workspace panel included -- only the frame shows. Then the composer is simply there and every other region fades in around it, once (~300ms, settling), with no rise, since nothing is changing place. Nothing may arrive or move after the fade starts: a part that decides the layout is loaded before it, not revealed after it.
- **Floating controls follow.** Anything anchored to a surface — scroll-to-latest over the composer — is re-measured when that surface is swapped or lands, never left behind.
- `prefers-reduced-motion` removes these transitions; the end state is identical.

# Components

**Frost chrome (signature, use more of it)** — composer, user bubbles, header search/terminal/workspace pill, scroll-to-latest, and future floating toolbars or hero surfaces like the dashboard launch row. Shared material: `frost-fill` / `glass-bg`, `frost-stroke` / `glass-border`, blur, no opaque `--background` slab. When something floats over content or marks the primary action area, default to frosted glass before reaching for a solid card. Do not frost lists, trees, settings pages, or palettes.

**Tiled pane** — dashboard sections, workspace columns, live-terminal empty states. Hairline, 10px radius, flat. Selected/hover row is a gray wash inside the tile.

**List row** — transparent, 7–8px radius. The `{colors.accent}` wash is the **cursor**: the row under the pointer, under keyboard focus, or being pressed, and only one row at a time — pointer and keyboard move the same cursor, as in a palette or menu. Keyboard focus on a row is that wash and nothing else: no focus ring, from the browser or a component. Selecting several rows is the cursor applied to each: every selected row takes the same wash, with no edge bar, tick column or other marker. In the sidebar, the current page is not a wash: every row rests at one weight in grey text, and the current row -- chat, project, workspace or page alike -- is white and semibold (660) with no fill, its Lucide icons at a heavier stroke (2.6) and a harness mark lit rather than thickened. The folder or workspace holding the current chat is drawn the same way, collapsed or not, so where you are reads up the tree; a pinned row looks exactly like its unpinned row, marks included, and follows the same rules -- a harness mark in its own colours, but the white text is what must carry it, since most marks have none. The cursor and where you are can always be told apart. A current rail icon is white with a heavier stroke. Never an inset coloured bar.

**Palette / modal** — solid `{colors.popover}`, 11–12px radius. Model picker ergonomics are the standard: type-to-filter, groups, gray highlight, keycap footer.

**User bubble** — frosted glass (`glass-bg` + blur), `{rounded.bubble}` radius, right-aligned. Assistant has no bubble. The bubble and composer are the same material family — keep them visually related.

**Leader menu** — what Ctrl+X can do from where you are, shown only after a pause by default. A step back: the page dims and one small card sits bottom-centre, in the composer's material with the question card's rows (keycap, then a 12px/560 label; the row takes the wash on hover). Its heading is the path of regions in 9px uppercase mono, the level shown as a wash; the go-to chords and Esc sit at the foot under a hairline. It rises ~8px as it arrives; choosing or cancelling ends it.

**Dropdown menu** — the common case, more often than a palette: sessions, shortcuts, overflow. Solid `{colors.popover}`, `{rounded.pop}`, ~320px wide. A 9px uppercase group label, then rows of **one line**: an optional leading mark (a harness mark, a drag grip, or nothing), a 12px/560 title, its muted mono meta inline and right-aligned, truncating before the title does, and trailing 13px icon actions that stay muted and appear with the row on hover or keyboard focus (always shown on touch). The whole row takes the `{colors.accent}` wash, not just the part under the pointer. A single footer action row ("+ New …") sits under a hairline. Something edited in place opens as an inline form inside its row — bordered inputs, a two-state toggle with the selected state as the gray wash, Cancel/Done — and saves on Done; the list has no separate Save. Use a popover rather than a menu when the rows hold inputs, so typing is not taken as menu navigation. A one-field rename stays a dialog.

Choosing in a menu:

- **The current choice is a wash, not a tick.** Its row keeps the `{colors.accent}` wash and a heavier label; hover and keyboard focus use the same wash. No ✓ column anywhere.
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

**Pane header** — a hairline-bottomed strip across a pane (terminal today). Left: route buttons if any, then the status indicator, the name (semibold), and one muted mono context line joined with ` · `. Right: groups of quiet ghost controls separated by a 1px, ~14px hairline, in the order the person reaches for them, with anything that does not fit collapsing into a `⋯` menu rather than scrolling.

**Runtime dot** — 6–8px, live green / warn amber / danger red / muted. Color on the dot only. Never blue. A healthy indicator is the dot alone; it gains a label only when it has something to say ("Updating", "Reconnecting", "Read only"), and a busy state is a small spinner in the dot's place. One indicator per surface: fold "server" and "this connection" into one, worst state first.

**Composer takeover** — for anything the agent is blocked on until the user answers: the question tool, and every approval, choice or typed request a harness makes. Those are one question of one answer — Approve / Approve for session / Deny as numbered rows, choosing is answering, and Esc reads "deny" where a dismissed approval is a denial. It replaces the composer rather than stacking above it: the composer slides down out of the pane, and the takeover rises into the same slot in the composer's material and width, `{rounded.xl}`. It never scrolls inside itself:

- One step at a time. Several questions are tabs across the top — the current one a gray wash, an answered one a small check — ending in a Submit tab that summarises every answer (header muted, answer at 560, unanswered muted). Dismiss is a quiet × at the right of the tab row.
- The prompt is 14px/560. Answers are one-line rows: muted mono number, 13px/560 label, 12px muted description inline (its own line on a phone), a check at the right — a filled box when several answers are allowed. The keyboard cursor is the row's gray wash. A typed answer is the last numbered row, typed in place.
- It takes the keyboard while it is up: arrows move, a number or Enter chooses, Tab turns the page, Esc dismisses. One footer line explains the keys in keycaps; touch hides it and keeps the Next/Submit button.
- A single question with a single answer skips tabs and Submit: choosing is answering.

**Keycap** — 16px square, hairline, muted mono.

**Input-quiet** — borderless inside frost composer or palette search.

**Input-bordered** — 1px hairline inside settings/forms, `{rounded.md}` radius, min-height ~34–36px.

# Do's and Don'ts

Do:

- Design in near-monochrome charcoal. Hue only for live dots, destructive, git/data glyphs.
- Group with hairline tiles and space, not colored surfaces.
- Put frosted glass on floating chrome and reach for it first: composer, user bubbles, header pill, scroll-to-latest, floating toolbars, dashboard launch row. It is the signature material.
- Select with a gray accent wash (model picker, dashboard rows, settings rail).
- Keep the dashboard title, frost composer, and tiled lists as the home-screen pattern.
- Stay dark. Match existing Solid/Kobalte slots (`data-slot="button"`, menu, dialog).
- Hide the transcript scrollbar; keep thin thumbs on panes that scroll as ledgers.
- Respect `prefers-reduced-motion` except the existing meteor field.

Don't:

- Do not use any blue for any purpose: no selection, rails, slivers, gradients, status strips, card emphasis, focus rings, dots, waveforms, or audio states.
- Do not put a colored left-edge sliver on selected cards, nav, or rows.
- Do not follow the `frontend-design` skill's urge to add a signature accent color. Frosted glass is the signature; no hue is needed.
- Do not glass the dashboard tiles, workspace tree, transcript, or settings body. Frost is for floating chrome — but use it generously there.
- Do not ship a light theme, mesh gradients, glow, or generic SaaS card grid.
- Do not center a hero of metric boxes. Conduit leads with a composer and lists.
- Do not introduce a second font, icon set, or chart library for chrome.
- Do not encode implementation gotchas (density-duplicate CSS, `-webkit-backdrop-filter` pairing, content-visibility) as visual rules.
