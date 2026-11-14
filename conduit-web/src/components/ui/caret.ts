/**
 * The caret of an editable region is drawn here, over the region, and breathes by its opacity alone, which the compositor animates: the browser's own
 * caret can only be faded by its colour, which is inherited, so animating it restyles everything under the region every frame (or steps, when done a few
 * times a second). It stands solid for a moment after it moves. A field keeps the browser's caret (styles/foundations.css); so does a touch screen,
 * whose caret has handles.
 */
export function breatheCarets() {
  if (!matchMedia("(pointer: fine)").matches) return;
  const caret = document.createElement("div");
  caret.className = "ui-caret"; caret.setAttribute("aria-hidden", "true");
  let region: HTMLElement | null = null, due = 0, last = "";
  // The region says its caret's colour by an attribute of its own (a paper's way of writing).
  const looked = new MutationObserver(() => { last = ""; soon(); });
  /** Where a collapsed range stands; an empty line has no box of its own, so its block's first line stands for it. */
  const boxOf = (range: Range) => {
    const drawn = range.getClientRects()[0];
    if (drawn?.height) return drawn;
    const node = range.startContainer, inside = node instanceof Element ? node.childNodes[range.startOffset] : null, element = inside instanceof Element ? inside : node instanceof Element ? node : node.parentElement;
    if (!element) return null;
    const box = element.getBoundingClientRect();
    if (element === inside) return box;
    const look = getComputedStyle(element);
    return { left: box.left + parseFloat(look.borderLeftWidth) + parseFloat(look.paddingLeft), top: box.top + parseFloat(look.borderTopWidth) + parseFloat(look.paddingTop), height: parseFloat(look.lineHeight) || box.height };
  };
  const place = () => {
    due = 0;
    const selection = getSelection(), range = selection?.rangeCount && selection.isCollapsed ? selection.getRangeAt(0) : null, home = caret.parentElement;
    const box = region?.isConnected && home && range && region.contains(range.startContainer) ? boxOf(range) : null;
    if (!box || !home) { if (last) { caret.style.visibility = "hidden"; last = ""; } return; }
    const frame = home.getBoundingClientRect(), next = `${Math.round(box.left - frame.left - home.clientLeft + home.scrollLeft)},${Math.round(box.top - frame.top - home.clientTop + home.scrollTop)},${Math.round(box.height)}`;
    if (next === last) return;
    const [left, top, height] = next.split(",");
    last = next;
    // An empty --caret would be a value (and no colour at all), so it is set only where the region gives one.
    const colour = getComputedStyle(region!).getPropertyValue("--caret").trim();
    caret.style.cssText = `transform:translate(${left}px,${top}px);height:${height}px${colour ? `;--caret:${colour}` : ""}`;
    // Moved, it is solid again before it next fades.
    for (const animation of caret.getAnimations()) animation.currentTime = 0;
  };
  const soon = () => { if (region && !due) due = requestAnimationFrame(place); };
  const leave = () => { looked.disconnect(); region = null; caret.remove(); last = ""; };
  document.addEventListener("focusin", (event) => {
    leave();
    if (!(event.target instanceof HTMLElement) || event.target.contentEditable !== "true") return;
    region = event.target; looked.observe(region, { attributes: true });
    // In the region's own frame, so it scrolls with the text where that frame does.
    (region.offsetParent ?? document.body).append(caret);
    soon();
  });
  document.addEventListener("focusout", leave);
  document.addEventListener("selectionchange", soon);
  // What moves the text under it without moving the selection.
  document.addEventListener("input", soon, { capture: true });
  document.addEventListener("scroll", soon, { capture: true, passive: true });
  addEventListener("resize", soon);
}
