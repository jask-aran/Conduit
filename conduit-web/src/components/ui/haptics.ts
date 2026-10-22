import { touchOnly } from "./layout";

/**
 * Haptics: what a touch that changes something feels like on a phone. The kinds are each a piece's own (callers do
 * not fire them):
 * - select: a side chosen in a Segmented or PillSwitch;
 * - press: a PillButton that acts at once (the mic, Send, Stop: its haptic prop);
 * - hold: a long press opening a context menu;
 * - fold: what an Expand or Disclosure holds opening or shutting;
 * - dismiss: an overlay closing (a menu, submenu, popover, dialog, the phone's drawer).
 * fold and dismiss are felt only just after a touch, so what opens or closes on its own (rows a search filters in,
 * a drawer shut by navigation from the keyboard) is not. Only a touch screen with nothing that hovers feels them; the
 * plugin is the platform's own feedback in the app, and a short vibration in a browser.
 */
export type Haptic = "select" | "press" | "hold" | "fold" | "dismiss";
let plugin: Promise<typeof import("@capacitor/haptics")> | undefined;
let touchedAt = -Infinity;
// Down as well as up: a tap outside a menu closes it on the way down.
const touched = (event: PointerEvent) => { if (event.pointerType === "touch") touchedAt = performance.now(); };
if (typeof addEventListener === "function") for (const type of ["pointerdown", "pointerup"] as const) addEventListener(type, touched, { capture: true, passive: true });
export function haptic(kind: Haptic) {
  if (!touchOnly()) return;
  if ((kind === "fold" || kind === "dismiss") && performance.now() - touchedAt > 600) return;
  plugin ??= import("@capacitor/haptics");
  void plugin.then(({ Haptics, ImpactStyle }) => Haptics.impact({ style: kind === "hold" ? ImpactStyle.Medium : ImpactStyle.Light })).catch(() => undefined);
}
