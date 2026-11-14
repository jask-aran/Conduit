import { createEffect, createMemo, createSignal, For, on, onCleanup, onMount } from "solid-js";
import { createStore, reconcile, unwrap } from "solid-js/store";
import { MarkupMarginNotes, MarkupNote } from "@/components/ui/markup";
import type { MarkupHost, MarkupThread } from "./host";

const OPEN_EVERY_MS = 3000;
const split = (key: string) => { const at = key.lastIndexOf("/"); return [key.slice(0, at), Number(key.slice(at + 1))] as const; };
/** A suggestion's card is known in the column by its key under this, so it never meets a comment's "<item>/<n>". */
const SUGGESTED = "suggestion:";
/** How many lines of a comment's thread the person has seen, kept per browser so a card answered since reads as unread. */
const SEEN = "conduit.markup.seen.";
const seenOf = (key: string) => { try { return Number(localStorage.getItem(SEEN + key) ?? -1); } catch { return -1; } };

/** A card the tool stands in the margin before it is sent: `want`, the top of its marks and `height`, its own (viewport px); `at` is told where the column puts it, or null where the column is not beside the text. */
export type MarkupMarginWaiting = { want: number; height: number; at(place: { left: number; top: number; width: number } | null): void };
/** The margin's column for a host, where it has one mounted: sent cards and those waiting to be sent are laid out in it as one, in the order of their places. */
const columns = new WeakMap<MarkupHost, { waiting: Map<string, MarkupMarginWaiting>; lay(): void }>();
export const marginColumn = (host: MarkupHost) => columns.get(host);
/** One card of the margin as a list shows it (`key` as its host knows it): a comment (`about` its quote or first words, `by` who it is with, `unread` an answer the person has not opened) or a suggestion. */
export type MarkupMarginEntry = { key: string; kind: "comment" | "suggestion"; about: string; by: string | null; state: "waiting" | "working" | "answered" | "resolved" | "suggested"; unread: boolean };
/** What the host can do with the margin from outside it: how many comments stand open (sent and not resolved); opening the next or previous one, or one by key, in the order of their places;
 *  every card in that order (`list`, read where drawn); and resolving every comment the agent has resolved (`resolveDone`, one after another, the outcome said once). */
export type MarkupMarginControl = { open(): number; next(): void; previous(): void; go(key: string): void; list(): MarkupMarginEntry[]; resolveDone(): Promise<void> };

/**
 * A surface's margin: every comment the person has not resolved, as its thread, beside what it is about, whether or not the tool is open. The
 * host mounts it where its margin is and says through `host.margin` where each comment's place is. Where the host has
 * no room beside (it has put this under what is marked, as on a phone) the cards are a list in the order of their places.
 * `sent` changing asks for the threads at once: the host changes it when the tool has sent. `control` is handed what the host can do with it (MarkupMarginControl).
 * `onCards` is told how many cards stand in it, sent or waiting, each time they are laid out and before they are measured: a host whose margin takes no room
 * while it is empty makes that room then, so the first card is laid out beside the text.
 */
