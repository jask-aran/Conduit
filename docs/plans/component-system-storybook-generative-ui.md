# Component system, gallery workbench, and generative UI

Status: decisions agreed 2026-10-08; milestone 0 done 2026-10-10; milestone 1 started (gallery canvas in `src/gallery/`).
Supersedes the earlier long-form plan (see git history of this file for the
per-file TSX/CSS inventory, Storybook setup notes and the iframe-artifact
security discussion).
Scope: `conduit-web` components, styles and dev tooling.
Related: [DESIGN.md](../../DESIGN.md), [CONTRIBUTING.md](../../CONTRIBUTING.md),
[testing](../TESTING.md).

## Why

All of these, together: the same control drifts across screens; tuning
needs a fast visual loop without clicking through the app; agents hand-roll
UI instead of reusing ours; and models should eventually render Conduit
components in answers. One canonical component set serves all four.

## Decisions

1. **`DESIGN.md` is the only design document.** It holds foundations, the
   catalogue of every canonical component (name, purpose, surface, variants,
   link to source and gallery story), composition rules, an
   intentional-exceptions register, and a separate known-mismatches list.
   No other ongoing design doc; this plan is an implementation record.
2. **Drift rule.** Adding, changing, deprecating or overriding a canonical
   component updates its source, its gallery stories and its `DESIGN.md`
   entry in the same change.
3. **Custom gallery, not Storybook/Histoire.** A dev-only separate Vite entry
   (`conduit-web/gallery.html`, `npm run gallery`, own port), never in the
   production bundle or the authenticated server. It renders the **real**
   components with the real stylesheet, dark root, Geist, frame/pane/frost,
   portals working. Features: co-located `*.story.tsx` files, desktop/phone
   viewport presets, prop controls, real app compositions via deterministic
   fixtures (no live server).
4. **One canvas, live propagation (revised 2026-10-10).** The gallery is a
   single page: a canvas laying out every base component, real and
   rendered, beside example surfaces from the app (phone header, sidebar
   header, composer, settings list) showing those components in their
   customised state. Everything is in one document on one stylesheet, so
   tuning a base component re-renders its customised uses on the same
   canvas live. Each component and surface is an addressable region
   (anchor) so agents can screenshot one at desktop and phone widths
   instead of clicking through the app; there is no per-story page.
   For propagation to work, a customisation must be expressed as overrides
   of the base's tokens, not a re-drawn copy (Known mismatches).
5. **Token tuning exports a CSS patch.** A token panel edits CSS variables
   live on the story root, with reset and before/after compare, and copies a
   CSS diff. The browser never writes source. Styles not yet token-driven are
   labelled as such.
6. **Three layers.** Feature compositions (chat, dashboards, settings,
   workspace) stay in `client/`; canonical primitives in
   `src/components/ui/` and evidence-backed patterns in
   `src/components/patterns/`, each a small module behind an `index.ts`
   barrel; Solid + Kobalte + CSS tokens underneath. Old import paths keep
   working via re-exports during migration. No React, no second palette, no
   Ark/TanStack until a concrete gap.
7. **Registry-ready APIs now, runtime later.** Canonical components get
   stable names, typed and mostly serializable props, controlled-state
   conventions (`value`/`onChange`, `open`/`onOpenChange`) and bounded
   variants, so a model-facing registry can wrap them without rewriting.
8. **Generative UI starts with fixed render tools.** After primitives are
   canonical, ship a few structured tools (`render_table`, `render_chart`,
   `render_choice`) rendered natively as a Conduit transcript block from a
   curated registry. No DSL, no iframe runtime yet. Exposed as a
   Conduit-owned tool: native to the Conduit runtime (pi-durable), and to
   Codex/Claude Code via MCP, so nothing harness-specific reaches the browser.

9. **Fixture runtime store.** Coupled app pieces (composer, sidebar,
   transcript) mount unchanged in the gallery against one fake runtime/state
   provider seeded from recorded fixtures, reused by stories and agent checks.
