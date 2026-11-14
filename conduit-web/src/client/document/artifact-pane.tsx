import names from "virtual:ui-pieces";
import { createEffect, createResource, createSignal, For, onCleanup, Show, type JSX } from "solid-js";
import { MarkupMargin, MarkupTool, httpTransport, type MarkupHost, type MarkupMarginControl, type MarkupMarginEntry, type MarkupMode } from "@/components/markup";
import { Button, Dot, Empty, HeaderButton, Icons, SheetFill, StatusDot } from "@/components/ui";
import { MarkupRibbonRoom } from "@/components/ui/markup";
import { DropdownMenu, MenuContent, MenuControl, MenuRow, MenuSection } from "@/components/ui/menus";
import { toast } from "@/components/ui/notifications";
import { api } from "../api/client";
import { capturePage } from "../feedback/conduit-feedback";
import { ARTIFACT_KINDS, type ArtifactSurface, type MarkupOffer } from "./artifact-kinds";
import { artifactAbout, artifactKnown, artifactLabel, type Artifact } from "./artifacts";
import { holdArtifact, placeShown, placeWanted } from "./focused-artifact";
import { connect, connectedTo, disconnect } from "./connections";

const STATES: Record<MarkupMarginEntry["state"], string> = { waiting: "Waiting", working: "Working", answered: "Answered", resolved: "Agent resolved", suggested: "Suggested" };

/*
 * An artifact in a pane (the view `artifact:<id>`): its kind's surface (ARTIFACT_KINDS), with Markup's bar over the
 * pane, wired as /document wires the test document. `quiet`: the app's own interface feedback is open, and there is
 * one bar. `header` is the pane's, given what the artifact adds to its actions: why what is shown may not be the
 * file, "Mark up" while its bar is closed, and "Connect a chat" over `chats`, the project's.
 */
