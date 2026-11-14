import names from "virtual:ui-pieces";
import { createEffect, createResource, createSignal, For, onCleanup, Show, type JSX } from "solid-js";
import { DocumentEditor, type DocumentControls, type DocumentHost, type DocumentMarks } from "@/components/document";
import { MarkupMargin, MarkupTool, httpTransport, type MarkupHost, type MarkupMarginControl, type MarkupMode } from "@/components/markup";
import { Button, Empty, HeaderButton, Icons, SheetFill, StatusDot } from "@/components/ui";
import { DocumentOutline, type DocumentWidth } from "@/components/ui/document";
import { MarkupRibbonRoom } from "@/components/ui/markup";
import { DropdownMenu, MenuContent, MenuControl, MenuRow, MenuSection } from "@/components/ui/menus";
import { toast } from "@/components/ui/notifications";
import { api } from "../api/client";
import { authorizedFetch } from "../api/native-auth-client";
import { httpUrl, webSocketUrl } from "../api/transport.js";
import { capturePage } from "../feedback/conduit-feedback";
import { artifactAbout, artifactKnown, artifactLabel, copyArtifactMarkdown, countPapers, paperCounted, renameArtifact, type Artifact } from "./artifacts";
import { blockShown, blockWanted, holdArtifact } from "./focused-artifact";
import { ARTIFACT_CAPABILITIES } from "./artifact-capabilities";
import { connect, connectedTo, disconnect } from "./connections";
import SitePane from "./site-pane";

/*
 * An artifact in a pane (the view `artifact:<id>`): a paper's editor and margin, or a site's frame (SitePane), with
 * Markup's bar over the pane, wired as /document wires the test document. `quiet`: the app's own interface feedback
 * is open, and there is one bar. `header` is the pane's, given what the artifact adds to its actions: why what is shown
 * may not be the file, "Mark up" while its bar is closed, and "Connect a chat" over `chats`, the project's.
 */
