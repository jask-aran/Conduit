/**
 * The composer floats over the foot of what scrolls under it (a thread, a room's messages), so that scroller has to
 * reserve the composer's height itself. A fixed reservation only ever matched the resting composer: a multi-line
 * draft, attachments, or the queued-message card each grew the stack over the newest output and left it covered.
 * Reserving the measured height instead (--transcript-composer-inset on `target`, the dock's border box plus a
 * clearance) makes the content taller, which a tail that follows reads as the bottom moving -- so the output steps up
 * out of the way while the card is there, and back down when it goes.
 *
 * Border box, because the only thing the keyboard changes about the stack is its padding: the pill inside stays its
 * height whether or not the navigation bar is owed room underneath, so a content-box observation reports once and
 * never again. Dictating on a phone, the text pill folds away under captions that float where it was: the room is
 * still taken, so the reservation keeps it rather than following the composer down and back up.
 */
const CLEARANCE_PX = 40;
export const DOCK_INSET = "--transcript-composer-inset";

export function clearDock(target: HTMLElement, dock: HTMLElement, onResize?: () => void) {
  let measured = -1;
  const sync = (blockSize: number) => {
    const current = parseFloat(target.style.getPropertyValue(DOCK_INSET)) || 0;
    if (dock.querySelector('.ui-phone-composer[data-state="listening"]') && blockSize + CLEARANCE_PX < current) return;
    const inset = `${Math.round(blockSize + CLEARANCE_PX)}px`;
    if (target.style.getPropertyValue(DOCK_INSET) !== inset) target.style.setProperty(DOCK_INSET, inset);
  };
  const sizes = new ResizeObserver((entries) => {
    const entry = entries[0];
    const blockSize = entry?.borderBoxSize[0]?.blockSize ?? entry?.contentRect.height ?? 0;
    if (Math.abs(blockSize - measured) < 0.5) return;
    measured = blockSize;
    sync(blockSize);
    onResize?.();
  });
  sizes.observe(dock, { box: "border-box" });
  return () => sizes.disconnect();
}
