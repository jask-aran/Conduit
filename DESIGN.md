---
name: Conduit
description: In-app visual language for Conduit. Dark charcoal control plane, tiled hairline panes, frost on floating chrome only. Never the steely-blue selection treatment.
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
    rounded: "11px"
  frost-chrome:
    backgroundColor: "{colors.frost-fill}"
    textColor: "{colors.foreground}"
    rounded: "{rounded.composer}"
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
  input:
    backgroundColor: "transparent"
    textColor: "{colors.foreground}"
    rounded: "{rounded.md}"
---

# Overview

Conduit is a self-hosted, always-dark agent control plane. The look is charcoal, quiet, and tiled: a darker frame, inset rounded panes, hairline lists, and frost only on floating chrome (composer, header pill). It is not a marketing site, not a light theme, and not a colorful dashboard.

The accepted surfaces are the app dashboard, the chat/workspace split, the frosted composer, the header action pill, and the model-picker palette. Copy those. Do not copy Settings' steely-blue selected-nav treatment.

Stack: SolidJS, Kobalte primitives, Geist Variable, tokens in `conduit-web/src/client/styles.css`. Do not add React, extra icon kits, or a second palette.

# Colors

The app is locked to `.dark` on `<html>`. Light `:root` tokens exist as leftovers; never paint them.

The charcoal is cool-neutral at chroma ~0.004–0.006. That gray is the brand. Do not raise chroma to make it "read as blue."

- **frame** — page ground behind inset panes (body, `#root`, mobile sidebar).
- **background** — inset pane fill (chat main, settings shell).
- **foreground / muted-foreground** — type. Muted for timestamps, hints, empty states, icons at rest.
- **border** — 1px hairlines. Almost every grouping is a hairline, not a fill.
- **accent** — white at 6–7% opacity. This is hover, pressed, and selected. Selection is a gray wash, never a hue.
- **card / popover** — slightly raised solids for menus, palettes, modal cards, tool/attachment cards. Not glass.
- **primary** — near-white. Default buttons and the one bright action.
- **destructive** — errors and destructive actions only.
- **live / warn** — tiny runtime dots and git-ish status. Never as fills, rails, or card washes.
- **frost-fill / frost-stroke** — floating chrome only.

## Forbidden color

`--accent-cool` (`oklch(0.72 0.045 246)`) and any steely, slate, or "intelligent blue" derived from it must not be used for:

- selected rows, cards, or nav items
- a left-edge sliver / inset rail that wraps a highlight
- a cool gradient wash on a selected control
- status strips, current-item cards, or "this is active" surfaces
- focus rings (use a near-neutral ring)

That treatment is leftover frontend-design skill output. It currently stains Settings (selected nav, status strip, current workspace card). Do not encode it, copy it, or extend it. If you need "selected," use `{colors.accent}` full-row wash like the model picker and dashboard lists.

Workspace glyph colors and git file dots are user/data colors, not brand. Leave them on the glyph; do not echo them into chrome.

# Typography

Geist Variable everywhere for UI. `ui-monospace` (not Geist Mono) for model ids, paths, keycaps, status, waveforms.

- **display** — dashboard title only ("Start where the work is."). Weight 560, tight tracking.
- **heading** — settings/modal titles ~18–20px, weight 600, slight negative tracking.
- **sans 12–14px** — body, chat, lists. Dashboard row titles ~10.5px / 580.
- **caption 8.5–9px** — section subtitles, timestamps, empty copy.
- **uppercase tracked meta** — palette group labels (`SCOPED`, `GOOGLE`), terminal pane tags. Scarce.
- **keycaps** — 8px mono in a 16px rounded square, muted stroke.

Do not invent a type scale. Do not use serif except the Capacitor first-launch wordmark (legacy).

# Layout

Desktop is a darker **frame** with **inset rounded panes** (chat ~16px radius, 8px margin, inset hairline — not an outer border). Mobile drops the inset and goes full-bleed, keeping safe-area padding on edge controls.

Two pane types:

1. **Tiled content** — dashboard sections, workspace tree + preview, recent-chat lists. Hairline box, ~10px radius, transparent/background fill, stacked rows, no drop shadow. Tiles sit adjacent; they do not float in a card grid with gaps of empty brand color.
2. **Floating chrome** — composer, header icon pill. Frosted, larger radius (~22px), centered on the reading column (~608–760px).

Dashboard composition (canonical):

- Centered ~880px column.
- Display title, then a launch row: frost composer | two quiet quick-action tiles.
- Below: one tall tiled list (recent chats) spanning two rows, two stacked tiles on the right (workspaces, terminals).
- Section heading is a 48px hairline header: title + 9px muted subtitle, trailing quiet controls.
- Rows are 43px, icon + copy + chevron, hover = accent wash.

