import { CODE_BLOCK } from "@/components/ui/shared";
/* A formula still arriving is re-rendered by KaTeX on every token, almost all of it the same as the last; replacing
   innerHTML would restyle and relay thousands of boxes each token, so only what differs is touched. */
const template = typeof document === "undefined" ? null : document.createElement("template");

export function morphHtml(element: Element, html: string) {
  if (!template || !html || !element.firstChild) {
    element.innerHTML = html;
    return;
  }
  template.innerHTML = html;
  morphChildren(element, template.content);
}

// A code block's children are its lines, one element apiece.
const renderedLines = new WeakMap<Element, string[]>();

/* A streaming fence gains a line or two a delivery; parsing and walking all of a long file's lines to find them is
   most of each delivery's work. */
const PLAIN_LINE = new RegExp(`^<span class="${CODE_BLOCK.line}">([^<]*)</span>$`);
const ENTITIES: Record<string, string> = { lt: "<", gt: ">", amp: "&", quot: "\"", "#x27": "'", "#39": "'", nbsp: "\u00a0" };
const unescapeText = (html: string) => {
  if (!html.includes("&")) return html;
  let known = true;
  const text = html.replace(/&([#\w]+);/g, (match, name: string) => ENTITIES[name] ?? ((known = false), match));
  return known && !/&(?![#\w]+;)/.test(html) ? text : null;
};

export function morphLines(element: Element, lines: string[]) {
  const previous = renderedLines.get(element);
  renderedLines.set(element, lines);
  // Anything else having changed the children, they are brought to the lines whole.
  if (!template || !previous || element.childNodes.length !== previous.length) {
    morphHtml(element, lines.join(""));
    return;
  }
  const children = element.childNodes;
  for (let index = 0; index < lines.length; index += 1) {
    // The strings first: reading a child for every line of a long file, every delivery, is most of the cost.
    if (previous[index] === lines[index]) continue;
    const existing = children[index];
    // A line with no highlighting yet -- the one being written -- has its text set, not parsed.
    const plain = PLAIN_LINE.exec(lines[index]!);
    const text = plain ? unescapeText(plain[1]!) : null;
    if (text != null && existing?.nodeType === Node.ELEMENT_NODE && (existing as Element).className === CODE_BLOCK.line
      && existing.childNodes.length <= 1 && existing.firstChild?.nodeType !== Node.ELEMENT_NODE) {
      if (!text) existing.firstChild?.remove();
      else if (existing.firstChild) (existing.firstChild as Text).data = text;
      else existing.appendChild(document.createTextNode(text));
      continue;
    }
    template.innerHTML = lines[index]!;
    const incoming = template.content.firstChild;
    if (!incoming) continue;
    if (!existing) element.appendChild(incoming);
    else if (existing.nodeType === Node.ELEMENT_NODE && incoming.nodeType === Node.ELEMENT_NODE
      && (existing as Element).tagName === (incoming as Element).tagName) morphChildren(existing, incoming);
    else element.replaceChild(incoming, existing);
  }
  while (element.childNodes.length > lines.length) element.removeChild(element.lastChild!);
}

function morphChildren(from: Node, to: Node) {
  const current = from.childNodes;
  const next = Array.from(to.childNodes);
  for (let index = 0; index < next.length; index += 1) {
    const incoming = next[index]!;
    const existing = current[index];
    if (!existing) {
      from.appendChild(incoming);
      continue;
    }
    if (existing.nodeType !== incoming.nodeType
      || (existing.nodeType === Node.ELEMENT_NODE && (existing as Element).tagName !== (incoming as Element).tagName)) {
      from.replaceChild(incoming, existing);
      continue;
    }
    if (existing.nodeType === Node.TEXT_NODE) {
      if ((existing as Text).data !== (incoming as Text).data) (existing as Text).data = (incoming as Text).data;
      continue;
    }
    if (existing.nodeType !== Node.ELEMENT_NODE) continue;
    const target = existing as Element;
    const source = incoming as Element;
    for (const { name, value } of Array.from(source.attributes)) {
      if (target.getAttribute(name) !== value) target.setAttribute(name, value);
    }
    for (const { name } of Array.from(target.attributes)) {
      if (!source.hasAttribute(name)) target.removeAttribute(name);
    }
    morphChildren(target, source);
  }
  while (current.length > next.length) from.removeChild(from.lastChild!);
}
