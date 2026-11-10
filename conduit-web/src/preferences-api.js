/*
 * The UI preferences, declared once: what a client keeps on the hub so every device has it (GET and PATCH
 * /v0/preferences). The store's defaults, what a patch may hold, how a stored value is read back and which keys the
 * route passes on are all this list (preferences-store.js, server/routes/runtime.js), and the client's UiPreferences
 * is typed from it (client/preferences/ui-preferences.ts). A key added here is validated, saved, served and typed; one
 * added anywhere else is not saved.
 *
 * Each is unset (null) until chosen: the client's own default stands. `type`:
 *   boolean | integer (min..max) | strings (at most `limit`) | choice (one of `values`) | shortcuts | voice
 *
 * Plain data and small functions, no imports: the client takes it as types only.
 */
export const UI_PREFERENCES = /** @type {const} */ ({
  sidebarChatLimit: { type: "integer", min: 5, max: 100 },
  collapsedProjectIds: { type: "strings", limit: 200 },
  sidebarCollapsed: { type: "boolean" },
  // The retired renderer ids are absent: a stored one reads back unset, and the client draws with its default.
  markdownRenderer: { type: "choice", values: ["incremark", "marked"] },
  meteorField: { type: "boolean" },
  // Reading-surface presets. Free pixel values are deliberately not accepted: the shell scales its geometry by
  // density and container width, so only a named preset stays correct across devices.
  transcriptWidth: { type: "choice", values: ["compact", "default", "wide", "full"] },
  transcriptWideBlocks: { type: "choice", values: ["off", "default", "wider", "full"] },
  codeBlockCollapse: { type: "choice", values: ["off", "long", "all"] },
  codeBlockCollapseLines: { type: "choice", values: [10, 15, 25, 50] },
  codeBlockWidth: { type: "choice", values: ["column", "wide"] },
  panelMotion: { type: "choice", values: ["translate", "reflow"] },
  leaderMenu: { type: "choice", values: ["pause", "immediate", "never"] },
  userMessageCollapse: { type: "choice", values: ["off", "6", "10", "15", "25"] },
  chatSort: { type: "choice", values: ["latest", "created"] },
  // Kept in their own file beside the preferences (keybindings.js), served here.
  shortcutOverrides: { type: "shortcuts" },
  voicePreferences: { type: "voice" },
});

export const UI_PREFERENCE_KEYS = Object.keys(UI_PREFERENCES);

const stringList = (value, limit) => Array.isArray(value) && value.length <= limit
  && value.every((item) => typeof item === "string" && item.length <= 200);
const validShortcutOverrides = (value) => {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).length > 100) return false;
  return Object.entries(value).every(([commandId, bindings]) => commandId.length <= 100
    && Array.isArray(bindings) && bindings.length <= 4
    && bindings.every((binding) => Array.isArray(binding?.strokes) && binding.strokes.length >= 1 && binding.strokes.length <= 2
      && binding.strokes.every((stroke) => typeof stroke?.code === "string" && stroke.code.length <= 40
        && typeof stroke.key === "string" && stroke.key.length <= 40
        && stringList(stroke.modifiers, 4))));
};
const validVoicePreferences = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value)
  && typeof value.shortcut === "string" && value.shortcut.length <= 100
  && ["push_to_talk", "toggle"].includes(value.activation)
  && typeof value.autoSend === "boolean"
  && ["raw", "processed"].includes(value.captureProfile);

/** What a client may send for each type: exactly a value of it. */
const VALID = {
  boolean: (value) => typeof value === "boolean",
  integer: (value, { min, max }) => Number.isInteger(value) && value >= min && value <= max,
  strings: (value, { limit }) => stringList(value, limit),
  choice: (value, { values }) => values.includes(value),
  shortcuts: validShortcutOverrides,
  voice: validVoicePreferences,
};
/** What a stored value reads back as: itself made to fit, or unset (null) when it is no longer one. */
const READ = {
  boolean: (value) => (typeof value === "boolean" ? value : null),
  integer: (value, { min, max }) => (Number.isFinite(Number(value)) ? Math.min(max, Math.max(min, Math.round(Number(value)))) : null),
  strings: (value, { limit }) => (Array.isArray(value)
    ? [...new Set(value.filter((item) => typeof item === "string" && item.length <= 200))].slice(0, limit) : null),
  choice: (value, { values }) => (values.includes(value) ? value : null),
  shortcuts: (value) => (validShortcutOverrides(value) ? structuredClone(value) : null),
  voice: (value) => (validVoicePreferences(value) ? structuredClone(value) : null),
};

/** Whether every UI preference in a patch is a value of its type; keys that are not UI preferences are not its business. */
export function validUiPreferencePatch(input = {}) {
  return Object.entries(input).every(([key, value]) => {
    if (!Object.hasOwn(UI_PREFERENCES, key)) return true;
    return value != null && VALID[UI_PREFERENCES[key].type](value, UI_PREFERENCES[key]);
  });
}

/** The UI preferences of a patch, and nothing else of it. */
export const uiPreferencePatch = (input = {}) => Object.fromEntries(UI_PREFERENCE_KEYS
  .filter((key) => Object.hasOwn(input || {}, key)).map((key) => [key, input[key]]));

/** Every UI preference read from `input`, falling back to `fallback`'s where it has none. */
export const readUiPreferences = (input = {}, fallback = {}) => Object.fromEntries(UI_PREFERENCE_KEYS.map((key) => {
  const read = (value) => READ[UI_PREFERENCES[key].type](value, UI_PREFERENCES[key]);
  return [key, input[key] == null ? (fallback[key] == null ? null : read(fallback[key])) : read(input[key])];
}));
