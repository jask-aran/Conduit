import { Capacitor, registerPlugin, type PluginListenerHandle } from "@capacitor/core";
import { hapticSteps } from "@/components/ui/haptics";

export type ComposerKind = "web" | "native";
export const COMPOSER_KINDS: { value: ComposerKind; label: string }[] = [
  { value: "web", label: "Web" }, { value: "native", label: "Native while typing" },
];
const KEY = "conduit.composer";
export function composerKind(): ComposerKind {
  try { return localStorage.getItem(KEY) === "native" ? "native" : "web"; } catch { return "web"; }
}
export function saveComposerKind(kind: ComposerKind): ComposerKind {
  try { localStorage.setItem(KEY, kind); } catch { /* this page only */ }
  return kind;
}
export const nativeComposerAvailable = () => Capacitor.getPlatform() === "android" && Capacitor.isPluginAvailable("ConduitComposer");
export type ComposerAction = "attach" | "camera" | "keyboard" | "mic" | "send" | "stop" | "latest" | "undo" | "delete" | "left" | "right" | "select";
export type ComposerInput = { text: string; selectionStart: number; selectionEnd: number };
type Rect = { x: number; y: number; width: number; height: number };
export type ComposerPill = { name: ComposerAction; rect: Rect; enabled: boolean; label: string; press: boolean };
export function measureNativeComposer(input: HTMLTextAreaElement) {
  const root = input.closest(".ui-phone-composer");
  const row = root?.querySelector<HTMLElement>(".ui-phone-row");
  const field = input.closest<HTMLElement>(".ui-pill-field");
  if (!root || !row || !field) throw new Error("Phone composer is not mounted");
  const rect = (element: Element): Rect => {
    const r = element.getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height };
  };
  const pills: ComposerPill[] = [];
  for (const button of row.querySelectorAll<HTMLButtonElement>("button")) {
    const pill = button.closest<HTMLElement>(".ui-pill");
    if (!pill || pill.hasAttribute("data-folded")) continue;
    const label = button.getAttribute("aria-label") ?? "";
    const name: ComposerAction | undefined = label === "Message options" ? "attach" : label === "Take a photo" ? "camera"
      : label === "Close the keyboard" || label === "Type a message" ? "keyboard" : label.includes("voice dictation") ? "mic"
      : label === "Stop response" ? "stop" : label === "Scroll to latest" ? "latest" : label.startsWith("Send") ? "send" : undefined;
    if (name) pills.push({ name, rect: rect(pill), enabled: !button.disabled, label, press: ["mic", "send", "stop", "camera"].includes(name) });
  }
  const editPills: ComposerPill[] = [];
  if (root.getAttribute("data-show")?.split(" ").includes("edit") && !root.hasAttribute("data-opening")) {
    for (const button of root.querySelectorAll<HTMLButtonElement>(".ui-phone-edit button")) {
      const pill = button.closest(".ui-pill");
      if (!pill) continue;
      const label = button.getAttribute("aria-label") ?? "";
      const name = label === "Undo" ? "undo" : label === "Delete word or selection" ? "delete"
        : label === "Previous word" ? "left" : label === "Next word" ? "right" : label === "End of draft" ? "select" : undefined;
      if (name) editPills.push({ name, rect: rect(pill), enabled: !button.disabled, label, press: false });
    }
  }
  const style = getComputedStyle(input), fieldStyle = getComputedStyle(field);
  const icon = row.querySelector("svg");
  return {
    viewport: { width: window.innerWidth, height: window.innerHeight }, field: rect(field), row: rect(row), pills, editPills,
    typography: { size: parseFloat(style.fontSize), lineHeight: parseFloat(style.lineHeight), weight: parseInt(style.fontWeight) || 400,
      paddingX: parseFloat(fieldStyle.paddingLeft) + parseFloat(fieldStyle.borderLeftWidth), paddingY: parseFloat(style.paddingTop) + parseFloat(fieldStyle.borderTopWidth),
      maxHeight: Math.min(192, parseFloat(style.maxHeight) || 192) + parseFloat(fieldStyle.borderTopWidth) + parseFloat(fieldStyle.borderBottomWidth), minHeight: parseFloat(fieldStyle.minHeight),
      radius: parseFloat(fieldStyle.borderRadius), iconSize: icon ? icon.getBoundingClientRect().width : 18 },
  };
}
type Geometry = ReturnType<typeof measureNativeComposer>;
export const nativeComposer = registerPlugin<{
  begin(options: ComposerInput & Geometry & { placeholder: string; press: ReturnType<typeof hapticSteps> }): Promise<void>;
  update(options: Partial<ComposerInput> & { pills?: ComposerPill[]; editPills?: ComposerPill[]; fieldHeight?: number; field?: Rect; row?: Rect }): Promise<void>;
  end(): Promise<void>;
  addListener(name: "input" | "ended", listener: (event: ComposerInput) => void): Promise<PluginListenerHandle>;
  addListener(name: "action", listener: (event: { name: ComposerAction }) => void): Promise<PluginListenerHandle>;
  addListener(name: "height", listener: (event: { height: number }) => void): Promise<PluginListenerHandle>;
}>("ConduitComposer");
