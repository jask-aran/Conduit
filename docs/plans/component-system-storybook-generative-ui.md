# Component system, gallery workbench, and generative UI

Status: shaping; decisions agreed 2026-10-08, **nothing implemented**.
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
4. **Built for me and agents equally.** Every story has a stable URL so
   agents can screenshot it via agent-browser to verify UI changes instead
   of clicking through the app.
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
