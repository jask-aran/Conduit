import { createEffect, createMemo, createSignal, For, onCleanup, Show } from "solid-js";
import { DocumentEditor, type DocumentAnswers, type DocumentControls, type DocumentHost, type DocumentMarks } from "@/components/document";
import type { DocumentToolName } from "@/components/document/host";
import { PAPER_KEYS, PaperShortcuts, type PaperKeyGroup, type PaperKeyRow } from "@/components/document/shortcuts";
import { HeaderButton, Icons } from "@/components/ui";
import { documentBlockIcons, type DocumentWidth } from "@/components/ui/document";
import { DropdownMenu, MenuContent, MenuControl, MenuRow, MenuSection } from "@/components/ui/menus";
import { toast } from "@/components/ui/notifications";
import { api } from "../api/client";
import { authorizedFetch } from "../api/native-auth-client";
import { httpUrl, webSocketUrl } from "../api/transport.js";
import { ARTIFACT_COMMANDS, type ArtifactCommand } from "../commands/command-registry";
import type { ShortcutManager } from "../shortcuts/shortcut-manager";
import { formatShortcutBinding, formatShortcutStroke } from "../shortcuts/shortcut-normalize";
import type { ShortcutModifier } from "../shortcuts/shortcut-types";
import { ARTIFACT_KINDS, type ArtifactSurfaceProps } from "./artifact-kinds";
import { copyArtifactMarkdown, countPapers, paperCounted, renameArtifact } from "./artifacts";

/** What the paper's editor offers, with what another builder's side may not have added yet. */
type Marks = DocumentMarks & Partial<{ seats(): { name: string; state: string; for?: string }[] }>;
const WIDTHS: DocumentWidth[] = ["narrow", "wide", "full"];

// The group each palette command stands in on the shortcuts sheet; one not named here is the paper's.
const COMMAND_GROUPS: Partial<Record<ArtifactCommand, PaperKeyGroup>> = { blockMenu: "Blocks", blockUp: "Blocks", blockDown: "Blocks", nextComment: "Comments", previousComment: "Comments" };
const MODIFIERS: Record<string, ShortcutModifier> = { Mod: "primary", Ctrl: "control", Alt: "alt", Shift: "shift" };
/** The sheet's rows: the editor's keys (PAPER_KEYS) for the tools offered (`tools`), written as the app writes a key, each palette command with the keys it is bound to now. */
const keyGroups = (manager: ShortcutManager, tools: readonly DocumentToolName[]): [PaperKeyGroup, PaperKeyRow[]][] => {
  const chord = (keys: string) => { const parts = keys.split("-"), key = parts.pop()!; return formatShortcutStroke({ code: key, key, modifiers: parts.map((part) => MODIFIERS[part]!) }, manager.environment); };
  const bound = (name: ArtifactCommand) => manager.effectiveBindings(ARTIFACT_COMMANDS[name][0]).map((binding) => formatShortcutBinding(binding, manager.environment));
  const named = Object.values(PAPER_KEYS).flat().flatMap((row) => "command" in row ? [row.command] : []);
  return (Object.keys(PAPER_KEYS) as PaperKeyGroup[]).map((group) => {
    const rows: PaperKeyRow[] = PAPER_KEYS[group].filter((row) => !row.tool || tools.includes(row.tool)).map((row) => {
      const command = "command" in row ? row.command as ArtifactCommand : undefined;
      return { does: "does" in row ? row.does : ARTIFACT_COMMANDS[command!][1], keys: [...new Set([...command ? bound(command) : [], ...(row.keys ?? []).map(chord)])], typed: row.typed, space: row.space };
    });
    for (const name of Object.keys(ARTIFACT_COMMANDS) as ArtifactCommand[]) if ((COMMAND_GROUPS[name] ?? "Paper") === group && !named.includes(name)) rows.push({ does: ARTIFACT_COMMANDS[name][1], keys: bound(name) });
    return [group, rows.filter((row) => row.keys.length || row.typed)];
  });
};

