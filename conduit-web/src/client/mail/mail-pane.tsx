import { createEffect, createMemo, createResource, createSignal, For, on, onCleanup, Show, type JSX } from "solid-js";
import type { MailAccount, MailDraft, MailLabel, MailThread } from "@/mail/mail";
import { Button, DashDay, Empty, HeaderButton, Icons, LeadInput, Loading, MailRow, ReaderSplit, ReadingScroll, ReadingTitle, SelectTrigger, SheetFill, Spinner, StatusDot, ToolBar } from "@/components/ui";
import { ContextMenu, ContextMenuContent, ContextMenuTrigger, DropdownMenu, MenuContent, MenuControl, MenuRow, MenuSection } from "@/components/ui/menus";
import { toast } from "@/components/ui/notifications";
import { createArtWindow } from "@/components/ui/chat-art";
import { failure, mailApi } from "./mail-api";
import { DraftComposer } from "./mail-compose";
import { createMailList } from "./mail-list";
import { labelRows, mailDay, mailTime, MailThreadView, threadVerbs } from "./mail-thread";

const LABEL_ICON: Record<string, () => JSX.Element> = {
  inbox: () => <Icons.Inbox />, starred: () => <Icons.Star />, sent: () => <Icons.Send />, drafts: () => <Icons.Edit />, all: () => <Icons.Mail />, important: () => <Icons.Notification />,
};
const who = (thread: MailThread, own: string) => {
  const names = [...new Set(thread.from.map((party) => party.address === own ? "me" : (party.name || party.address).split(" ")[0]!))];
  return thread.from.length === 1 ? thread.from[0]!.name || thread.from[0]!.address : names.join(", ");
};

/**
 * Mail in a pane: the list of a label (or a search) beside the open thread while the pane holds both, else one at a time.
 * Writing opens in the thread's column. It says it is loading until its first list is in.
 */
