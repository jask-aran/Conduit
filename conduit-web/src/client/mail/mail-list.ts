import { createSignal } from "solid-js";
import { createStore, reconcile } from "solid-js/store";
import type { MailChange, MailThread } from "@/mail/mail";
import { toast } from "@/components/ui/notifications";
import { createLatest } from "../state/latest";
import { THREAD_PAGE, failure, mailApi } from "./mail-api";

/** The most threads the hub answers with in one page. */
const MOST_AT_ONCE = 100;
/** How long typing in search rests before the source is asked too (slower than the hub's own copy). */
export const SEARCH_REMOTE_MS = 600;

/** Whether a thread now belongs in a label's list. */
const holds = (label: string, thread: MailThread) => label === "all" || thread.labels.includes(label)
  || (label === "starred" && thread.starred) || (label === "drafts" && thread.draft);

/** A change as the list draws it: a triage, or a move (`to`, a split's label) out of every taking split (`taking`, their labels). */
type Change = Omit<MailChange, "threads" | "messages"> & { move?: { to: string; taking: string[] } };

/** What a change makes of a thread, as the hub will: null when it goes (trashed). */
function predict(thread: MailThread, change: Change): MailThread | null {
  if (change.trash) return null;
  // A category or a split sorts the inbox, so a thread taken out of the inbox leaves them too; a move leaves the views it passes.
  const out = (label: string) => change.remove?.includes(label) || (change.remove?.includes("inbox") && /^(category|split)-/.test(label)) || change.move?.taking.includes(label);
  const labels = [...new Set([...thread.labels.filter((label) => !out(label)), ...(change.add ?? []), ...(change.move ? [change.move.to] : [])])];
  const unread = change.unread === undefined ? thread.unread : change.unread ? Math.max(thread.unread, 1) : 0;
  return { ...thread, labels, unread, starred: labels.includes("starred") };
}

/**
 * The threads one label (or one search) shows, a page at a time. Each row keeps its object across a refresh, so a menu open
 * on it and the cursor stand. Triage is drawn at once, then the hub's answer is taken as the truth; a refusal puts it back.
 */
export function createMailList(account: () => string | null, label: () => string) {
  const [store, setStore] = createStore<{ threads: MailThread[] }>({ threads: [] });
  const [next, setNext] = createSignal<string | null>(null);
  const [ready, setReady] = createSignal(false);
  const [paging, setPaging] = createSignal(false);
  const [query, setQuery] = createSignal("");
  const [searchingRemote, setSearchingRemote] = createSignal(false);
  const latest = createLatest();
  let remoteTimer = 0;

  const show = (threads: MailThread[]) => setStore("threads", reconcile(threads, { key: "id", merge: true }));
  /** Every page shown, read again, in asks of the most the hub gives at once. */
  const reread = async () => {
    const own = account();
    if (!own) return;
    const mine = latest.next();
    const wanted = Math.max(THREAD_PAGE, store.threads.length), found: MailThread[] = [];
    let before: string | null = null;
    do {
      const answer = await mailApi.threads({ account: own, label: label(), before, limit: Math.min(MOST_AT_ONCE, wanted - found.length) });
      if (!mine()) return;
      found.push(...answer.threads);
      before = answer.next;
    } while (before && found.length < wanted);
    show(found);
    setNext(before);
    setReady(true);
  };
  /** A label chosen: what was shown stands until the new list is in. */
  const load = () => { window.clearTimeout(remoteTimer); setSearchingRemote(false); setQuery(""); return reread(); };
  const more = async () => {
    const own = account(), before = next();
    if (!own || !before || paging() || query()) return;
    setPaging(true);
    const mine = latest.join();
    try {
      const answer = await mailApi.threads({ account: own, label: label(), before });
      if (!mine()) return;
      show([...store.threads, ...answer.threads.filter((thread) => !store.threads.some((shown) => shown.id === thread.id))]);
      setNext(answer.next);
    } finally { setPaging(false); }
  };

  const search = async (text: string) => {
    setQuery(text);
    window.clearTimeout(remoteTimer);
    setSearchingRemote(false);
    const own = account();
    if (!text.trim()) return void reread();
    if (!own) return;
    const mine = latest.next();
    const found = await mailApi.search({ account: own, q: text });
    if (!mine()) return;
    show(found);
    setNext(null);
    remoteTimer = window.setTimeout(async () => {
      if (!mine()) return;
      setSearchingRemote(true);
      try { const merged = await mailApi.search({ account: own, q: text, remote: true }); if (mine()) show(merged); }
      catch (reason) { if (mine()) toast.error(failure(reason)); }
      finally { if (mine()) setSearchingRemote(false); }
    }, SEARCH_REMOTE_MS);
  };

  const keeps = (thread: MailThread) => Boolean(query()) || holds(label(), thread);
  /** Drawn at once as `change` makes the threads; the hub's answer (`ask`) then stands, and a refusal puts the rows back and says why. `onThreads` hears each outcome. */
  const act = async (threads: MailThread[], change: Change, ask: (ids: string[]) => Promise<MailThread[] | void>, onThreads?: (threads: MailThread[]) => void) => {
    const before = store.threads.slice();
    const ids = threads.map((thread) => thread.id);
    const predicted = threads.map((thread) => predict(thread, change)).filter((thread): thread is MailThread => Boolean(thread));
    const apply = (now: MailThread[], gone: string[]) => {
      show(store.threads.flatMap((row) => {
        if (gone.includes(row.id)) return [];
        const found = now.find((thread) => thread.id === row.id);
        return found ? keeps(found) ? [found] : [] : [row];
      }));
      onThreads?.(now);
    };
    apply(predicted, change.trash ? ids : []);
    try {
      const answer = await ask(ids);
      if (answer) apply(answer, ids.filter((id) => !answer.some((thread) => thread.id === id)));
      return true;
    } catch (reason) {
      show(before);
      onThreads?.(threads);
      toast.error(failure(reason));
      return false;
    }
  };
  const triage = (threads: MailThread[], change: Omit<MailChange, "threads" | "messages">, onThreads?: (threads: MailThread[]) => void) =>
    act(threads, change, (ids) => mailApi.change({ ...change, threads: ids }), onThreads);
  /** Into a split (its id, its label `split-<id>`): out of the taking splits (`taking`, their labels), drawn at once. `ask` is the hub's move, or a sender's route (whose threads are then told). */
  const move = (threads: MailThread[], split: string, taking: string[], ask: (ids: string[]) => Promise<MailThread[] | void>, onThreads?: (threads: MailThread[]) => void) =>
    act(threads, { move: { to: `split-${split}`, taking } }, ask, onThreads);

  /** The hub's word that mail changed: the shown pages are read again when a named thread is shown or could now be. */
  const heard = async (threads?: string[]) => {
    if (query()) return void search(query());
    if (!threads?.length || threads.some((id) => store.threads.some((row) => row.id === id))) return void reread();
    const own = account();
    if (!own) return;
    const head = await mailApi.threads({ account: own, label: label() });
    if (head.threads.some((thread) => threads.includes(thread.id))) await reread();
  };

  return { threads: () => store.threads, ready, next, paging, query, searchingRemote, load, more, search, triage, move, heard, holds };
}
export type MailList = ReturnType<typeof createMailList>;
