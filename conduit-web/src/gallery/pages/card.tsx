import { Icons } from "@/components/ui";
import { createDecisionDialogs } from "@/components/decision-dialog";
import { WorkspaceAppearanceEditor } from "../../client/project/workspace-appearance-editor";
import { ComputerExplorer } from "../../client/dashboard/computer-dashboard";
import WorkspaceExcerptView from "../../client/workspace/workspace-excerpt-view";
import { CameraPreview } from "@/components/ui/connection";
import { Dialog } from "@/components/dialog";
import { CardColumns, CardColumn, CardCaption, CardActions, CardForm, CardBody, CardNote, CardRead, CardDetails, CardQR, CardPreview, Attachments, Attachment } from "@/components/ui/card";
import { createSignal, For } from "solid-js";
import { Field, Segmented, Button, Card, TextArea, Input, Read, Preview } from "@/components/ui";
import { PROJECTS } from "../seed";
import { InUse, FormTable, form, px, rounding, edge, bg, Replay, type Mark, type FormRow } from "../specs";
import { typeOf, ConnectionDemo, SwitchDemo } from "../demos";
import { type Family, lib } from "../model";

/* Card: its parts measured in a prompt, then each form at each density. */
export const cardScene = () => <div class="g-card-scene"><Card title="Destroy Japan?" detail="Type Japan to confirm." actions={<><Button variant="ghost" outline>Cancel</Button><Button variant="destructive">Destroy</Button></>}><Input placeholder="Japan" /></Card></div>;
export const CARD_MARKS: Mark[] = [
  { selector: ".ui-card", label: "--card-edge: padding all round, every box meets it (1.25 units)", read: (el) => px(getComputedStyle(el).paddingTop) },
  { selector: ".ui-card > h3", label: "title: the Heading role (--text-body · --weight-strong)", read: typeOf },
  { selector: ".ui-card > p", label: "detail: the Caption role (--text-caption · muted), --card-pair under the title", read: (el) => `${typeOf(el)} · ${px(`${el.getBoundingClientRect().top - el.previousElementSibling!.getBoundingClientRect().bottom}px`)} under` },
  { selector: ".ui-card .ui-input", label: "body: the library's Input, its box on the edge, --card-gap from what is above and below", read: (el) => { const card = el.closest<HTMLElement>(".ui-card")!.getBoundingClientRect(); const r = el.getBoundingClientRect(); return `${px(`${r.left - card.left}px`)} / ${px(`${card.right - r.right}px`)} from the sides · ${px(`${r.top - el.previousElementSibling!.getBoundingClientRect().bottom}px`)} gap`; } },
  { selector: ".ui-card-actions", label: "actions: right-aligned, half a unit apart, each the widest's width", read: (el) => `${px(getComputedStyle(el).columnGap)} apart · ${[...el.children].map((b) => px(`${b.getBoundingClientRect().width}px`)).join(" = ")}` },
  { selector: ".ui-card .ui-button[data-variant='ghost']", label: "a secondary action: ghost outline, a --tint hairline", read: edge },
  { selector: ".ui-card .ui-button[data-variant='destructive']", label: "the confirm: destructive, filled red", read: bg },
  { selector: ".ui-card", label: "corner --radius-surface; at most 30 units wide (a phone: its width)", read: (el) => `${rounding(el)} · ${px(`${el.getBoundingClientRect().width}px`)} wide` },
];
export function DialogBehaviorDemo(props: { alert?: boolean; busy?: boolean }) {
  const [open, setOpen] = createSignal(false);
  const [busy, setBusy] = createSignal(Boolean(props.busy));
  return <><Button onClick={() => { setBusy(Boolean(props.busy)); setOpen(true); }}>Open {props.busy ? "busy dialog" : props.alert ? "confirmation" : "dialog"}</Button>
    <Dialog open={open()} onOpenChange={setOpen} title="Example dialog" description="Keyboard and focus behavior" alert={props.alert} busy={busy()} close="Close example"
      actions={<><Button variant="ghost" outline disabled={busy()} onClick={() => setOpen(false)}>Cancel</Button><Button onClick={() => busy() ? setBusy(false) : setOpen(false)}>{busy() ? "Finish operation" : "Done"}</Button></>}>
      <Field label="Example name"><Input value="Example" /></Field>
    </Dialog></>;
}
export function DecisionDemo() {
  const decisions = createDecisionDialogs();
  const [answer, setAnswer] = createSignal("No decision yet");
  const [valid, setValid] = createSignal(true);
  return <CardBody>
    <Button onClick={async () => setAnswer(`Confirm: ${await decisions.confirm("Discard example changes?", { destructive: true, confirmLabel: "Discard" })}`)}>Try confirmation</Button>
    <Button onClick={async () => { const value = await decisions.prompt("Rename example", "Example"); setAnswer(value === null ? "Prompt cancelled" : `Prompt: ${JSON.stringify(value)}`); }}>Try prompt</Button>
    <Button onClick={() => {
      const first = decisions.confirm("First queued decision");
      const second = decisions.prompt("Second queued decision", "Queued");
      void Promise.all([first, second]).then((values) => setAnswer(JSON.stringify(values)));
    }}>Queue two decisions</Button>
    <Button onClick={async () => { setValid(true); const pending = decisions.confirm("This target expires while open", { valid }); setValid(false); setAnswer(`Expired: ${await pending}`); }}>Try expired target</Button>
    <CardNote>{answer()}</CardNote><decisions.Host />
  </CardBody>;
}
export function ExplorerDemo() {
  const [result, setResult] = createSignal("No action yet");
  const project = PROJECTS[0]!;
  const [location, setLocation] = createSignal({ project, home: "/home/you", parent: "/home", repository: false,
    listing: { truncated: false, entries: [{ name: "src", path: "src", type: "directory" as const }, { name: "README.md", path: "README.md", type: "file" as const, size: 1024 }, { name: ".hidden", path: ".hidden", type: "file" as const }] } });
  return <CardBody><ComputerExplorer dialog projects={PROJECTS} location={location()} loading={false} error=""
    onBrowse={(path) => { setResult(`Browse: ${path ?? "Home"}`); setLocation((current) => ({ ...current, project: { ...current.project, workingRoot: path ?? "/home/you" } })); }}
    onPrefetch={() => {}} onMakeWorkspace={() => setResult("Make workspace")} onCreateWorkspace={(path) => setResult(`Create workspace: ${path}`)}
    onOpenWorkspace={(target) => setResult(`Open: ${target.name}`)} onManageWorkspace={(action) => setResult(action)} onStartWorkspaceAction={(action) => setResult(action)}
    onOpenView={(view) => setResult(view)} onOpenFile={(path) => setResult(`Open: ${path}`)} onSelectFolder={() => setResult("Select folder")}
    onCreateFolder={() => setResult("Create folder")} onCloneRepository={() => setResult("Clone repository")} /><CardNote>{result()}</CardNote></CardBody>;
}
export const CARDS: FormRow[] = [
  form("async decisions", "confirm, prompt, queue, cancellation and stale target guard", () => <DecisionDemo />, "createDecisionDialogs > Dialog", "the live app's shared decision queue"),
  form("workspace identity", "mark, icon search, palette and custom colour; Save retains the draft", () => <WorkspaceAppearanceEditor compact onSave={() => {}} />, "WorkspaceAppearanceEditor > IdentityEditor", "v2 controls and tokens"),
  form("folder explorer", "search, sort, tiles/details, hidden files and context menus", () => <ExplorerDemo />, "ComputerExplorer > Browser", "same presentation as the live folder dialog"),
  form("server connection", "choices, address, password, loading and errors", () => <ConnectionDemo />, "ConnectionForm > ConnectionAddress · ConnectionStatus · ConnectionPassword", "no discovery or connection requests"),
  form("camera preview", "camera display and cancel, without opening a real camera", () => <CameraPreview videoRef={() => {}} message="Point the camera at a pairing code" onClose={() => {}} />, "CameraPreview", "the real scanner's v2 presentation"),
  form("code excerpt", "real read-only code with line numbers and highlighted selection", () => <WorkspaceExcerptView path="example.ts" text={"const total = 42;\nconsole.log(total);"} firstLine={12} startColumn={7} endColumn={13} />, "WorkspaceExcerptView > CodeExcerpt", "CodeMirror uses v2 syntax and size tokens"),
  form("modal", "focus is trapped, Escape or a press on the dim closes; focus returns to the trigger", () => <DialogBehaviorDemo />, "Dialog > Scrim + Card", "Kobalte behavior, v2 surface"),
  form("modal alert", "a press on the dim does not dismiss a confirmation", () => <DialogBehaviorDemo alert />, "<Dialog alert>", "Kobalte alert-dialog"),
  form("modal busy", "Escape, the dim and close cannot dismiss while busy; finish releases the dialog", () => <DialogBehaviorDemo busy />, "<Dialog busy>", "all dismissal paths share the busy guard"),
  form("shared parts", "forms, actions, notes, paths and previews use the Card's spacing", () => <Card title="Shared dialog parts"><CardForm onSubmit={(event) => event.preventDefault()}><CardBody><Field label="Name"><Input value="Example" /></Field><CardRead>src/example.ts</CardRead><CardNote>Supporting text</CardNote><CardPreview><Read>Selected source</Read></CardPreview><CardDetails><dt>Server</dt><dd>Laptop</dd></CardDetails><CardQR svg="" expired /></CardBody><CardActions><Button type="submit">Save</Button></CardActions></CardForm></Card>, "CardForm · CardBody · CardActions · CardRead · CardNote · CardPreview · CardDetails · CardQR", "v2 tokens only"),
  form("title", "a card says what it is about", () => <Card title="Delete this chat?" />, "<Card title>", "Heading: --text-body · --weight-strong"),
  form("title · detail", "a line --card-pair under the title, only when it asks something of you: never what the title already says", () => <Card title="Destroy Japan?" detail="Type Japan to confirm." />, "<Card title detail>", "Caption: --text-caption · muted, --card-pair under the title"),
  form("body", "what the card holds: one field, a list, a preview", () => <Card title="Rename chat"><Input value="Lorem ipsum file" /></Card>, "<Card title>{children}</Card>", "1 unit between parts; the Input's well and line are the surface's"),
  form("actions", "its buttons, right-aligned: the place picks each form", () => <Card title="Save changes?" actions={<><Button variant="ghost" outline>Cancel</Button><Button outline>Save</Button></>} />, "<Card actions={<>…</>}>", "half a unit apart · primary outline, ghost outline"),
  form("alert", "confirms what cannot be undone (Dialog alert)", () => <Card title="Delete this chat?" actions={<><Button variant="ghost" outline>Cancel</Button><Button variant="destructive">Delete</Button></>} />, "<Card title detail actions>", "the confirm destructive, filled"),
  form("prompt", "one field and its answer (Dialog)", () => <Card title="Rename chat" actions={<><Button variant="ghost" outline>Cancel</Button><Button outline>Save</Button></>}><Input value="Lorem ipsum file" /></Card>, "<Card title actions>{<Input />}</Card>", "a one-field prompt drops its label"),
];
/*
 * In the app: every dialog the app opens, rebuilt from its real content with v2 alone. Lines
 * that only restate the title are left out (DESIGN.md Dialog). Under each: its file, and what v2
 * still lacks for it, or that it has all of it.
 */
