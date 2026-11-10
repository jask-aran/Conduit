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

/** Every piece root wholly inside a box, the outermost only: what a drag gathers. */
export function piecesWithin(box: { left: number; top: number; width: number; height: number }): Element[] {
  const right = box.left + box.width, bottom = box.top + box.height;
  const inside: Element[] = [];
  const visit = (element: Element) => {
    if (element.matches(OWN)) return;
    const rect = element.getBoundingClientRect();
    // Nothing of it is in the box: nor is anything inside it worth the walk, unless it overflows (cheap to allow).
    if (rect.width && rect.height && rect.left >= box.left && rect.top >= box.top && rect.right <= right && rect.bottom <= bottom && pieceOf(element)) {
      if (element.checkVisibility?.({ checkOpacity: true, checkVisibilityCSS: true }) !== false) inside.push(element);
      return;
    }
    for (const child of element.children) visit(child);
  };
  visit(document.body);
  return inside;
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
