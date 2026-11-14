import { createSignal, For, lazy, onMount, Show, Suspense } from "solid-js";
import { Answer, Button, ComposerField, ComposerLine, DashDay, DesktopComposer, DraftState, EmailItem, Icons, IconButton, MailRow, PaneHeader, ReaderSplit, ReadingScroll, ReadingTitle,
  Row, Segmented, TextArea, ToolBar, Toolbar } from "@/components/ui";
import { PaneTab, PaneTabRow, PaneTabs, TabPlace } from "@/components/ui/pane";
import { Actions } from "@/components/ui/actions";
import { attachRowMenus } from "@/components/ui/menus";
import type { MailAccount, MailBody, MailChange, MailDraft, MailLabel, MailMessage, MailParty, MailThread } from "@/mail/mail";
import { row, type Page } from "../model";

const MailPane = lazy(() => import("../../client/mail/mail-pane"));
const MailSettings = lazy(() => import("../../client/settings/mail-settings").then((module) => ({ default: module.MailSettings })));

/* --- A made-up mailbox behind a stub of the hub's /v0/mail, so the real pane runs here without a hub. --- */

const NOW = Date.now();
const ago = (hours: number) => new Date(NOW - hours * 3_600_000).toISOString();
const me: MailParty = { name: "Jask", address: "jask@example.com" };
const party = (name: string, domain = "example.com"): MailParty => ({ name, address: `${name.split(" ")[0]!.toLowerCase()}@${domain}` });
const maya = party("Maya Chen", "albertst-realty.example"), tom = party("Tom Okafor"), priya = party("Priya Raman"), lena = party("Lena Fischer"), hana = party("Hana Sato", "ryokan.example");
const shop = (name: string) => ({ name, address: `hello@${name.toLowerCase().replace(/\W+/g, "")}.example` });

type Seed = { subject: string; hours: number; from: MailParty[]; text: string[]; labels?: string[]; unread?: boolean; starred?: boolean; file?: string; html?: boolean };
const SEEDS: Seed[] = [
  { subject: "Lease renewal for 14 Albert St", hours: 1, from: [maya, me, tom, maya], labels: ["l2"], unread: true, starred: true, file: "lease-renewal-2027.pdf", text: [
    "Hi both, the lease is up on 31 December. The owner would like to renew for twelve months at **$720 a week**.",
    "Thanks Maya. Could we do $700 given the hot water issue this winter? Happy to sign for twelve months.",
    "Either works for me, as long as it's twelve months and not six.",
    "Hi both,\n\nTom's fine with the twelve months, and the owner has agreed to **$700 a week** given the hot water. I've attached the renewal; sign by Friday if you can and I'll countersign.\n\nMaya"] },
  { subject: "Ryokan in Shirakawa-go: two nights confirmed", hours: 2.5, from: [hana], labels: ["l1"], unread: true, html: true, text: ["Your stay on 3–5 December is confirmed. Dinner is served at 18:30 in the hearth room; please tell us of any allergies."] },
  { subject: "[conduit] Release v0.8.11 published", hours: 3, from: [shop("GitHub")], labels: ["l4"], unread: true, text: ["jask-aran published conduit v0.8.11: jbot work log and digest."] },
  { subject: "Saturday climbing?", hours: 3.4, from: [priya, me], text: ["Gym opens at 9. I can bring the spare harness if Tom wants to come.", "Count me in, 9:30?"] },
  { subject: "Your November bill is ready", hours: 18, from: [shop("Northwind Energy")], labels: ["l3"], file: "bill-november.pdf", text: ["Amount due $142.30 by 28 November."] },
  { subject: "Re: bike rack", hours: 20, from: [tom], unread: true, text: ["Measured it: the rack fits if we take the front wheel off. Want to try Sunday?"] },
  { subject: "Notes from Thursday's review", hours: 25, from: [lena, me, lena], labels: ["l4"], unread: true, text: ["Agreed on the pane layout.", "Where does search live once the list folds?", "With the list: it goes where the list goes."] },
  { subject: "Check in for SYD → KIX now open", hours: 40, from: [shop("Harbour Air")], labels: ["l1"], starred: true, text: ["Flight HA 21 departs 1 December at 09:05. Choose your seats and add bags."] },
  { subject: "Invoice 2026-114", hours: 46, from: [party("Sam Whitlock")], labels: ["l3"], file: "invoice-2026-114.pdf", text: ["Please find attached the invoice for October's work. Payment terms 14 days."] },
  { subject: "Photos from the coast", hours: 70, from: [priya], file: "lighthouse.jpg", text: ["Finally sorted them. The lighthouse came out really well."] },
  { subject: "Smoke alarm check", hours: 75, from: [maya], labels: ["l2"], text: ["The technician will come by Wednesday between 8 and 12. No need to be home."] },
  { subject: "Draft agenda for the offsite", hours: 100, from: [lena], labels: ["l4"], unread: true, text: ["Day one is planning, day two is building. Shout if anything's missing."] },
  { subject: "Dinner Thursday", hours: 120, from: [tom, me], text: ["Booked for 7:30 at the Thai place on King St.", "Perfect."] },
];
const TOPICS = ["Book club: December pick", "Water bill share", "Your hold is ready", "Welcome to the team space", "Re: scope for December", "Planned outage on your street",
  "Your order has shipped", "A note on your wishlist", "Weekly digest", "Receipt for your purchase", "Garden fence", "Quarterly plan"];
