import names from "virtual:ui-pieces";
import { createResource, createSignal, For, onCleanup, Show, type JSX } from "solid-js";
import { DocumentEditor, type DocumentHost, type DocumentMarks } from "@/components/document";
import { MarkupMargin, MarkupTool, httpTransport, type MarkupHost, type MarkupMode } from "@/components/markup";
import { Empty, HeaderButton, Icons, SheetFill, StatusDot } from "@/components/ui";
import { DropdownMenu, MenuContent, MenuControl, MenuRow, MenuSection } from "@/components/ui/menus";
import { toast } from "@/components/ui/notifications";
import { api } from "../api/client";
import { webSocketUrl } from "../api/transport.js";
import { capturePage } from "../feedback/conduit-feedback";
import { artifactAbout, artifactKnown } from "./artifacts";
import { connect, connectedTo, disconnect } from "./connections";

/*
 * A paper in a pane (the view `artifact:<id>`): its editor, its margin and Markup's bar over the pane, wired as
 * /document wires the test document. `quiet`: the app's own interface feedback is open, and there is one bar.
 * `header` is the pane's, given what the paper adds to its actions: "Mark up" while its bar is closed, and "Connect a
 * chat" over `chats`, the project's.
 */
export default function ArtifactPane(props: { id: string; quiet?: boolean; chats?: (project: string) => { id: string; title: string }[]; onName?: (name: string) => void; header: (actions: JSX.Element) => JSX.Element }) {
  const [about, { refetch }] = createResource(() => props.id, (id) => artifactAbout(id).then((found) => { props.onName?.(found.name); return found; }));
  // Renamed, it takes its new name; deleted, it says so, where its editor would only wait for the hub.
  const changed = () => void refetch();
  window.addEventListener("conduit:artifacts-changed", changed);
  onCleanup(() => window.removeEventListener("conduit:artifacts-changed", changed));
  const [mode, setMode] = createSignal<MarkupMode | null>("use"), [sent, setSent] = createSignal(0), [away, setAway] = createSignal(false);
  const client = `document-${Math.random().toString(36).slice(2, 10)}`;
  let frame: HTMLDivElement | undefined, marks: DocumentMarks | undefined;
  // What the open tool offers the paper's `@`: who is listening, and a comment for one of them.
  const [offer, setOffer] = createSignal<Parameters<NonNullable<MarkupHost["asks"]>>[0]>(null);
  const editing: DocumentHost = { socket: async (id) => new WebSocket(await webSocketUrl(`/v0/document/${id}/live`)), author: () => "person" };
  const base = () => `/v0/document/${encodeURIComponent(props.id)}`;
  const markup: MarkupHost = {
    names,
    capabilities: { deliveries: ["batched", "live"], tools: ["quote", "highlight", "pen", "shape", "text", "erase", "note"], screenshot: false, sent: "margin", thin: false },
    transport: httpTransport(api, `${base()}/markup`),
    clientId: () => client,
    client: () => ({ kind: "document" }),
    subject: () => ({ ...marks?.subject(), change: `\`node scripts/conduit-markup.mjs document read ${props.id}\` prints it as it is now, as Markdown with each block under its id; \`document replace\`, \`insert\` and \`delete\` change one block (\`document\` alone says how).` }),
    under: (box) => marks?.under(box) ?? null,
    capturePage,
    frame: () => frame,
    margin: {
      anchors: (list) => marks?.anchors(list), place: (key) => marks?.place(key) ?? null, watch: (listener) => marks?.watch(listener) ?? (() => {}),
      revert: { can: (key) => marks?.changed(key) ?? false, run: (key) => api(`${base()}/changes`, { method: "POST", body: JSON.stringify({ op: "revert", thread: key }) }) },
    },
    tools: () => marks?.tools() ?? [],
    asking: () => marks?.selection() ?? null,
    asks: setOffer,
    sent: () => setSent((count) => count + 1),
    notify: (outcome, message) => outcome === "sent" ? toast.success(message) : toast.error(message),
  };
  // `latest`: asked again, it stays as it was until the hub answers, so its editor is not made anew.
  const found = () => about.error ? undefined : about.latest;
  const name = () => found()?.name ?? artifactKnown(props.id)?.name ?? "Paper";
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
    {props.header(<><Show when={away()}><StatusDot label="Reconnecting to the hub" title="Reconnecting to the hub" tone="warn" spinning /></Show><Show when={!props.quiet && !mode() && found()}><HeaderButton label="Mark up" icon={<Icons.Feedback />} onClick={() => setMode("use")} /></Show><Show when={found()}>{connecting}</Show></>)}
    <Show when={!about.error} fallback={<Empty role="alert">This paper could not be opened: {String((about.error as Error)?.message || "the hub did not say why").replace(/\.$/, "")}.</Empty>}>
      <Show when={found()?.id} keyed fallback={<Empty role="status">Opening the paper…</Empty>}>{(id) => <>
        <DocumentEditor host={editing} id={id} name={name()} bare onAway={setAway} marks={(offered) => { marks = offered; }} mentions={() => offer()?.names() ?? []} onMention={(about, name) => offer()?.ask(about, name)} margin={<MarkupMargin host={markup} sent={sent()} />} />
        <Show when={!props.quiet && mode()}>{(now) => <MarkupTool host={markup} mode={now()} onMode={setMode} onClose={() => setMode(null)} />}</Show>
      </>}</Show>
    </Show>
  </SheetFill>;
}
