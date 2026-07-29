# MeteorShower integration guide

This document tells the integration agent everything needed to add the
MeteorShower as a background for the new chat screen in Conduit.

## Where the component lives

`conduit-web/src/components/meteor-shower/`

```
meteor-shower/
  index.ts           public API (re-exports everything below)
  types.ts           MeteorEvent, MeteorSettings, DEFAULT_SETTINGS, DEFAULT_SEED
  simulate.ts        simulateMeteors() — pure batch simulator with seeded PRNG
  MeteorShower.tsx   the Solid component (renders events as CSS animations)
  meteor.css         the @keyframes meteor animation and .meteor / .meteor__tail styles
```

The component is imported via the `@/` alias:

```ts
import {
  MeteorShower,
  simulateMeteors,
  DEFAULT_SETTINGS,
  DEFAULT_SEED,
  type MeteorEvent,
  type MeteorSettings,
} from "@/components/meteor-shower";
```

(The `meteor.css` is imported by `MeteorShower.tsx` itself, so the consumer
does not need to import it separately.)

## What it is, in one sentence

A pure batch simulator that pre-computes a full timeline of meteor events,
plus a Solid component that renders those events as CSS animations. No
state, no timers, no live updates — once the events array is rendered, the
browser plays the timeline on its own.

## The canonical shower

Use these exact values. They were tuned by the user and locked in as the
defaults; the same seed + the same settings + the same viewport always
produces the same shower.

```ts
import { DEFAULT_SETTINGS, DEFAULT_SEED, simulateMeteors } from "@/components/meteor-shower";

const events = simulateMeteors({
  settings: DEFAULT_SETTINGS,           // the user's tuned defaults
  viewport: { width: window.innerWidth, height: window.innerHeight },
  durationSeconds: 600,                 // 10 minutes of shower
  seed: DEFAULT_SEED,                   // 0xC0FFEE
});
```

`DEFAULT_SEED` is a stable constant exported from the component — the same
number is what the playground saves in its JSON config under the `seed`
key. If you want a different canonical shower, pick a different seed; the
playground can show you what any seed looks like.

## How to render it

```tsx
import { MeteorShower } from "@/components/meteor-shower";

function ChatScreen() {
  const events = simulateMeteors({
    settings: DEFAULT_SETTINGS,
    viewport: { width: window.innerWidth, height: window.innerHeight },
    durationSeconds: 600,
    seed: DEFAULT_SEED,
  });

  return (
    <div class="chat-screen">
      <div class="chat-screen__background">
        <MeteorShower events={events} entryOffset={DEFAULT_SETTINGS.entryOffset} />
      </div>
      <div class="chat-screen__content">
        {/* the existing chat UI */}
      </div>
    </div>
  );
}
```

The component takes two props:
- `events: MeteorEvent[]` — the pre-computed timeline.
- `entryOffset?: number` — pixels above the top of the viewport where
  meteors start. Defaults to 12. Use the same value as
  `DEFAULT_SETTINGS.entryOffset` unless you have a reason to change it.

## How to position it as a background

The component renders absolutely-positioned `<span>` elements. The parent
container must be `position: relative` (or `fixed`) and have explicit
dimensions, and must clip overflow so meteors that travel off-screen
don't cause horizontal scrollbars.

```css
.chat-screen__background {
  position: fixed;
  inset: 0;
  z-index: 0;
  pointer-events: none;
  overflow: hidden;
}

.chat-screen__content {
  position: relative;
  z-index: 1;
}
```

The three critical rules:
- `pointer-events: none` — the shower is decorative, clicks pass through
  to the chat content.
- `z-index: 0` for the background, `z-index: 1` for the content — the
  shower sits behind everything.
- `overflow: hidden` — meteors travel off-screen; without this, the
  page gets a horizontal scrollbar.

## What it looks like to the user

- 10 minutes of meteor activity, replaying from the same seed on each
  page load.
- The browser handles all the animation timing via CSS. Once rendered,
  no JavaScript runs in the shower — the timeline is the DOM, the
  browser's compositor plays it.
- Memory: each meteor cleans itself up via `onAnimationEnd`, so the
  steady-state DOM has only the meteors that are currently on-screen
  plus a small backlog of recently-finished ones that haven't been
  collected yet. For the default settings this is 5–15 elements.

## Where the playground lives (not for the integration agent, for
reference only)

`conduit-web/dev/meteors/`

```
dev/meteors/
  index.html
  main.tsx          the playground (sliders, Save/Load, etc.)
  main.css          playground styles
  vite.config.ts    separate Vite config so the playground runs on
                    port 5173 without colliding with the Conduit dev
                    server
  INTEGRATION.md    this file
```

The playground is on port 5173. The Conduit app is on 4310. The
integration agent does not need to touch the playground.

## Things to verify after integration

1. **No horizontal scrollbar.** If meteors leak past the right edge,
   the parent container is missing `overflow: hidden`.
2. **Clicks pass through the shower.** Try clicking a chat input through
   a visible meteor; the input should receive focus. If not, the
   `pointer-events: none` is missing.
3. **The shower is behind the content.** A meteor should never cover
   chat text in a way that makes it unreadable. If it does, the
   `z-index` ordering is wrong.
4. **No JS frame budget cost.** Open DevTools → Performance, record
   for 30 seconds. The "Scripting" line should be flat. The "Rendering"
   line should show only compositing work, no layout or paint. If
   scripting spikes, the component is being re-rendered unnecessarily
   (it should only be rendered once at mount).
5. **Reproducibility.** Reload the page. The first meteor should appear
   at the same time, at the same position, every time. If it doesn't,
   the seed isn't being threaded through correctly.

## If you want a different shower

The playground can produce a different seed + settings combo. The flow:
1. Open the playground at http://localhost:5173/
2. Dial the sliders, change the seed, hit "Save to file"
3. Open the saved JSON, copy the `seed` and `settings` fields
4. Pass them to `simulateMeteors` in place of `DEFAULT_SETTINGS` /
   `DEFAULT_SEED`

The `MeteorSettings` type is the contract for what's tunable. All 29
fields are listed in `types.ts`.

## If the component needs to change

The component is the single source of truth. Changes to the math
(distribution, timing, geometry) go in `simulate.ts`. Changes to the
animation or the meteor element go in `MeteorShower.tsx` and
`meteor.css`. The integration code doesn't need to change unless the
component's props change.