Chat composition:

- Sidebar on the frame (transparent).
- Chat pane inset; workspace pane is a second full-bleed tiled split (tree | preview), not a floating card.
- Assistant markdown is the full reading column. User messages are a right-aligned frost bubble (~640px max).
- Composer sits at the bottom of the pane, same column width as dashboard composer.

Palettes (model picker is the reference):

- Centered solid popover, 11px radius, dim 55% behind.
- Search row, hairline, close at right.
- Uppercase 9px group labels.
- Highlighted option = accent wash + 6–7px row radius. No left rail. Model id in muted mono, right-aligned.
- Footer hint bar: keycaps + labels. Actionable hints use foreground; the rest stay muted.
- Widths: commands 512px, models 576px, chat search 720px. Mobile: fill the visual viewport with a ~6px inset so it remains a dialog, not a new route.

Settings is a large solid shell (up to 1120×820) with a 190px rail. New settings chrome must follow dashboard tiles and palette selection, not the current cool-blue selected nav.

# Elevation & Depth

Almost none.

- Tiles and panes: hairline only.
- Palettes/modals: one dark shadow `0 24px 70px rgb(0 0 0 / 35–45%)` plus hairline.
- Frost chrome: translucent fill, 1px white-alpha stroke, blur 19–24px, optional top specular inset. No heavy drop.
- Primary buttons: top specular inset + short lift. Ghost buttons: no fill until hover.

No stacked card shadows, no colored glows, no glass on tiled content, no glass on palettes.

# Shapes

- Inset panes: 16px.
- Tiles / dashboard sections: 10px.
- Rows / small controls: 6–8px.
- Composer and header pill: 22px (squircle, not a circle, not a sharp box).
- Icon buttons in chrome: ~8–10px radius inside the frost pill.
- Pills only for true pills (scope toggle, runtime dots). Do not pill section titles or metadata.

Icons are Lucide at 1.5 stroke, 13–16px, muted at rest.

# Components

**Frost chrome** — composer, header search/terminal/workspace pill, and future floating toolbars. Shared material: `frost-fill`, `frost-stroke`, blur, no opaque `--background` slab. Use it more on floating controls. Do not frost lists, trees, settings pages, or palettes.

**Tiled pane** — dashboard sections, workspace columns, live-terminal empty states. Hairline, 10px radius, flat. Selected/hover row is a gray wash inside the tile.

**List row** — transparent, 7–8px radius, hover `{colors.accent}`. Selected chats in the sidebar may use the same wash; never an inset colored bar.

**Palette / modal** — solid `{colors.popover}`, 11–12px radius. Model picker ergonomics are the standard: type-to-filter, groups, gray highlight, keycap footer.

**User bubble** — frost (glass-bg + blur), 15px radius, right-aligned. Assistant has no bubble.

**Runtime dot** — 6–8px, live green / warn amber / danger red / muted. Color on the dot only.

**Keycap** — 16px square, hairline, muted mono.

**Input** — borderless inside frost or palette search; bordered 1px inside settings/forms, 7px radius, min-height ~34–36px.

# Do's and Don'ts

Do:

- Design in near-monochrome charcoal. Hue only for live dots, destructive, git/data glyphs.
- Group with hairline tiles and space, not colored surfaces.
- Put frost on floating chrome and keep using it there.
- Select with a gray accent wash (model picker, dashboard rows).
- Keep the dashboard title, frost composer, and tiled lists as the home-screen pattern.
- Stay dark. Match existing Solid/Kobalte slots (`data-slot="button"`, menu, dialog).
- Hide the transcript scrollbar; keep thin thumbs on panes that scroll as ledgers.
- Respect `prefers-reduced-motion` except the existing meteor field.

Don't:

- Do not use `--accent-cool` or any steely/slate blue for selection, rails, gradients, status strips, or card emphasis.
- Do not put a colored left-edge sliver on selected cards, nav, or rows.
- Do not follow the `frontend-design` skill's urge to add a signature accent color.
- Do not glass the dashboard tiles, workspace tree, transcript, or settings body.
- Do not ship a light theme, mesh gradients, glow, or generic SaaS card grid.
- Do not center a hero of metric boxes. Conduit leads with a composer and lists.
- Do not introduce a second font, icon set, or chart library for chrome.
- Do not encode implementation gotchas (density-duplicate CSS, `-webkit-backdrop-filter` pairing, content-visibility) as visual rules.