export const status = (needs?: string) => needs ? `Needs: ${needs}` : "v2 has all of it";
/** A fresh Cancel each time: one element can only be in one place. */
export const cancel = () => <Button variant="ghost" outline>Cancel</Button>;
export const files = [{ name: "M105525021_AAMI_incident_form_completed_signed.pdf", detail: "940 KB · application/pdf", icon: () => <Icons.FileText /> }, { name: "notes.txt", detail: "2.1 KB · text/plain", icon: () => <Icons.FileText /> }];
export const IN_APP: FormRow[] = [
  form("Rename chat · folder · terminal", "one name, then Rename", () => <Card title="Rename chat" actions={<>{cancel()}<Button outline>Rename</Button></>}><Field label="Name"><Input value="Lorem ipsum file" /></Field></Card>, "navigation/sidebar.tsx · remotes/terminal-pane.tsx", status()),
  form("Edit shortcut", "the terminal's shortcut, from its shortcuts menu: name, command, which shell, and whether /terminal runs it on start", () => <Card title="Edit shortcut" description="A command you run often, one press from the terminal's header." actions={<>{cancel()}<Button outline>Save</Button></>}><Field label="Name"><Input value="Dev" /></Field><Field label="Command"><Input value="npm run dev" /></Field><Field plain label="Runs in"><Segmented label="Runs in" value="current" options={[{ value: "current", label: "This shell" }, { value: "new", label: "New shell" }]} onChange={() => {}} /></Field><Field inline label="Also run it when /terminal starts or recovers a shell"><SwitchDemo /></Field></Card>, "remotes/terminal-pane.tsx · Field plain, Field inline", status()),
  form("New folder", "a display name, then Create folder", () => <Card title="New folder" actions={<>{cancel()}<Button outline>Create folder</Button></>}><Field label="Display name"><Input placeholder="Research" /></Field></Card>, "navigation/sidebar.tsx", status()),
  form("Delete chat · chats", "the sidebar's and chat search's delete", () => <Card title="Delete 3 chats?" actions={<>{cancel()}<Button variant="destructive">Delete 3 chats</Button></>} />, "navigation/sidebar.tsx · navigation/command-menu.tsx", status()),
  form("Delete workspace and files", "type its name to confirm; Delete waits until it matches", () => <Card title="Delete workspace and files?" detail="Type the workspace's name, Japan, to continue." actions={<>{cancel()}<Button variant="destructive" disabled><Icons.Delete />Delete workspace</Button></>}><Field label="Workspace name"><Input /></Field></Card>, "project/dashboard.tsx", status()),
  form("Open external link", "the address, shown before it opens", () => <Card title="Open external link?" actions={<>{cancel()}<Button outline>Open link</Button></>}><CardRead>https://example.com/a/long/path?q=1&amp;ref=conduit</CardRead></Card>, "chat/external-link-dialog.tsx", status()),
  form("Attachments", "every file on the draft, opened from the strip: remove one, or all", () => <Card size="wide" title="2 attachments" actions={<><Button variant="ghost" outline>Remove all</Button><Button outline>Done</Button></>}><Attachments><For each={files}>{(file) => <Attachment name={file.name} detail={file.detail} icon={file.icon()} onRemove={() => {}} />}</For></Attachments></Card>, "chat/attachment-strip.tsx", status()),
  form("Attachments · tray", "the files a message was sent with, under it in the transcript: each framed, an image a thumbnail, name and detail cut short", () => <Attachments form="tray" label="Attachments"><For each={files}>{(file) => <Attachment name={file.name} detail={file.detail} icon={file.icon()} />}</For></Attachments>, "chat/attachments.tsx · <Attachments form=\"tray\">"),
  form("Edit review comment", "the excerpt it is on, and its text", () => <Card size="wide" close title="Edit review comment" detail="src/main.tsx · lines 12–14" actions={<>{cancel()}<Button outline>Save comment</Button></>}><Preview>{"const total = items.reduce(\n  (sum, item) => sum + item.size, 0);"}</Preview><TextArea value="This could use the size label helper." /></Card>, "chat/review-comment-cards.tsx", status()),
  form("Connect", "pair this server as a QR, or add another", () => <Card size="split" close title="Connect"><CardColumns><CardColumn title="Pair a device"><div class="g-slot g-qr">QR code</div><CardCaption>laptop.ts.net</CardCaption><CardDetails><dt>Opens on</dt><dd>Tailscale</dd><dt>Code</dt><dd>Single use · 4:52</dd></CardDetails><CardActions><Button variant="ghost">Copy link</Button><Button variant="ghost" outline>New code</Button></CardActions></CardColumn><CardColumn title="Add server"><Input aria-label="Server address" placeholder="Address or pair link" /><Button variant="ghost" outline><Icons.QrCode />Scan QR code</Button><Button outline>Connect</Button></CardColumn></CardColumns></Card>, "navigation/pair-dialog.tsx · main.tsx (ServerConnectForm)", status()),
  form("Workspace identity", "a short mark or an icon, then its colour", () => <Card size="wide" close title="Workspace identity" actions={<Button outline>Save</Button>}><Segmented label="Kind" value="mark" options={[{ value: "mark", label: "Mark" }, { value: "icon", label: "Icon" }]} onChange={() => {}} /><Field label="Mark"><Input value="JP" /></Field></Card>, "main.tsx · project/dashboard.tsx (WorkspaceAppearanceEditor)", status()),
];

export const cardFamily: Family = { title: "Card", note: "raised frost at a dialog's width and padding: title · detail · body · actions, drawn from the library's Input and Buttons. Its actions: the primary one a white outline, the others ghost outline, a destructive confirm filled red", usage: `import { Card, CardDetails, CardRead } from "@/components/ui/card";

<Card embedded size="wide" title="Cloning workspace" detail="Closing this tab does not stop the operation.">
  <CardDetails><dt>Destination</dt><dd>/work/conduit</dd></CardDetails>
  <CardRead>Preparing clone…</CardRead>
</Card>`,
  api: ["Card", "CardBody", "CardActions", "CardForm", "CardColumns", "CardColumn", "CardNote", "CardRead", "CardDetails", "CardQR", "CardCaption", "CardPreview", "Attachments", "Attachment"],
  groups: [
    { title: "In use", note: "a confirm, measured: pink is the card's edge (--card-edge), green the gaps between its parts (--card-gap, --card-pair title to detail, half a unit between actions)", layout: "desktop", atoms: [
      lib("card-inuse", "Card in use", "both", "card", "Card title detail children actions", () => <InUse scene={cardScene} marks={CARD_MARKS} spacing={[".ui-card", ".ui-card-actions"]} />, "row"),
    ] },
    { title: "Forms", note: "each form at each density -- the phone's a phone wide. Every card: --frost-* raised, corner --radius-surface, and spacing it declares: --card-edge all round, which every box meets (1.25 units), --card-gap between parts (1 unit), --card-pair title to detail (0.5); text trimmed to its glyphs; actions share the widest's width. A phone's card is the screen's width", layout: "desktop", atoms: [
      lib("card-forms", "Card · forms × densities", "both", "card", "Card", () => <FormTable rows={CARDS} on={["desktop", "phone"]} widths={["200px", "minmax(0, 1fr)", "360px"]} />, "row"),
    ] },
    { title: "In the app", note: "every dialog the app opens (Dialog), rebuilt from its real content with v2 alone: Card (wide, close), Field, Input, TextArea, Chip, Section and Items, the code preview, Segmented, Buttons. Under each, its file and what v2 still lacks for it", layout: "desktop", atoms: [
      lib("card-in-app", "Dialog · in the app", "both", "card", "client/**/Dialog", () => <FormTable rows={IN_APP} on={["desktop", "phone"]} widths={["minmax(0, 1fr)", "360px"]} stacked />, "row"),
    ] },
    { title: "Motion", note: "its own moves: a card rises in over the page and drops back when it closes", layout: "desktop", atoms: [
      lib("card-motion", "Card · motion", "both", "card", "Card motion", () => <FormTable rows={[form("arrives · leaves", "rises --space-md with a fade; drops back", () => <Replay leaves={["leaving"]}>{(m) => <Card title="Delete 3 chats?" motion={m()} actions={<><Button variant="ghost" outline>Cancel</Button><Button variant="destructive">Delete</Button></>} />}</Replay>, "<Card motion>", "in: --duration-gentle · --ease-arrive · out: --duration-quick · --ease-leave")]} on={["desktop", "phone"]} widths={["200px", "minmax(0, 1fr)", "minmax(0, 1fr)"]} />, "row"),
    ] },
  ] };
