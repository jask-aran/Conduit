import { createEffect, createMemo, createSignal, Index, on, onCleanup, onMount, Show, type JSX } from "solid-js";

type Kind = "row" | "title" | "gap";
const OVER = 4;

/**
 * A long list drawn only where it shows: its rows are made for the window in view (and a few past it), and each slot is kept and given the
 * next entry when the list or the scroll changes, so typing into a filter or stepping past the fold re-creates nothing. Rows are one
 * height, titles another; both are read off the first drawn. It sits inside its scroller (its parent). `reveal` is an index kept in view.
 */
export function Windowed<T>(props: { items: T[]; title: (item: T) => string | undefined; row: (item: () => T) => JSX.Element; reveal?: number; control?: (api: { pageRows: () => number }) => void }) {
  let box!: HTMLDivElement;
  const [heights, setHeights] = createSignal<Record<Kind, number>>({ row: 32, title: 34, gap: 38 });
  const [top, setTop] = createSignal(0);
  const [view, setView] = createSignal(640);
  const kind = (item: T, index: number): Kind => props.title(item) === undefined ? "row" : index ? "gap" : "title";
  const tops = createMemo(() => {
    const at: number[] = [], size = heights();
    let y = 0;
    props.items.forEach((item, index) => { at.push(y); y += size[kind(item, index)]; });
    at.push(y);
    return at;
  });
  const range = createMemo(() => {
    const at = tops(), from = top(), to = from + view(), last = at.length - 1;
    let start = 0;
    while (start < last && at[start + 1]! <= from) start++;
    let end = start;
    while (end < last && at[end]! < to) end++;
    return [Math.max(0, start - OVER), Math.min(last, end + OVER)] as const;
  });
  const slice = createMemo(() => props.items.slice(...range()));
  const scroller = () => box.parentElement!;
  // The list's padding over the window, read with the heights: the scroll's own events say where it is, so nothing here reads layout.
  let pad = 0, now = 0;
  const read = () => { now = scroller().scrollTop; setTop(Math.max(0, now - pad)); setView(scroller().clientHeight); };
  onMount(() => {
    scroller().addEventListener("scroll", read, { passive: true });
    onCleanup(() => scroller().removeEventListener("scroll", read));
    const frame = requestAnimationFrame(() => {
      pad = box.offsetTop;
      read();
      const size = { ...heights() };
      let seen = false;
      for (const element of box.firstElementChild!.children) {
        const which: Kind = element.hasAttribute("data-title") ? element.hasAttribute("data-gap") ? "gap" : "title" : "row";
        size[which] = which === "row" ? Math.max(seen ? size.row : 0, (element as HTMLElement).offsetHeight) : (element as HTMLElement).offsetHeight;
        if (which === "row") seen = true;
      }
      if (Object.entries(size).some(([key, value]) => heights()[key as Kind] !== value)) setHeights(size);
    });
    onCleanup(() => cancelAnimationFrame(frame));
  });
  props.control?.({ pageRows: () => Math.max(1, Math.floor(view() / heights().row) - 1) });
  createEffect(on(() => [props.reveal, tops()] as const, ([index, at]) => {
    if (index === undefined || index < 0 || index >= at.length - 1) return;
    const from = at[index]! + pad, to = at[index + 1]! + pad;
    // A row under a title brings the title along when it is the first.
    const want = index <= 1 ? 0 : from < now ? from : to > now + view() ? to - view() : null;
    if (want !== null && want !== now) { scroller().scrollTop = now = want; setTop(Math.max(0, want - pad)); }
  }, { defer: true }));
  return <div ref={box} style={{ height: `${tops().at(-1)}px` }}>
    <div style={{ transform: `translateY(${tops()[range()[0]]}px)` }}>
      <Index each={slice()}>{(item, at) => {
        const title = () => props.title(item());
        return <Show when={title() !== undefined} fallback={props.row(item)}>
          <div class="ui-title" data-title="" data-gap={at + range()[0] ? "" : undefined} role="presentation"><span>{title()}</span></div>
        </Show>;
      }}</Index>
    </div>
  </div>;
}
