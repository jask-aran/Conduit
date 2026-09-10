# Mobile MESSAGE OPTIONS submenus unusable on touch — bug report handoff

Date (UTC): 2026-09-08
Status: investigated, NOT fixed (read-only investigation).
Device: mobile Chrome, portrait phone (screenshot `screenshot.jpg` in this same folder, 1440x3120).

## Symptom (user wording)

> On mobile I can't change model or profile because entering their submenu requires tapping on the icon not the full width touch target, then I can't tap on anything in submenu it just instant closes

Screenshot shows the `+` → `MESSAGE OPTIONS` popover open above the composer:

* `Model  Muse Spark 1.3 Free  >` (with sliders icon)
* `EFFORT  Minimal / Low / Medium / ✓ High / Xhigh` (inline radio, works)
* `Profile  Assistant  >` (with person icon)
* `Attach files`

So the root menu opens fine. Only the `Model >` and `Profile >` **submenus** fail:

1. Tapping the full-width `Model`/`Profile` row does not enter the submenu; only tapping the small chevron/icon does.
2. Once the submenu is open, tapping any item instantly closes the menu without changing model/profile.

Desktop is unaffected (hover opens submenus; no touch focus fight).

## Identities / context

* Incident chat: `f44563aa-0cd7-4335-8e22-4b5242da0ed2` (`template runtime v1`, `profile runtime v1`, `binary 0.84.1`)
* Screenshot chat content (Drive/adapter discussion) is irrelevant; the failing UI is the composer `+` menu, not transcript data.
* No version/ownership claim: single device, single build, touch-only failure.

## Code paths (all read-only)

* `conduit-web/src/client/chat/mobile-composer-options.tsx` — entire mobile `+` menu:
  * root `<Menu modal={false}>` + `<MenuContent class="composer-options-menu" onOpenAutoFocus={preserveComposerFocus} ... onPointerDown={preserveComposerFocusOnPointerDown} onClick={restoreComposerFocusAfterInteraction}>`
  * `MenuSub` → `MobileComposerSubTrigger` → `MenuContent class="composer-options-submenu composer-model-menu / composer-profile-menu"` with identical focus/pointer/click handlers
  * `MobileComposerSubTrigger`: custom `onPointerDown (capture + preventDefault + menu.open(true))`, `onPointerUp (preventDefault)`, `onClick (restore focus)`
  * `MobileComposerSubmenuRadioItem`: `closeOnSelect={false}` + `onSelect={() => menu.close(false)}`
  * `useMenuContext` imported from Kobalte internal chunk (`chunk/L544S5A4.jsx`) — `menu.open/close/toggle`, `registerTriggerId`
* `conduit-web/src/components/primitives.tsx:85-101`:
  * `MenuSub = KMenu.Sub`, `MenuSubTrigger` renders `KMenu.SubTrigger + <ChevronRightIcon class="menu-chevron"/>`, forwards `onPointerDown/onPointerUp/onClick`
  * `MenuContent` portals to fullscreen mount, forwards `onOpenAutoFocus/onCloseAutoFocus/onFocusOutside/onPointerDown/onClick`
* `conduit-web/src/client/styles.css:792-835,1604-1647`:
  * `.composer-options-submenu` repositioned to a fixed bottom popover (`position:fixed; bottom:calc(44.8px + safe-area); transform:none`)
  * `body:has(.composer-options-submenu) ... .composer-options-menu { visibility:hidden }` — root hides while submenu open, so an accidental root-close looks like "instant close" of the submenu too.

## Hypotheses (ranked, NOT confirmed — needs live touch debugging)

### H1 — `preventDefault` on `pointerdown` kills Kobalte's touch open path (explains symptom 1)

`MobileComposerSubTrigger.onPointerDown` calls `event.preventDefault()` on the whole row, then manually `menu.open(true)`. On touch Chrome, `preventDefault` on `pointerdown` suppresses compatibility mouse events and can suppress Kobalte's own press-to-open/focus logic for `SubTrigger` (which expects hover/focus, not a prevented pointerdown). If the manually-called `menu.open(true)` resolves to the **root** menu context rather than the **sub** context (the internal `useMenuContext` identity is fragile — see the `@ts-expect-error` comment), the sub never opens from a row tap. Tapping the chevron SVG may instead give keyboard focus to the trigger (focus still opens subs in Kobalte), which is why "only the icon works".

