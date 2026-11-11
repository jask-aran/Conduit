/* No modifier escape hatch: `ClipboardEvent` carries no modifier state, so the attachment is reversible instead. */
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

export function insertTextAt(draft: string, start: number, end: number, text: string) {
  const from = Math.max(0, Math.min(start, draft.length));
  const to = Math.max(from, Math.min(end, draft.length));
  return { text: `${draft.slice(0, from)}${text}${draft.slice(to)}`, caret: from + text.length };
}