export function MarkupMargin(props: { host: MarkupHost; sent?: unknown; control?: (control: MarkupMarginControl) => void; onCards?: (count: number) => void }) {
  const host = props.host, transport = host.transport, margin = host.margin;
  const [held, setHeld] = createStore<{ items: MarkupThread[] }>({ items: [] });
  const [openKey, setOpenKey] = createSignal<string | null>(null), [reply, setReply] = createSignal(""), [beside, setBeside] = createSignal(false);
  const [seen, setSeen] = createStore<Record<string, number>>({});
  let column: HTMLDivElement | undefined, field: HTMLTextAreaElement | undefined, due = 0;
  const failed = (what: string) => (error: unknown) => host.notify("failed", `${what}: ${error instanceof Error ? error.message : String(error)}`);
  // An item put away leaves once its answer is read, but not from under the person reading it: the open card's item stays until the card is shut.
  const ask = () => { if (!document.hidden) void transport.open().then((items) => { const reading = openKey() && itemOf(openKey()!); setHeld("items", reconcile(reading && !items.some((item) => item.id === reading.id) ? [...items, unwrap(reading)] : items, { key: "id" })); }, () => {}); };
  const took = (thread: MarkupThread) => setHeld("items", (item) => item.id === thread.id, reconcile(thread));
  // By key, so a card stays the card it was through each look (and its field keeps the words being written).
  const keys = createMemo(() => held.items.flatMap((item) => item.comments.map((comment) => `${item.id}/${comment.n}`)), [], { equals: (a, b) => a.length === b.length && a.every((key, at) => key === b[at]) });
  const itemOf = (key: string) => held.items.find((item) => item.id === split(key)[0]);
  const commentOf = (key: string) => itemOf(key)?.comments.find((comment) => comment.n === split(key)[1]);
  /** What was said about a comment; what was said of its item as a whole stands with the item's first. */
  const saidOf = (key: string) => { const item = itemOf(key), n = split(key)[1]; return (item?.messages ?? []).filter((message) => message.n === n || (message.n === null && item!.comments[0]?.n === n)).map((message) => ({ from: message.from, at: message.at, text: message.text ?? (message.resolved ? "Resolved" : "Reopened") })); };
  /** Resolved by the person, a comment is put away. Resolved by the session only, its card stays as it was, saying so, until the person resolves it too: nothing leaves the margin but by their hand. */
  const putAway = (key: string) => { const comment = commentOf(key); return Boolean(comment?.resolved && comment.resolvedBy === "person"); };
  const seat = (key: string) => margin?.working?.(key);
  const said = (key: string) => saidOf(key).filter((line) => line.text !== "Resolved");
  const answered = (key: string) => Boolean(margin?.revert?.can(key) || itemOf(key)?.state === "handled" || said(key).at(-1)?.from === "agent");
  const stateOf = (key: string) => { const comment = commentOf(key), at = seat(key); return putAway(key) ? { label: "Resolved" } : at ? { label: `${at.by} is ${at.state}`, busy: true } : comment?.working ? { label: "Working on it", busy: true } : comment?.resolved ? { label: "Agent resolved" } : margin?.revert?.can(key) ? { label: "Changed" } : itemOf(key)?.state === "handled" ? { label: "Handled" } : said(key).at(-1)?.from === "agent" ? { label: "Answered" } : { label: itemOf(key)?.by ? "Sent" : "Saved" }; };
  const phase = (key: string): MarkupMarginEntry["state"] => seat(key) || commentOf(key)?.working ? "working" : commentOf(key)?.resolved ? "resolved" : answered(key) ? "answered" : "waiting";
  /** An answer stands that the person has not opened: more lines than they last saw, the latest the agent's. */
  const unread = (key: string) => !putAway(key) && saidOf(key).at(-1)?.from === "agent" && saidOf(key).length > (seen[key] ?? seenOf(key));
  const saw = (key: string) => { const count = saidOf(key).length; if (seen[key] === count) return; setSeen(key, count); try { localStorage.setItem(SEEN + key, String(count)); } catch { /* this session only */ } };
  createEffect(() => { const key = openKey(); if (key && !key.startsWith(SUGGESTED)) saw(key); });

  const suggestions = () => margin?.suggestions?.list() ?? [];
  const suggestionOf = (key: string) => suggestions().find((one) => one.key === key);
  const placeOf = (key: string) => key.startsWith(SUGGESTED) ? margin?.suggestions?.place(key.slice(SUGGESTED.length)) ?? null : margin?.place(key) ?? null;

  /** Each card, sent or waiting to be, at the height of its place, the next pushed down past it; with no room beside, a list in that order (the tool places those waiting itself). */
  const waiting = new Map<string, MarkupMarginWaiting>();
  const lay = () => {
    due = 0;
    if (!column) return;
    props.onCards?.(column.children.length + waiting.size);
    // Nothing to place: no reason to measure (this runs as the text under it changes, so on every key typed).
    if (!column.children.length && !waiting.size) return;
    const box = column.getBoundingClientRect(), gap = parseFloat(getComputedStyle(column).rowGap) || 0;
    const cards = [
      ...([...column.children] as HTMLElement[]).map((card) => ({ want: placeOf(card.dataset.key ?? "")?.top ?? null, height: () => card.offsetHeight,
        put: (top: number | null, order: number) => { card.style.top = top === null ? "" : `${top}px`; card.style.order = top === null ? String(order) : ""; } })),
      ...[...waiting.values()].map((one) => ({ want: one.want as number | null, height: () => one.height, put: (top: number | null) => one.at(top === null ? null : { left: box.left, top: box.top + top, width: box.width }) })),
    ].sort((a, b) => (a.want ?? Number.MAX_VALUE) - (b.want ?? Number.MAX_VALUE));
    // Beside what is marked, the margin starts no lower than it; put under it, every place is above.
    const side = cards.some(({ want }) => want !== null && want >= box.top);
    setBeside(side);
    let floor = 0;
    cards.forEach((card, order) => {
      const top = Math.max(card.want !== null ? card.want - box.top : floor, floor);
      card.put(side ? top : null, order);
      floor = top + card.height() + gap;
    });
    column.style.minHeight = side ? `${Math.max(0, floor - gap)}px` : "";
  };
  const soon = () => { due ||= requestAnimationFrame(lay); };
  const open = (key: string | null) => {
    setReply(""); setOpenKey(key);
    if (key && !key.startsWith(SUGGESTED)) { void transport.thread(split(key)[0], true).then(took, () => {}); queueMicrotask(() => field?.focus({ preventScroll: true })); }
  };
  const answer = () => {
    const key = openKey(), words = reply().trim();
    if (!key || !words) return;
    setReply("");
    void transport.say(split(key)[0], split(key)[1], words).then(took, failed("Not said"));
  };
  const settle = (key: string, resolved: boolean) => { if (resolved && openKey() === key) open(null); void transport.resolve(split(key)[0], split(key)[1], resolved).then((thread) => { took(thread); ask(); }, failed(resolved ? "Not resolved" : "Not reopened")); };
  const resolveDone = async () => {
    const done = keys().filter((key) => commentOf(key)?.resolved && !putAway(key));
    let resolved = 0;
    for (const key of done) {
      try { took(await transport.resolve(split(key)[0], split(key)[1], true)); resolved++; } catch { /* counted below */ }
    }
    if (openKey() && done.includes(openKey()!)) open(null);
    ask();
    if (resolved === done.length) host.notify("sent", `Resolved ${resolved} ${resolved === 1 ? "comment" : "comments"}`);
    else host.notify("failed", `Resolved ${resolved} of ${done.length} comments`);
  };

  const openKeys = createMemo(() => keys().filter((key) => !commentOf(key)?.resolved));
  const byPlace = (list: string[]) => [...list].sort((a, b) => (placeOf(a)?.top ?? Number.MAX_VALUE) - (placeOf(b)?.top ?? Number.MAX_VALUE));
  /** A card opened and brought into view, beside its mark. */
  const go = (named: string) => { const key = keys().includes(named) ? named : SUGGESTED + named; open(key); requestAnimationFrame(() => column?.querySelector(`[data-key="${CSS.escape(key)}"]`)?.scrollIntoView({ block: "center" })); };
  /** The next open comment after the one open now (or the first), in the order of their places. */
  const step = (by: 1 | -1) => {
    const list = byPlace(openKeys());
    if (!list.length) return;
    const at = list.indexOf(openKey() ?? "");
    go(list[at < 0 ? (by > 0 ? 0 : list.length - 1) : (at + by + list.length) % list.length]!);
  };
  const list = () => byPlace([...keys().filter((key) => !putAway(key)), ...suggestions().map((one) => SUGGESTED + one.key)]).map((key): MarkupMarginEntry => {
    if (key.startsWith(SUGGESTED)) { const one = suggestionOf(key.slice(SUGGESTED.length))!; return { key: one.key, kind: "suggestion", about: one.summary, by: one.by, state: "suggested", unread: false }; }
    const comment = commentOf(key);
    return { key, kind: "comment", about: comment?.quote || comment?.comment || comment?.name || "", by: itemOf(key)?.by ?? null, state: phase(key), unread: unread(key) };
  });
  props.control?.({ open: () => openKeys().length, next: () => step(1), previous: () => step(-1), go, list, resolveDone });

  createEffect(() => { margin?.anchors(keys().map((key) => { const comment = commentOf(key); return { key, quote: comment?.quote, under: comment?.under, current: openKey() === key, resolved: putAway(key) }; })); soon(); });
  createEffect(on(() => suggestions().length, soon, { defer: true }));
  createEffect(on(() => props.sent, ask, { defer: true }));
  onMount(() => {
    ask();
    columns.set(host, { waiting, lay });
    onCleanup(() => columns.delete(host));
    const asking = setInterval(ask, OPEN_EVERY_MS);
    const sized = new ResizeObserver(soon), cards = new MutationObserver(() => { for (const card of column!.children) sized.observe(card); soon(); });
    sized.observe(column!); cards.observe(column!, { childList: true });
    // Ctrl Enter says it, and Enter is a new line (a reply runs longer than a note); Escape shuts the card and gives the keyboard back to the surface.
    column!.addEventListener("keydown", (event) => { if (event.key === "Escape") { open(null); margin?.focus?.(); } else if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) { event.preventDefault(); answer(); } });
    const unwatch = margin?.watch((pressed) => { if (pressed) { open(pressed); column?.querySelector(`[data-key="${CSS.escape(pressed)}"]`)?.scrollIntoView({ block: "nearest" }); } soon(); });
    onCleanup(() => { clearInterval(asking); sized.disconnect(); cards.disconnect(); unwatch?.(); cancelAnimationFrame(due); });
  });

  return <MarkupMarginNotes ref={(element) => { column = element; }} beside={beside()}>
    <For each={keys()}>{(key) => <MarkupNote ref={(element) => { field = element; }} key={key} open={openKey() === key} tag="" name={commentOf(key)?.quote ? "" : commentOf(key)?.name ?? ""} quote={commentOf(key)?.quote} words={commentOf(key)?.comment} said={saidOf(key)} by={itemOf(key)?.by ?? undefined} state={stateOf(key)} unread={unread(key)}
      placeholder="Write back" resolved={putAway(key)} value={openKey() === key ? reply() : ""} onOpen={() => open(key)} onInput={setReply} onSay={answer} onResolve={(resolved) => settle(key, resolved)}
      onRevert={margin?.revert?.can(key) ? () => void margin.revert!.run(key).catch(failed("Not taken back")) : undefined} />}</For>
    <For each={suggestions().map((one) => one.key)}>{(key) => <MarkupNote key={SUGGESTED + key} open={false} tag="" name="" words={suggestionOf(key)?.summary} state={{ label: `Suggested by ${suggestionOf(key)?.by === "person" ? "you" : suggestionOf(key)?.by ?? "an agent"}` }} value="" onOpen={() => {}} onInput={() => {}}
      onAccept={() => margin?.suggestions?.accept(key)} onReject={() => margin?.suggestions?.reject(key)} />}</For>
  </MarkupMarginNotes>;
}
