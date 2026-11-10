import names from "virtual:ui-pieces";

/*
 * Naming what is on the page (the feedback tool): an element is the root of a library piece when it says so
 * (`data-piece`) or carries a piece's own class; the names, sources and stylesheets come from the library's source
 * (scripts/ui-pieces.mjs), so nothing here lists pieces.
 */

const ANCHORS = ["data-region", "data-tool", "data-surface", "data-tab", "data-doc-view", "data-pane"];
/** The tool's own layer: never what is under the pointer. */
const OWN = ".ui-feedback-layer";

/** The piece an element is the root of, the outermost when it is drawn through others (TreeRow, not Row); null for a part or plain markup. */
export function pieceOf(element: Element): string | null {
  const said = element.getAttribute("data-piece");
  if (said) return said;
  const roots = [...element.classList].map((name) => names.classes[name]).filter((entry) => entry && !entry.part).map((entry) => entry!.piece);
  if (!roots.length) return null;
  const inner = new Set<string>();
  for (const root of roots) for (let wrapped = names.pieces[root]?.wraps; wrapped && !inner.has(wrapped); wrapped = names.pieces[wrapped]?.wraps) inner.add(wrapped);
  return roots.find((root) => !inner.has(root)) ?? roots[0]!;
}

/** The nearest piece root at or above an element. */
export function pieceRoot(element: Element | null): Element | null {
  for (let node = element; node && node !== document.documentElement; node = node.parentElement) if (pieceOf(node)) return node;
  return null;
}

/** What is under a point, the tool's own layer aside. */
export const under = (x: number, y: number) => document.elementsFromPoint(x, y).find((element) => !element.closest(OWN)) ?? null;

type Box = { left: number; top: number; width: number; height: number };
type Edges = { left: number; top: number; right: number; bottom: number };
/** A drag takes a piece when this much of what shows of it is inside the box, so a drag need not be exact. */
const MOSTLY = 0.6;
const meet = (a: Edges, b: Edges): Edges => ({ left: Math.max(a.left, b.left), top: Math.max(a.top, b.top), right: Math.min(a.right, b.right), bottom: Math.min(a.bottom, b.bottom) });
const area = (edges: Edges) => Math.max(0, edges.right - edges.left) * Math.max(0, edges.bottom - edges.top);
const shown = (element: Element) => element.checkVisibility?.({ checkOpacity: true, checkVisibilityCSS: true }) !== false;

/**
 * What a drag locks onto. The outermost pieces mostly inside the box, as far as they show (what a scroller clips or
 * another layer covers is not there); when those are all the pieces of the piece around them, that one piece; and
 * when the box holds no piece (a drag inside one), the smallest piece that holds the box.
 */
export function piecesWithin(box: Box): Element[] {
  const drag: Edges = { left: box.left, top: box.top, right: box.left + box.width, bottom: box.top + box.height };
  if (!area(drag)) return [];
  const view: Edges = { left: 0, top: 0, right: innerWidth, bottom: innerHeight };
  // The outermost pieces under a root that `take` accepts, given what shows of each; nothing wholly outside `within` is walked.
  const walk = (root: Element, clip: Edges, within: Edges, take: (showing: Edges) => boolean, found: Element[]) => {
    for (const element of root.children) {
      if (element.matches(OWN) || !shown(element)) continue;
      const bounds = element.getBoundingClientRect();
      const sized = bounds.width > 0 && bounds.height > 0;
      const showing = sized ? meet(bounds, clip) : clip;
      if (sized && pieceOf(element) && area(showing) && take(showing)) { found.push(element); continue; }
      // A sized box outside it holds nothing in it; one with no size may hold positioned children.
      if (sized && !area(meet(showing, within))) continue;
      walk(element, sized && getComputedStyle(element).overflow !== "visible" ? showing : clip, within, take, found);
    }
    return found;
  };
  const uncovered = (element: Element, showing: Edges) => {
    const inside = meet(showing, drag);
    const top = under((inside.left + inside.right) / 2, (inside.top + inside.bottom) / 2);
    return !top || element.contains(top) || top.contains(element);
  };
  const gathered = walk(document.body, view, drag, (showing) => area(meet(showing, drag)) >= MOSTLY * area(showing), []).filter((element) => uncovered(element, meet(element.getBoundingClientRect(), view)));
  if (!gathered.length) {
    // A drag inside a piece: outward from the piece at its middle to the first that holds most of the box.
    let holder = pieceRoot(under((drag.left + drag.right) / 2, (drag.top + drag.bottom) / 2));
    while (holder && area(meet(holder.getBoundingClientRect(), drag)) < 0.9 * area(drag)) holder = pieceRoot(holder.parentElement) ?? null;
    return holder ? [holder] : [];
  }
  if (gathered.length < 2) return gathered;
  // Every piece of the piece around them: the drag means that piece.
  let around = pieceRoot(gathered[0]!.parentElement);
  while (around && !gathered.every((element) => around!.contains(element))) around = pieceRoot(around.parentElement);
  if (!around) return gathered;
  const all = walk(around, view, view, () => true, []);
  return all.length === gathered.length && all.every((element) => gathered.includes(element)) ? [around] : gathered;
}

