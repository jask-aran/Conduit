# Issue #27 — PWA + mobile UI/UX

Slice plan. Current code only; replace this file when behaviour ships or the plan changes.

## Current baseline

- **No PWA.** `conduit-web/vite.config.js` is Solid + Tailwind only. `index.html` has `theme-color` and SVG favicon; no manifest, no service worker, no apple-touch metadata. Icons: `conduit-web/public/favicon.svg` only.
- **Static serve is already SW-friendly.** `express.static(dist)` serves non-asset files with `Cache-Control: no-cache`, then SPA fallback to `index.html`. `sw.js` / `manifest.webmanifest` will be hit before the fallback once present in `dist/`.
- **Mobile layout already exists** at `@media (max-width: 760px)` in `styles.css`:
  - Sidebar: fixed full-viewport slide-in from left (`data-mobile-open`), trigger button top-left (moves top-right when open).
  - Workspace panel: fixed full-viewport slide-in from right (`workspace-panel-open`); resize handle hidden; width forced `100vw`.
  - Context menus narrowed (11rem / 7rem sub).
  - Settings shell nearly full-bleed; profile posture hidden; chat header padded for the trigger.
- **No panel backdrop / scrim.** Open sidebar covers chat by being full-width; no dimmed dismiss target beside it. Workspace same.
- **Body is already `overflow: hidden`.** Classic “body scroll lock” is mostly a no-op. Real mobile problems are nested scrollers (message viewport, sidebar content, workspace trees) chaining into browser overscroll / pull-to-refresh, and focus not returning after panel close.
- **Playwright already runs `mobile-chromium` (Pixel 7)** beside desktop. Several tests branch on project name or viewport; mobile coverage of panel/palette behaviour is thin.
- **Bundle budgets enforced** by `npm run build` → `scripts/check-bundle.mjs`. Workbox + SW registration will move the budget; treat any raise as an explicit, reviewed line in the same change.
- **Hard constraint from the issue:** never add a blanket runtime cache for `/v0/`. Authenticated mutable catalogue/chat/runtime must not be replayed from a SW. Future runtime caching only for a documented safe read-only surface, and must invalidate on auth/session change.

Out of scope for #27 (named so they do not sneak in):

