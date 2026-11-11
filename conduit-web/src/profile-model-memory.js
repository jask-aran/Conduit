// Written the moment somebody picks a model in a composer, not when they send: the choice is the decision.
export const rememberedModel = (preferences, profileId) =>
  (profileId ? preferences.get().profileModelDefaults?.[profileId] : undefined);

export const rememberModel = async (preferences, profileId, model, thinkingLevel = "") => {
  if (!profileId || !model) return;
  const current = preferences.get().profileModelDefaults || {};
  const next = { model, ...(thinkingLevel ? { thinkingLevel } : {}) };
  const existing = current[profileId];
  if (existing?.model === next.model && (existing.thinkingLevel || "") === (next.thinkingLevel || "")) return;
  await preferences.save({ profileModelDefaults: { ...current, [profileId]: next } });
};
