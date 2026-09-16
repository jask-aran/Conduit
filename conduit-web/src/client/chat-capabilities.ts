import type { BooleanCapability, ChatCapabilities, ChatSummary, Template } from "./api/contracts";

/**
 * The harness manifest for a chat, resolved from that chat's own identity.
 *
 * Deliberately not the profile the picker shows. That one falls back to the
 * default profile so there is always something to display, which is right for a
 * picker and wrong here: a chat whose profile is missing would be handed the
 * default harness's answers rather than told we do not know. It also reads a
 * templateId that applyDetail sets after the selection commits, so during a
 * switch it still describes the chat before this one -- which is the whole
 * class of bug this exists to stop. A chat summary carries profileId at click
 * time, before the transcript and long before any process.
 */
export function manifestForChat(
  profiles: Template[],
  chat: ChatSummary | null | undefined,
): ChatCapabilities | null {
  const profileId = chat?.profileId || chat?.templateId;
  if (!profileId) return null;
  return profiles.find((profile) => profile.id === profileId)?.capabilities || null;
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
