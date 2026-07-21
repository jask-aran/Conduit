/**
 * Tool-call renderer registry + timeline-item renderer registry.
 *
 * `toolRenderers` is keyed by the exact tool name from `item.value.name`;
 * card components take `({ tool, sessionId }) => JSX` (the full merged
 * tool-state object). Unregistered tool names fall back to the generic
 * ToolCard v2, registered as the default from `tool-card.jsx` at module
 * load — kept out of this file so the lookup mechanics stay JSX-free and
 * unit-testable with node:test (see tool-registry.test.js).
 *
 * `timelineItemRenderers` is keyed by non-message timeline item type
 * (`tool`, and Phase 3's `question`), replacing the growing inline
 * conditional in chat-thread.jsx's timeline loop with a lookup. Each
 * renderer takes `({ item, sessionId }) => JSX`.
 */

export const toolRenderers = {};
let defaultToolRenderer = null;

export function registerToolRenderer(name, component) {
  toolRenderers[name] = component;
}

export function setDefaultToolRenderer(component) {
  defaultToolRenderer = component;
}

export function getToolRenderer(name) {
  return toolRenderers[name] || defaultToolRenderer;
}

export const timelineItemRenderers = {};

export function registerTimelineItemRenderer(type, component) {
  timelineItemRenderers[type] = component;
}