Check live: log which menu `useMenuContext()` returns inside `MobileComposerSubTrigger` (root vs sub), and whether `menu.open(true)` expands `[data-expanded]` on the sub-trigger on a full-row tap vs chevron tap.

### H2 — composer refocus steals the tap and fires focus-outside close (explains symptom 2)

Every `MenuContent` (root + both submenus) wires:

* `onPointerDown={captureComposerFocus}` (records textarea, no preventDefault)
* `onClick={restoreComposerFocusAfterInteraction}` → unless tap is on `[aria-haspopup]`, `requestAnimationFrame(focusComposer)` focuses the `Message Pi` textarea
* `onFocusOutside={keepComposerFocusInsideMenu}` → `preventDefault` only if focus target is the textarea

On mobile, focusing the textarea opens the keyboard and moves focus out of the menu portal. Kobalte's `focusOutside`/`pointerDownOutside` then closes the submenu before `onSelect` fires — "instant close, nothing selected". The `preventDefault` guard assumes desktop focus semantics; on touch Chrome the close may already be queued by pointerdown-outside or by the `visibility:hidden` root swap shifting layout under the finger.

Check live with remote debugging: tap a submenu radio item, watch order of `pointerdown → focusout/focusoutside → close → select`; try removing the `restoreComposerFocusAfterInteraction` refocus on submenu content only.

### H3 — `menu.close(false)` in radio items closes the wrong scope

`MobileComposerSubmenuRadioItem` sets `closeOnSelect={false}` (keep open for multi-pick, per `primitives.tsx` comment) but then unconditionally `menu.close(false)` on select. If that `menu` is the root context, a successful model/profile pick closes everything including the just-opened submenu — correct end state for single-pick, but if H2 already closed the menu, the `close` looks like the tap "did nothing". Lower suspicion than H1/H2; verify after fixing focus.

## Repro sketch (for implementation agent)

1. Mobile viewport / device emulation with touch (`Chrome DevTools → device toolbar → phone`, or real phone as in screenshot).
2. Open any chat, tap composer `+` → `MESSAGE OPTIONS` opens.
3. Tap the `Model` row body (not chevron) → expected submenu, actual nothing (bug 1). Tap chevron → submenu opens.
4. Tap any model in submenu → menu vanishes, model unchanged (bug 2). Repeat for `Profile`.
5. Compare desktop (mouse hover opens sub, click selects): works.

Inspect live: `document.querySelector('[data-expanded]')` after row tap; `menu.isOpen()` per context; event order in `mobile-composer-options.tsx` handlers; `body:has(.composer-options-submenu)` visibility swap timing.

## Smallest fix directions (NOT applied)

* Do not change desktop hover behavior. Scope touch changes to `MobileComposerSubTrigger` / submenu `MenuContent` only.
* Candidate A: stop `preventDefault` on sub-trigger `pointerdown` for touch (or move `menu.open` to `onClick` on the full row), and verify the opened context is the sub. Ensure the whole `MenuSubTrigger` row (label + preview + chevron) is one large touch target (`min-height` already 30-40px; check `.composer-options-preview` truncation doesn't shrink hit area or capture pointer).
* Candidate B: remove textarea refocus from submenu interactions — only refocus after the whole menu closes (`onCloseAutoFocus`), not on every submenu `onClick`. Keep `onOpenAutoFocus={preventDefault}` (already there) so the keyboard never steals a submenu tap.
* Candidate C: if keeping auto-refocus, make `keepComposerFocusInsideMenu` reliably veto close on touch (Kobalte `focusOutside` + `pointerDownOutside` both), or set submenu `modal={true}` so outside focus cannot close mid-tap.
* Verify: full-row tap opens submenu first try; submenu taps select model/profile without keyboard flash; `Effort` inline radios (no submenu) keep working; `Manage models…/Manage profiles…` items still navigate; safe-area bottom offset unchanged.

## Files in this handoff

* `screenshot.jpg` — copy of user screenshot
* `mobile-composer-submenu-touch.md` — this file

Original attachment source (do not edit): `data/chat/files/.conduit/chats/f44563aa-0cd7-4335-8e22-4b5242da0ed2/attachments/0eaf6a1b-4270-48ca-a95f-fbd319ef1db4--Screenshot_20260908_152538_Chrome.jpg`
Key paths: `conduit-web/src/client/chat/mobile-composer-options.tsx`, `conduit-web/src/components/primitives.tsx:85-101`, `conduit-web/src/client/styles.css:792-835,1604-1647`
