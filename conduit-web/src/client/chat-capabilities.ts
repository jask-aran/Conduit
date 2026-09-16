import type { BooleanCapability, ChatCapabilities, ChatSummary } from "./api/contracts";

/**
 * What the harness running a chat can do.
 *
 * A profile elects a harness; the harness declares the capabilities. So the
 * join is the chat's implementation, which is the key a manifest is registered
 * under, and not its profile -- four Pi profiles have no separate opinion about
 * whether Pi answers approvals.
 *
 * Deliberately not the profile the picker shows, either. That one falls back to
 * a default so there is always something to display, which is right for a
 * picker and wrong here: a chat whose harness is unknown would be handed the
 * default one's answers rather than told we do not know. It also reads a
 * templateId that applyDetail sets after the selection commits, so during a
 * switch it still describes the chat before this one -- the whole class of bug
 * this exists to stop. A chat summary carries its implementation at click time,
 * before the transcript and long before any process.
 */
export function manifestForChat(
  harnesses: Record<string, ChatCapabilities>,
  chat: ChatSummary | null | undefined,
): ChatCapabilities | null {
  const implementation = chat?.backend?.implementation;
  if (!implementation) return null;
  return harnesses[implementation] || null;
}

/**
 * Whether a capability is on, given what the harness declares and what a live
 * process reported.
 *
 * The manifest decides. A live record may only narrow it, never add: a control
 * that appears once a process is running is a control that flickers in, or one
 * still holding the answer for the session before this one. Narrowing is kept
 * because a resident process can outlive the profile its chat names, though
 * Conduit refuses to change a chat's harness once it has history, so today that
 * is a guard rather than a path anything travels.
 */
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