const short = (text: string, length: number) => text.length > length ? `${text.slice(0, length - 1)}…` : text;
const label = (element: Element) => short((element.getAttribute("aria-label") || element.getAttribute("title") || (element as HTMLElement).innerText || element.textContent || "").replace(/\s+/g, " ").trim(), 120);
const step = (element: Element) => {
  const marks = ANCHORS.filter((name) => element.hasAttribute(name)).map((name) => `[${name}="${element.getAttribute(name)}"]`).join("");
  const classes = [...element.classList].slice(0, 3).map((name) => `.${CSS.escape(name)}`).join("");
  return `${element.tagName.toLowerCase()}${element.id ? `#${CSS.escape(element.id)}` : ""}${classes}${marks}`;
};

/** A CSS path to an element from the nearest anchored ancestor (or the body), with :nth-of-type where a step is not alone. */
export function domPath(element: Element): string {
  const steps: string[] = [];
  for (let node: Element | null = element; node && node !== document.body && steps.length < 12; node = node.parentElement) {
    const own = step(node);
    const twins = node.parentElement ? [...node.parentElement.children].filter((sibling) => sibling.tagName === node!.tagName) : [];
    steps.unshift(twins.length > 1 ? `${own}:nth-of-type(${twins.indexOf(node) + 1})` : own);
    if (node !== element && node.hasAttribute("data-region")) break;
  }
  return steps.join(" > ");
}

export type Described = ReturnType<typeof describe>;

/** One element as a feedback item states it: enough for an agent with nothing else to find its code. */
export function describe(element: Element) {
  const piece = pieceOf(element);
  const info = piece ? names.pieces[piece] : undefined;
  const partOf = piece ? null : [...element.classList].map((name) => names.classes[name]).find((entry) => entry?.part)?.piece ?? null;
  const classes = [...element.classList].filter((name) => names.classes[name]);
  // The pieces it sits in, outermost first, each once in a row.
  const within: { piece: string; source?: string }[] = [];
  for (let node = element.parentElement; node && node !== document.documentElement; node = node.parentElement) {
    const name = pieceOf(node);
    if (name && within[0]?.piece !== name) within.unshift({ piece: name, source: names.pieces[name]?.source });
  }
  const anchors: Record<string, string> = {};
  for (let node: Element | null = element; node; node = node.parentElement)
    for (const name of ANCHORS) if (node.hasAttribute(name) && !(name in anchors)) anchors[name] = node.getAttribute(name) ?? "";
  const region = anchors["data-region"];
  const rect = element.getBoundingClientRect();
  const attributes: Record<string, string> = {};
  for (const attribute of element.attributes) if (/^(data-|aria-|role$|type$|href$|disabled$)/.test(attribute.name)) attributes[attribute.name] = short(attribute.value, 120);
  const html = element.outerHTML;
  return {
    component: piece ?? (partOf ? `${partOf} (part)` : null),
    source: info?.source ?? (partOf ? names.pieces[partOf]?.source : undefined) ?? null,
    // The same root class is another piece's too, or pieces with no class of their own draw through this one.
    ...(piece && classes.some((name) => names.classes[name]?.also) ? { orComponent: classes.flatMap((name) => names.classes[name]?.also ?? []) } : {}),
    ...(info?.through ? { maybeDrawnBy: info.through } : {}),
    styles: [...new Set(classes.flatMap((name) => names.styles[name] ?? []))],
    classes: [...element.classList],
    within,
    anchors,
    ...(region && names.anchors[`data-region=${region}`] ? { regionSource: names.anchors[`data-region=${region}`] } : {}),
    label: label(element),
    domPath: domPath(element),
    attributes,
    rect: { left: Math.round(rect.left), top: Math.round(rect.top), width: Math.round(rect.width), height: Math.round(rect.height) },
    html: html.length > 1600 ? `${html.slice(0, 1600)}… (${html.length} characters)` : html,
  };
}

/** A selection's name on its mark and note: the piece, or for several the pieces counted ("3 pieces: IconButton ×3"). */
export function nameOf(elements: Element[]): string {
  if (elements.length === 1) return pieceOf(elements[0]!) ?? elements[0]!.tagName.toLowerCase();
  const counts = new Map<string, number>();
  for (const element of elements) { const name = pieceOf(element) ?? element.tagName.toLowerCase(); counts.set(name, (counts.get(name) ?? 0) + 1); }
  return `${elements.length} pieces: ${[...counts].map(([name, count]) => count > 1 ? `${name} ×${count}` : name).join(", ")}`;
}

export const sourceOf = (element: Element) => { const piece = pieceOf(element); return piece ? names.pieces[piece]?.source : undefined; };
