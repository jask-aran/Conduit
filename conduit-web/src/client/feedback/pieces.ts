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

const shown = (element: Element) => element.checkVisibility?.({ checkOpacity: true, checkVisibilityCSS: true }) !== false;
/** Down from what the pointer hits to what is drawn there: a control that ignores the pointer (a disabled button) is passed over by the hit test, and is still what is on the page. */
const drawnAt = (element: Element, x: number, y: number): Element => {
  for (const child of [...element.children].reverse()) {
    const bounds = child.getBoundingClientRect();
    if (bounds.width && bounds.height && x >= bounds.left && x <= bounds.right && y >= bounds.top && y <= bounds.bottom && shown(child)) return drawnAt(child, x, y);
  }
  return element;
};
/** What is under a point, the tool's own layer aside. */
export const under = (x: number, y: number) => { const hit = document.elementsFromPoint(x, y).find((element) => !element.closest(OWN)); return hit ? drawnAt(hit, x, y) : null; };

type Box = { left: number; top: number; width: number; height: number };
type Edges = { left: number; top: number; right: number; bottom: number };
/** A piece with this much of what shows of it inside the box is mostly inside, so a drag need not be exact (half: a box 6px short of a 36px button on two sides still has it). */
const MOSTLY = 0.5;
/** A piece with this much of it inside the box is wholly inside, near enough. */
const WHOLLY = 0.9;
/** A box that runs the height or width of a piece is across it when it has this much of it. */
const ACROSS = 0.25;
/** A piece thinner than this (px) is a rule between pieces: a drag across several does not mean it. */
const HAIRLINE = 4;
const meet = (a: Edges, b: Edges): Edges => ({ left: Math.max(a.left, b.left), top: Math.max(a.top, b.top), right: Math.min(a.right, b.right), bottom: Math.min(a.bottom, b.bottom) });
const area = (edges: Edges) => Math.max(0, edges.right - edges.left) * Math.max(0, edges.bottom - edges.top);

/**
 * What a drag locks onto. A piece wholly inside the box is taken as it is. A piece partly inside is looked into
 * first: it is taken itself when it is mostly inside and the box has every piece in it (or it has none), and gives
 * the pieces of it the box has otherwise, so a drag round two of three tiles is the two tiles and a drag a little
 * short of a button is the button. Only what shows counts: what a scroller clips or another layer covers is not
 * there. A box that holds no piece (a drag inside one) is the smallest piece that holds the box, or the pieces of
 * that one it runs across when there are several.
 */
export function piecesWithin(box: Box): Element[] {
  const drag: Edges = { left: box.left, top: box.top, right: box.left + box.width, bottom: box.top + box.height };
  if (!area(drag)) return [];
  const view: Edges = { left: 0, top: 0, right: innerWidth, bottom: innerHeight };
  const solid = (found: Element[]) => { const kept = found.filter((element) => { const bounds = element.getBoundingClientRect(); return Math.min(bounds.width, bounds.height) >= HAIRLINE; }); return kept.length ? kept : found; };
  const uncovered = (element: Element, showing: Edges) => {
    const inside = meet(showing, drag);
    const top = under((inside.left + inside.right) / 2, (inside.top + inside.bottom) / 2);
    return !top || element.contains(top) || top.contains(element);
  };
  // Under a root: `piece` is called with each outermost piece that shows and says what of it to keep; a sized box wholly outside `within` is not walked.
  const walk = (root: Element, clip: Edges, within: Edges, piece: (element: Element, showing: Edges, clip: Edges) => Element[]): Element[] => [...root.children].flatMap((element) => {
    if (element.matches(OWN) || !shown(element)) return [];
    const bounds = element.getBoundingClientRect();
    const sized = bounds.width > 0 && bounds.height > 0;
    const showing = sized ? meet(bounds, clip) : clip;
    // One with no size may hold positioned children.
    if (sized && !area(meet(showing, within))) return [];
    const inner = sized && getComputedStyle(element).overflow !== "visible" ? showing : clip;
    return sized && pieceOf(element) ? piece(element, showing, inner) : walk(element, inner, within, piece);
  });
  const gather = (element: Element, showing: Edges, clip: Edges): Element[] => {
    const part = area(meet(showing, drag)) / area(showing);
    if (part >= WHOLLY) return uncovered(element, showing) ? [element] : [];
    const taken = solid(walk(element, clip, drag, gather));
    if (part < MOSTLY || !uncovered(element, showing)) return taken;
    return solid(walk(element, clip, view, (inside) => [inside])).every((inside) => taken.includes(inside)) ? [element] : taken;
  };
  const gathered = solid(walk(document.body, view, drag, gather));
  if (gathered.length) return gathered;
  // A drag inside a piece: outward from the piece at its middle to the first that holds the box.
  let holder = pieceRoot(under((drag.left + drag.right) / 2, (drag.top + drag.bottom) / 2));
  while (holder && area(meet(holder.getBoundingClientRect(), drag)) < WHOLLY * area(drag)) holder = pieceRoot(holder.parentElement);
  if (!holder) return [];
  // A box across part of several of its pieces (the right half of three rows) means those: each one the box runs the height or the width of.
  const crossed = solid(walk(holder, view, drag, (inside, showing) => {
    const within = meet(showing, drag);
    return Math.max((within.right - within.left) / (showing.right - showing.left), (within.bottom - within.top) / (showing.bottom - showing.top)) >= WHOLLY && area(within) >= ACROSS * area(showing) && uncovered(inside, showing) ? [inside] : [];
  }));
  return crossed.length > 1 ? crossed : [holder];
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
