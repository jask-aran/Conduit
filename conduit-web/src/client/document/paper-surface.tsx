import { createSignal, onCleanup, Show } from "solid-js";
import { DocumentEditor, type DocumentControls, type DocumentHost, type DocumentMarks } from "@/components/document";
import { HeaderButton, Icons } from "@/components/ui";
import { DocumentOutline, type DocumentWidth } from "@/components/ui/document";
import { DropdownMenu, MenuContent, MenuControl, MenuSection } from "@/components/ui/menus";
import { toast } from "@/components/ui/notifications";
import { api } from "../api/client";
import { authorizedFetch } from "../api/native-auth-client";
import { httpUrl, webSocketUrl } from "../api/transport.js";
import { ARTIFACT_KINDS, type ArtifactSurfaceProps } from "./artifact-kinds";
import { copyArtifactMarkdown, countPapers, paperCounted, renameArtifact } from "./artifacts";

/** What the paper's editor offers, with what another builder's side may not have added yet. */
type Marks = DocumentMarks & Partial<{ seats(): { name: string; state: string; for?: string }[] }>;
const WIDTHS: DocumentWidth[] = ["narrow", "wide", "full"];

/** A paper in its pane: the hub's live copy in the paper's editor, the comment margin beside its text. */
export default function PaperSurface(props: ArtifactSurfaceProps) {
  const id = props.about().id, base = `/v0/document/${encodeURIComponent(id)}`;
  let marks: Marks | undefined, outlining: HTMLButtonElement | undefined;
  // Also as a signal, so what the margin reads of the editor live (its seats, its suggestions) follows once the editor is made.
  const [marked, setMarked] = createSignal<Marks>();
  const [controls, setControls] = createSignal<DocumentControls>(), [away, setAway] = createSignal(false), [stale, setStale] = createSignal(false);
  const ask = (about: Range, name?: string) => props.offer()?.ask(about, name);
  const widthKey = `conduit.paper.width.${id}`;
  const [width, setWidth] = createSignal<DocumentWidth>((() => { try { const kept = localStorage.getItem(widthKey) as DocumentWidth | null; return kept && WIDTHS.includes(kept) ? kept : "narrow"; } catch { return "narrow"; } })());
  const widen = () => { const next = WIDTHS[(WIDTHS.indexOf(width()) + 1) % WIDTHS.length]!; setWidth(next); try { localStorage.setItem(widthKey, next); } catch { /* this session only */ } };
  // A paper's pictures are kept by the hub beside it. An installed client signs in with a token an <img> does not send, so each is fetched as the person and shown from memory.
  const pictures = new Map<string, Promise<string>>();
  const images: DocumentHost["images"] = {
    keep: async (file) => {
      const response = await authorizedFetch(httpUrl(`${base}/images`), { method: "POST", body: file, headers: { "content-type": file.type } });
      if (!response.ok) { const why = (await response.json().catch(() => null) as { message?: string } | null)?.message ?? `the hub answered ${response.status}`; toast.error(`Image not kept: ${why}`); throw new Error(why); }
      return (await response.json() as { name: string }).name;
    },
    src: (name) => pictures.get(name) ?? pictures.set(name, authorizedFetch(httpUrl(`${base}/images/${name}`)).then(async (response) => { if (!response.ok) throw new Error(String(response.status)); return URL.createObjectURL(await response.blob()); })).get(name)!,
  };
  onCleanup(() => pictures.forEach((made) => void made.then(URL.revokeObjectURL, () => {})));
  const editing: DocumentHost = { images, suggest: ARTIFACT_KINDS.paper.suggest, tools: ARTIFACT_KINDS.paper.edit, socket: async (paper) => new WebSocket(await webSocketUrl(`/v0/document/${paper}/live`)), author: () => "person" };
  props.onSurface({
    markup: {
      client: () => ({ kind: "document" }),
      subject: () => ({ ...marks?.subject(), change: `\`node scripts/conduit-markup.mjs document read ${id}\` prints it as it is now, as Markdown with each block under its id; \`document replace\`, \`insert\` and \`delete\` change one block (\`document\` alone says how).` }),
      under: (box) => marks?.under(box) ?? null,
      margin: {
        anchors: (list) => marks?.anchors(list), place: (key) => marks?.place(key) ?? null, watch: (listener) => marks?.watch(listener) ?? (() => {}),
        revert: { can: (key) => marks?.changed(key) ?? false, run: (key) => api(`${base}/changes`, { method: "POST", body: JSON.stringify({ op: "revert", thread: key }) }) },
        working: (key) => { const seat = marked()?.seats?.().find((one) => one.for === key); return seat && { by: seat.name, state: seat.state }; },
        suggestions: { list: () => marked()?.suggestions() ?? [], place: (key) => marks?.place(key) ?? null, accept: (key) => marks?.accept(key), reject: (key) => marks?.reject(key) },
        focus: () => props.pane()?.querySelector<HTMLElement>(".ui-document-text")?.focus({ preventScroll: true }),
      },
      tools: () => marks?.tools() ?? [],
      history: { undo: () => marks?.history.undo() ?? false, redo: () => marks?.history.redo() ?? false, canUndo: () => marks?.history.canUndo() ?? false, canRedo: () => marks?.history.canRedo() ?? false },
      asking: () => marks?.selection() ?? null,
    },
    offers: () => {
      const edits = controls();
      return {
        rename: () => props.pane()?.querySelector<HTMLInputElement>("input.ui-document-title")?.select(),
        copyMarkdown: () => void copyArtifactMarkdown({ id }), count: () => countPapers(!paperCounted()), width: widen, shortcuts: props.onShortcuts,
        ...(edits ? { find: edits.find, blockMenu: edits.openBlockMenu, blockUp: () => void edits.moveBlock(-1), blockDown: () => void edits.moveBlock(1), outline: () => outlining?.click() } : {}),
      };
    },
    header: () => <Show when={controls()}>{(edits) => <DropdownMenu modal={false} placement="bottom-end">
      <MenuControl as={HeaderButton} ref={(element: HTMLButtonElement) => { outlining = element; }} label="Outline" icon={<Icons.Sidebar />} />
      <MenuContent width="md"><MenuSection title="Outline" note={edits().outline().length ? undefined : "No headings yet"}><Show when={edits().outline().length}><DocumentOutline headings={edits().outline()} current={edits().current()} onPick={edits().reveal} /></Show></MenuSection></MenuContent>
    </DropdownMenu>}</Show>,
    away, stale,
    reveal: () => controls()?.reveal,
  });
  return <DocumentEditor host={editing} id={id} name={props.about().name} bare onAway={setAway} onStale={setStale} marks={(offered) => { marks = offered; setMarked(() => offered); }} mentions={() => props.quiet ? [] : props.offer()?.names() ?? []} onMention={ask} onRename={(name) => renameArtifact(id, name)} count={paperCounted()} width={width()} controls={setControls} onComment={props.quiet ? undefined : ask} margin={props.margin} marginEmpty={props.marginEmpty} />;
}
