/* Phone composer layout, an experiment chosen in Settings → Interface:
   today's text row, or one of the two voice-first layouts. Per device. */
export type PhoneComposerLayout = "classic" | "surface" | "bar";

const KEY = "conduit:phone-composer";
export const PHONE_COMPOSER_CHANGE_EVENT = "conduit:phone-composer-change";

export const PHONE_COMPOSER_OPTIONS: readonly { value: PhoneComposerLayout; label: string }[] = [
  { value: "classic", label: "Classic" },
  { value: "surface", label: "Voice · one surface" },
  { value: "bar", label: "Voice · button bar" },
];

export function phoneComposerLayout(): PhoneComposerLayout {
  try {
    const value = localStorage.getItem(KEY);
    if (value === "surface" || value === "bar") return value;
  } catch { /* unavailable */ }
  return "classic";
}

export function savePhoneComposerLayout(layout: PhoneComposerLayout): PhoneComposerLayout {
  try { localStorage.setItem(KEY, layout); } catch { /* this session only */ }
  window.dispatchEvent(new CustomEvent(PHONE_COMPOSER_CHANGE_EVENT));
  return layout;
}
