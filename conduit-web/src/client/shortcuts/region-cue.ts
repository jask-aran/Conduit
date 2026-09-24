const reduced = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

const CUE_MS = 800;
let current: { lit: HTMLElement; frame: number } | null = null;

/**
 * Say that focus arrived in a region from the keyboard: for a moment the rest
 * of the app dims and the region stays lit with its own corners -- the leader
 * menu's language, so the lit region always means where you are. It follows
 * the region as it settles (a collapsed sidebar opening on Ctrl+Shift+1), and
 * a second jump replaces the first. The line along the held region's bottom
 * edge (data-focus-held) says where focus stays; this only marks the arrival.
 * Reduced motion shows nothing extra.
 */
export function acknowledgeRegion(region: Element) {
  if (reduced() || typeof document === "undefined") return;
  if (current) { cancelAnimationFrame(current.frame); current.lit.remove(); }
  const lit = document.createElement("div");
  lit.className = "region-cue";
  lit.setAttribute("aria-hidden", "true");
  lit.style.borderRadius = getComputedStyle(region).borderRadius;
  document.body.append(lit);
  const cue = { lit, frame: 0 };
  current = cue;
  const place = () => {
    const box = region.getBoundingClientRect();
    Object.assign(lit.style, { top: `${box.top}px`, left: `${box.left}px`, width: `${box.width}px`, height: `${box.height}px` });
    cue.frame = requestAnimationFrame(place);
  };
  place();
  lit.animate([{ opacity: 0 }, { opacity: 1, offset: 0.19 }, { opacity: 1, offset: 0.5 }, { opacity: 0 }], { duration: CUE_MS, easing: "ease-out" })
    .finished.catch(() => undefined).finally(() => {
      cancelAnimationFrame(cue.frame);
      lit.remove();
      if (current === cue) current = null;
    });
}
