import { reducedMotion } from "@/components/ui/motion";

/**
 * Say that focus arrived in a region from the keyboard, at the region and nowhere else: its held line
 * ([data-region]::after, which then stays) draws out from its middle, and a hairline glow traces the region's own edge
 * once and fades. Nothing outside the region moves or dims (the old cue dimmed the whole window, which read as the
 * screen blinking rather than as "here"). Both are opacity and transform on the region's own layers, so the
 * compositor runs them: no per-frame layout or paint. A second arrival replaces the first; arriving where focus already
 * is shows nothing (main.tsx). Reduced motion: the line appears without drawing, no glow.
 */
// The glow's length, --duration-arrival (400ms): the element is removed once it has run.
const ARRIVE_MS = 400;
let current: { region: HTMLElement; glow: HTMLElement; timer: ReturnType<typeof setTimeout> } | null = null;

const clear = () => {
  if (!current) return;
  clearTimeout(current.timer);
  current.region.removeAttribute("data-arriving");
  current.glow.remove();
  current = null;
};

export function acknowledgeRegion(region: Element) {
  if (typeof document === "undefined" || !(region instanceof HTMLElement)) return;
  clear();
  if (reducedMotion()) return;
  const glow = document.createElement("span");
  glow.className = "region-arrival";
  glow.setAttribute("aria-hidden", "true");
  region.append(glow);
  // Restart the line's draw even when the same attribute was just removed (a quick second jump).
  void region.offsetWidth;
  region.setAttribute("data-arriving", "");
  const cue = { region, glow, timer: setTimeout(() => { if (current === cue) clear(); }, ARRIVE_MS + 60) };
  current = cue;
}
