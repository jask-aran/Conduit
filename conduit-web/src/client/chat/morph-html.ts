/**
 * Bring an element's content to `html` by editing what is already there.
 *
 * A formula still arriving is re-rendered by KaTeX on every token, and almost
 * all of each new rendering is the same as the last: same spans, same inline
 * styles, a few changed at the tail. Replacing the element's innerHTML threw
 * all of it away, so every token restyled and relaid thousands of new boxes
 * (~12ms for a long aligned block). Walking the new markup against the old and
 * touching only what differs leaves the unchanged boxes clean (~3ms).
 */
const template = typeof document === "undefined" ? null : document.createElement("template");

export function morphHtml(element: Element, html: string) {
  if (!template || !html || !element.firstChild) {
    element.innerHTML = html;
    return;
  }
  template.innerHTML = html;
  morphChildren(element, template.content);
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
