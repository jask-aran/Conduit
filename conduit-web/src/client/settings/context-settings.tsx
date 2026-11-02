import { createEffect, createMemo, createSignal, For, lazy, Show, type JSX } from "solid-js";
import { api } from "../api/client.ts";
import { Select } from "@/components/menus";
import { Button, Input, Segmented } from "@/components/ui/controls";
import * as Icons from "@/components/ui/icons";
import { ChainBreak, ChainGap, ChainLink, ChainMap } from "@/components/ui/network";
import { TextEditorTitle, Workbench, WorkbenchFact, WorkbenchSplit, WorkbenchTitle } from "@/components/ui/workbench";
import { StatusText } from "@/components/ui/file";
import { Group } from "@/components/ui/group";
import { Loading, Note } from "@/components/ui/state";
import { Actions, IconButton } from "@/components/ui/actions";
// The editor brings CodeMirror: loaded when a page that shows one opens, never with the app.
const TextEditor = lazy(() => import("@/components/ui/text-editor").then((module) => ({ default: module.TextEditor })));
import type { ModelOption } from "../api/contracts";
import { ModelSelector } from "../chat/model-selector";
import { Row } from "@/components/ui/row";

/*
 * What every thread Conduit starts is given (GET /v0/context, context-store.js): blocks, named pieces of text, stacked
 * into documents, one document per role -- a profile, jbot, a routine's run, a subagent, chat naming. Prompts shows a
 * document as its stack under the role it starts; Blocks edits one block and says which documents it is in.
 */
export type BlockSummary = { id: string; label: string; kind: "text" | "live" | "notice"; source: "shipped" | "installed" | "jbot" | "custom" | "conduit";
  description?: string; tag?: string; template?: string; slots?: { name: string; description: string }[]; appendix?: string; modified: boolean; editable: boolean; resettable: boolean; deletable: boolean; chars: number; usedBy: string[] };
export type RoleKind = "profile" | "agent" | "run" | "subagent" | "service";
export type DocumentView = { id: string; label: string; role: { kind: RoleKind; id: string; label: string };
  blocks: string[]; live: string[]; first: string[]; notices?: string[]; modified: boolean; subagents?: { model: string; thinkingLevel: string } | null };
type BlockDetail = BlockSummary & { content?: string; preview?: string; defaultContent?: string };
/** A slot: fixed (filled into a system prompt when a thread starts; a change reaches the thread as an update notice)
 *  or current (never in a system prompt; it travels on notices). */
export type ContextVar = { name: string; description: string; value?: string; scope?: "fixed" | "current" };

