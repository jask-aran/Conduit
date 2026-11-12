/*
 * How a site's pane talks to the site in its frame. The frame is sandboxed with no origin of its own, so the site's
 * scripts can reach neither Conduit's page nor the hub as the person; the pane can then only ask it by message. A few
 * lines of script are put after the site's own HTML: they say where the site is scrolled (the next version of the
 * file opens where this one was being read) and what lies in a box of it (a mark drawn over the frame then names the
 * elements under it, which is how an agent finds them in the file). The site's own scripts can say the same things in
 * its place; all that is believed is a pair of numbers and some text for the comment.
 */
type Said = { scroll?: unknown; n?: unknown; under?: unknown };
type Box = { left: number; top: number; width: number; height: number };

/** How long the frame has to answer: a site whose HTML swallowed the script (an unclosed tag) never does. */
const ANSWER_MS = 400;
const script = (scroll: [number, number]) => `<script>(() => {
  const say = (message) => parent.postMessage({ conduitSite: message }, "*"), at = ${JSON.stringify(scroll)}, back = () => scrollTo(at[0], at[1]);
  addEventListener("DOMContentLoaded", back); addEventListener("load", back);
  let told = 0;
  addEventListener("scroll", () => { cancelAnimationFrame(told); told = requestAnimationFrame(() => say({ scroll: [scrollX, scrollY] })); }, { passive: true });
  const one = (el) => el.tagName.toLowerCase() + (el.id ? "#" + el.id : "") + [...el.classList].slice(0, 3).map((name) => "." + name).join("");
  const path = (el) => [el.parentElement && el.parentElement !== document.body ? one(el.parentElement) : null, one(el)].filter(Boolean).join(" > ");
  addEventListener("message", (event) => {
    const ask = event.source === parent && event.data && event.data.conduitSite;
    if (!ask || !ask.under) return;
    const { left, top, width, height } = ask.under, seen = new Set();
    for (let x = 0; x <= 4; x += 1) for (let y = 0; y <= 4; y += 1) { const el = document.elementFromPoint(left + width * x / 4, top + height * y / 4); if (el && el !== document.documentElement && el !== document.body) seen.add(el); }
    const inner = [...seen].filter((el) => ![...seen].some((other) => other !== el && el.contains(other))).slice(0, 8);
    say({ n: ask.n, under: inner.map((el) => [path(el), String(el.innerText || el.getAttribute("alt") || "").replace(/\\s+/g, " ").trim().slice(0, 160)]) });
  });
})()</script>`;

/** `frame`: the site's frame, once it is drawn. */
export function siteBridge(frame: () => HTMLIFrameElement | undefined) {
  let scroll: [number, number] = [0, 0], asked = 0;
  const waiting = new Map<number, (found: Record<string, string> | null) => void>();
  const heard = (event: MessageEvent) => {
    const said = event.source && event.source === frame()?.contentWindow ? (event.data as { conduitSite?: Said } | null)?.conduitSite : null;
    if (!said) return;
    if (Array.isArray(said.scroll)) scroll = [Number(said.scroll[0]) || 0, Number(said.scroll[1]) || 0];
    if (typeof said.n !== "number" || !Array.isArray(said.under)) return;
    const found = said.under.slice(0, 8).flatMap((entry) => Array.isArray(entry) && typeof entry[0] === "string" ? [{ element: entry[0].slice(0, 200), text: String(entry[1] ?? "").slice(0, 160) }] : []);
    waiting.get(said.n)?.(found.length ? { elements: found.map((one) => one.text ? `${one.element} “${one.text}”` : one.element).join("; ") } : null);
  };
  window.addEventListener("message", heard);
  return {
    /** What the frame is given for this HTML (its `srcdoc`): the site, then the script, opening where the last one was scrolled to. */
    document: (html: string) => `${html}\n${script(scroll)}`,
    /** The elements of the site in a box of the window, as the site names them (`section#plans > h2 “Plans”`); null where the box is off the frame or the site does not answer. */
    under(box: Box): Promise<Record<string, string> | null> {
      const element = frame(), target = element?.contentWindow;
      if (!element || !target) return Promise.resolve(null);
      const edge = element.getBoundingClientRect(), n = (asked += 1);
      return new Promise((resolve) => {
        const done = (found: Record<string, string> | null) => { clearTimeout(late); waiting.delete(n); resolve(found); };
        const late = setTimeout(done, ANSWER_MS, null);
        waiting.set(n, done);
        target.postMessage({ conduitSite: { n, under: { left: box.left - edge.left, top: box.top - edge.top, width: box.width, height: box.height } } }, "*");
      });
    },
    close: () => window.removeEventListener("message", heard),
  };
}
