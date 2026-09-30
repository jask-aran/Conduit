/*
 * Mark the row that holds visible focus, for the stylesheet.
 *
 * `.sidebar-row:has(:focus-visible)` said this in CSS, but a :has() whose
 * argument is a pseudo-class, attribute or tag cannot be narrowed by Chrome:
 * every DOM change anywhere made it re-check ancestors. A streaming answer
 * changes the DOM every frame, and those checks were most of each frame's
 * style work late in a long one. One focus listener says the same thing.
 */
const HOSTS: ReadonlyArray<[host: string, focus: string]> = [
  [".sidebar-row", ":focus-visible"],
  [".settings-line", ":focus-visible, input:focus"],
];
const ATTRIBUTE = "data-focus-shown";
let marked: Element[] = [];
let installed = false;

function clear() {
  for (const element of marked) element.removeAttribute(ATTRIBUTE);
  marked = [];
}

export function installFocusShown(root: Document = document) {
  if (installed) return;
  installed = true;
  root.addEventListener("focusin", (event) => {
    clear();
    const target = event.target;
    if (!(target instanceof Element)) return;
    for (const [host, focus] of HOSTS) {
      if (!target.matches(focus)) continue;
      // Every enclosing host, as :has() matched every ancestor row.
      for (let at = target.closest(host); at; at = at.parentElement?.closest(host) ?? null) {
        at.setAttribute(ATTRIBUTE, "");
        marked.push(at);
      }
    }
  }, true);
  root.addEventListener("focusout", clear, true);
}
