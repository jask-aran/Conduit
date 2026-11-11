/*
 * A key added here is validated, saved, served and typed; one added anywhere else is not saved. Each is unset (null)
 * until chosen, so the client's own default stands.
 * Plain data and small functions, no imports: the client takes its types, and the choice lists as values.
 */
export const UI_PREFERENCES = /** @type {const} */ ({
  sidebarChatLimit: { type: "integer", min: 5, max: 100 },
  collapsedProjectIds: { type: "strings", limit: 200 },
  sidebarCollapsed: { type: "boolean" },
  meteorField: { type: "boolean" },
  // Free pixel values are not accepted: the shell scales its geometry by density and container width, so only a named
  // preset stays correct across devices.
  transcriptWidth: { type: "choice", values: ["compact", "default", "wide", "full"] },
  transcriptWideBlocks: { type: "choice", values: ["off", "default", "wider", "full"] },
  codeBlockCollapse: { type: "choice", values: ["off", "long", "all"] },
  codeBlockCollapseLines: { type: "choice", values: [10, 15, 25, 50] },
  codeBlockWidth: { type: "choice", values: ["column", "wide"] },
  panelMotion: { type: "choice", values: ["translate", "reflow"] },
  leaderMenu: { type: "choice", values: ["pause", "immediate", "never"] },
  userMessageCollapse: { type: "choice", values: ["off", "6", "10", "15", "25"] },
  chatSort: { type: "choice", values: ["latest", "created"] },
  shortcutOverrides: { type: "shortcuts" },
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

const VALID = {
  boolean: (value) => typeof value === "boolean",
  integer: (value, { min, max }) => Number.isInteger(value) && value >= min && value <= max,
  strings: (value, { limit }) => stringList(value, limit),
  choice: (value, { values }) => values.includes(value),
  shortcuts: validShortcutOverrides,
};
const READ = {
  boolean: (value) => (typeof value === "boolean" ? value : null),
  integer: (value, { min, max }) => (Number.isFinite(Number(value)) ? Math.min(max, Math.max(min, Math.round(Number(value)))) : null),
  strings: (value, { limit }) => (Array.isArray(value)
    ? [...new Set(value.filter((item) => typeof item === "string" && item.length <= 200))].slice(0, limit) : null),
  choice: (value, { values }) => (values.includes(value) ? value : null),
  shortcuts: (value) => (validShortcutOverrides(value) ? structuredClone(value) : null),
};

// Keys that are not UI preferences are not its business.
export function validUiPreferencePatch(input = {}) {
  return Object.entries(input).every(([key, value]) => {
    if (!Object.hasOwn(UI_PREFERENCES, key)) return true;
    return value != null && VALID[UI_PREFERENCES[key].type](value, UI_PREFERENCES[key]);
  });
}

export const uiPreferencePatch = (input = {}) => Object.fromEntries(UI_PREFERENCE_KEYS
  .filter((key) => Object.hasOwn(input || {}, key)).map((key) => [key, input[key]]));

export const readUiPreferences = (input = {}, fallback = {}) => Object.fromEntries(UI_PREFERENCE_KEYS.map((key) => {
  const read = (value) => READ[UI_PREFERENCES[key].type](value, UI_PREFERENCES[key]);
  return [key, input[key] == null ? (fallback[key] == null ? null : read(fallback[key])) : read(input[key])];
}));
