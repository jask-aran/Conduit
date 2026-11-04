import type { PluginListenerHandle } from "@capacitor/core";
import { duration, easing, reducedMotion, REDUCED_MOTION_QUERY } from "./motion";
import { hapticSteps, type Haptic } from "./haptics";
import type { PhoneState } from "./phone-composer";

export type ComposerAction = "attach" | "camera" | "keyboard" | "mic" | "send" | "stop" | "latest" | "undo" | "delete" | "left" | "right" | "select";
export type ComposerInput = { text: string; selectionStart: number; selectionEnd: number };
type Rect = { x: number; y: number; width: number; height: number };
type Bezier = [number, number, number, number];
const KEYWORD_CURVES: Record<string, Bezier> = {
  ease: [.25, .1, .25, 1], linear: [0, 0, 1, 1], "ease-in": [.42, 0, 1, 1], "ease-out": [0, 0, .58, 1], "ease-in-out": [.42, 0, .58, 1],
};
function bezier(value: string): Bezier {
  const keyword = KEYWORD_CURVES[value];
  if (keyword) return keyword;
  const match = /^cubic-bezier\(\s*([-+.\deE]+)\s*,\s*([-+.\deE]+)\s*,\s*([-+.\deE]+)\s*,\s*([-+.\deE]+)\s*\)$/.exec(value);
  if (!match) throw new Error(`Unsupported composer easing: ${value}`);
  const [a, b, c, d] = match.slice(1).map(Number);
  if (a === undefined || b === undefined || c === undefined || d === undefined || ![a, b, c, d].every(Number.isFinite) || a < 0 || a > 1 || c < 0 || c > 1) throw new Error("Invalid composer easing");
  return [a, b, c, d];
}
/** Live Foundations tokens; no native timing constants. */
export function motionSpec(element: Element = document.documentElement) {
  return { quick: duration("--duration-quick", element), gentle: duration("--duration-gentle", element),
    arrive: bezier(easing("--ease-arrive", element)), leave: bezier(easing("--ease-leave", element)),
    change: bezier(easing("--ease-change", element)), room: bezier(easing("--ease-room", element)), reducedMotion: reducedMotion() };
}
function action(label: string): ComposerAction | null {
  return label === "Message options" ? "attach" : label === "Take a photo" ? "camera"
    : label === "Close the keyboard" || label === "Type a message" ? "keyboard" : label.includes("voice dictation") ? "mic"
    : label === "Stop response" ? "stop" : label === "Scroll to latest" ? "latest" : label.startsWith("Send") || label === "Stop and send" ? "send"
    : label === "Undo" ? "undo" : label === "Delete word or selection" ? "delete" : label === "Previous word" ? "left"
    : label === "Next word" ? "right" : label === "End of draft" ? "select" : null;
}
function hapticKind(value: string | undefined): Haptic | null {
  switch (value) { case "select": case "press": case "hold": case "fold": case "open": case "dismiss": return value; default: return null; }
}
function move(value: string | undefined) {
  switch (value) { case "fade": case "fold": case "tuck": case "collapse": case "wipe": case "give": return value; default: throw new Error("Composer part has no named move"); }
}
function phoneState(value: string | undefined): PhoneState {
  switch (value) { case "idle": case "typing": case "editing": case "listening": return value; default: throw new Error("Invalid phone composer state"); }
}
/** End-layout measurement uses an inert copy in the same containing block. Disabling transitions on the live root
 * would cancel its running moves. The copy is removed in this task, before paint, and never takes focus. */