for (let index = 0; index < 60; index++) SEEDS.push({ subject: TOPICS[index % TOPICS.length]!, hours: 170 + index * 30, from: [[priya, tom, lena, maya][index % 4]!], text: [`Older mail, number ${index + 1}, so the list has pages to read in.`] });

type Held = { thread: MailThread; messages: MailMessage[]; bodies: Record<string, MailBody> };
let held: Held[] = [];
let drafts: MailDraft[] = [];
let accounts: MailAccount[] = [];
let mode: Scenario = "syncing";
const LABELS: MailLabel[] = [
  { id: "inbox", name: "Inbox", role: "inbox", unread: 0 }, { id: "starred", name: "Starred", role: "starred", unread: 0 }, { id: "sent", name: "Sent", role: "sent", unread: 0 },
  { id: "drafts", name: "Drafts", role: "drafts", unread: 0 }, { id: "all", name: "All mail", role: null, unread: 0 },
  { id: "l1", name: "Japan trip", role: null, unread: 0 }, { id: "l2", name: "House", role: null, unread: 0 }, { id: "l3", name: "Receipts", role: null, unread: 0 }, { id: "l4", name: "Conduit", role: null, unread: 0 },
];

function seed(scenario: Scenario) {
  mode = scenario;
  accounts = scenario === "none" ? [] : [{ id: "a1", kind: "fixture", address: me.address, name: me.name,
    status: scenario === "error" ? { state: "error", error: "The source refused the sign-in: make a new app password in Settings › Mail." }
      : { state: "syncing", backfill: { done: 4210, total: 18532 } } }];
  held = SEEDS.map((one, index) => {
    const id = `t${index + 1}`;
    const messages = one.from.map((from, at): MailMessage => ({ id: `${id}m${at + 1}`, thread: id, account: "a1", from, to: from === me ? [one.from[0]!] : [me, ...(one.from.includes(tom) && from !== tom ? [tom] : [])],
      cc: [], bcc: [], subject: one.subject, date: ago(one.hours + (one.from.length - 1 - at) * 20), snippet: one.text[at]!.replace(/\*\*/g, "").replace(/\n+/g, " ").slice(0, 140),
      unread: Boolean(one.unread) && at === one.from.length - 1, starred: false, draft: false, labels: ["inbox", ...(one.labels ?? [])], attachments: Boolean(one.file) && at === one.from.length - 1, held: true }));
    const last = messages.at(-1)!;
    const bodies = Object.fromEntries(messages.map((message, at) => [message.id, { message: message.id, markdown: one.text[at]!, quoted: at > 0 ? `On ${new Date(messages[at - 1]!.date).toDateString()}, ${messages[at - 1]!.from.name} wrote:\n> ${messages[at - 1]!.snippet}` : "",
      html: one.html ? `<div style="font-family:Georgia,serif;max-width:560px;margin:24px auto;color:#222"><h2 style="color:#7a3b12">白川郷 · Shirakawa-go</h2><p>${one.text[at]}</p><img src="https://picsum.photos/520/200" alt="The village in snow" width="520" height="200"><p style="color:#888">A tracker would have been here.</p></div>` : null,
      attachments: one.file && message === last ? [{ index: 0, filename: one.file, mimeType: "application/octet-stream", size: 184_320 }] : [] } satisfies MailBody]));
    const thread: MailThread = { id, account: "a1", subject: one.subject, from: [...new Map(one.from.map((from) => [from.address, from])).values()], date: last.date, snippet: last.snippet,
      count: messages.length, unread: messages.filter((message) => message.unread).length, labels: ["inbox", ...(one.labels ?? []), ...(one.starred ? ["starred"] : [])],
      starred: Boolean(one.starred), attachments: Boolean(one.file), draft: false };
    return { thread, messages, bodies };
  });
  drafts = [draft({ id: "d1", thread: "t1", to: [maya, tom], subject: "Re: Lease renewal for 14 Albert St", text: "Thanks Maya, that's great. I'll sign it tonight.", reply: "t1m4", state: "saved" })];
  held[0]!.thread.draft = true;
}
function draft(input: Partial<MailDraft> & { id: string }): MailDraft {
  return { account: "a1", thread: null, to: [], cc: [], bcc: [], subject: "", text: "", reply: null, forward: null, updated: new Date().toISOString(), state: "saved", ...input };
}
const holds = (label: string, thread: MailThread) => label === "all" || thread.labels.includes(label) || (label === "drafts" && thread.draft);
const labelsNow = () => LABELS.map((label) => ({ ...label, unread: held.filter((one) => holds(label.id, one.thread)).reduce((sum, one) => sum + one.thread.unread, 0) }));
const tell = (threads?: string[]) => window.dispatchEvent(new CustomEvent("conduit:mail-changed", { detail: { type: "mail_changed", account: "a1", threads } }));
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const answer = (body: unknown, status = 200) => new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