10. **Drift rule is linted.** A script fails when a `components/ui` export
    lacks a story or a `DESIGN.md` catalogue row; it runs with typecheck.
11. **Gallery is the preferred agent UI seam.** For component and styling
    changes agents screenshot the relevant story at desktop and phone widths
    instead of driving the full app; record this in `docs/TESTING.md` when the
    gallery lands.

## Milestones

0. **Inventory.** Regenerate (don't trust a stale list) the shared
   primitives, their consumers, raw duplicated controls and hardcoded tokens;
   seed the `DESIGN.md` catalogue and exception format.
1. **Gallery.** Separate Vite entry with stories for existing primitives,
   frost dialogs, settings controls, and a few real app compositions, without
   moving any component. *Gate:* an open dialog and menu render identically
   in app and gallery; production bundle unchanged.
2. **Canonical primitives.** Split `components/primitives.tsx`, fold in
   `frost.tsx`, Segmented/Switch, Disclosure, StepSlider into
   `components/ui/`; compatibility re-exports; migrate callers incrementally.
3. **Patterns.** ListRow/SettingsRow/status/group patterns extracted only
   where reuse is real.
4. **Token panel** and selective token consolidation out of `styles.css`.
5. **First render tools** (`render_table` first) via the registry.
6. **Ongoing dedup** of one-offs; Markdown/KaTeX, transcript virtualisation,
   terminal and editor internals stay specialised.

## Milestone 0 record (2026-10-10)

Seeded in `DESIGN.md` under Catalogue, Intentional exceptions and Known
mismatches. Snapshot of what it found:

- **Shared components:** `components/primitives.tsx` (Button, Spinner,
  Badge, Menu/ContextMenu families, Popover, PopoverSearchList, Tooltip,
  Field family, Input, Textarea), `components/frost.tsx` (FrostDialog,
  FrostOverlay, Keycap), `components/phone-menu-panels.tsx`. Outside
  `components/`: Segmented and Switch (`settings/settings-controls.tsx`),
  Disclosure, StepSlider, runtime indicator, frost material.
- **Importers (files):** Button 20, Spinner 14, Menu 11, FrostDialog 9,
  ContextMenu 6, Segmented/Switch 6, Input 5, Popover 3, Field 2,
  Disclosure 2, StepSlider 2, Tooltip 1, Textarea 1, Keycap 1, Badge 0.
  The frost material class is used in 8 files, the runtime indicator in 9.
- **Duplicated controls:** segmented choice drawn four ways; `.menu-row`
  without a component; raw `<button>` most in terminal pane (23), sidebar
  (17), `main.tsx` (14), command menu (12), Computer dashboard (12).
- **Hardcoded values:** about 7.6k lines of CSS across 9+ files
  (`styles.css` 2.9k). 55 custom properties on `:root`; colours mostly
  tokens (a few `#000`/`#fff` and syntax/warning hexes). Radii are mostly
  literal (999px 60, 6px 47, 4px 28, 7/8/5px 22-23, 10px 19); font sizes are
  literal across ~15 values (12px 87, 9.6px 73, 11px 71, 10.4px 58, 13px 57,
  8.8px 55), partly from the density-duplicate blocks. These are the token
  consolidation targets for milestone 4, and the gallery's live propagation
  depends on them.

## Guardrails

- Changes touching transcript, composer or panes keep first-open, streaming
  and the 144Hz frame budget; run the panes smoke and the narrowest seam in
  `docs/TESTING.md`.
- No giant barrel imported on hot startup paths; watch cycles among
  overlay/focus/portal helpers.
- Render tools validate props against schema at runtime, map events only to
  known host actions with normal authorisation, and persist a versioned block
  that stays readable if a component is removed.
- Arbitrary HTML artifacts, if ever added, live in a sandboxed isolated-origin
  iframe, never trusted Conduit DOM. Deferred.
