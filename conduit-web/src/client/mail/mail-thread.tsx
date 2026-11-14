import { createSignal, For, onCleanup, Show, Suspense, type JSX } from "solid-js";
import type { MailBody, MailDraft, MailLabel, MailMessage, MailParty, MailThread } from "@/mail/mail";
import { Answer, Button, EmailItem, Empty, HeaderButton, IconButton, Icons, Loading, ReadingScroll, ReadingTitle, Row, Spinner, ToolBar, WebPage, clockTime } from "@/components/ui";
import { DropdownMenu, MenuContent, MenuControl, MenuRow, MenuSection } from "@/components/ui/menus";
import { toast } from "@/components/ui/notifications";
import { ChatMarkdown } from "../chat/lazy-markdown";
import { createLatest } from "../state/latest";
import { downloadAttachment, failure, mailApi } from "./mail-api";
import { DraftComposer } from "./mail-compose";
import type { MailList } from "./mail-list";

const DAY_MS = 86_400_000;
const DAY = new Intl.DateTimeFormat([], { weekday: "short" });
const DATE = new Intl.DateTimeFormat([], { day: "numeric", month: "short" });
const startOf = (at: number) => new Date(at).setHours(0, 0, 0, 0);
/** Today's clock time, then the weekday within the week, then the date. */
export const mailTime = (iso: string, now = Date.now()) => {
  const days = Math.round((startOf(now) - startOf(Date.parse(iso))) / DAY_MS);
  return days <= 0 ? clockTime(iso) ?? "" : days === 1 ? "Yesterday" : days < 7 ? DAY.format(new Date(iso)) : DATE.format(new Date(iso));
};
export const mailDay = (iso: string, now = Date.now()) => {
  const days = Math.round((startOf(now) - startOf(Date.parse(iso))) / DAY_MS);
  return days <= 0 ? "Today" : days === 1 ? "Yesterday" : days < 7 ? "This week" : "Earlier";
};
const named = (party: MailParty, own: string) => party.address === own ? "me" : party.name || party.address;
const size = (bytes: number) => bytes < 1024 ? `${bytes} B` : bytes < 1024 ** 2 ? `${Math.round(bytes / 1024)} KB` : `${(bytes / 1024 ** 2).toFixed(1)} MB`;

/** A thread's verbs, one list for its toolbar and its row's menu. */
export interface ThreadVerb { key: string; label: string; icon: () => JSX.Element; run: () => void; disabled?: boolean }
export function threadVerbs(thread: MailThread, list: MailList, onThreads?: (threads: MailThread[]) => void): ThreadVerb[] {
  const change = (input: Parameters<MailList["triage"]>[1]) => () => void list.triage([thread], input, onThreads);
  const starred = thread.labels.includes("starred");
  return [
    { key: "archive", label: "Archive", icon: () => <Icons.Archive />, run: change({ remove: ["inbox"] }), disabled: !thread.labels.includes("inbox") },
    { key: "read", label: thread.unread ? "Mark read" : "Mark unread", icon: () => thread.unread ? <Icons.MailRead /> : <Icons.Mail />, run: change({ unread: !thread.unread }) },
    { key: "star", label: starred ? "Unstar" : "Star", icon: () => <Icons.Star fill={starred ? "currentColor" : "none"} />, run: change(starred ? { remove: ["starred"] } : { add: ["starred"] }) },
    { key: "trash", label: "Trash", icon: () => <Icons.Delete />, run: change({ trash: true }) },
  ];
}
/** The account's own labels, the thread's current; choosing one puts it on or takes it off. */
export const labelRows = (thread: MailThread, labels: MailLabel[], list: MailList, onThreads?: (threads: MailThread[]) => void) =>
  <For each={labels.filter((label) => !label.role && label.id !== "all")}>{(label) => <MenuRow closeOnSelect={false} checked={thread.labels.includes(label.id)}
    onSelect={() => void list.triage([thread], thread.labels.includes(label.id) ? { remove: [label.id] } : { add: [label.id] }, onThreads)}>{label.name}</MenuRow>}</For>;

