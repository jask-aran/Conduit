import { reducedMotion } from "@/components/ui/motion";

/**
 * Say that focus arrived in a region from the keyboard, at the region and nowhere else: its held line
 * ([data-region]::after, which then stays) draws out from its middle. Nothing else moves, dims or outlines. A
 * transform and opacity on the region's own layer, so the compositor runs it. A second arrival replaces the first;
 * arriving where focus already is shows nothing (main.tsx). Reduced motion: the line appears without drawing.
 */
const ARRIVE_MS = 250; // --duration-gentle, the line's draw
let current: { region: HTMLElement; timer: ReturnType<typeof setTimeout> } | null = null;

const clear = () => {
  if (!current) return;
  clearTimeout(current.timer);
  current.region.removeAttribute("data-arriving");
  current = null;
};

export function acknowledgeRegion(region: Element) {
  if (typeof document === "undefined" || !(region instanceof HTMLElement)) return;
  clear();
  if (reducedMotion()) return;
  // Restart the draw even when the same attribute was just removed (a quick second jump).
  void region.offsetWidth;
  region.setAttribute("data-arriving", "");
  const cue = { region, timer: setTimeout(() => { if (current === cue) clear(); }, ARRIVE_MS + 60) };
  current = cue;
}
