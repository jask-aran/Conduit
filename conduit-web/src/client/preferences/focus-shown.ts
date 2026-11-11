/*
 * Not `:has(:focus-visible)`: a :has() whose argument is a pseudo-class cannot be narrowed by Chrome, so every DOM
 * change re-checks ancestors, which a streaming answer does every frame.
 */
const HOSTS: ReadonlyArray<[host: string, focus: string]> = [
  [".ui-row[data-density=nav]", ":focus-visible"],
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
