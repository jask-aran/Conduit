# Liquid Glass performance investigation

## Status

Liquid Glass is paused as an experimental composer material. The application
now disables its runtime by default. Settings → UI → Liquid Glass runtime must
be set to `Enabled — experimental` before Liquid Glass can be selected as the
composer material.

Disabled mode prevents the Liquid component, SVG filter graph, and
`ResizeObserver` from mounting. It also removes the two older surface
preferences and reloads the document. This matches the recovery action that
restored smooth panel motion during the investigation.

The built Liquid JavaScript chunk and PNG assets remain available and can be
placed in the PWA precache. Disabled mode prevents execution and compositor
activation; it does not remove those files from the build or prevent the
service worker from caching them.

## Original observation

The same development server produced different panel performance in two Chrome
profiles. A fresh profile could remain smooth with Liquid Glass active. An
older profile could show choppy sidebar open/close motion even while Static or
Frosted appeared active. The older profile also showed different behavior
between panel open/close and drag resizing.

The result initially suggested a general composer topology regression. Storage
isolation then showed that the Liquid preferences could move the older profile
into a much slower state. Removing those preferences and reloading repeatedly
restored smooth behavior.

The slow state was intermittent. It could not always be restored from the same
saved preference set. No trace captured the transition into the retained slow
state. Therefore, the investigation established a containment boundary but did
not prove the Chromium mechanism.

## Commands and observed results

Run these commands in the browser developer console.

### Enter the severe Liquid state

This command selected Liquid, retained compatibility with the older binary
Liquid preference, selected Synthetic for both Markdown settings, and reloaded:

```js
localStorage.setItem("conduit:composer-surface", "liquid");
localStorage.setItem("conduit:liquid-glass-surface", "true");
localStorage.setItem("conduit:transcript-renderer", "incremark-synthetic");
localStorage.setItem("conduit:markdown-renderer", "incremark-synthetic");
location.reload();
```

In the affected profile, this produced a much larger slowdown than selecting
Liquid from the on-screen material selector. The slowdown remained when the
transcript renderer was Synthetic. This ruled out a requirement for the
IncreMark Advanced renderer.

An earlier test used Liquid with Advanced:

```js
localStorage.setItem("conduit:liquid-glass-surface", "true");
localStorage.setItem("conduit:composer-surface", "liquid");
localStorage.setItem("conduit:markdown-renderer", "incremark-synthetic");
localStorage.setItem("conduit:transcript-renderer", "incremark-advanced");
location.reload();
```

That state was also slower. The later Synthetic-only result showed that Liquid
was the shared condition. The evidence did not support a Liquid–Advanced-only
interaction.

### Restore smooth performance

This was the repeatable recovery command:

```js
localStorage.removeItem("conduit:composer-surface");
localStorage.removeItem("conduit:liquid-glass-surface");
location.reload();
```

It did two important things:

1. It removed both the current composer preference and the older binary Liquid
   preference.
2. It created a new document that started in Frosted mode and never mounted the
   Liquid SVG filter path.

Performance returned to the smooth state after this command in the affected
profile.

Selecting Liquid through the on-screen selector usually caused a smaller,
expected slowdown. Selecting Frosted again usually returned to smooth motion.
At least one observed state appeared to remain slow after Frosted was selected.
A full reload after removing the two Liquid keys recovered it.

### Rule out three unrelated preferences

These values were restored after a clean, smooth Frosted state:

```js
localStorage.setItem("conduit:incremark-typewriter", "1");
localStorage.setItem("conduit:panel-motion", "enabled");
localStorage.setItem("conduit:terminal-renderer", "xterm");
location.reload();
```

The application remained smooth. The first two keys were retired and no longer
read. The terminal renderer did not matter while no terminal was mounted.

### Count live Liquid objects

This diagnostic compared the modest Liquid state with the severe state:

```js
({
  composerShells: document.querySelectorAll(".composer-surface-shell").length,
  liquidSurfaces: document.querySelectorAll(".composer-glass-filter").length,
  svgDefinitions: document.querySelectorAll(".liquid-glass-definitions").length,
  liquidFilters: document.querySelectorAll(
    'filter[id^="conduit-liquid-glass-"]',
  ).length,
})
```

A fully mounted Liquid composer reported:

```js
{
  composerShells: 1,
  liquidSurfaces: 1,
  svgDefinitions: 1,
  liquidFilters: 1
}
```

Frosted reported zero Liquid surfaces, definitions, and filters. These counts
ruled out two persistent Liquid DOM trees or two application-owned SVG filters.
They did not rule out retained Chromium compositor resources.

The stored and rendered mode was checked with:

```js
({
  storedSurface: localStorage.getItem("conduit:composer-surface"),
  legacyLiquid: localStorage.getItem("conduit:liquid-glass-surface"),
  renderedSurface: document.querySelector(".composer")
    ?.getAttribute("data-composer-surface"),
})
```

### Restore a saved profile while forcing Frosted