export default function ArtifactPane(props: { id: string; quiet?: boolean; chats?: (project: string) => { id: string; title: string }[]; onAbout?: (about: Artifact, label: string) => void; onThread?: () => void; onShortcuts?: () => void; header: (actions: JSX.Element) => JSX.Element }) {
  // The kind's surface is fetched before the artifact is said to be found, so "Opening the …" stands until it can be drawn.
  const [about, { refetch }] = createResource(() => props.id, (id) => artifactAbout(id).then((found) => { last = found; props.onAbout?.(found, artifactLabel(found.kind)); return ARTIFACT_KINDS[found.kind].Surface.preload().then(() => found); }));
  // Renamed, it takes its new name; deleted, it says so, where its surface would only wait for the hub; and the hub says when its trouble starts and ends.
  const changed = () => void refetch();
  window.addEventListener("conduit:artifacts-changed", changed);
  onCleanup(() => window.removeEventListener("conduit:artifacts-changed", changed));
  const [mode, setMode] = createSignal<MarkupMode>("use"), [sent, setSent] = createSignal(0);
  const client = `document-${Math.random().toString(36).slice(2, 10)}`;
  let frame: HTMLDivElement | undefined, room: HTMLDivElement | undefined, last: Artifact | undefined;
  // What the open tool offers a surface that asks itself: who is listening, and a comment for one of them.
  const [offer, setOffer] = createSignal<MarkupOffer | null>(null);
  // What the surface and the margin offer the pane, once each is made: the header, the palette and the shortcuts act through them.
  const [surface, setSurface] = createSignal<ArtifactSurface>(), [host, setHost] = createSignal<MarkupHost>();
  const [comments, setComments] = createSignal<MarkupMarginControl>(), [cards, setCards] = createSignal(0);
  holdArtifact(() => frame, () => {
    const kind = found()?.kind, margin = comments();
    if (!kind) return null;
    return { id: props.id, kind, offers: { thread: props.onThread, ...surface()?.offers?.(), ...(margin && !props.quiet ? { nextComment: margin.next, previousComment: margin.previous } : {}) } };
  });
  // A comment's card pressed in a thread asks for its place: shown once the surface can.
  createEffect(() => { const place = placeWanted(props.id), reveal = surface()?.reveal?.(); if (!place || !reveal) return; const due = requestAnimationFrame(() => { reveal(place); placeShown(); }); onCleanup(() => cancelAnimationFrame(due)); });
  const shared = { names, transport: httpTransport(api, `/v0/document/${encodeURIComponent(props.id)}/markup`), clientId: () => client, capturePage, frame: () => room ?? frame,
    notify: (outcome, message) => outcome === "sent" ? toast.success(message) : toast.error(message),
    asks: (offered) => setOffer(() => offered), sent: () => setSent((count) => count + 1) } satisfies Partial<MarkupHost>;
  // Every card of the margin, in the order of their places: those waiting on the person (answered, resolved by the agent) or all, then the suggestions.
  const [needsMe, setNeedsMe] = createSignal(true);
  const commentList = (margin: MarkupMarginControl) => {
    const entries = () => margin.list(), notes = () => entries().filter((one) => one.kind === "comment"), suggested = () => entries().filter((one) => one.kind === "suggestion");
    const waiting = () => notes().filter((one) => one.state === "answered" || one.state === "resolved"), done = () => notes().filter((one) => one.state === "resolved").length;
    const suggestions = () => host()?.margin?.suggestions;
    const row = (entry: MarkupMarginEntry) => <MenuRow icon={entry.unread ? <Dot tone="unread" aria-label="Unread" /> : undefined} detail={entry.by ?? undefined} meta={STATES[entry.state]} onSelect={() => margin.go(entry.key)}>{entry.about || "Comment"}</MenuRow>;
    return <Show when={entries().length}><DropdownMenu modal={false} placement="bottom-end">
      <MenuControl as={Button} variant="ghost" size="sm" title="Comments">{margin.open() ? `${margin.open()} open` : `${entries().length} to review`}</MenuControl>
      <MenuContent width="md" height="lg">
        <MenuSection title="Show">
          <MenuRow closeOnSelect={false} checked={needsMe()} meta={String(waiting().length)} onSelect={() => setNeedsMe(true)}>Needs me</MenuRow>
          <MenuRow closeOnSelect={false} checked={!needsMe()} meta={String(notes().length)} onSelect={() => setNeedsMe(false)}>All</MenuRow>
        </MenuSection>
        <MenuSection title="Comments" note={(needsMe() ? waiting() : notes()).length ? undefined : needsMe() ? "Nothing waiting on you" : "No comments"}><For each={needsMe() ? waiting() : notes()}>{row}</For></MenuSection>
        <Show when={suggested().length}><MenuSection title="Suggestions"><For each={suggested()}>{(entry) => <MenuRow detail={entry.by ?? undefined} onSelect={() => margin.go(entry.key)}
          actions={[{ label: "Reject", icon: <Icons.Close />, onSelect: () => suggestions()?.reject(entry.key) }, { label: "Accept", icon: <Icons.Check />, onSelect: () => suggestions()?.accept(entry.key) }]}>{entry.about}</MenuRow>}</For></MenuSection></Show>
        <Show when={done()}><MenuSection><MenuRow icon={<Icons.Check />} meta={String(done())} onSelect={() => void margin.resolveDone()}>Resolve all the agent resolved</MenuRow></MenuSection></Show>
      </MenuContent>
    </DropdownMenu></Show>;
  };
  // `latest`: asked again, it stays as it was until the hub answers, so its surface is not made anew.
  const found = () => about.error ? undefined : about.latest;
  // `last`: deleted, it is in no list, and its pane still says what it was.
  const noun = () => { const kind = (found() ?? artifactKnown(props.id) ?? last)?.kind; return kind ? artifactLabel(kind).toLowerCase() : "artifact"; };
  // Its own mated thread is the artifact's already, never connected to it.
  const chats = () => (props.chats?.(found()?.project ?? "") ?? []).filter((chat) => chat.id !== connectedTo(props.id).thread);
  const linked = (chat: string) => connectedTo(props.id).connections.some((connection) => connection.chat === chat);
  const connecting = <DropdownMenu modal={false} placement="bottom-end">
    <MenuControl as={HeaderButton} label="Connect a chat" icon={<Icons.Chat />} />
    <MenuContent width="md"><MenuSection title="Connect a chat">
      <For each={chats()} fallback={<MenuRow disabled>No chats in this project</MenuRow>}>{(chat) =>
        <MenuRow closeOnSelect={false} picked={linked(chat.id)} onSelect={() => void (linked(chat.id) ? disconnect : connect)(props.id, chat.id).catch((error: Error) => toast.error(error.message))}>{chat.title}</MenuRow>}</For>
    </MenuSection></MenuContent>
  </DropdownMenu>;
  // Made once for each artifact, as a keyed child: its kind's surface, and the host it reports (the pane's part over the kind's), which the margin and the tool are made over.
  const shown = () => {
    const kind = ARTIFACT_KINDS[found()!.kind], Surface = kind.Surface;
    const made = (part: ArtifactSurface) => { setSurface(part); setHost({ ...shared, capabilities: kind.markup, ...part.markup }); };
    return <>
      <Surface about={() => found() ?? last!} quiet={props.quiet} offer={offer} pane={() => frame} onShortcuts={props.onShortcuts} onSurface={made} marginEmpty={!cards()}
        margin={<Show when={host()}>{(over) => <MarkupMargin host={over()} sent={sent()} control={setComments} onCards={setCards} />}</Show>} />
      <Show when={!props.quiet && host()}>{(over) => <MarkupTool host={over()} mode={mode()} onMode={setMode} onClose={() => setMode("use")} />}</Show>
    </>;
  };
  return <SheetFill ref={(element) => { frame = element; }} class="pane-artifact">
    {props.header(<><Show when={found()?.trouble}>{(why) => <StatusDot label={why()} title={why()} tone="warn" />}</Show><Show when={surface()?.stale?.()}><Button variant="secondary" size="sm" onClick={() => location.reload()}>Reload: this page is older than the {noun()}</Button></Show><Show when={surface()?.away?.()}><StatusDot label="Reconnecting to the hub" title="Reconnecting to the hub" tone="warn" spinning /></Show><Show when={!props.quiet && comments()}>{(margin) => commentList(margin())}</Show>
      {surface()?.header?.()}
      <Show when={found()}>{connecting}</Show></>)}
    <Show when={!props.quiet && found()}><MarkupRibbonRoom ref={(element) => { room = element; }} /></Show>
    <Show when={!about.error} fallback={<Empty role="alert">This {noun()} could not be opened: {String((about.error as Error)?.message || "the hub did not say why").replace(/\.$/, "")}.</Empty>}>
      <Show when={found()?.id} keyed fallback={<Empty role="status">Opening the {noun()}…</Empty>}>{(_id) => shown()}</Show>
    </Show>
  </SheetFill>;
}
