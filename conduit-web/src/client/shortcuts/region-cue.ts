const reduced = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * Say that focus arrived in a region from the keyboard: its edge brightens
 * for ~150ms and settles, drawing the eye without a standing frame. The
 * region's own focus colour (the chat and workspace titles) says where focus
 * stays; this only marks the arrival. Reduced motion shows nothing extra.
 */
export function acknowledgeRegion(region: Element) {
  if (reduced() || typeof (region as HTMLElement).animate !== "function") return;
  const edge = (color: string) => ({ outline: `1px solid ${color}`, outlineOffset: "-1px" });
  (region as HTMLElement).animate([
    edge("transparent"),
    { ...edge("color-mix(in oklch, var(--foreground), transparent 62%)"), offset: 0.25 },
    edge("transparent"),
  ], { duration: 600, easing: "cubic-bezier(.2, .8, .2, 1)" });
}
