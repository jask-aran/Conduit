/**
 * Border box, because the keyboard changes only the stack's padding: a content-box observation reports once and never
 * again. Dictating on a phone, the pill folds under captions where it was; the room is still taken, so it is kept.
 */
const CLEARANCE_PX = 40;
const DOCK_INSET = "--transcript-composer-inset";

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
