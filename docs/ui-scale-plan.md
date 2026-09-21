# One number for how big the interface is

Status: sketch. Nothing here is built. This records the shape of a change we
expect to make, and the reasons the obvious alternatives were already tried and
put down, so the next attempt does not start from the same two dead ends.

## The problem

The interface is written in literal pixels, twice: a full-size block and a
`0.8`-scaled copy of the same declarations, plus a phone block that is a third
hand-tuned set. Tuning a surface means editing the same value in two or three
places, and the copies drift -- the phone sidebar sat at desktop density for a
while because only one of them had been retuned.

That is tolerable until the screen changes. The current sizes are right at
1080p and too small on a large 1440p display, where the interface wants to be
roughly 110-125%. There is no lever for that short of Chrome's own zoom.

## What has already failed

**Coefficients on pixel values.** A `--ui-scale` variable multiplied into
`calc()` reaches only what the stylesheet remembered to multiply. Everything
missed stays fixed while the rest grows, which is worse than no scaling at all
because the layout comes apart rather than getting bigger.

**Any zoom that is not the browser's.** A transform or a zoom property scales
layout without scaling rasterisation and hit testing with it, so text softens
and targets stop being where they look. The Tauri shell's `setZoom` works
because it is the real thing -- the same lever `Ctrl+=` pulls -- and that is why
`applyUiScale` uses it on desktop and leaves the CSS variable at 1.

## The shape of the answer

Write sizes in `rem` and let `html { font-size }` be the only number.

That is the same lever browser zoom pulls, which is why it does not have either
failure above: one value, applied by the engine, with rasterisation and hit
testing following it. `--ui-scale` already sets the root font size, so the lever
exists; what is missing is a stylesheet written against it.

Two things this has to get right:

- **The conversion is all or nothing.** A half-converted stylesheet is the
  coefficient bug again, in a different costume. The unit of work is a surface
  -- the sidebar, settings, the composer -- converted completely, not a pass
  over the whole file.
- **Not everything is type.** Hairlines, focus rings and anything that should
  stay one device pixel keep their pixels on purpose. The rule is that a size
  scales when it belongs to the reading experience and holds when it belongs to
  the rendering.

Density then stops being a separate axis. A phone, a 1080p screen and a large
1440p screen differ in what the root should be, not in which declarations
apply -- so the duplicated blocks collapse into one, and the per-screen default
becomes a number we can pick rather than a stylesheet we maintain twice.

## Open questions

- Whether the desktop shell keeps using `setZoom` or moves to the root font
  size like the browser, and whether both can be live at once without squaring.
- Whether a large-screen default is detected or offered, and what it keys off
  -- physical size is not something the page can ask for directly.
- Where the terminal sits. It has its own font size and its own wheel zoom, and
  it should probably stay outside this.