async function mailRoute(url: URL, init: RequestInit = {}): Promise<Response> {
  await pause(120);
  const method = (init.method ?? "GET").toUpperCase(), path = url.pathname.replace("/v0/mail", ""), body = init.body ? JSON.parse(String(init.body)) as Record<string, unknown> : {};
  const find = (id: string) => held.find((one) => one.thread.id === id);
  const message = (id: string) => held.flatMap((one) => one.messages).find((one) => one.id === id);
  if (path === "/accounts") return method === "POST" ? answer({ error: "refused", message: "The source refused the sign-in: check the app password." }, 400) : answer({ accounts });
  if (/^\/accounts\/[^/]+\/labels$/.test(path)) return answer({ labels: labelsNow() });
  if (path === "/threads") {
    const label = url.searchParams.get("label") ?? "inbox", limit = Number(url.searchParams.get("limit") ?? 50), before = url.searchParams.get("before");
    const all = held.filter((one) => holds(label, one.thread)).map((one) => one.thread);
    const from = before ? all.findIndex((one) => one.id === before) + 1 : 0, page = all.slice(from, from + limit);
    return answer({ threads: page, next: from + limit < all.length ? page.at(-1)!.id : null });
  }
  const opened = /^\/threads\/([^/]+)$/.exec(path);
  if (opened) { const one = find(opened[1]!); return one ? answer({ thread: one.thread, messages: one.messages, drafts: drafts.filter((draft) => draft.thread === one.thread.id) }) : answer({ error: "not_found", message: "No such thread." }, 404); }
  const body_ = /^\/messages\/([^/]+)\/body$/.exec(path);
  if (body_) return answer(held.find((one) => one.bodies[body_[1]!])!.bodies[body_[1]!]);
  if (/\/attachments\/\d+$/.test(path)) return new Response(new Blob(["A file from the gallery's made-up mailbox.\n"]), { headers: { "content-type": "text/plain" } });
  if (path === "/change") {
    const change = body as MailChange, ids = change.threads ?? [];
    if (change.trash) { held = held.filter((one) => !ids.includes(one.thread.id)); tell(ids); return answer({ threads: [] }); }
    for (const one of held.filter((one) => ids.includes(one.thread.id))) {
      const labels = [...new Set([...one.thread.labels.filter((label) => !change.remove?.includes(label)), ...(change.add ?? [])])];
      const unread = change.unread === undefined ? one.thread.unread : change.unread ? 1 : 0;
      one.thread = { ...one.thread, labels, unread, starred: labels.includes("starred") };
      one.messages = one.messages.map((message, at) => ({ ...message, unread: change.unread === undefined ? message.unread : change.unread && at === one.messages.length - 1 }));
    }
    tell(ids);
    return answer({ threads: held.filter((one) => ids.includes(one.thread.id)).map((one) => one.thread) });
  }
  if (path === "/search") {
    const q = (url.searchParams.get("q") ?? "").toLowerCase();
    if (url.searchParams.get("remote")) await pause(900);
    return answer({ threads: held.map((one) => one.thread).filter((thread) => `${thread.subject} ${thread.snippet} ${thread.from.map((from) => from.name).join(" ")}`.toLowerCase().includes(q)) });
  }
  if (path === "/drafts" && method === "GET") return answer({ drafts });
  if (path === "/drafts" && method === "POST") {
    const original = message(String(body.reply ?? body.forward ?? body.adopt ?? ""));
    const made = draft({ id: `d${Date.now()}`, thread: original?.thread ?? null, reply: body.reply ? original!.id : null, forward: body.forward ? original!.id : null, state: "saving",
      to: original && !body.forward ? [original.from, ...(body.replyAll ? original.to.filter((to) => to.address !== me.address) : [])] : [],
      subject: original ? `${body.forward ? "Fwd" : "Re"}: ${original.subject}` : "", text: original ? `\n\nOn ${new Date(original.date).toDateString()}, ${original.from.name} wrote:\n> ${original.snippet}` : "" });
    drafts.push(made);
    setTimeout(() => { made.state = "saved"; tell(made.thread ? [made.thread] : undefined); }, 500);
    return answer({ draft: made }, 201);
  }
  const drafted = /^\/drafts\/([^/]+)(\/send)?$/.exec(path);
  if (drafted) {
    const found = drafts.find((one) => one.id === drafted[1]);
    if (!found) return answer({ error: "not_found", message: "No such draft." }, 404);
    if (method === "DELETE") { drafts = drafts.filter((one) => one !== found); return answer(undefined, 204); }
    if (drafted[2]) {
      if (!found.to.length) return answer({ error: "refused", message: "Say who it goes to." }, 400);
      await pause(600);
      drafts = drafts.filter((one) => one !== found);
      const one = found.thread ? find(found.thread) : null;
      if (one) { one.messages.push({ ...one.messages.at(-1)!, id: `${one.thread.id}m${one.messages.length + 1}`, from: me, to: found.to, date: new Date().toISOString(), snippet: found.text.slice(0, 140), unread: false });
        one.bodies[one.messages.at(-1)!.id] = { message: one.messages.at(-1)!.id, markdown: found.text, quoted: "", html: null, attachments: [] }; one.thread = { ...one.thread, count: one.messages.length, draft: false }; }
      tell(found.thread ? [found.thread] : undefined);
      return answer({ sent: true });
    }
    Object.assign(found, body, { state: "saving", updated: new Date().toISOString() });
    setTimeout(() => { found.state = "saved"; tell(found.thread ? [found.thread] : undefined); }, 500);
    return answer({ draft: { ...found } });
  }
  return answer({ error: "not_found", message: "No such route." }, 404);
}

