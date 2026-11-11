import type { BooleanCapability, ChatCapabilities, ChatSummary, HarnessManifestView } from "./api/contracts";

/**
 * Joined on the chat's implementation, not its profile: the profiles' templates share the durable agent's
 * capabilities. Not the picker's profile either: it falls back to a default, and reads a templateId set after the
 * selection commits, so during a switch it describes the previous chat.
 */
export function manifestForChat(
  harnesses: Record<string, HarnessManifestView>,
  chat: ChatSummary | null | undefined,
): HarnessManifestView | null {
  const implementation = chat?.backend?.implementation;
  if (!implementation) return null;
  return harnesses[implementation] || null;
}

const HISTORY_DEPTH: Record<string, number> = { none: 0, linear: 1, tree: 2 };

/**
 * The manifest decides and a live record may only narrow it (here, a shallower history), never add: a control that
 * appears once a process runs flickers in. History is not a yes or no, so it cannot go through resolveCapability.
 */
export function resolveHistory(
  manifest: ChatCapabilities | null | undefined,
  reported: ChatCapabilities | null | undefined,
): ChatCapabilities["history"] {
  const declared = manifest?.history;
  const observed = reported?.history;
  if (declared === undefined) return observed ?? "none";
  if (observed === undefined) return declared;
  return (HISTORY_DEPTH[observed] ?? 0) < (HISTORY_DEPTH[declared] ?? 0) ? observed : declared;
}

export function resolveCapability(
  manifest: ChatCapabilities | null | undefined,
  reported: ChatCapabilities | null | undefined,
  name: BooleanCapability,
  fallback = false,
): boolean {
  const declared = manifest?.[name];
  const observed = reported?.[name];
  if (declared === undefined) return observed === undefined ? fallback : Boolean(observed);
  return declared === false ? false : observed !== false;
}