The storage-isolation work kept a backup in `sessionStorage`. This command
restored it while forcing Frosted:

```js
const rawBackup = sessionStorage.getItem(
  "conduit:debug-local-storage-backup",
);

if (!rawBackup) {
  throw new Error("The localStorage backup is no longer available.");
}

const backup = JSON.parse(rawBackup);

localStorage.clear();
Object.entries(backup).forEach(([key, value]) => {
  localStorage.setItem(key, value);
});

localStorage.setItem("conduit:composer-surface", "frost");
localStorage.setItem("conduit:liquid-glass-surface", "false");

location.reload();
```

The restored profile did not reproduce the slow state on that attempt. This was
the point at which the state became non-deterministic and the work moved to a
static code audit.

## Proven application behavior

The application has one Liquid mount path. `Composer` conditionally renders
one lazy `LiquidGlassSurface`. Settings and Transcript store the selected mode
but do not mount another Liquid surface.

When Solid removes `LiquidGlassSurface`, its cleanup disconnects the
`ResizeObserver`, and its DOM and SVG filter definitions disappear. The lazy
module has no continuing task or cache. Its only module-level state is an
integer used to generate unique filter IDs.

These findings rule out a persistent second application renderer, observer, or
SVG node as the cause of Frosted remaining slow. They do not prove that Chrome
immediately releases every compositor resource created for the removed URL
backdrop filter.

## High-risk Liquid behavior

### The filter stays active during panel motion

Frosted has a motion-specific CSS rule that disables backdrop sampling while a
sidebar or workspace panel moves. Liquid has no equivalent rule. Its URL
backdrop filter continues to refract the moving transcript during panel
open/close and drag resizing.

This makes Liquid cross an expensive compositor boundary during the exact
interaction used to judge frame pacing.

### Resize notifications rebuild filter geometry

The Liquid `ResizeObserver` measures the composer with
`getBoundingClientRect()`. A new width or height updates two SVG `<feImage>`
primitives. Those inputs feed a graph containing blur, displacement,
saturation, composition, transfer, and blend operations.

During continuous panel resizing, the composer width can change on successive
frames. The current path can therefore force layout measurement and invalidate
the filter graph repeatedly.

Exact-size SVG image updates were added to correct visible filter geometry.
They fixed that defect but created a credible per-resize rebuild path.

### Asset selection is not asset readiness

`data-liquid-glass-ready="true"` means that the displacement and specular asset
paths were selected. It does not mean that both PNG files completed loading and
decoding. The URL backdrop filter can become active while its external image
inputs are still resolving.

### Cleanup does not explicitly clear the backdrop filter

Solid removes the Liquid DOM and disconnects the observer. The component does
not first set `backdrop-filter` and `-webkit-backdrop-filter` to `none`.

Chrome retaining compositor state after DOM removal is the leading explanation
for the observed “Frosted is still slow after Liquid” state. Static source
inspection cannot prove this explanation. No trace captured that state before
it became non-reproducible.

## Historical control

The v0.4.7 reference build remained smooth at the display's native 144 Hz. It
did not contain the current SVG displacement-filter path. Its composer sat over
an opaque footer instead of continuously sampling the live transcript through a
transparent floating surface.

This control does not prove that the Liquid filter alone caused every observed
regression. It does show that the current Liquid URL-filter and transparent
backdrop path is not part of the known-good architecture.

## Current containment

The runtime preference is:

```text
conduit:liquid-glass-runtime
```

Only the exact value `enabled` permits Liquid. Missing, malformed, and
`disabled` values all fail closed to Frosted.

When disabled:

- stored `liquid` selections resolve to Frosted;
- attempts to save `liquid` resolve to Frosted;
- Liquid is absent from the Settings and transcript material selectors;
- the live render condition checks the runtime gate before mounting
  `LiquidGlassSurface`;
- changing the setting dispatches Frosted first, which removes a live Liquid
  surface;
- both older surface keys are removed;
- the document reloads so the next document never creates the Liquid filter.

When enabled, the application still resets the selected material to Frosted.
The user must then select Liquid separately. A stale Liquid preference cannot
reactivate the runtime.

## Work to resume later

The next investigation should use one reversible change at a time:

1. Capture a Chrome Performance trace immediately when the severe state occurs.
   Do not reload or change materials first.
2. Disable the Liquid URL filter during panel motion while retaining its cheap
   chrome gradients.
3. Suspend Liquid size measurement during motion and measure once after motion
   ends.
4. Read dimensions from `ResizeObserverEntry.borderBoxSize`, coalesce work to
   one animation frame, and skip unchanged dimensions.
5. Load and decode both PNG assets before enabling the URL filter.
6. Explicitly clear both backdrop-filter properties before removing the SVG
   definition.
7. Compare Liquid → Frosted teardown with the runtime gate's full-document
   recovery.

The acceptance test remains the real 144 Hz display. Automated browser tests
can prove mount counts, storage cleanup, selector availability, and DOM
teardown, but they cannot establish native-display compositor smoothness.