/** A paper in its pane, or any kind drawn in its editor (a Markdown file): the hub's live copy in the paper's editor with what the kind's entry offers, the comment margin beside its text. */
export default function PaperSurface(props: ArtifactSurfaceProps) {
  const id = props.about().id, kind = ARTIFACT_KINDS[props.about().kind], base = `/v0/document/${encodeURIComponent(id)}`;
  let marks: Marks | undefined, outlining: HTMLButtonElement | undefined;
  // Also as a signal, so what the margin reads of the editor live (its seats, its suggestions) follows once the editor is made.
  const [marked, setMarked] = createSignal<Marks>();
  const [controls, setControls] = createSignal<DocumentControls>(), [away, setAway] = createSignal(false), [stale, setStale] = createSignal(false), [ready, setReady] = createSignal(false);
  // The margin's answer acts reach the editor once both are made, whichever is first.
  const [answers, setAnswers] = createSignal<DocumentAnswers | null>(null);
  createEffect(() => marked()?.answers(answers()));
  const ask = (about: Range, name?: string, words?: string) => props.offer()?.ask(about, name, words);
  // Read again each time the sheet opens, so a key rebound since shows.
  const [showingKeys, setShowingKeys] = createSignal(false);
  const shownKeys = createMemo<[PaperKeyGroup, PaperKeyRow[]][]>((was) => showingKeys() && props.shortcuts ? keyGroups(props.shortcuts, kind.edit) : was, []);
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
  const editing: DocumentHost = { images, suggest: kind.suggest, tools: kind.edit, holds: kind.holds, socket: async (paper) => new WebSocket(await webSocketUrl(`/v0/document/${paper}/live`)), author: () => "person" };
  props.onSurface({
    markup: {
      client: () => ({ kind: "document" }),
      subject: () => ({ ...marks?.subject(), change: `\`node scripts/conduit-markup.mjs document read ${id}\` prints it as it is now, as Markdown with each block under its id; \`document replace\`, \`insert\` and \`delete\` change one block (\`document\` alone says how).` }),
      under: (box) => marks?.under(box) ?? null,
      margin: {
        anchors: (list) => marks?.anchors(list), place: (key) => marks?.place(key) ?? null, watch: (listener) => marks?.watch(listener) ?? (() => {}),
        stop: (key) => api(`${base}/stop`, { method: "POST", body: JSON.stringify({ item: key.split("/")[0] }) }),
        revert: { can: (key) => marks?.changed(key) ?? false, run: (key) => api(`${base}/changes`, { method: "POST", body: JSON.stringify({ op: "revert", thread: key }) }) },
        working: (key) => { const seat = marked()?.seats?.().find((one) => one.for === key); return seat && { by: seat.name, state: seat.state }; },
        suggestions: { list: () => marked()?.suggestions() ?? [], place: (key) => marks?.place(key) ?? null, accept: (key) => marks?.accept(key), reject: (key) => marks?.reject(key), acceptAll: (by) => marks?.acceptAll(by), rejectAll: (by) => marks?.rejectAll(by) },
        column: () => props.pane()?.querySelector<HTMLElement>(".ui-document-text")?.getBoundingClientRect() ?? null,
        focus: () => props.pane()?.querySelector<HTMLElement>(".ui-document-text")?.focus({ preventScroll: true }),
        answers: (acts) => setAnswers(() => acts),
      },
      tools: () => marks?.tools() ?? [],
      history: { undo: () => marks?.history.undo() ?? false, redo: () => marks?.history.redo() ?? false, canUndo: () => marks?.history.canUndo() ?? false, canRedo: () => marks?.history.canRedo() ?? false },
      asking: () => marks?.selection() ?? null,
    },
    offers: () => {
      const edits = controls();
      return {
        rename: () => props.pane()?.querySelector<HTMLInputElement>("input.ui-document-title")?.select(),
        ...(kind.markdown ? { copyMarkdown: () => void copyArtifactMarkdown({ id }) } : {}), ...(kind.count ? { count: () => countPapers(!paperCounted()) } : {}), width: widen, ...(props.shortcuts ? { shortcuts: () => setShowingKeys(true) } : {}),
        ...(edits ? { find: edits.find, blockMenu: edits.openBlockMenu, blockUp: () => void edits.moveBlock(-1), blockDown: () => void edits.moveBlock(1), outline: () => outlining?.click() } : {}),
      };
    },
    header: () => <Show when={controls()}>{(edits) => <DropdownMenu modal={false} placement="bottom-end">
      <MenuControl as={HeaderButton} ref={(element: HTMLButtonElement) => { outlining = element; }} label="Outline" icon={<Icons.Sidebar />} />
      <MenuContent width="md"><MenuSection title="Outline" note={edits().outline().length ? undefined : "No headings yet"}><For each={edits().outline()}>{(heading) => { const Level = documentBlockIcons[`heading-${Math.min(3, Math.max(1, heading.level))}` as "heading-1"]; return <MenuRow icon={<Level />} checked={heading.id === edits().current() || undefined} onSelect={() => edits().reveal(heading.id)}>{heading.text || "Untitled"}</MenuRow>; }}</For></MenuSection></MenuContent>
    </DropdownMenu>}</Show>,
    away, stale,
    reveal: () => controls()?.reveal,
    drawn: ready,
    // The sheet and the margin beside it, and the column's own side room past them.
    reach: () => {
      const pane = props.pane(), column = pane?.querySelector<HTMLElement>(".ui-document-column");
      if (!pane || !column) return 0;
      const right = Math.max(0, ...[...column.querySelectorAll(":scope > .ui-document-page > *")].map((part) => part.getBoundingClientRect().right));
      return right + (parseFloat(getComputedStyle(column).paddingRight) || 0) - pane.getBoundingClientRect().left;
    },
  });
  return <><DocumentEditor host={editing} id={id} name={props.about().name} bare onAway={setAway} onStale={setStale} onReady={() => setReady(true)} marks={(offered) => { marks = offered; setMarked(() => offered); }} mentions={() => props.quiet ? [] : props.offer()?.names() ?? []} to={() => props.offer()?.to() ?? null} onMention={ask} onRename={(name) => renameArtifact(id, name)} count={Boolean(kind.count) && paperCounted()} width={width()} controls={setControls} onComment={props.quiet ? undefined : ask} margin={props.margin} marginEmpty={props.marginEmpty} />
    <PaperShortcuts open={showingKeys()} onOpenChange={setShowingKeys} groups={shownKeys()} />
  </>;
}