export function describe(root: HTMLElement) {
  const copy = root.cloneNode(true);
  if (!(copy instanceof HTMLElement) || !root.parentElement) throw new Error("Phone composer is not mounted");
  copy.setAttribute("data-measuring", ""); copy.inert = true; copy.setAttribute("aria-hidden", "true");
  copy.style.cssText += `;position:absolute;left:0;top:0;width:${root.getBoundingClientRect().width}px;visibility:hidden;pointer-events:none;`;
  for (const element of copy.querySelectorAll("[id]")) element.removeAttribute("id");
  const liveInput = root.querySelector<HTMLTextAreaElement>(".ui-phone-field textarea"), input = copy.querySelector<HTMLTextAreaElement>(".ui-phone-field textarea");
  if (!liveInput || !input) throw new Error("Phone composer has no textarea");
  input.value = liveInput.value;
  root.parentElement.append(copy);
  try {
    const row = copy.querySelector<HTMLElement>(".ui-phone-row"), field = copy.querySelector<HTMLElement>(".ui-pill-field");
    const liveRow = root.querySelector<HTMLElement>(".ui-phone-row");
    if (!row || !field || !liveRow) throw new Error("Phone composer parts are missing");
    const rowBox = row.getBoundingClientRect(), liveBox = liveRow.getBoundingClientRect();
    const dx = liveBox.x - rowBox.x, dy = liveBox.bottom - rowBox.bottom;
    const rect = (element: Element): Rect => { const r = element.getBoundingClientRect(); return { x: r.x + dx, y: r.y + dy, width: r.width, height: r.height }; };
    const selector = ".ui-phone-edit > .ui-pill, .ui-phone-field, .ui-phone-field > .ui-pill-field, .ui-phone-row > .ui-pill, .ui-phone-row > .ui-pill-room";
    const nodes = [...copy.querySelectorAll<HTMLElement>(selector)], liveNodes = [...root.querySelectorAll<HTMLElement>(selector)];
    const parts = nodes.map((element, index) => {
      const button = element.querySelector("button"), textarea = element.querySelector("textarea");
      const holder = element.classList.contains("ui-phone-field"), isField = element.classList.contains("ui-pill-field");
      const label = (button ?? textarea)?.getAttribute("aria-label") ?? "";
      const live = liveNodes[index];
      const current = live?.getBoundingClientRect();
      const spinner = button?.querySelector<HTMLElement>(".ui-spinner");
      return { id: holder ? "field-holder" : isField ? "field" : `part-${index}`, kind: holder ? "holder" : isField ? "field" : element.classList.contains("ui-pill-room") ? "room" : "pill",
        rect: rect(element), presentation: current && live ? { rect: { x: current.x, y: current.y, width: current.width, height: current.height }, opacity: Number(getComputedStyle(live).opacity) } : null, move: move(element.dataset.move), out: element.hasAttribute("data-out"), hidden: !!element.closest(".ui-phone-edit") && copy.hasAttribute("data-opening"),
        folded: element.hasAttribute("data-folded"), stretch: element.hasAttribute("data-stretch"), voice: element.hasAttribute("data-voice"),
        disabled: (button ?? textarea)?.disabled ?? false, label, placeholder: textarea?.placeholder ?? "", clipRadius: parseFloat(getComputedStyle(element).borderRadius) || 0, action: action(label), icon: spinner ? "spinner" : action(label), spin: duration("--duration-spin", element) * (reducedMotion() ? 3 : 1), haptic: hapticKind(element.dataset.haptic ?? button?.dataset.haptic),
        // The button's disabled style belongs to its contents, not its frost.
        contentOpacity: button ? Number(getComputedStyle(button).opacity) : 1, under: element.hasAttribute("data-under"),
        edit: !!element.closest(".ui-phone-edit") };
    });
    const style = getComputedStyle(input), fieldStyle = getComputedStyle(field), icon = row.querySelector("svg");
    return { state: phoneState(copy.dataset.state), show: copy.dataset.show ?? "", parts,
      viewport: { width: window.innerWidth, height: window.innerHeight }, field: rect(field), row: rect(row),
      typography: { size: parseFloat(style.fontSize), lineHeight: parseFloat(style.lineHeight), weight: parseInt(style.fontWeight) || 400,
        paddingX: parseFloat(fieldStyle.paddingLeft) + parseFloat(fieldStyle.borderLeftWidth), paddingY: parseFloat(style.paddingTop) + parseFloat(fieldStyle.borderTopWidth),
        maxHeight: Math.min(192, parseFloat(style.maxHeight) || 192) + parseFloat(fieldStyle.borderTopWidth) + parseFloat(fieldStyle.borderBottomWidth), minHeight: parseFloat(fieldStyle.minHeight),
        radius: parseFloat(fieldStyle.borderRadius), iconSize: icon ? icon.getBoundingClientRect().width : 18 } };
  } finally { copy.remove(); }
}
export type NativeComposerPart = ReturnType<typeof describe>["parts"][number];
type Description = ReturnType<typeof describe>;
export type NativePhoneComposerPlugin = {
  begin(options: ComposerInput & Description & { placeholder: string; motion: ReturnType<typeof motionSpec>; haptics: Partial<Record<Haptic, ReturnType<typeof hapticSteps>>> }): Promise<void>;
  update(options: Partial<ComposerInput> & Partial<Pick<Description, "parts" | "state" | "show" | "row">> & { motion?: ReturnType<typeof motionSpec> }): Promise<void>;
  end(): Promise<void>;
  addListener(name: "input" | "ended" | "closing", listener: (event: ComposerInput) => void): Promise<PluginListenerHandle>;
  addListener(name: "action", listener: (event: { name: ComposerAction }) => void): Promise<PluginListenerHandle>;
};
/** The web tree remains laid out and moving, so dock reservation and transcript motion keep their normal source. */
export function mirror(root: HTMLElement, input: HTMLTextAreaElement, plugin: NativePhoneComposerPlugin) {
  let frame = 0, stopped = false, ready = false, previous = "", fieldHeight = 0;
  let growth: Animation | undefined;
  const field = root.querySelector<HTMLElement>(".ui-pill-field");
  const preference = matchMedia(REDUCED_MOTION_QUERY);
  const hidden = [...root.querySelectorAll<HTMLElement>(":scope > .ui-phone-field, :scope > .ui-phone-row, :scope > .ui-phone-edit")]
    .map(element => ({ element, visibility: element.style.visibility }));
  const restore = () => {
    stopped = true; cancelAnimationFrame(frame); sizes.disconnect(); attributes.disconnect();
    preference.removeEventListener("change", sync); growth?.cancel(); root.removeAttribute("data-native-mirror");
    for (const { element, visibility } of hidden) element.style.visibility = visibility;
  };
  const sync = () => {
    if (frame || stopped || !ready) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      try {
        const { parts, state, show, row } = describe(root), motion = motionSpec(root);
        if (motion.reducedMotion) { growth?.cancel(); growth = undefined; }
        const fieldPart = parts.find(part => part.kind === "field");
        // The Web setting keeps its existing sizing path. While mirrored, the hidden frost and native field grow
        // together on the same gentle/arrive tokens, so clearDock observes the same travel as the native frame.
        if (field && fieldPart && fieldPart.rect.height !== fieldHeight) {
          const from = field.getBoundingClientRect().height;
          growth?.cancel();
          if (!motion.reducedMotion && !fieldPart.out) growth = field.animate([{ height: `${from}px` }, { height: `${fieldPart.rect.height}px` }],
            { duration: motion.gentle, easing: easing("--ease-arrive", root) });
          fieldHeight = fieldPart.rect.height;
        }
        const signature = JSON.stringify({ parts: parts.map(({ presentation: _presentation, rect, ...part }) => ({ ...part, rect: { ...rect, y: rect.y - row.y - row.height } })), state, show, width: row.width, motion });
        if (signature === previous) return;
        previous = signature;
        void plugin.update({ parts, state, show, row, motion }).catch(() => { void plugin.end(); });
      } catch { void plugin.end(); }
    });
  };
  const sizes = new ResizeObserver(sync), attributes = new MutationObserver(records => {
    if (records.some(record => record.type === "childList" || record.attributeName?.startsWith("data-") || record.attributeName === "disabled" || record.attributeName === "aria-label" || record.attributeName === "style")) sync();
  });
  const start = async () => {
    try {
      const description = describe(root);
      fieldHeight = description.field.height;
      root.setAttribute("data-native-mirror", "");
      const haptics: Partial<Record<Haptic, ReturnType<typeof hapticSteps>>> = {};
      for (const part of description.parts) if (part.haptic) haptics[part.haptic] = hapticSteps(part.haptic);
      for (const { element } of hidden) element.style.visibility = "hidden";
      await plugin.begin({ ...description, text: input.value, selectionStart: input.selectionStart, selectionEnd: input.selectionEnd,
        placeholder: input.placeholder, motion: motionSpec(root), haptics });
      if (stopped) { await plugin.end(); return; }
      ready = true; preference.addEventListener("change", sync);
      sizes.observe(root); for (const element of root.querySelectorAll(".ui-pill, .ui-phone-field, .ui-phone-row")) sizes.observe(element);
      attributes.observe(root, { subtree: true, attributes: true, childList: true }); sync();
    } catch (error) { restore(); throw error; }
  };
  return { ready: start(), restore, sync };
}
