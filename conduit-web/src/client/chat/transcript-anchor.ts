/**
 * Capture where the transcript is anchored so a layout-disturbing commit can be
 * undone. The first row carrying a message id is the stable reference: rows
 * prepended above it, or blocks relaid out around it, both move it by a known
 * delta that can be subtracted straight out of scrollTop.
 */
export type TranscriptAnchor = {
  element: HTMLElement | null;
  top: number | null;
  scrollTop: number;
  scrollHeight: number;
};

export function captureTranscriptAnchor(
  viewport: HTMLElement,
  thread: HTMLElement,
): TranscriptAnchor {
  const element = thread.querySelector<HTMLElement>("[data-message-id]");
  return {
    element,
    top: element?.getBoundingClientRect().top ?? null,
    scrollTop: viewport.scrollTop,
    scrollHeight: viewport.scrollHeight,
  };
}

/**
 * Re-apply an anchor. Returns the correction in pixels so callers can tell
 * whether the commit actually moved anything. `write` exists so the transcript
 * can route the correction through its programmatic-scroll bookkeeping instead
 * of touching scrollTop behind its own scroll listener.
 */
export function restoreTranscriptAnchor(
  viewport: HTMLElement,
  anchor: TranscriptAnchor,
  write: (next: number) => void = (next) => { viewport.scrollTop = next; },
): number {
  if (anchor.element?.isConnected && anchor.top != null) {
    const delta = anchor.element.getBoundingClientRect().top - anchor.top;
    if (Math.abs(delta) <= 0.05) return 0;
    write(viewport.scrollTop + delta);
    return delta;
  }
  const next = anchor.scrollTop + viewport.scrollHeight - anchor.scrollHeight;
  const delta = next - viewport.scrollTop;
  if (Math.abs(delta) <= 0.05) return 0;
  write(next);
  return delta;
}
