import { ANSWER_MARKDOWN } from "@/components/ui/shared";
import katex from "katex";
import { streamFadeMs } from "@/client/preferences/stream-fade";

/* A formula still arriving is patched from KaTeX's render tree, not its markup: morphing markup still parses the whole
   string and walks the whole DOM every token. `__renderToDomTree` and `__domTree` are KaTeX's own shape; the settled
   formula still goes through renderToString, so a change there costs smoothness, never correctness. */
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

/* The class comes off once the fade has run: left on, every finished fade is still an animation in effect, and a long
   answer's hundreds of them make each style pass resolve thousands of KaTeX spans again. */
export const MATH_FADE_CLASS = ANSWER_MARKDOWN.math;
let faded: Array<[Element, number]> = [];
let fadedTimer: ReturnType<typeof setTimeout> | null = null;

function clearFaded() {
  fadedTimer = null;
  const cutoff = performance.now() - streamFadeMs() - 50;
  let done = 0;
  while (done < faded.length && faded[done]![1] <= cutoff) faded[done++]![0].classList.remove(MATH_FADE_CLASS);
  faded = faded.slice(done);
  if (faded.length) fadedTimer = setTimeout(clearFaded, faded[0]![1] - cutoff);
}

export function markFadeIn(element: Element | null | undefined) {
  if (!element) return;
  element.classList.add(MATH_FADE_CLASS);
  faded.push([element, performance.now()]);
  fadedTimer ??= setTimeout(clearFaded, streamFadeMs() + 50);
}

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
