import katex from "katex";

/**
 * Draw a formula still arriving by patching the DOM from KaTeX's own render
 * tree, not from its markup.
 *
 * Each token re-renders the whole formula. Almost all of the new rendering is
 * the old one: the same spans with the same classes, a few inline heights
 * changed, a row or a symbol added at the tail. Replacing innerHTML rebuilt
 * every box; morphing the markup (morph-html.ts) still parsed the whole string
 * and walked the whole DOM through its accessors on every token, which in a
 * headed browser was most of a frame for a long aligned block. KaTeX builds a
 * plain tree before it writes markup, so consecutive partials are compared as
 * plain objects and only what differs is written.
 *
 * `__renderToDomTree` and `__domTree` are KaTeX exports, underscored because
 * their shape is KaTeX's own; the settled formula still goes through
 * renderToString, so a change there costs smoothness, never correctness.
 */
type TreeNode = {
  children?: TreeNode[];
  classes?: string[];
  style?: Record<string, string>;
  attributes?: Record<string, string>;
  toNode(): Node;
  toMarkup(): string;
};

const domTree = (katex as unknown as { __domTree: { Span: new () => TreeNode; Anchor: new () => TreeNode } }).__domTree;
const renderToDomTree = (katex as unknown as { __renderToDomTree: (tex: string, options: object) => TreeNode }).__renderToDomTree;

export function renderMathTree(tex: string, displayMode: boolean): TreeNode | null {
  try {
    return renderToDomTree(tex, { displayMode, throwOnError: true, output: "html" });
  } catch {
    return null;
  }
}

/** Bring `host`, last drawn from `previous`, to `next`. */
export function patchMathTree(host: Element, previous: TreeNode | null, next: TreeNode) {
  if (!previous || host.childNodes.length !== 1) {
    host.replaceChildren(next.toNode());
    return;
  }
  patchNode(host, host.firstChild!, previous, next);
}

const isElement = (node: TreeNode) => (node as object) instanceof domTree.Span || (node as object) instanceof domTree.Anchor;
// A fragment's children are appended flat, so they are compared flat.
const isFragment = (node: TreeNode) => !isElement(node) && Array.isArray(node.children) && !("attributes" in node);

function flatten(children: TreeNode[] | undefined, into: TreeNode[] = []) {
  for (const child of children || []) {
    if (isFragment(child)) flatten(child.children, into);
    else into.push(child);
  }
  return into;
}

const markup = new WeakMap<TreeNode, string>();
function markupOf(node: TreeNode) {
  let value = markup.get(node);
  if (value === undefined) {
    value = node.toMarkup();
    markup.set(node, value);
  }
  return value;
}

const sameClasses = (left: string[] = [], right: string[] = []) =>
  left.length === right.length && left.every((name, index) => name === right[index]);

function patchNode(parent: Node, dom: Node, previous: TreeNode, next: TreeNode) {
  if (isElement(next) && isElement(previous) && previous.constructor === next.constructor && dom.nodeType === Node.ELEMENT_NODE) {
    const element = dom as HTMLElement;
    if (!sameClasses(previous.classes, next.classes)) element.className = (next.classes || []).filter(Boolean).join(" ");
    const before = previous.style || {};
    const after = next.style || {};
    const style = element.style as unknown as Record<string, string>;
    for (const key in after) if (before[key] !== after[key]) style[key] = after[key]!;
    for (const key in before) if (!(key in after)) style[key] = "";
    const was = previous.attributes || {};
    const is = next.attributes || {};
    for (const key in is) if (was[key] !== is[key]) element.setAttribute(key, is[key]!);
    for (const key in was) if (!(key in is)) element.removeAttribute(key);
    patchChildren(element, flatten(previous.children), flatten(next.children));
    return;
  }
  if (!isElement(next) && !isElement(previous) && previous.constructor === next.constructor && markupOf(previous) === markupOf(next)) return;
  parent.replaceChild(next.toNode(), dom);
}

function patchChildren(element: Element, previous: TreeNode[], next: TreeNode[]) {
  const nodes = element.childNodes;
  // Drawn by someone else since: start this element afresh.
  if (nodes.length !== previous.length) {
    element.replaceChildren(...next.map((child) => child.toNode()));
    return;
  }
  const shared = Math.min(previous.length, next.length);
  for (let index = 0; index < shared; index += 1) patchNode(element, nodes[index]!, previous[index]!, next[index]!);
  for (let index = shared; index < next.length; index += 1) element.appendChild(next[index]!.toNode());
  while (nodes.length > next.length) element.removeChild(element.lastChild!);
}