let stubbed = false;
/** Mounted over the gallery's own stub (which answers every /v0 with {}), so it is installed when a pane mounts. */
const stubMail = () => {
  if (stubbed) return;
  stubbed = true;
  attachRowMenus();
  const under = window.fetch.bind(window);
  window.fetch = (input, init) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url, location.href);
    return url.origin === location.origin && url.pathname.startsWith("/v0/mail") ? mailRoute(url, init) : under(input, init);
  };
};

type Scenario = "syncing" | "error" | "none";
seed("syncing");
function LivePane(props: { width: string }) {
  const [scenario, setScenario] = createSignal<Scenario>(mode);
  const [run, setRun] = createSignal(0);
  onMount(stubMail);
  const choose = (next: Scenario) => { seed(next); setScenario(next); setRun(run() + 1); };
  return <div style={{ display: "grid", gap: "var(--space-sm)", width: props.width, "max-width": "100%" }}>
    <div style={{ "justify-self": "start" }}><Segmented label="Mailbox" size="sm" value={scenario()} onChange={choose} options={[{ value: "syncing", label: "Syncing" }, { value: "error", label: "Not working" }, { value: "none", label: "No account" }]} /></div>
    <div style={{ display: "flex", height: "calc(40 * var(--u-space))", overflow: "hidden", "border-radius": "var(--radius-surface)", background: "var(--background)" }}>
      <Show when={run() + 1} keyed><Suspense><MailPane account="default" onAccount={() => {}} onSettings={() => {}}
        header={(actions) => <PaneHeader actions={<>{actions}<Actions kind="pane"><IconButton kind="pane" label="Close pane"><Icons.Close /></IconButton></Actions></>}>
          <PaneTabRow><PaneTabs><TabPlace><PaneTab title="Mail" shown icon={<Icons.Mail />} onClose={() => {}} /></TabPlace></PaneTabs></PaneTabRow></PaneHeader>} /></Suspense></Show>
    </div>
  </div>;
}