- Web push / attention notifications (design-doc D5).
- Offline chat or API reads.
- Settings/palette design-system unification (#26).
- Safe-area / software-keyboard composer reflow beyond what breaks acceptance (file follow-ups if found).
- Login page as a separate installable surface (same origin is enough; login stays a normal document).

## Slice map

| Slice | Goal | Primary files | Depends on |
|-------|------|---------------|------------|
| **1** | Installable PWA shell (manifest + SW + icons) | `vite.config.js`, `index.html`, `public/`, `package.json`, build check, README | — |
| **2** | Mobile panel chrome (backdrop, dismiss, overscroll, focus) | `styles.css`, `sidebar.tsx`, `workspace-panel.tsx`, `main.tsx` | — (parallel with 1) |
| **3** | Command palette at phone widths | `styles.css`, palette shell component | 2 preferred (shared overlay rules) |
| **4** | Touch / context-menu / long-press fit | `sidebar.tsx`, `styles.css`, primitives if needed | 2 |
| **5** | Acceptance: Playwright mobile + PWA build checks + docs | `test/browser/`, build/test scripts, READMEs | 1–4 |

Slices 1 and 2 are independent and can land as separate commits. 3–4 build on 2. 5 is the closing commit (or two: tests then docs).

---

## Slice 1 — PWA shell

**Behaviour**

- Production build emits a web manifest and a root-scoped service worker.
- Chrome/Edge can install Conduit; installed window is `display: standalone`.
- App shell (HTML/JS/CSS/fonts/icons) is available offline after a successful online load.
- `/v0/*`, WebSocket upgrades, and any authenticated JSON are **network-only** (default: not in the Workbox precache, no runtime route). A failed offline API call fails visibly; it must not surface a cached catalogue or transcript as current.
- New deploys update via `registerType: "autoUpdate"` (Workbox skipWaiting + clientsClaim pattern from the plugin). No “click to refresh” UI in this slice unless autoUpdate proves sticky in practice.
- iOS home-screen icon + `apple-mobile-web-app-*` meta so Add to Home Screen is not a blank glyph.

**Work**

1. `npm install -D vite-plugin-pwa` in `conduit-web/`.
2. Wire `VitePWA({...})` in `vite.config.js` roughly as the issue specifies:
   - `registerType: "autoUpdate"`
   - `includeAssets: ["favicon.svg", …png icons]`
   - manifest name/short_name/description/theme/background/`standalone`/`start_url: "/"`
   - icons 192 + 512 + maskable
   - `workbox.globPatterns` limited to static assets (`js,css,html,svg,png,ico,woff2`)
   - **No** `runtimeCaching` entry for `/v0` or SSE/WS
3. Generate `public/pwa-192x192.png` and `public/pwa-512x512.png` from `favicon.svg` (sharp/resvg/magick — pick whatever is already on the machine; commit the PNGs, not a generate step).
4. Extend `index.html` with apple-mobile meta + `apple-touch-icon`. Keep existing `theme-color`.
5. Confirm Express needs **no** route changes: static middleware already serves new files; `no-cache` on `sw.js` and the manifest is required and already the non-asset default. If the plugin emits `sw.js` at dist root, spot-check response headers once.
6. Bundle budget: run `npm run build`, read the delta, adjust `scripts/check-bundle.mjs` only if the SW registration chunk forces it — note the reason in the commit body.
7. Docs: short “Install as app” note in root `README.md` and `conduit-web/README.md` (manifest path, SW scope, explicit non-caching of `/v0`).

**Verification**

- `npm run build` produces `dist/manifest.webmanifest` (or plugin equivalent) and a service worker file; `dist/index.html` links the manifest and registers the SW.
- Focused check (prefer a small Node test or a build-smoke script, not a full browser install): assert those artifacts exist and that the generated SW/workbox config string does **not** reference `/v0` runtime caching.
- Manual (human): production server, Chrome DevTools → Application → Manifest valid, SW activated; Install app; open installed window (no browser chrome); DevTools offline → shell loads, API calls fail cleanly; redeploy → SW updates without clearing site data.
- iOS manual: Add to Home Screen shows the icon.

**Risks**

- Dev vs prod: plugin should not break Vite dev HMR. Prefer `devOptions.enabled: false` (default) so SW only exists in production builds; document that installability is a prod-only property.
- Auth cookie + SW: precaching `index.html` is fine; do not cache `/login` HTML responses that embed state. Login page is server-rendered from `auth-login-page.js`, not the SPA bundle — keep it out of the precache by not placing it in `dist/` assets (status quo).
- Issue #30 (auth test ↔ `dist/`): building for PWA verification will create `dist/`; do not “fix” #30 by accident. Leave that test’s coupling alone unless it blocks.

**Exit:** production installable shell; no mobile interaction changes yet.

---

## Slice 2 — Mobile panel chrome

**Behaviour (≤760px)**

- Sidebar open: full-height slide-over (already), **backdrop** over chat that dismisses on tap, focus moves into the drawer on open and returns to the prior chat control (composer textarea if present, else mobile trigger) on close.
- Workspace panel open: full-height slide-over (already), same backdrop/dismiss/focus rules. Opening workspace while sidebar is open closes sidebar first (single overlay owner) — state this as the rule so Escape and backdrops stay deterministic.
- Nested scroll containers inside an open overlay use `overscroll-behavior: contain` so pull-to-refresh and scroll chaining do not fire through the drawer.
- Chat message scroller does not receive pointer/scroll interaction under an open overlay (backdrop intercepts).
- Desktop (≥761px) behaviour and layout unchanged: no backdrop, docked sidebar, resizable workspace panel.

**Work**

1. Introduce a shared mobile-overlay pattern (class + tiny helper, not a new dependency):
   - Backdrop element or pseudo-layer with `data-mobile-backdrop` for tests.
   - Optional: `data-mobile-overlay-open` on `document.documentElement` when either panel is open, for CSS hooks (`overscroll-behavior-y: none` on root while open).
2. Sidebar (`navigation/sidebar.tsx`): render/teleport backdrop when `mobileOpen`; click → `closeMobile()`. On open, focus first focusable in the drawer; on close, restore focus.
3. Workspace (`workspace-panel.tsx` / `main.tsx`): same for `panelOpen` at the mobile breakpoint only. Reuse the matchMedia `max-width: 760px` gate already used by `startResize`.
4. CSS: backdrop z-index between chat and the active panel (sidebar ~55, workspace ~70 — backdrop must sit under the active panel and above chat). `overscroll-behavior: contain` on `.conduit-sidebar .sidebar-container`, `.workspace-panel-surface`, and any internal scroll regions touched.
5. Escape ordering already closes workspace before palette/settings interactions in `main.tsx` — extend the same story so mobile sidebar participates without fighting Escape (sidebar close on outside/backdrop first; Escape closes topmost overlay).

**Verification**

- Playwright `mobile-chromium`:
  - open sidebar via trigger → backdrop visible → tap backdrop → sidebar closed → composer or trigger focused.
  - open workspace panel → full viewport width → backdrop dismiss → closed.
  - open sidebar then workspace → only workspace remains (or documented stacking); no double-trap.
- Desktop project: existing sidebar collapse + workspace resize tests still pass unchanged.
- Manual: Pixel/iPhone emulation, scroll lists inside drawers without triggering pull-to-refresh.

**Risks**

- Focus restore must not steal focus during chat streaming or when a dialog (rename/delete) is open on top of the sidebar — dialogs remain the top layer; backdrop dismiss disabled while a modal inside the drawer is open, or backdrop sits below the modal (Kobalte portal default).
- `localStorage` persistence of workspace-panel open state on mobile means a phone reload can present the full-screen panel immediately — acceptable; ensure backdrop + focus still initialize correctly on first paint.

**Exit:** both phone drawers feel like modal sheets; desktop untouched.

---

## Slice 3 — Command palette on phones

**Behaviour**

- ≤480px: palette shell is full-bleed (edge-to-edge, top-anchored or full-height), larger tap targets on options, input not cramped.
- 481–760px: keep centred card if still legible (`min(640px, calc(100vw - 28px))`); only push to full-bleed if manual audit shows overflow.
- Touch: options activate on tap; no hover-only affordance required. Escape/back behaviour unchanged.
- Submenus / any palette secondary surfaces stay inside the visual viewport (reuse the sidebar context-menu narrowing lesson if palette grows sub-panels).

**Work**

1. CSS-only preferred: `@media (max-width: 480px)` rules on `.command-shell` (and overlay container) for width/height/radius/max-height.
2. Audit `command-menu.tsx` / palette open path for keyboard-only assumptions (e.g. autofocus is fine; hover-highlight-only selection is not).
3. Adjust the existing centred-palette Playwright assertion (it currently allows a 2px center epsilon) so mobile full-bleed is expected under `mobile-chromium` or a 480px viewport case, without weakening desktop.

**Verification**

- Playwright: open palette at Pixel 7 and at 480×720; assert shell geometry (full-bleed within 2px of viewport edges at ≤480, or documented hybrid); type filter; pick a command; palette closes.
- Desktop centre assertion remains.

**Exit:** palette usable one-handed on a phone.

---

## Slice 4 — Touch targets and context menus

**Behaviour**

- Long-press (or platform equivalent) on a sidebar chat/project row opens the existing Kobalte context menu.
- Menu and sub-menu fit within the viewport on Pixel-class widths (already partially handled by 11rem/7rem widths); confirm collision/flip behaviour and fix if Kobalte places off-screen.
- No accidental navigation when the long-press gesture ends (click must not also fire `onOpenChat` after a successful menu open).
- Optional polish only if cheap: minimum 44px row hit area on mobile for sidebar rows and header icon buttons.

**Work**

1. Manual + Playwright long-press (`page.locator(...).click({ button: "right" })` is insufficient on true mobile; use touch long-press via `locator.dispatchEvent` or Playwright’s tap + timeout pattern — prove one approach in the test helper).
2. If click-after-long-press navigates, gate the row `onClick` when the menu opened (Kobalte `onOpenChange` flag).
3. CSS: ensure `position` / `max-height` / overflow on `.sidebar-context-menu` under 760px.

**Verification**

- mobile-chromium test: open sidebar, long-press a chat, expect menu item “Rename” visible and within viewport bounds; dismiss; chat did not change selection spuriously.
- Desktop right-click path still works (existing or new smoke).

**Exit:** phone sidebar management does not require a desktop mouse.

---

## Slice 5 — Acceptance harness and docs closeout

**Behaviour:** none new; locks 1–4.

**Work**

1. Consolidate Playwright coverage under clear test titles matching the acceptance bullets in #27.
2. Add a build-level PWA artifact check (if not done in slice 1) to `npm test` or `npm run build` so CI’s typecheck/build path fails if the manifest/SW disappear.
3. README sections finalised; issue acceptance criteria quoted and checked off in the closing commit body.
4. Close #27 when the list below is green.

**Full acceptance checklist (from issue, operationalised)**

PWA:

- [ ] Production exposes valid manifest + root SW
- [ ] Chrome/Edge installable; standalone launch
- [ ] Offline: shell only; no cached API/chat presented as live
- [ ] Redeploy updates SW without clearing site data
- [ ] iOS home-screen icon + standalone presentation
- [ ] `npm run build` green; artifacts covered by automated check + docs

Mobile:

- [ ] Sidebar slide-over, backdrop dismiss, no background scroll/overscroll leak
- [ ] Workspace slide-over, backdrop dismiss, same
- [ ] Palette legible; full-bleed at ≤480px if needed
- [ ] Long-press context menus fit viewport
- [ ] Desktop unchanged
- [ ] Playwright mobile breakpoint coverage for the above

---

## Suggested commit sequence

1. `Add PWA manifest and service worker` (slice 1)
2. `Polish mobile sidebar and workspace overlays` (slice 2)
3. `Make command palette full-bleed on narrow phones` (slice 3)
4. `Fix mobile sidebar context menus for touch` (slice 4)
5. `Cover PWA and mobile acceptance in tests` (slice 5; may merge into 1–4 if a slice’s tests ship with it)

Prefer tests **with** each slice over a single trailing test dump; slice 5 is the gap-fill and issue close.

## Explicit non-goals / defer

| Item | Why defer |
|------|-----------|
| Web push | Separate product surface; design-doc D5 |
| Runtime cache of any `/v0` read | Auth/freshness footgun; issue forbids blanket rules |
| #26 design-system merge | Different issue; palette CSS in slice 3 must stay local |
| Login install UX | Same-origin install from `/` is enough |
| `vite-plugin-pwa` dev SW | HMR complexity; prod-only is correct |

## Open decisions (defaults if you say nothing)

1. **SW registration UX:** autoUpdate, no toast. (Override: prompt-for-reload toast.)
2. **Backdrop stack rule:** at most one of {sidebar, workspace} open on mobile; opening one closes the other.
3. **Palette full-bleed breakpoint:** 480px exactly, matching the issue.
4. **Icon generation:** committed PNGs from `favicon.svg`, no runtime generate script.

## Start order

Begin **slice 1** unless you prefer visible mobile UX first (**slice 2**). They do not block each other.

## Status

- **Slice 1 — done.** `vite-plugin-pwa` production build emits `manifest.webmanifest`, root `sw.js`, icons; NavigationRoute denylists `/v0`, `/healthz`, `/login`; no runtimeCaching; `check-bundle.mjs` enforces artifacts; docs in root and `conduit-web` READMEs. Installability is prod-only (dev SW disabled).
- **Slice 2 — done.** Mobile sidebar/workspace exclusive overlays with backdrops, focus restore, overscroll contain, Escape dismiss; drawer width leaves a tappable strip; Playwright mobile coverage.
- Slices 3–5 not started.