const ROLE_KIND: Record<RoleKind, string> = { profile: "Profile", agent: "Persistent agent", run: "Run", subagent: "Subagent", service: "Service" };
/** What a role's document starts, said once under its name. */
const ROLE_STARTS: Record<RoleKind, string> = {
  profile: "starts each of its chats", agent: "starts its home and side threads", run: "starts each run of it",
  subagent: "starts each subagent a chat hands a task", service: "starts each request",
};
const ROLE_ICON: Record<RoleKind, () => ReturnType<typeof Icons.Profile>> = {
  profile: () => <Icons.Profile />, agent: () => <Icons.Agent />, run: () => <Icons.Clock />, subagent: () => <Icons.Agent />, service: () => <Icons.Settings />,
};
const SOURCE: Record<BlockSummary["source"], string> = { shipped: "shipped", installed: "installed skill", jbot: "jbot's file", custom: "yours", conduit: "filled in by Conduit" };
/** About how much it costs a thread: tokens at four characters each, the unit a context window is counted in. */
export const tokens = (chars: number) => chars < 400 ? `${Math.max(1, Math.round(chars / 4))} tok` : `${(chars / 4000).toFixed(1)}k tok`;
/** The blocks and documents, loaded once a page opens and again after every change (the server's word is the state). */
export function createContextData() {
  const [data, setData] = createSignal<{ blocks: BlockSummary[]; documents: DocumentView[]; vars?: ContextVar[] } | null>(null);
  const [error, setError] = createSignal("");
  const load = async () => {
    try { setData(await api<{ blocks: BlockSummary[]; documents: DocumentView[]; vars?: ContextVar[] }>("/v0/context")); setError(""); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
  };
  const block = (id: string) => data()?.blocks.find((item) => item.id === id);
  const document = (id: string) => data()?.documents.find((item) => item.id === id);
  return { data, error, load, block, document };
}
export type ContextData = ReturnType<typeof createContextData>;

/** A block's text or, for one Conduit fills in, its template; loaded when chosen, kept until the context reloads. */
function createBlockDetails(context: ContextData) {
  const cache = new Map<string, Promise<BlockDetail>>();
  createEffect(() => { context.data(); cache.clear(); });
  return (id: string) => {
    if (!cache.has(id)) cache.set(id, api<BlockDetail>(`/v0/context/blocks/${encodeURIComponent(id)}`));
    return cache.get(id)!;
  };
}

/** Settings › Prompts: one document, named by its title (which is also how another is chosen), as its stack -- its
 *  blocks in the order the model reads them, then what Conduit adds, then a run's first message -- beside the chosen
 *  block in an editor pane filling the height, the block's actions in the pane's bar and what is known of it in its
 *  foot. */
export function PromptsSettings(props: { context: ContextData; documentId: string; onDocument: (id: string) => void; onEditBlock: (id: string) => void; models?: () => ModelOption[]; onManageModels?: () => void }) {
  const [busy, setBusy] = createSignal(false);
  const [failure, setFailure] = createSignal("");
  const [chosen, setChosen] = createSignal("");
  const [detail, setDetail] = createSignal<BlockDetail | null>(null);
  const [liveView, setLiveView] = createSignal<"template" | "now">("template");
  const details = createBlockDetails(props.context);
  const documents = () => props.context.data()?.documents ?? [];
  const current = createMemo(() => props.context.document(props.documentId) ?? documents()[0]);
  const texts = () => (props.context.data()?.blocks ?? []).filter((block) => block.kind === "text" && block.id !== "web-tools");
  createEffect(() => { if (!props.context.document(props.documentId) && documents()[0]) props.onDocument(documents()[0]!.id); });
  const every = () => { const doc = current(); return doc ? [...doc.blocks, ...doc.live, ...doc.first, ...(doc.notices ?? [])] : []; };
  createEffect(() => { if (!every().includes(chosen())) setChosen(current()?.blocks[0] ?? ""); });
  createEffect(() => {
    const id = chosen();
    props.context.data();
    if (!id) return setDetail(null);
    void details(id).then((loaded) => { if (chosen() === id) setDetail(loaded); }, (cause) => setFailure(String(cause?.message || cause)));
  });
  const save = async (blocks: string[]) => {
    const doc = current();
    if (!doc) return;
    setBusy(true); setFailure("");
    try { await api(`/v0/context/documents/${encodeURIComponent(doc.id)}`, { method: "PUT", body: JSON.stringify({ blocks }) }); await props.context.load(); }
    catch (cause) { setFailure(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); }
  };
  const reset = async () => {
    const doc = current();
    if (!doc) return;
    setBusy(true);
    try { await api(`/v0/context/documents/${encodeURIComponent(doc.id)}/reset`, { method: "POST" }); await props.context.load(); }
    catch (cause) { setFailure(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); }
  };
  // A profile's subagents: the model and effort they run on ("Chat's model" stores nothing).
  const setChildren = async (value: { model: string; thinkingLevel: string } | null) => {
    const doc = current();
    if (!doc) return;
    setBusy(true); setFailure("");
    try { await api(`/v0/context/documents/${encodeURIComponent(doc.id)}`, { method: "PUT", body: JSON.stringify({ subagents: value }) }); await props.context.load(); }
    catch (cause) { setFailure(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); }
  };
  const SAME_CHAT = { provider: "its chat", id: "", spec: "", label: "Chat's model", thinkingLevels: [] } as unknown as ModelOption;
  const levelsOf = (spec: string) => props.models?.().find((model) => model.spec === spec)?.thinkingLevels || ["off"];
  const chooseChildren = (spec: string) => {
    if (!spec) return void setChildren(null);
    const keep = current()?.subagents?.thinkingLevel;
    const allowed = levelsOf(spec);
    void setChildren({ model: spec, thinkingLevel: keep && allowed.includes(keep) ? keep : allowed.includes("medium") ? "medium" : allowed[0] || "off" });
  };
  const Children = () => <Show when={current()?.role.kind === "profile" && props.models}>
    <WorkbenchFact name="Subagents" title="The model and effort this profile's subagents run on">
      <ModelSelector models={[SAME_CHAT, ...props.models!()]} model={current()?.subagents?.model ?? ""} thinkingLevel={current()?.subagents?.thinkingLevel ?? ""}
        quiet={current()?.subagents ? undefined : ""} onModelChange={chooseChildren} onManageModels={props.onManageModels}
        onThinkingLevelChange={(thinkingLevel) => current()?.subagents && void setChildren({ ...current()!.subagents!, thinkingLevel })} />
    </WorkbenchFact>
  </Show>;
  const at = () => current()?.blocks.indexOf(chosen()) ?? -1;
  const edit = (change: (list: string[]) => void) => { const list = [...current()!.blocks]; change(list); void save(list); };
  const move = (to: number) => edit((list) => { const [item] = list.splice(at(), 1); list.splice(to, 0, item!); });
  const swap = (id: string) => { if (!id) return; const from = at(); edit((list) => { list[from] = id; }); setChosen(id); };
  const insert = (id: string) => { if (!id) return; const after = at(); edit((list) => list.splice(after + 1, 0, id)); setChosen(id); };
  const remove = () => edit((list) => list.splice(at(), 1));
  const own = (id: string) => Boolean(current()?.blocks.includes(id));
  const others = () => texts().filter((block) => !current()?.blocks.includes(block.id));
  /** Swap or add: an icon in the pane's bar opening a search over the blocks not already in the document. */
  const BlockPicker = (pickProps: { title: string; icon: JSX.Element; onPick: (id: string) => void }) => <Select look="icon" icon={pickProps.icon} search="Search blocks" title={pickProps.title} aria-label={pickProps.title} value="" disabled={busy()} onChange={(event) => pickProps.onPick(event.currentTarget.value)}>
    <option value="">{pickProps.title}</option>
    <For each={others()}>{(block) => <option value={block.id}>{block.label}</option>}</For>
  </Select>;
  const link = (id: string, index?: number) => { const block = () => props.context.block(id);
    return <ChainLink index={index} live={block()?.kind === "live"} notice={block()?.kind === "notice"} name={block()?.label ?? id} modified={block()?.modified} meta={block() ? (index == null ? block()!.tag ? `<${block()!.tag}>` : block()!.kind === "notice" && block()!.modified ? "changed" : undefined : SOURCE[block()!.source]) : "missing"}
      size={block() ? tokens(block()!.chars) : undefined} current={chosen() === id} onSelect={() => { setChosen(id); setLiveView("template"); }} />; };
  const Detail = () => <Show when={detail()} fallback={<Loading>Loading…</Loading>}>{(block) => {
    const live = () => block().kind === "live";
    const shown = () => live() ? (liveView() === "now" ? block().preview ?? "" : block().template ?? "") : block().content ?? "";
    return <TextEditor fill readOnly label={`${block().label} ${live() ? liveView() === "now" ? "as it stands now" : "template" : "text"}`} value={shown()}
      head={<>
        <TextEditorTitle live={live()}>{block().label}</TextEditorTitle>
        <Show when={live() && block().preview && block().preview !== block().template}>
          <Segmented size="sm" label="Show" value={liveView()} onChange={setLiveView} options={[{ value: "template", label: "Template" }, { value: "now", label: "Now" }]} />
        </Show>
        <Actions kind="editor">
          <IconButton kind="file" label={live() ? "Where it is used" : `Edit ${block().label}`} onClick={() => props.onEditBlock(block().id)}>{live() ? <Icons.Preview /> : <Icons.Edit />}</IconButton>
          <Show when={own(block().id)}>
            <IconButton kind="file" label="Move up" disabled={busy() || at() <= 0} onClick={() => move(at() - 1)}><Icons.ArrowUp /></IconButton>
            <IconButton kind="file" label="Move down" disabled={busy() || at() >= current()!.blocks.length - 1} onClick={() => move(at() + 1)}><Icons.ArrowDown /></IconButton>
            <BlockPicker title={`Swap ${block().label} for another block`} icon={<Icons.Swap />} onPick={swap} />
            <BlockPicker title="Add a block after this one" icon={<Icons.Add />} onPick={insert} />
            <IconButton kind="file" label="Remove from this document" disabled={busy() || current()!.blocks.length < 2} onClick={remove}><Icons.Close /></IconButton>
          </Show>
        </Actions>
      </>}
      status={<>
        <StatusText>{tokens(live() ? shown().length : block().chars)}</StatusText>
        <Show when={live()} fallback={<>
          <Show when={block().kind === "notice"}><StatusText>{block().appendix ? `notice · then ${block().appendix}` : "notice: Conduit writes it into the thread"}</StatusText></Show>
          <Show when={block().usedBy.length > 1}><StatusText>{`in ${block().usedBy.length} documents`}</StatusText></Show>
        </>}>
          <StatusText>{block().tag ? `<${block().tag}> · filled in by Conduit` : "filled in by Conduit"}</StatusText>
        </Show>
      </>} />; }}</Show>;
  return <Show when={props.context.data()} fallback={<Show when={props.context.error()} fallback={<Loading>Loading documents…</Loading>}><Note tone="error">{props.context.error()}</Note></Show>}>
    <Show when={current()}>{(doc) => <Workbench label="Prompts">
      <WorkbenchTitle meta={`${ROLE_KIND[doc().role.kind]} · ${ROLE_STARTS[doc().role.kind]}${doc().modified ? " · changed" : ""}`}
        title={<Select look="title" id="context-document" search="Search documents" aria-label="Document" title="Choose a document" value={doc().id} onChange={(event) => props.onDocument(event.currentTarget.value)}>
          <For each={documents()}>{(item) => <option value={item.id}>{item.role.label}</option>}</For>
        </Select>}
        actions={<><Children /><Button variant="ghost" size="icon-sm" aria-label="Reset to its default blocks" title="Reset to its default blocks" disabled={busy() || !doc().modified} onClick={() => void reset()}><Icons.Reset /></Button></>} />
      <Show when={failure()}><Note tone="error">{failure()}</Note></Show>
      <WorkbenchSplit main={<Detail />} side={<ChainMap label={`${doc().role.label}'s document`}>
        <For each={doc().blocks}>{(id, index) => <><Show when={index() > 0}><ChainGap /></Show>{link(id, index() + 1)}</>}</For>
        <Show when={doc().live.length}><ChainBreak label="Conduit adds" /><For each={doc().live}>{(id, index) => <><Show when={index() > 0}><ChainGap /></Show>{link(id)}</>}</For></Show>
        <Show when={doc().first.length}><ChainBreak label="First message" /><For each={doc().first}>{(id, index) => <><Show when={index() > 0}><ChainGap /></Show>{link(id)}</>}</For></Show>
        <Show when={doc().notices?.length}><ChainBreak label="Notices it receives" /><For each={doc().notices}>{(id, index) => <><Show when={index() > 0}><ChainGap /></Show>{link(id)}</>}</For></Show>
      </ChainMap>} />
    </Workbench>}</Show>
  </Show>;
}

/** Settings › Blocks: a workbench on one block -- its name the page's title (choosing another), its text in an editor
 *  pane filling the height (save, reset, delete in the pane's bar; tokens and where it comes from in its foot), and
 *  beside it the documents it is in (each opening in Prompts) and the slots it can use. */
export function BlocksSettings(props: { context: ContextData; blockId: string; onBlock: (id: string) => void; onOpenDocument: (id: string) => void }) {
  const [detail, setDetail] = createSignal<BlockDetail | null>(null);
  const [draft, setDraft] = createSignal("");
  const [label, setLabel] = createSignal("");
  const [state, setState] = createSignal<"idle" | "saving" | "saved">("idle");
  const [failure, setFailure] = createSignal("");
  const [liveView, setLiveView] = createSignal<"template" | "now">("template");
  const blocks = () => props.context.data()?.blocks ?? [];
  const current = createMemo(() => props.context.block(props.blockId) ?? blocks()[0]);
  createEffect(() => { if (!props.context.block(props.blockId) && blocks()[0]) props.onBlock(blocks()[0]!.id); });
  createEffect(() => {
    const block = current();
    if (!block) return;
    setDetail(null); setFailure(""); setState("idle"); setLiveView("template");
    void api<BlockDetail>(`/v0/context/blocks/${encodeURIComponent(block.id)}`).then((loaded) => {
      if (loaded.id !== current()?.id) return;
      setDetail(loaded); setDraft(loaded.content ?? ""); setLabel(loaded.label);
    }, (cause) => setFailure(String(cause?.message || cause)));
  });
  const editable = (block: BlockSummary | null | undefined) => block?.kind === "text" || block?.kind === "notice";
  const dirty = () => editable(detail()) && (draft() !== (detail()?.content ?? "") || (detail()?.source === "custom" && label().trim() !== detail()?.label));
  const run = async (work: () => Promise<unknown>) => {
    setState("saving"); setFailure("");
    try { await work(); await props.context.load(); setState("saved"); }
    catch (cause) { setFailure(cause instanceof Error ? cause.message : String(cause)); setState("idle"); }
  };
  const save = () => { if (!dirty() || !draft().trim()) return; void run(async () => {
    const block = current()!;
    const saved = await api<BlockDetail>(`/v0/context/blocks/${encodeURIComponent(block.id)}`, { method: "PUT", body: JSON.stringify({ content: draft(), ...(block.source === "custom" && label().trim() ? { label: label().trim() } : {}) }) });
    setDetail(saved); setDraft(saved.content ?? draft()); setLabel(saved.label);
  }); };
  const reset = () => run(async () => {
    const saved = await api<BlockDetail>(`/v0/context/blocks/${encodeURIComponent(current()!.id)}/reset`, { method: "POST" });
    setDetail(saved); setDraft(saved.content ?? "");
  });
  const create = () => run(async () => {
    const made = await api<BlockDetail>("/v0/context/blocks", { method: "POST", body: JSON.stringify({ label: "New block", content: "Write this block's instructions here." }) });
    props.onBlock(made.id);
  });
  const remove = () => run(async () => { await api(`/v0/context/blocks/${encodeURIComponent(current()!.id)}`, { method: "DELETE" }); props.onBlock(""); });
  const groups = (): { title: string; items: BlockSummary[] }[] => [
    { title: "yours", items: blocks().filter((block) => block.source === "custom") },
    { title: "shipped", items: blocks().filter((block) => block.source === "shipped" && block.kind === "text") },
    { title: "installed skills", items: blocks().filter((block) => block.source === "installed") },
    { title: "jbot's file", items: blocks().filter((block) => block.source === "jbot") },
    { title: "filled in by Conduit", items: blocks().filter((block) => block.kind === "live") },
    { title: "notice", items: blocks().filter((block) => block.kind === "notice") },
  ].filter((group) => group.items.length);
  const documentLabel = (id: string) => props.context.document(id)?.role.label ?? id;
  // The slots a block can use: a notice declares its own; a jbot or run block gets the fixed slots (the current time
  // never goes in a system prompt).
  const slotsOf = (block: BlockSummary): { name: string; description: string; value?: string }[] => {
    const vars = props.context.data()?.vars ?? [];
    if (block.kind === "notice") return (block.slots ?? []).map((slot) => ({ ...slot, value: vars.find((item) => item.name === slot.name)?.value }));
    return block.kind === "text" && block.usedBy.some((id) => id === "agent" || id.startsWith("run:")) ? vars.filter((item) => item.scope !== "current") : [];
  };
  const Main = () => <Show when={detail()} fallback={<Loading>Loading…</Loading>}>{(loaded) => {
    const live = () => loaded().kind === "live";
    return <TextEditor fill readOnly={live()} label={`${loaded().label} ${live() ? liveView() === "now" ? "as it stands now" : "template" : "text"}`}
      value={live() ? (liveView() === "now" ? loaded().preview ?? "" : loaded().template ?? "") : draft()}
      onChange={(value) => { setDraft(value); setState("idle"); }} onSave={save}
      head={<>
        <TextEditorTitle live={live()}>{live() ? "Template" : loaded().kind === "notice" ? "Notice" : "Text"}</TextEditorTitle>
        <Show when={live() && loaded().preview && loaded().preview !== loaded().template}>
          <Segmented size="sm" label="Show" value={liveView()} onChange={setLiveView} options={[{ value: "template", label: "Template" }, { value: "now", label: "Now" }]} />
        </Show>
        <Show when={!live()}><Actions kind="editor">
          <Button variant={dirty() ? "primary" : "ghost"} size="sm" disabled={!dirty() || !draft().trim() || state() === "saving"} title="Save (Ctrl+S)" onClick={save}>{state() === "saving" ? "Saving…" : dirty() ? "Save" : "Saved"}</Button>
          <IconButton kind="file" label="Reset to the shipped text" disabled={!loaded().resettable || !loaded().modified || state() === "saving"} onClick={() => void reset()}><Icons.Reset /></IconButton>
          <Show when={loaded().source === "custom"}><IconButton kind="file" label={loaded().usedBy.length ? "Remove it from every document to delete it" : "Delete block"} disabled={loaded().usedBy.length > 0 || state() === "saving"} onClick={() => void remove()}><Icons.Delete /></IconButton></Show>
        </Actions></Show>
      </>}
      status={<>
        <StatusText>{tokens(live() ? (liveView() === "now" ? loaded().preview ?? "" : loaded().template ?? "").length : draft().length)}</StatusText>
        <StatusText>{live() ? loaded().tag ? `<${loaded().tag}> · filled in by Conduit` : "filled in by Conduit" : loaded().kind === "notice" ? "notice: Conduit writes it into the thread" : loaded().source === "jbot" ? "jbot's file: jbot can change it too" : SOURCE[loaded().source]}</StatusText>
      </>} />; }}</Show>;
  return <Show when={props.context.data()} fallback={<Show when={props.context.error()} fallback={<Loading>Loading blocks…</Loading>}><Note tone="error">{props.context.error()}</Note></Show>}>
    <Show when={current()}>{(block) => <Workbench label="Blocks">
      <WorkbenchTitle meta={`${block().kind === "live" || block().kind === "notice" ? block().description ?? SOURCE.conduit : SOURCE[block().source]}${block().modified ? " · changed" : ""}`}
        title={<Select look="title" id="context-block" search="Search blocks" aria-label="Block" title="Choose a block" value={block().id} onChange={(event) => props.onBlock(event.currentTarget.value)}>
          <For each={groups()}>{(group) => <For each={group.items}>{(item) => <option value={item.id}>{item.label}</option>}</For>}</For>
        </Select>}
        actions={<Button variant="ghost" size="icon-sm" aria-label="New block" title="New block" disabled={state() === "saving"} onClick={() => void create()}><Icons.Add /></Button>} />
      <Show when={failure()}><Note tone="error">{failure()}</Note></Show>
      <WorkbenchSplit main={<Main />} side={<>
        <Show when={block().source === "custom"}>
          <Group kind="workbench" title="Name"><Input aria-label="Block name" value={label()} onInput={(event) => { setLabel(event.currentTarget.value); setState("idle"); }} onKeyDown={(event) => { if (event.key === "Enter") save(); }} /></Group>
        </Show>
        <Group kind="workbench" title="Used in">
          <Show when={block().usedBy.length} fallback={<Note kind="workbench">In no document yet: add it to one from Prompts.</Note>}>
            <For each={block().usedBy}>{(id) => <Row density="nav" element="button" lead={ROLE_ICON[props.context.document(id)?.role.kind ?? "profile"]()} end={<Icons.ChevronRight />} title={`Open ${documentLabel(id)} in Prompts`} onClick={() => props.onOpenDocument(id)}>{documentLabel(id)}</Row>}</For>
          </Show>
        </Group>
        <Show when={slotsOf(block()).length}>
          <Group kind="workbench" title="Slots it can use">
            <For each={slotsOf(block())}>{(slot) => <WorkbenchFact code name={`{{${slot.name}}}`} value={slot.value || (block().kind === "notice" ? slot.description : undefined)} title={slot.description} />}</For>
          </Group>
        </Show>
        <Show when={block().appendix}>
          <Group kind="workbench" title="Conduit then adds"><Note kind="workbench">{block().appendix}</Note></Group>
        </Show>
      </>} />
    </Workbench>}</Show>
  </Show>;
}