/* --- The pieces, each in its forms. --- */

const box = (width: number) => ({ width: `min(100%, calc(${width} * var(--u-space)))` });
const rows = () => <div style={box(30)}>
  <DashDay>Today</DashDay>
  <MailRow from="Maya, me, Tom" count={4} subject="Lease renewal for 14 Albert St" snippet="Tom's fine with the twelve months." time="09:42" unread starred attachments draft />
  <MailRow from="Hana Sato" subject="Ryokan in Shirakawa-go" snippet="Your stay on 3–5 December is confirmed." time="08:15" unread current />
  <MailRow from="Priya, me" count={2} subject="Saturday climbing?" snippet="Gym opens at 9." time="07:20" />
  <MailRow from="Northwind Energy" subject="Your November bill is ready" snippet="Amount due $142.30." time="Yesterday" attachments />
</div>;
const email = (props: { folded?: boolean }) => <EmailItem from="Maya Chen" to="me, Tom Okafor" time="09:42" folded={props.folded} snippet="Tom's fine with the twelve months, and the owner has agreed to $700 a week."
  quoted={"On Wed, Tom Okafor wrote:\n> Either works for me."} attachments={<Row density="line" element="button" lead={<Icons.Attach />} label="lease-renewal-2027.pdf" meta="180 KB" />}
  actions={<><Button variant="ghost" outline size="sm"><Icons.Reply />Reply</Button><Button variant="ghost" outline size="sm"><Icons.ReplyAll />Reply all</Button><Button variant="ghost" outline size="sm"><Icons.MailForward />Forward</Button></>}>
  <Answer><p>Tom's fine with the twelve months, and the owner has agreed to $700 a week. I've attached the renewal.</p></Answer></EmailItem>;
const composer = (state: MailDraft["state"], error?: string) => <div style={box(34)}><DesktopComposer>
  <ComposerLine id={`g-to-${state}`} label="To" value="Maya Chen <maya@albertst-realty.example>, Tom Okafor <tom@example.com>" end={<Button variant="ghost" size="sm">Cc</Button>} />
  <ComposerLine id={`g-subject-${state}`} label="Subject" value="Re: Lease renewal" />
  <ComposerField><TextArea value="Thanks Maya, I'll sign it tonight." /></ComposerField>
  <Toolbar end={<Button variant="ghost" size="icon-sm" aria-label="Discard draft"><Icons.Delete /></Button>} aside={<DraftState state={state} error={error} />} primary={<Button variant="ghost" size="icon-sm" aria-label="Send"><Icons.Send /></Button>} />
</DesktopComposer></div>;
const split = (width: number, show: "list" | "reader") => <div style={{ display: "flex", width: `calc(${width} * var(--u-space))`, "max-width": "100%", height: "calc(16 * var(--u-space))", background: "var(--background)" }}>
  <ReaderSplit show={show} list={<ReadingScroll>{rows()}</ReadingScroll>} reader={<ReadingScroll><ReadingTitle>Lease renewal for 14 Albert St</ReadingTitle><p>The open thread.</p></ReadingScroll>} />
</div>;

