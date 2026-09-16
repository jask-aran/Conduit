/**
 * What model a profile was last set to.
 *
 * Written the moment somebody picks one in a composer, not when they send: the
 * choice is the decision, and a model chosen and then abandoned without a
 * message is still the answer to "what do I want this profile on".
 *
 * Keyed by profile rather than by backend, because "Assistant" and "Coding" are
 * two answers to the same question and sharing one entry between them meant
 * choosing in one silently moved the other.
 */
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
