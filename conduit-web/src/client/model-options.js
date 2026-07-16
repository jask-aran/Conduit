const list = (value) => Array.isArray(value) ? value : [];

export function modelSearchValue(model) {
  return [model.label, model.provider, model.spec].filter(Boolean).join(" ");
}

export function filterModels(models, query) {
  const needle = String(query || "").trim().toLowerCase();
  if (!needle) return models;
  return models.filter((model) => modelSearchValue(model).toLowerCase().includes(needle));
}

export function groupModels(models) {
  const groups = new Map();
  for (const model of list(models)) {
    const provider = model.provider || model.spec?.split("/")[0] || "Other";
    if (!groups.has(provider)) groups.set(provider, []);
    groups.get(provider).push(model);
  }
  return [...groups.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([provider, items]) => ({
      provider,
      items: [...items].sort((left, right) => left.label.localeCompare(right.label)),
    }));
}

export function thinkingLabel(level) {
  if (level === "xhigh") return "XHigh";
  return `${level?.[0]?.toUpperCase() || ""}${level?.slice(1) || ""}`;
}
