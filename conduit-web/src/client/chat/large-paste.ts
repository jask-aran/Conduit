/**
 * A paste large enough to dominate the model's context is attached as a text
 * file rather than inlined, so the agent can open it on demand and the draft
 * stays readable.
 *
 * There is no modifier escape hatch. `ClipboardEvent` extends `Event`, not
 * `UIEvent`, so it carries no modifier state and no browser reports one for a
 * paste; reading Ctrl+Shift+V would mean arming a flag on keydown and hoping
 * the matching paste arrives. The attachment is reversible instead, which needs
 * no hidden state and is discoverable in a way a shortcut is not.
 */
export const LARGE_PASTE_BYTES = 32 * 1024;

export function pastedTextByteLength(text: string): number {
  return new TextEncoder().encode(text).length;
}

export function shouldAttachPastedText(
  text: string,
  options: { attachmentsSupported: boolean; threshold?: number },
): boolean {
  if (!options.attachmentsSupported || !text) return false;
  return pastedTextByteLength(text) >= (options.threshold ?? LARGE_PASTE_BYTES);
}

export function pastedTextFilename(at: Date = new Date()): string {
  return `pasted-text-${at.toISOString().replace(/[:.]/g, "-").replace("T", "-").slice(0, 19)}.txt`;
}

export function fileFromPastedText(text: string, at?: Date): File {
  return new File([text], pastedTextFilename(at), { type: "text/plain" });
}

/** Undo puts the text back where the caret was when the paste was swallowed. */
export function insertTextAt(draft: string, start: number, end: number, text: string) {
  const from = Math.max(0, Math.min(start, draft.length));
  const to = Math.max(from, Math.min(end, draft.length));
  return { text: `${draft.slice(0, from)}${text}${draft.slice(to)}`, caret: from + text.length };
}
