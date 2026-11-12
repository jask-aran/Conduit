import { createEffect, createMemo, createSignal, For, on, onCleanup, onMount } from "solid-js";
import { createStore, reconcile } from "solid-js/store";
import { MarkupMarginNotes, MarkupNote } from "@/components/ui/markup";
import type { MarkupHost, MarkupThread } from "./host";

const OPEN_EVERY_MS = 3000;
const split = (key: string) => { const at = key.lastIndexOf("/"); return [key.slice(0, at), Number(key.slice(at + 1))] as const; };

/**
 * A surface's margin: every open comment as its thread, beside what it is about, whether or not the tool is open. The
 * host mounts it where its margin is and says through `host.margin` where each comment's place is. Where the host has
 * no room beside (it has put this under what is marked, as on a phone) the cards are a list in the order of their places.
 * `sent` changing asks for the threads at once: the host changes it when the tool has sent.
 */
export function MarkupMargin(props: { host: MarkupHost; sent?: unknown }) {
  const host = props.host, transport = host.transport, margin = host.margin;
  const [held, setHeld] = createStore<{ items: MarkupThread[] }>({ items: [] });
  const [openKey, setOpenKey] = createSignal<string | null>(null), [reply, setReply] = createSignal(""), [beside, setBeside] = createSignal(false);
  let column: HTMLDivElement | undefined, field: HTMLTextAreaElement | undefined, due = 0;
  const failed = (what: string) => (error: unknown) => host.notify("failed", `${what}: ${error instanceof Error ? error.message : String(error)}`);
  const ask = () => { if (!document.hidden) void transport.open().then((items) => setHeld("items", reconcile(items, { key: "id" })), () => {}); };
  const took = (thread: MarkupThread) => setHeld("items", (item) => item.id === thread.id, reconcile(thread));
  // By key, so a card stays the card it was through each look (and its field keeps the words being written).
  const keys = createMemo(() => held.items.flatMap((item) => item.comments.map((comment) => `${item.id}/${comment.n}`)), [], { equals: (a, b) => a.length === b.length && a.every((key, at) => key === b[at]) });
  const itemOf = (key: string) => held.items.find((item) => item.id === split(key)[0]);
  const commentOf = (key: string) => itemOf(key)?.comments.find((comment) => comment.n === split(key)[1]);
  /** What was said about a comment; what was said of its item as a whole stands with the item's first. */
  const saidOf = (key: string) => { const item = itemOf(key), n = split(key)[1]; return (item?.messages ?? []).filter((message) => message.n === n || (message.n === null && item!.comments[0]?.n === n)).map((message) => ({ from: message.from, at: message.at, text: message.text ?? (message.resolved ? "Resolved" : "Reopened") })); };
  const stateOf = (key: string) => { const comment = commentOf(key), said = saidOf(key); return comment?.resolved ? { label: "Resolved" } : comment?.working ? { label: "Working on it", busy: true } : margin?.revert?.can(key) ? { label: "Changed" } : said[said.length - 1]?.from === "agent" ? { label: "Answered" } : { label: itemOf(key)?.by ? "Sent" : "Saved" }; };

  /** Each card at the height of its place, the next pushed down past it; with no room beside, a list in that order. */
  const lay = () => {
    due = 0;
    if (!column) return;
    const box = column.getBoundingClientRect(), gap = parseFloat(getComputedStyle(column).rowGap) || 0;
    const cards = ([...column.children] as HTMLElement[]).map((card) => ({ card, at: margin?.place(card.dataset.key ?? "") ?? null })).sort((a, b) => (a.at?.top ?? Infinity) - (b.at?.top ?? Infinity));
    // Beside what is marked, the margin starts no lower than it; put under it, every place is above.
    const side = cards.some(({ at }) => at && at.top >= box.top);
    setBeside(side);
    let floor = 0;
    cards.forEach(({ card, at }, order) => {
      const top = Math.max(at ? at.top - box.top : floor, floor);
      card.style.top = side ? `${top}px` : "";
      card.style.order = side ? "" : String(order);
      floor = top + card.offsetHeight + gap;
    });
    column.style.minHeight = side ? `${Math.max(0, floor - gap)}px` : "";
  };
  const soon = () => { due ||= requestAnimationFrame(lay); };
  const open = (key: string | null) => {
    setReply(""); setOpenKey(key);
    if (key) { void transport.thread(split(key)[0], true).then(took, () => {}); queueMicrotask(() => field?.focus({ preventScroll: true })); }
  };
  const answer = () => {
    const key = openKey(), words = reply().trim();
    if (!key || !words) return;
    setReply("");
    void transport.say(split(key)[0], split(key)[1], words).then(took, failed("Not said"));
  };
  const settle = (key: string, resolved: boolean) => { if (resolved && openKey() === key) open(null); void transport.resolve(split(key)[0], split(key)[1], resolved).then((thread) => { took(thread); ask(); }, failed(resolved ? "Not resolved" : "Not reopened")); };

  createEffect(() => { margin?.anchors(keys().map((key) => { const comment = commentOf(key); return { key, quote: comment?.quote, under: comment?.under, current: openKey() === key, resolved: Boolean(comment?.resolved) }; })); soon(); });
  createEffect(on(() => props.sent, ask, { defer: true }));
  onMount(() => {
    ask();
    const asking = setInterval(ask, OPEN_EVERY_MS);
    const sized = new ResizeObserver(soon), cards = new MutationObserver(() => { for (const card of column!.children) sized.observe(card); soon(); });
    sized.observe(column!); cards.observe(column!, { childList: true });
    // Enter says it and Escape shuts the card, as in the tool's own notes.
    column!.addEventListener("keydown", (event) => { if (event.key === "Escape") open(null); else if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); answer(); } });
    const unwatch = margin?.watch((pressed) => { if (pressed) { open(pressed); column?.querySelector(`[data-key="${CSS.escape(pressed)}"]`)?.scrollIntoView({ block: "nearest" }); } soon(); });
    onCleanup(() => { clearInterval(asking); sized.disconnect(); cards.disconnect(); unwatch?.(); cancelAnimationFrame(due); });
  });

  return <MarkupMarginNotes ref={(element) => { column = element; }} beside={beside()}>
    <For each={keys()}>{(key) => <MarkupNote ref={(element) => { field = element; }} key={key} open={openKey() === key} tag="" name={commentOf(key)?.quote ? `“${commentOf(key)!.quote}”` : commentOf(key)?.name ?? ""} words={commentOf(key)?.comment} said={saidOf(key)} state={stateOf(key)}
      placeholder="Write back" resolved={commentOf(key)?.resolved} value={openKey() === key ? reply() : ""} onOpen={() => open(key)} onInput={setReply} onSay={answer} onResolve={(resolved) => settle(key, resolved)}
      onRevert={margin?.revert?.can(key) ? () => void margin.revert!.run(key).catch(failed("Not taken back")) : undefined} />}</For>
  </MarkupMarginNotes>;
}
