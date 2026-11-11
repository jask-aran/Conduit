/* Dependency-free so the test runner can import it: the project's modules import without file extensions, which the
   bundler resolves but the test runner does not. A line count rather than a character budget, because what costs the
   reader is screen height. */
export type UserMessageCollapseMode = "off" | "6" | "10" | "15" | "25";

export const USER_MESSAGE_COLLAPSE_STORAGE_KEY = "conduit:user-message-collapse";

export const USER_MESSAGE_COLLAPSE_OPTIONS: ReadonlyArray<{ value: UserMessageCollapseMode; label: string }> = [
  { value: "off", label: "Never" },
  { value: "6", label: "Over 6 lines" },
  { value: "10", label: "Over 10 lines" },
  { value: "15", label: "Over 15 lines" },
  { value: "25", label: "Over 25 lines" },
];

export const USER_MESSAGE_COLLAPSE_DEFAULT: UserMessageCollapseMode = "10";

const MODES = new Set<string>(USER_MESSAGE_COLLAPSE_OPTIONS.map((option) => option.value));

export function isUserMessageCollapseMode(value: unknown): value is UserMessageCollapseMode {
  return typeof value === "string" && MODES.has(value);
}

export function userMessageCollapseLines(mode: UserMessageCollapseMode) {
  return mode === "off" ? 0 : Number(mode);
}

export function selectedUserMessageCollapse(
  storage: Pick<Storage, "getItem"> = localStorage,
): UserMessageCollapseMode {
  const override = typeof location === "undefined"
    ? null
    : new URLSearchParams(location.search).get("userMessageCollapse");
  if (isUserMessageCollapseMode(override)) return override;
  const stored = storage.getItem(USER_MESSAGE_COLLAPSE_STORAGE_KEY);
  return isUserMessageCollapseMode(stored) ? stored : USER_MESSAGE_COLLAPSE_DEFAULT;
}

export function saveUserMessageCollapse(
  mode: UserMessageCollapseMode,
  storage: Pick<Storage, "setItem"> = localStorage,
): UserMessageCollapseMode {
  const selected = isUserMessageCollapseMode(mode) ? mode : USER_MESSAGE_COLLAPSE_DEFAULT;
  storage.setItem(USER_MESSAGE_COLLAPSE_STORAGE_KEY, selected);
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("conduit:ui-preference-change", {
      detail: { key: "userMessageCollapse", value: selected },
    }));
  }
  return selected;
}