/** The sender's own HTML, in a frame that runs nothing and reaches nothing; images only when asked for. */
const original = (html: string, images: boolean) =>
  `<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:${images ? " https:" : ""}">${html}`;

/**
 * An open thread: its subject, earlier messages folded to a line, the newest and any unread open, each with its verbs; the
 * drafts written in it at its foot. It says it is opening until the thread and its open bodies are in.
 */
export function MailThreadView(props: { id: string; own: string; labels: MailLabel[]; list: MailList; back?: () => void; onGone: () => void }) {
  const [thread, setThread] = createSignal<MailThread>();
  const [messages, setMessages] = createSignal<MailMessage[]>([]);
  const [drafts, setDrafts] = createSignal<MailDraft[]>([]);
  const [bodies, setBodies] = createSignal<Record<string, MailBody>>({});
  const [open, setOpen] = createSignal<string[]>([]);
  const [failed, setFailed] = createSignal("");
  const [showing, setShowing] = createSignal<{ message: string; images: boolean } | null>(null);
  const latest = createLatest();

  const fetchBodies = async (ids: string[]) => {
    const missing = ids.filter((id) => !bodies()[id]);
    const found = await Promise.all(missing.map(async (id) => [id, await mailApi.body(id)] as const));
    if (found.length) setBodies({ ...bodies(), ...Object.fromEntries(found) });
  };
  const read = async (first: boolean) => {
    const mine = latest.next();
    try {
      const answer = await mailApi.thread(props.id);
      if (!mine()) return;
      const newest = answer.messages.at(-1);
      const opened = [...new Set([...open(), ...answer.messages.filter((message) => message.unread || message === newest).map((message) => message.id)])];
      // The markdown drawer comes with the bodies, so nothing is drawn half-made.
      await Promise.all([fetchBodies(opened), ChatMarkdown.preload()]);
      if (!mine()) return;
      setMessages(answer.messages);
      // Kept by id: a composer stands (its focus, its words) while the hub's copy of its draft moves on.
      setDrafts(answer.drafts.map((draft) => drafts().find((held) => held.id === draft.id) ?? draft)); setOpen(opened); setThread(answer.thread);
      if (first && answer.thread.unread) void props.list.triage([answer.thread], { unread: false }, (now) => { const own = now.find((one) => one.id === props.id); if (own) setThread(own); });
    } catch (reason) { if (mine()) setFailed(failure(reason)); }
  };
  void read(true);
  const heard = (event: Event) => {
    const detail = (event as CustomEvent<{ threads?: string[] }>).detail;
    if (!detail?.threads?.length || detail.threads.includes(props.id)) void read(false);
  };
  window.addEventListener("conduit:mail-changed", heard);
  onCleanup(() => window.removeEventListener("conduit:mail-changed", heard));

  // A change that takes it out of the list shown (archived from the inbox, trashed) closes it.
  const ours = (now: MailThread[]) => {
    const own = now.find((one) => one.id === props.id);
    if (own) setThread(own);
    if (!own || !props.list.threads().some((one) => one.id === props.id)) props.onGone();
  };
  const unfold = async (id: string) => {
    try { await fetchBodies([id]); setOpen([...open(), id]); }
    catch (reason) { toast.error(failure(reason)); }
  };
  const write = async (input: Omit<Parameters<typeof mailApi.newDraft>[0], "account">) => {
    try { const draft = await mailApi.newDraft({ account: thread()!.account, ...input }); setDrafts([...drafts().filter((one) => one.id !== draft.id), draft]); }
    catch (reason) { toast.error(failure(reason)); }
  };

  const bar = (end?: JSX.Element) => <ToolBar end={end}>
    <Show when={props.back}>{(back) => <HeaderButton label="Back" icon={<Icons.Back />} onClick={back()} />}</Show>
  </ToolBar>;
  const verbs = (current: MailThread) => <>
    <For each={threadVerbs(current, props.list, ours).slice(0, 3)}>{(verb) => <IconButton label={verb.label} disabled={verb.disabled} onClick={verb.run}>{verb.icon()}</IconButton>}</For>
    <DropdownMenu modal={false} placement="bottom-end">
      <MenuControl as={IconButton} label="Labels"><Icons.Label /></MenuControl>
      <MenuContent width="sm"><MenuSection title="Labels" note={props.labels.some((label) => !label.role && label.id !== "all") ? undefined : "No labels of your own"}>
        {labelRows(current, props.labels, props.list, ours)}</MenuSection></MenuContent>
    </DropdownMenu>
    {(() => { const trash = threadVerbs(current, props.list, ours).at(-1)!; return <IconButton label={trash.label} onClick={trash.run}>{trash.icon()}</IconButton>; })()}
  </>;

  const message = (item: MailMessage) => {
    const body = () => bodies()[item.id];
    const isOpen = () => open().includes(item.id) && Boolean(body());
    return <EmailItem from={named(item.from, props.own)} to={[...item.to, ...item.cc].map((party) => named(party, props.own)).join(", ")}
      time={mailTime(item.date)} dateTime={item.date} folded={!isOpen()} snippet={item.snippet} onOpen={() => void unfold(item.id)} quoted={body()?.quoted || undefined}
      attachments={body()?.attachments.length ? <For each={body()!.attachments}>{(file) => <Row density="line" element="button" lead={<Icons.Attach />} label={file.filename} meta={size(file.size)}
        onClick={() => void downloadAttachment(item.id, file.index, file.filename).catch((reason) => toast.error(failure(reason)))} />}</For> : undefined}
      actions={<>
        <Show when={item.draft} fallback={<>
          <Button variant="ghost" outline size="sm" onClick={() => void write({ reply: item.id })}><Icons.Reply />Reply</Button>
          <Button variant="ghost" outline size="sm" onClick={() => void write({ reply: item.id, replyAll: true })}><Icons.ReplyAll />Reply all</Button>
          <Button variant="ghost" outline size="sm" onClick={() => void write({ forward: item.id })}><Icons.MailForward />Forward</Button>
        </>}><Button variant="ghost" outline size="sm" onClick={() => void write({ adopt: item.id })}><Icons.Edit />Edit</Button></Show>
        <Show when={body()?.html}><Button variant="ghost" size="sm" onClick={() => setShowing({ message: item.id, images: false })}>Original</Button></Show>
      </>}>
      <Answer><Suspense fallback={<Spinner />}><ChatMarkdown streaming={false}>{body()?.markdown ?? ""}</ChatMarkdown></Suspense></Answer>
    </EmailItem>;
  };

  return <Show when={thread()} fallback={<>{bar()}<Show when={failed()} fallback={<Loading kind="pane"><Spinner />Opening the thread</Loading>}><Empty role="alert">{failed()}</Empty></Show></>}>{(current) =>
    <Show when={showing()} fallback={<>
      {bar(verbs(current()))}
      <ReadingScroll>
        <ReadingTitle>{current().subject || "(no subject)"}</ReadingTitle>
        <div><For each={messages()}>{message}</For></div>
        <For each={drafts()}>{(draft) => <DraftComposer draft={draft} autofocus subject={Boolean(draft.forward)}
          onDone={() => setDrafts(drafts().filter((one) => one.id !== draft.id))} />}</For>
      </ReadingScroll>
    </>}>{(view) => <>
      <ToolBar end={<Button variant="ghost" size="sm" disabled={view().images} onClick={() => setShowing({ ...view(), images: true })}>Load images</Button>}>
        <HeaderButton label="Back to the thread" icon={<Icons.Back />} onClick={() => setShowing(null)} /><small>Original</small>
      </ToolBar>
      <WebPage title="The message as it was sent" sandbox="" srcdoc={original(bodies()[view().message]?.html ?? "", view().images)} />
    </>}</Show>}</Show>;
}
