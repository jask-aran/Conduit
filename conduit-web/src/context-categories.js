/**
 * The one set of context categories Conduit speaks, whatever the harness.
 * A harness reports what it can and each adapter maps its own parts onto
 * these; a part Conduit has no category for is Other, never dropped. When a
 * category gathers several of a harness's parts, they become its items, so
 * nothing the harness said is lost (docs/design/conduit-harness-plugins.md).
 */
export const CONTEXT_CATEGORIES = Object.freeze([
  { id: "system-prompt", label: "System prompt", kind: "used" },
  { id: "tools", label: "Tools", kind: "used" },
  { id: "instructions", label: "Instructions", kind: "used" },
  { id: "messages", label: "Messages", kind: "used" },
  { id: "other", label: "Other", kind: "used" },
  // A harness that does not itemise reports its whole fill as this.
  { id: "used", label: "Used", kind: "used" },
  { id: "buffer", label: "Autocompact buffer", kind: "buffer" },
  { id: "deferred-tools", label: "Deferred tools", kind: "deferred" },
  { id: "free", label: "Free space", kind: "free" },
]);

/**
 * Gather a harness's parts -- `{ category, label, tokens, items? }`, each
 * already assigned a Conduit category id -- into Conduit's categories, in
 * Conduit's order.
 */
export function conduitCategories(parts) {
  const groups = new Map();
  for (const part of parts || []) {
    if (!part || !(part.tokens > 0 || part.category === "free")) continue;
    const id = CONTEXT_CATEGORIES.some((category) => category.id === part.category) ? part.category : "other";
    (groups.get(id) || groups.set(id, []).get(id)).push(part);
  }
  return CONTEXT_CATEGORIES.filter((category) => groups.has(category.id)).map((category) => {
    const members = groups.get(category.id);
    const items = members.length > 1
      ? members.map((part) => ({ label: part.label, tokens: part.tokens }))
      : members[0].items?.length ? members[0].items : null;
    return { id: category.id, label: category.label, kind: category.kind,
      tokens: members.reduce((sum, part) => sum + part.tokens, 0), ...(items ? { items } : {}) };
  });
}