export default function MailPane(props: {
  /** An account's id, or "default": the first account. */
  account: string;
  /** The person chose another account (only offered when there are several). */
  onAccount(id: string): void;
  /** Open Settings at the mail section. */
  onSettings(): void;
  /** The pane's header, given what mail adds to its actions (Compose, the error dot). */
  header(actions: JSX.Element): JSX.Element;
}) {
  // A failure to read is said in the pane, never thrown into it.
  const [trouble, setTrouble] = createSignal("");
  const [accounts, { refetch: rereadAccounts }] = createResource(() => mailApi.accounts().catch((reason) => { setTrouble(failure(reason)); return [] as MailAccount[]; }));
  const account = createMemo<MailAccount | null>(() => { const all = accounts.latest ?? []; return all.find((one) => one.id === props.account) ?? all[0] ?? null; });
  const own = () => account()?.address ?? "";
  const [labelsRead, { refetch: rereadLabels }] = createResource(() => account()?.id, (id) => mailApi.labels(id).catch(() => [] as MailLabel[]), { initialValue: [] as MailLabel[] });
  // Read as .latest: a refetch must not suspend the pane.
  const labels = () => labelsRead.latest ?? [];
  const [label, setLabel] = createSignal("inbox");
  // The view last chosen for an account is where its mail opens next, on this device.
  const viewKey = (id: string) => `conduit:mail-view:${id}`;
  createEffect(on(() => account()?.id, (id) => { try { const kept = id && localStorage.getItem(viewKey(id)); if (kept) setLabel(kept); } catch { /* opens on the inbox */ } }));
  createEffect(on(label, (now) => { const id = account()?.id; try { if (id) localStorage.setItem(viewKey(id), now); } catch { /* this session only */ } }, { defer: true }));
  const list = createMailList(() => account()?.id ?? null, label);
  createEffect(on([() => account()?.id, label], ([id]) => { if (id) void list.load().then(() => setTrouble(""), (reason) => setTrouble(failure(reason))); }));

  const [open, setOpen] = createSignal<string | null>(null);
  const [writing, setWriting] = createSignal<MailDraft | null>(null);
  const [folded, setFolded] = createSignal(false);
  const [cursor, setCursor] = createSignal<string | null>(null);
  let rows: HTMLDivElement | undefined, field: HTMLInputElement | undefined;

  const heard = (event: Event) => {
    const detail = (event as CustomEvent<{ account: string; threads?: string[]; accounts?: true }>).detail;
    if (detail?.accounts) void rereadAccounts();
    if (!detail || detail.account !== account()?.id) return;
    void rereadLabels();
    void list.heard(detail.threads).catch(() => {});
  };
  window.addEventListener("conduit:mail-changed", heard);
  onCleanup(() => window.removeEventListener("conduit:mail-changed", heard));

  const openThread = (id: string) => { setWriting(null); setOpen(id); setCursor(id); };
  const backToList = () => {
    setOpen(null); setWriting(null);
    queueMicrotask(() => rows?.querySelector<HTMLElement>(`[data-thread="${CSS.escape(cursor() ?? "")}"]`)?.focus());
  };
  const compose = async () => {
    const id = account()?.id;
    if (!id) return;
    try { const draft = await mailApi.newDraft({ account: id }); setOpen(null); setWriting(draft); }
    catch (reason) { toast.error(failure(reason)); }
  };

  const status = () => account()?.status;
  const headerActions = () => <>
    <Show when={status()?.state === "error"}><StatusDot tone="danger" label={status()?.error ?? "Mail is not working"} title={status()?.error} /></Show>
    <Show when={account()}><HeaderButton label="Compose" icon={<Icons.Edit />} onClick={() => void compose()} /></Show>
  </>;

  const labelName = () => labels().find((one) => one.id === label())?.name ?? "Inbox";
  const chooser = () => <DropdownMenu modal={false} placement="bottom-start">
    <MenuControl as={SelectTrigger} bare value={labelName()} aria-label="Label" />
    <MenuContent width="sm" height="xl">
      <Show when={(accounts.latest?.length ?? 0) > 1}><MenuSection title="Accounts"><For each={accounts.latest}>{(one) =>
        <MenuRow checked={one.id === account()?.id} detail={one.name || undefined} onSelect={() => props.onAccount(one.id)}>{one.address}</MenuRow>}</For></MenuSection></Show>
      <MenuSection><For each={labels().filter((one) => one.role || one.id === "all")}>{(one) => <MenuRow icon={LABEL_ICON[one.role ?? one.id]?.() ?? <Icons.Label />}
        checked={one.id === label()} meta={one.unread ? String(one.unread) : undefined} onSelect={() => setLabel(one.id)}>{one.name}</MenuRow>}</For></MenuSection>
      <Show when={labels().some((one) => !one.role && one.id !== "all")}><MenuSection title="Labels"><For each={labels().filter((one) => !one.role && one.id !== "all")}>{(one) =>
        <MenuRow icon={<Icons.Label />} checked={one.id === label()} meta={one.unread ? String(one.unread) : undefined} onSelect={() => setLabel(one.id)}>{one.name}</MenuRow>}</For></MenuSection></Show>
    </MenuContent>
  </DropdownMenu>;

  // One flat list keyed by the thread objects (which a refresh keeps), each day named over its first row.
  const dayOver = (index: number) => { const all = list.threads(), day = mailDay(all[index]!.date); return index === 0 || mailDay(all[index - 1]!.date) !== day ? day : null; };
  // One Tab stop: the remembered row, else the first; arrows walk the rows, clamped, and ↑ from the top hands on to search.
  const rowsShown = () => [...rows?.querySelectorAll<HTMLElement>("[data-thread]") ?? []];
  const walk = (event: KeyboardEvent) => {
    const all = rowsShown(), at = all.indexOf(document.activeElement as HTMLElement);
    const to = event.key === "ArrowDown" ? at + 1 : event.key === "ArrowUp" ? at - 1 : event.key === "Home" ? 0 : event.key === "End" ? all.length - 1 : null;
    if (to === null || at < 0) return;
    event.preventDefault();
    if (to < 0) return field?.focus();
    all[Math.min(to, all.length - 1)]?.focus();
  };
  const nearEnd = (element: HTMLElement) => { if (element.scrollTop + 2 * element.clientHeight >= element.scrollHeight) void list.more().catch((reason) => toast.error(failure(reason))); };
  const row = (thread: MailThread) => <ContextMenu>
    <ContextMenuTrigger as={MailRow} data-thread={thread.id} tabIndex={(cursor() ?? list.threads()[0]?.id) === thread.id ? 0 : -1}
      current={open() === thread.id} from={who(thread, own())} count={thread.count} subject={thread.subject || "(no subject)"} snippet={thread.snippet}
      time={mailTime(thread.date)} dateTime={thread.date} unread={thread.unread > 0} starred={thread.starred} attachments={thread.attachments} draft={thread.draft}
      onFocus={() => setCursor(thread.id)} onClick={() => openThread(thread.id)} />
    <ContextMenuContent width="sm">
      <MenuSection><MenuRow icon={<Icons.Preview />} onSelect={() => openThread(thread.id)}>Open</MenuRow>
        <For each={threadVerbs(thread, list)}>{(verb) => <MenuRow icon={verb.icon()} disabled={verb.disabled} onSelect={verb.run}>{verb.label}</MenuRow>}</For></MenuSection>
      <Show when={labels().some((one) => !one.role && one.id !== "all")}><MenuSection title="Labels">{labelRows(thread, labels(), list)}</MenuSection></Show>
    </ContextMenuContent>
  </ContextMenu>;

  const foot = () => list.searchingRemote() ? "Searching older mail"
    : status()?.backfill && !list.query() ? `Reading in older mail · ${status()!.backfill!.done.toLocaleString()} of ${status()!.backfill!.total.toLocaleString()}` : "";
  const listColumn = () => <>
    <ToolBar>{chooser()}
      <LeadInput kind="tool" ref={(element) => { field = element; }} aria-label="Search mail" placeholder="Search mail" value={list.query()}
        onInput={(event) => void list.search(event.currentTarget.value).catch((reason) => toast.error(failure(reason)))}
        onClear={() => void list.search("")}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown") { event.preventDefault(); (rowsShown().find((one) => one.tabIndex === 0) ?? rowsShown()[0])?.focus(); }
          if (event.key === "Escape" && list.query()) { event.preventDefault(); event.stopPropagation(); void list.search(""); }
        }} />
    </ToolBar>
    <ReadingScroll ref={(element) => { rows = element; }} onScroll={(event) => nearEnd(event.currentTarget)} onKeyDown={walk} aria-label={labelName()}>
      <Show when={list.threads().length} fallback={<Empty>{list.query() ? "Nothing found" : `Nothing in ${labelName()}`}</Empty>}>
        <div><For each={list.threads()}>{(thread, index) => <><Show when={dayOver(index())}>{(day) => <DashDay>{day()}</DashDay>}</Show>{row(thread)}</>}</For></div>
      </Show>
      <Show when={list.paging()}><Loading kind="earlier" label="Loading older mail" /></Show>
    </ReadingScroll>
    <Show when={foot()}><ToolBar edge="top"><StatusDot spinning label={foot()} /><small>{foot()}</small></ToolBar></Show>
  </>;

  const back = () => folded() ? backToList : undefined;
  const readerColumn = () => <Show when={writing()} fallback={<Show when={open()} keyed fallback={<Empty>No thread open</Empty>}>{(id) =>
    <MailThreadView id={id} own={own()} labels={labels()} list={list} back={back()} onGone={backToList} />}</Show>}>{(draft) => <>
    <ToolBar><Show when={folded()}><HeaderButton label="Back" icon={<Icons.Back />} onClick={backToList} /></Show></ToolBar>
    <ReadingScroll><ReadingTitle>New message</ReadingTitle><DraftComposer draft={draft()} subject autofocus onDone={backToList} /></ReadingScroll>
  </>}</Show>;

  // Escape steps out one level: a thread that took the pane hands it back to the list. In a field it is the field's.
  const escape = (event: KeyboardEvent) => {
    if (event.key !== "Escape" || event.defaultPrevented || !folded() || !(open() || writing())) return;
    if ((event.target as HTMLElement).closest("textarea, input")) return;
    event.preventDefault();
    backToList();
  };

  return <SheetFill ref={createArtWindow(true)} class="pane-mail" onKeyDown={escape}>
    {props.header(headerActions())}
    <Show when={!accounts.loading || accounts.latest} fallback={<Loading kind="pane"><Spinner />Loading mail</Loading>}>
      <Show when={account()} fallback={trouble() ? <Empty role="alert">{trouble()}</Empty> : <Empty><div><Icons.Mail /><p>Mail is set up in Settings.</p><Button variant="ghost" outline size="sm" onClick={() => props.onSettings()}>Open Settings</Button></div></Empty>}>
        <Show when={list.ready()} fallback={<Show when={trouble()} fallback={<Loading kind="pane"><Spinner />Loading mail</Loading>}><Empty role="alert">{trouble()}</Empty></Show>}>
          <ReaderSplit label="Mail" show={open() || writing() ? "reader" : "list"} onFold={setFolded} list={listColumn()} reader={readerColumn()} />
        </Show>
      </Show>
    </Show>
  </SheetFill>;
}
