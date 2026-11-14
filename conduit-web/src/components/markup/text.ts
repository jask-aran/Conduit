/*
 * The page's own text as places (MarkupPlace): what the quote tool takes where its host says nothing of its places, and what a surface whose text is
 * the page's (a paper) makes its places from.
 */
import type { MarkupBox } from "@/components/ui/markup";
import type { MarkupAt, MarkupPlace } from "./host";

/** How many of a run's text nodes are measured. */
const QUOTE_NODES = 400;

/** Where in the page's text a point is; the layer over it is let through for the hit test. */
const caretAt = (layer: HTMLElement, at: MarkupAt): { node: Node; offset: number } | null => {
  layer.style.pointerEvents = "none";
  const position = document.caretPositionFromPoint?.(at.x, at.y), range = position ? null : document.caretRangeFromPoint?.(at.x, at.y);
  layer.style.pointerEvents = "";
  const node = position?.offsetNode ?? range?.startContainer, offset = position?.offset ?? range?.startOffset ?? 0;
  return node && !layer.contains(node) && !(node instanceof HTMLInputElement || node instanceof HTMLTextAreaElement) ? { node, offset } : null;
};
/** From one caret to another, whichever comes first; null when they are in different documents or shadow roots. */
const rangeBetween = (a: { node: Node; offset: number }, b: { node: Node; offset: number }) => {
  try {
    const range = document.createRange();
    range.setStart(a.node, a.offset);
    if (range.comparePoint(b.node, b.offset) < 0) range.setStart(b.node, b.offset); else range.setEnd(b.node, b.offset);
    return range;
  } catch { return null; }
};
/** A press with no drag takes the word it is on. */
const wordAt = (at: { node: Node; offset: number }) => {
  if (!(at.node instanceof Text)) return null;
  const text = at.node.data;
  let start = at.offset, end = at.offset;
  while (start > 0 && /\S/.test(text[start - 1]!)) start--;
  while (end < text.length && /\S/.test(text[end]!)) end++;
  return start < end ? rangeBetween({ node: at.node, offset: start }, { node: at.node, offset: end }) : null;
};
// The text's own lines, not the boxes of the elements it runs through (which a range's own rects include). Kept for when the app redraws the text away.
const lastLines = new WeakMap<Range, MarkupBox[]>();
const linesOf = (range: Range): MarkupBox[] => {
  const lines: MarkupBox[] = [];
  const walker = document.createTreeWalker(range.commonAncestorContainer, NodeFilter.SHOW_TEXT);
  let node: Node | null = range.startContainer instanceof Text ? range.startContainer : (walker.currentNode = range.startContainer, walker.nextNode());
  for (let count = 0; node && count < QUOTE_NODES; node = walker.nextNode(), count++) {
    if (range.comparePoint(node, 0) > 0) break;
    if (!range.intersectsNode(node)) continue;
    const part = document.createRange();
    part.selectNodeContents(node);
    if (node === range.startContainer) part.setStart(node, range.startOffset);
    if (node === range.endContainer) part.setEnd(node, range.endOffset);
    for (const rect of part.getClientRects()) if (rect.width && rect.height) lines.push({ left: rect.left, top: rect.top, width: rect.width, height: rect.height });
  }
  if (lines.length) lastLines.set(range, lines);
  return lines.length ? lines : lastLines.get(range) ?? [];
};

/** A run of the page's text as a place: the range follows the page. With no text drawn (an empty line) its box is the element that holds it. */
export const textPlace = (range: Range): MarkupPlace => {
  const holder = range.commonAncestorContainer instanceof Element ? range.commonAncestorContainer : range.commonAncestorContainer.parentElement;
  return { text: range.toString(), element: holder ?? undefined, boxes: () => { const lines = linesOf(range); return lines.length || !holder ? lines : [holder.getBoundingClientRect()]; } };
};
/** The text from one point to another, under the tool's layer (`to` null: the word at `from`); null where there is no text there. */
export const textAt = (layer: HTMLElement, from: MarkupAt, to: MarkupAt | null) => {
  const start = caretAt(layer, from), end = to && caretAt(layer, to);
  const range = !start || (to && !end) ? null : end ? rangeBetween(start, end) : wordAt(start);
  return range && !range.collapsed ? textPlace(range) : null;
};
