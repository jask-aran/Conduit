/**
 * Haptics: what a tap that changes something feels like on a phone. Three kinds, each the piece's own (callers do
 * not fire them): select, a side chosen in a Segmented or PillSwitch; press, a PillButton that acts at once (the mic,
 * Send, Stop: its haptic prop); hold, a long press opening a context menu. Only a touch screen with nothing that
 * hovers feels them; the plugin is the platform's own feedback in the app, and a short vibration in a browser.
 */
export type Haptic = "select" | "press" | "hold";
let plugin: Promise<typeof import("@capacitor/haptics")> | undefined;
const touchOnly = () => typeof matchMedia === "function" && matchMedia("(hover: none) and (pointer: coarse)").matches;
export function haptic(kind: Haptic) {
  if (!touchOnly()) return;
  plugin ??= import("@capacitor/haptics");
  void plugin.then(({ Haptics, ImpactStyle }) => Haptics.impact({ style: kind === "hold" ? ImpactStyle.Medium : ImpactStyle.Light })).catch(() => undefined);
}