const WIDE = "calc(72 * var(--u-space))", NARROW = "calc(30 * var(--u-space))";
export const mailPage: Page = {
  title: "Mail", rail: "Blocks",
  summary: "Mail in a Work pane: a label's threads (MailRow) beside the open thread (ReaderSplit) while the pane holds both, else one at a time. The thread reads in a ReadingScroll under a ReadingTitle, its messages EmailItems (earlier ones folded to a line), a reply a DesktopComposer with ComposerLines and a DraftState. The panes below run the real MailPane over a made-up mailbox.",
  preview: rows,
  usage: `import { MailRow, ReaderSplit, ReadingScroll, ReadingTitle, EmailItem, ComposerLine, DraftState, ToolBar } from "@/components/ui";

<ReaderSplit show={open() ? "reader" : "list"} onFold={setFolded}
  list={<><ToolBar>{labels}{search}</ToolBar><ReadingScroll><MailRow from subject snippet time unread starred attachments draft current /></ReadingScroll></>}
  reader={<><ToolBar end={verbs}>{back}</ToolBar><ReadingScroll><ReadingTitle>{subject}</ReadingTitle><EmailItem folded snippet onOpen /><EmailItem attachments actions>…</EmailItem></ReadingScroll></>} />`,
  examples: [
    row("MailPane · wide", "the real pane over a made-up mailbox: open a thread, triage it (its row's menu too), write and send; the list reads in older pages as it scrolls", () => <LivePane width={WIDE} />, { surfaces: ["ground"], source: "mail/mail-pane.tsx" }),
    row("MailPane · narrow", "too narrow for both: the list, then a thread in its place with Back; Escape steps back", () => <LivePane width={NARROW} />, { surfaces: ["ground"], source: "mail/mail-pane.tsx" }),
    row("MailSettings", "Settings › Mail over the same mailbox: its accounts and how each stands, Remove behind a confirm, and the form to add one (this stub refuses every sign-in, to show the hub's sentence)", () => {
      onMount(stubMail);
      return <div style={box(40)}><Suspense><MailSettings /></Suspense></div>;
    }, { surfaces: ["frost"], source: "settings/mail-settings.tsx" }),
    row("MailRow", "unread (the dot, lit title and subject), starred, with attachments and a draft; current; read", rows, { surfaces: ["ground"], phone: true, code: "<MailRow from count subject snippet time unread starred attachments draft current />" }),
    row("ReaderSplit · both", "the frame holds --split-list beside --split-reader: both stand", () => split(60, "reader"), { surfaces: ["ground"], code: '<ReaderSplit show list reader onFold />' }),
    row("ReaderSplit · folded", "narrower than both minimums: one at a time, the other faded out where it stands", () => split(30, "reader"), { surfaces: ["ground"], code: '<ReaderSplit show="reader" />' }),
    row("EmailItem · open", "attachments under the text, and its foot of verbs", () => <div style={box(34)}>{email({})}</div>, { surfaces: ["ground"], code: "<EmailItem from to time quoted attachments actions>…</EmailItem>" }),
    row("EmailItem · folded", "one line that opens it", () => <div style={box(34)}>{email({ folded: true })}</div>, { surfaces: ["ground"], code: "<EmailItem folded snippet onOpen />" }),
    row("ComposerLine · DraftState · Saved", "addressed lines over the text; the draft's state in the toolbar's aside", () => composer("saved"), { surfaces: ["ground"], code: '<ComposerLine label="To" end /> · <DraftState state />' }),
    row("DraftState · Saving", "while an edit is on its way", () => composer("saving"), { surfaces: ["ground"] }),
    row("DraftState · Not saved", "the hub's reason after it", () => composer("failed", "The source refused the draft."), { surfaces: ["ground"] }),
    row("ToolBar · end", "a thread's bar: Back, and its verbs held at the far end", () => <ToolBar style={box(30)} end={<><IconButton label="Archive"><Icons.Archive /></IconButton><IconButton label="Mark read"><Icons.MailRead /></IconButton><IconButton label="Star"><Icons.Star /></IconButton><IconButton label="Labels"><Icons.Label /></IconButton><IconButton label="Trash"><Icons.Delete /></IconButton></>}>
      <IconButton label="Back"><Icons.Back /></IconButton></ToolBar>, { code: "<ToolBar end={verbs}>{back}</ToolBar>" }),
    row("ReadingScroll · ReadingTitle", "one column at the reading width, the pane scrolling it; the name at the title role", () => <div style={{ display: "flex", ...box(30), height: "calc(10 * var(--u-space))" }}><ReadingScroll><ReadingTitle>Ryokan in Shirakawa-go: two nights confirmed</ReadingTitle><For each={[1, 2, 3]}>{() => <p>Dinner is served at 18:30 in the hearth room.</p>}</For></ReadingScroll></div>, { surfaces: ["ground"] }),
  ],
  api: ["MailRow", "ReaderSplit", "ReadingScroll", "ReadingTitle", "EmailItem", "ComposerLine", "DraftState", "ToolBar"],
};