export default function ArtifactPane(props: { id: string; quiet?: boolean; chats?: (project: string) => { id: string; title: string }[]; onAbout?: (about: Artifact, label: string) => void; onThread?: () => void; onShortcuts?: () => void; header: (actions: JSX.Element) => JSX.Element }) {
  const [about, { refetch }] = createResource(() => props.id, (id) => artifactAbout(id).then((found) => { was = found.kind; props.onAbout?.(found, artifactLabel(found.kind)); return found; }));
  // Renamed, it takes its new name; deleted, it says so, where its editor would only wait for the hub; and the hub says when its trouble starts and ends.
  const changed = () => void refetch();
  window.addEventListener("conduit:artifacts-changed", changed);
  onCleanup(() => window.removeEventListener("conduit:artifacts-changed", changed));
  const [mode, setMode] = createSignal<MarkupMode>("use"), [sent, setSent] = createSignal(0), [away, setAway] = createSignal(false);
  const base = () => `/v0/document/${encodeURIComponent(props.id)}`;
  const client = `document-${Math.random().toString(36).slice(2, 10)}`;
  let frame: HTMLDivElement | undefined, room: HTMLDivElement | undefined, marks: DocumentMarks | undefined, was: Artifact["kind"] | undefined;
  // What the open tool offers the paper's `@`: who is listening, and a comment for one of them.
  const [offer, setOffer] = createSignal<Parameters<NonNullable<MarkupHost["asks"]>>[0]>(null);
  const ask = (about: Range, name?: string) => offer()?.ask(about, name);
  // What the paper's editor and margin offer the pane, once each is made: the header, the palette and the shortcuts act through them.
  const [controls, setControls] = createSignal<DocumentControls>(), [comments, setComments] = createSignal<MarkupMarginControl>(), [cards, setCards] = createSignal(0);
  const WIDTHS: DocumentWidth[] = ["narrow", "wide", "full"], widthKey = `conduit.paper.width.${props.id}`;
  const [width, setWidth] = createSignal<DocumentWidth>((() => { try { const kept = localStorage.getItem(widthKey) as DocumentWidth | null; return kept && WIDTHS.includes(kept) ? kept : "narrow"; } catch { return "narrow"; } })());
  const widen = () => { const next = WIDTHS[(WIDTHS.indexOf(width()) + 1) % WIDTHS.length]!; setWidth(next); try { localStorage.setItem(widthKey, next); } catch { /* this session only */ } };
  let outlining: HTMLButtonElement | undefined;
  holdArtifact(() => frame, () => {
    const kind = found()?.kind, edits = controls();
    if (!kind) return null;
    return { id: props.id, kind, offers: { thread: props.onThread, ...(kind === "paper" ? {
      rename: () => frame?.querySelector<HTMLInputElement>("input.ui-document-title")?.select(),
      copyMarkdown: () => void copyArtifactMarkdown({ id: props.id }), count: () => countPapers(!paperCounted()), width: widen, shortcuts: props.onShortcuts,
      ...(edits ? { find: edits.find, blockMenu: edits.openBlockMenu, blockUp: () => void edits.moveBlock(-1), blockDown: () => void edits.moveBlock(1), outline: () => outlining?.click() } : {}),
      ...(comments() && !props.quiet ? { nextComment: comments()!.next, previousComment: comments()!.previous } : {}),
    } : {}) } };
  });
  // A comment's card pressed in a thread asks for its block: shown once the editor has drawn it.
  createEffect(() => { const block = blockWanted(props.id), edits = controls(); if (!block || !edits) return; const due = requestAnimationFrame(() => { edits.reveal(block); blockShown(); }); onCleanup(() => cancelAnimationFrame(due)); });
  // A paper's pictures are kept by the hub beside it. An installed client signs in with a token an <img> does not send, so each is fetched as the person and shown from memory.
  const pictures = new Map<string, Promise<string>>();
  const images: DocumentHost["images"] = {
    keep: async (file) => {
      const response = await authorizedFetch(httpUrl(`${base()}/images`), { method: "POST", body: file, headers: { "content-type": file.type } });
      if (!response.ok) { const why = (await response.json().catch(() => null) as { message?: string } | null)?.message ?? `the hub answered ${response.status}`; toast.error(`Image not kept: ${why}`); throw new Error(why); }
      return (await response.json() as { name: string }).name;
    },
    src: (name) => pictures.get(name) ?? pictures.set(name, authorizedFetch(httpUrl(`${base()}/images/${name}`)).then(async (response) => { if (!response.ok) throw new Error(String(response.status)); return URL.createObjectURL(await response.blob()); })).get(name)!,
  };
  onCleanup(() => pictures.forEach((made) => void made.then(URL.revokeObjectURL, () => {})));
  const editing: DocumentHost = { images, tools: ARTIFACT_CAPABILITIES.paper.edit, socket: async (id) => new WebSocket(await webSocketUrl(`/v0/document/${id}/live`)), author: () => "person" };
  const shared = { names, transport: httpTransport(api, `${base()}/markup`), clientId: () => client, capturePage, frame: () => room ?? frame,
    notify: (outcome, message) => outcome === "sent" ? toast.success(message) : toast.error(message) } satisfies Partial<MarkupHost>;
  const markup: MarkupHost = {
    ...shared,
    capabilities: ARTIFACT_CAPABILITIES.paper.markup,
    client: () => ({ kind: "document" }),
    subject: () => ({ ...marks?.subject(), change: `\`node scripts/conduit-markup.mjs document read ${props.id}\` prints it as it is now, as Markdown with each block under its id; \`document replace\`, \`insert\` and \`delete\` change one block (\`document\` alone says how).` }),
    under: (box) => marks?.under(box) ?? null,
    margin: {
      anchors: (list) => marks?.anchors(list), place: (key) => marks?.place(key) ?? null, watch: (listener) => marks?.watch(listener) ?? (() => {}),
      revert: { can: (key) => marks?.changed(key) ?? false, run: (key) => api(`${base()}/changes`, { method: "POST", body: JSON.stringify({ op: "revert", thread: key }) }) },
    },
    tools: () => marks?.tools() ?? [],
    history: { undo: () => marks?.history.undo() ?? false, redo: () => marks?.history.redo() ?? false, canUndo: () => marks?.history.canUndo() ?? false, canRedo: () => marks?.history.canRedo() ?? false },
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
    {props.header(<><Show when={found()?.trouble}>{(why) => <StatusDot label={why()} title={why()} tone="warn" />}</Show><Show when={away()}><StatusDot label="Reconnecting to the hub" title="Reconnecting to the hub" tone="warn" spinning /></Show><Show when={found()?.kind === "paper" && !props.quiet && comments()?.open()}>{(open) => <Button variant="ghost" size="sm" title="Go to the next open comment" onClick={() => comments()?.next()}>{open()} open</Button>}</Show>
      <Show when={found()?.kind === "paper" && controls()}>{(edits) => <DropdownMenu modal={false} placement="bottom-end">
        <MenuControl as={HeaderButton} ref={(element: HTMLButtonElement) => { outlining = element; }} label="Outline" icon={<Icons.Sidebar />} />
        <MenuContent width="md"><MenuSection title="Outline"><Show when={edits().outline().length} fallback={<MenuRow disabled>No headings yet</MenuRow>}><DocumentOutline headings={edits().outline()} current={edits().current()} onPick={edits().reveal} /></Show></MenuSection></MenuContent>
      </DropdownMenu>}</Show>
      <Show when={found()}>{connecting}</Show></>)}
    <Show when={!props.quiet && found()}><MarkupRibbonRoom ref={(element) => { room = element; }} /></Show>
    <Show when={!about.error} fallback={<Empty role="alert">This {kind()} could not be opened: {String((about.error as Error)?.message || "the hub did not say why").replace(/\.$/, "")}.</Empty>}>
      <Show when={found()?.id} keyed fallback={<Empty role="status">Opening the {kind()}…</Empty>}>{(id) => found()?.kind === "site" ? <SitePane about={() => found()!} host={shared} tool={tool} /> : <>
        <DocumentEditor host={editing} id={id} name={found()?.name ?? ""} bare onAway={setAway} marks={(offered) => { marks = offered; }} mentions={() => props.quiet ? [] : offer()?.names() ?? []} onMention={ask} onRename={(name) => renameArtifact(id, name)} count={paperCounted()} width={width()} controls={setControls} onComment={props.quiet ? undefined : ask} margin={<MarkupMargin host={markup} sent={sent()} control={setComments} onCards={setCards} />} marginEmpty={!cards()} />
        {tool(markup)}
      </>}</Show>
    </Show>
  </SheetFill>;
}
