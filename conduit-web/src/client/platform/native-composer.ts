import { Capacitor, registerPlugin } from "@capacitor/core";
import type { NativePhoneComposerPlugin } from "@/components/ui/native-phone-composer";
export type { ComposerAction, ComposerInput } from "@/components/ui/native-phone-composer";

export type ComposerKind = "web" | "native";
export const COMPOSER_KINDS: { value: ComposerKind; label: string }[] = [
  { value: "web", label: "Web" }, { value: "native", label: "Native while typing" },
];
const KEY = "conduit.composer";
/** Native takes over only where the Android plugin is there. */
export function composerKind(): ComposerKind {
  try { return localStorage.getItem(KEY) === "web" ? "web" : "native"; } catch { return "native"; }
}
export function saveComposerKind(kind: ComposerKind): ComposerKind {
  try { localStorage.setItem(KEY, kind); } catch { /* this page only */ }
  return kind;
}
export const nativeComposerAvailable = () => Capacitor.getPlatform() === "android" && Capacitor.isPluginAvailable("ConduitComposer");
export const nativeComposer = registerPlugin<NativePhoneComposerPlugin>("ConduitComposer");
