const CONTEXT_CATEGORIES = Object.freeze([
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

/** Each part arrives already assigned a Conduit category id. */
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
