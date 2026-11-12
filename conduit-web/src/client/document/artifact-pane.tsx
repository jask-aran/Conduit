import names from "virtual:ui-pieces";
import { createResource, createSignal, For, onCleanup, Show, type JSX } from "solid-js";
import { DocumentEditor, type DocumentHost, type DocumentMarks } from "@/components/document";
import { MarkupMargin, MarkupTool, httpTransport, type MarkupHost, type MarkupMode } from "@/components/markup";
import { Empty, HeaderButton, Icons, SheetFill, StatusDot } from "@/components/ui";
import { MarkupRibbonRoom } from "@/components/ui/markup";
import { DropdownMenu, MenuContent, MenuControl, MenuRow, MenuSection } from "@/components/ui/menus";
import { toast } from "@/components/ui/notifications";
import { api } from "../api/client";
import { webSocketUrl } from "../api/transport.js";
import { capturePage } from "../feedback/conduit-feedback";
import { artifactAbout, artifactKnown, artifactLabel, type Artifact } from "./artifacts";
import { connect, connectedTo, disconnect } from "./connections";
import SitePane from "./site-pane";

/*
 * An artifact in a pane (the view `artifact:<id>`): a paper's editor and margin, or a site's frame (SitePane), with
 * Markup's bar over the pane, wired as /document wires the test document. `quiet`: the app's own interface feedback
 * is open, and there is one bar. `header` is the pane's, given what the artifact adds to its actions: why what is shown
 * may not be the file, "Mark up" while its bar is closed, and "Connect a chat" over `chats`, the project's.
 */
export default function ArtifactPane(props: { id: string; quiet?: boolean; chats?: (project: string) => { id: string; title: string }[]; onAbout?: (about: Artifact, label: string) => void; header: (actions: JSX.Element) => JSX.Element }) {
  const [about, { refetch }] = createResource(() => props.id, (id) => artifactAbout(id).then((found) => { was = found.kind; props.onAbout?.(found, artifactLabel(found.kind)); return found; }));
  // Renamed, it takes its new name; deleted, it says so, where its editor would only wait for the hub; and the hub says when its trouble starts and ends.
  const changed = () => void refetch();
  window.addEventListener("conduit:artifacts-changed", changed);
  onCleanup(() => window.removeEventListener("conduit:artifacts-changed", changed));
  const [mode, setMode] = createSignal<MarkupMode>("use"), [sent, setSent] = createSignal(0), [away, setAway] = createSignal(false);
  const client = `document-${Math.random().toString(36).slice(2, 10)}`;
  let frame: HTMLDivElement | undefined, room: HTMLDivElement | undefined, marks: DocumentMarks | undefined, was: Artifact["kind"] | undefined;
  // What the open tool offers the paper's `@`: who is listening, and a comment for one of them.
  const [offer, setOffer] = createSignal<Parameters<NonNullable<MarkupHost["asks"]>>[0]>(null);
  const ask = (about: Range, name?: string) => offer()?.ask(about, name);
  const editing: DocumentHost = { socket: async (id) => new WebSocket(await webSocketUrl(`/v0/document/${id}/live`)), author: () => "person" };
  const base = () => `/v0/document/${encodeURIComponent(props.id)}`;
  const shared = { names, transport: httpTransport(api, `${base()}/markup`), clientId: () => client, capturePage, frame: () => room ?? frame,
    notify: (outcome, message) => outcome === "sent" ? toast.success(message) : toast.error(message) } satisfies Partial<MarkupHost>;
  const markup: MarkupHost = {
    ...shared,
    capabilities: { deliveries: ["batched", "live"], tools: ["quote", "highlight", "pen", "shape", "text", "erase", "note"], screenshot: false, sent: "margin", thin: false, bar: "ribbon" },
    client: () => ({ kind: "document" }),
    subject: () => ({ ...marks?.subject(), change: `\`node scripts/conduit-markup.mjs document read ${props.id}\` prints it as it is now, as Markdown with each block under its id; \`document replace\`, \`insert\` and \`delete\` change one block (\`document\` alone says how).` }),
    under: (box) => marks?.under(box) ?? null,
    margin: {
      anchors: (list) => marks?.anchors(list), place: (key) => marks?.place(key) ?? null, watch: (listener) => marks?.watch(listener) ?? (() => {}),
      revert: { can: (key) => marks?.changed(key) ?? false, run: (key) => api(`${base()}/changes`, { method: "POST", body: JSON.stringify({ op: "revert", thread: key }) }) },
    },
    tools: () => marks?.tools() ?? [],
    asking: () => marks?.selection() ?? null,
    asks: (offered) => setOffer(() => offered),
    sent: () => setSent((count) => count + 1),
  };
  const tool = (host: MarkupHost) => <Show when={!props.quiet}><MarkupTool host={host} mode={mode()} onMode={setMode} onClose={() => setMode("use")} /></Show>;
  // `latest`: asked again, it stays as it was until the hub answers, so its editor is not made anew.
  const found = () => about.error ? undefined : about.latest;
  // `was`: deleted, it is in no list, and its pane still says what it was.
  const kind = () => (found() ?? artifactKnown(props.id))?.kind ?? was ?? "artifact";
  // Its own mated thread is the paper's already, never connected to it.
  const chats = () => (props.chats?.(found()?.project ?? "") ?? []).filter((chat) => chat.id !== connectedTo(props.id).thread);
  const linked = (chat: string) => connectedTo(props.id).connections.some((connection) => connection.chat === chat);
  const connecting = <DropdownMenu modal={false} placement="bottom-end">
    <MenuControl as={HeaderButton} label="Connect a chat" icon={<Icons.Chat />} />
    <MenuContent width="md"><MenuSection title="Connect a chat">
      <For each={chats()} fallback={<MenuRow disabled>No chats in this project</MenuRow>}>{(chat) =>
        <MenuRow closeOnSelect={false} picked={linked(chat.id)} onSelect={() => void (linked(chat.id) ? disconnect : connect)(props.id, chat.id).catch((error: Error) => toast.error(error.message))}>{chat.title}</MenuRow>}</For>
    </MenuSection></MenuContent>
  </DropdownMenu>;
  return <SheetFill ref={(element) => { frame = element; }} class="pane-artifact">
    {props.header(<><Show when={found()?.trouble}>{(why) => <StatusDot label={why()} title={why()} tone="warn" />}</Show><Show when={away()}><StatusDot label="Reconnecting to the hub" title="Reconnecting to the hub" tone="warn" spinning /></Show><Show when={found()}>{connecting}</Show></>)}
    <Show when={!props.quiet && found()}><MarkupRibbonRoom ref={(element) => { room = element; }} /></Show>
    <Show when={!about.error} fallback={<Empty role="alert">This {kind()} could not be opened: {String((about.error as Error)?.message || "the hub did not say why").replace(/\.$/, "")}.</Empty>}>
      <Show when={found()?.id} keyed fallback={<Empty role="status">Opening the {kind()}…</Empty>}>{(id) => found()?.kind === "site" ? <SitePane about={() => found()!} host={shared} tool={tool} /> : <>
        <DocumentEditor host={editing} id={id} name={found()?.name ?? ""} bare onAway={setAway} marks={(offered) => { marks = offered; }} mentions={() => props.quiet ? [] : offer()?.names() ?? []} onMention={ask} onComment={props.quiet ? undefined : ask} margin={<MarkupMargin host={markup} sent={sent()} />} />
        {tool(markup)}
      </>}</Show>
    </Show>
  </SheetFill>;
}
