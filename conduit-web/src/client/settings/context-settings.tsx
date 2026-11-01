import { createEffect, createMemo, createSignal, For, Show } from "solid-js";
import { api } from "../api/client.ts";
import { Select } from "@/components/menus";
import { Button, Input, Segmented } from "@/components/ui/controls";
import * as Icons from "@/components/ui/icons";
import { NavRow } from "@/components/ui/nav";
import { ChainBreak, ChainDetailHead, ChainGap, ChainHead, ChainLayout, ChainLink, ChainMap, PromptSection } from "@/components/ui/network";
import { TextEditor } from "@/components/ui/text-editor";
import { SettingGroup, SettingLine, SettingLoading, SettingNote, SettingWide } from "@/components/ui/overlay";

/*
 * What every thread Conduit starts is given (GET /v0/context, context-store.js): blocks, named pieces of text, stacked
 * into documents, one document per role -- a profile, jbot, a routine's run, a subagent, chat naming. Prompts shows a
 * document as its stack under the role it starts; Blocks edits one block and says which documents it is in.
 */
export type BlockSummary = { id: string; label: string; kind: "text" | "live"; source: "shipped" | "jbot" | "custom" | "conduit";
  description?: string; tag?: string; template?: string; modified: boolean; editable: boolean; resettable: boolean; deletable: boolean; chars: number; usedBy: string[] };
export type RoleKind = "profile" | "agent" | "run" | "subagent" | "service";
export type DocumentView = { id: string; label: string; role: { kind: RoleKind; id: string; label: string };
  blocks: string[]; live: string[]; first: string[]; modified: boolean };
type BlockDetail = BlockSummary & { content?: string; preview?: string; defaultContent?: string };
type Preview = { sections: { blockId: string; label: string; kind: "text" | "live"; part: "system" | "first"; placed?: boolean; text: string }[]; chars: number };
export type ContextVar = { name: string; description: string; value?: string };

const ROLE_KIND: Record<RoleKind, string> = { profile: "Profile", agent: "Persistent agent", run: "Run", subagent: "Subagent", service: "Service" };
/** What a role's document starts, said once under its name. */
const ROLE_STARTS: Record<RoleKind, string> = {
  profile: "starts each of its chats", agent: "starts its home and side threads", run: "starts each run of it",
  subagent: "starts each subagent a chat hands a task", service: "starts each request",
};
const ROLE_ICON: Record<RoleKind, () => ReturnType<typeof Icons.Profile>> = {
  profile: () => <Icons.Profile />, agent: () => <Icons.Agent />, run: () => <Icons.Clock />, subagent: () => <Icons.Agent />, service: () => <Icons.Settings />,
};
const SOURCE: Record<BlockSummary["source"], string> = { shipped: "shipped", jbot: "jbot's file", custom: "yours", conduit: "filled in by Conduit" };
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

/** Settings › Prompts: one document as its stack -- the role at the top, its blocks in the order the model reads them,
 *  then what Conduit adds, then a run's first message -- beside the chosen block: its text or template and what can be
 *  done to it here. Text reads the whole document as the model gets it now. */
export function PromptsSettings(props: { context: ContextData; documentId: string; onDocument: (id: string) => void; onEditBlock: (id: string) => void }) {
  const [view, setView] = createSignal<"stack" | "text">("stack");
  const [busy, setBusy] = createSignal(false);
  const [failure, setFailure] = createSignal("");
  const [preview, setPreview] = createSignal<Preview | null>(null);
  const [chosen, setChosen] = createSignal("");
  const [detail, setDetail] = createSignal<BlockDetail | null>(null);
  const details = createBlockDetails(props.context);
  const documents = () => props.context.data()?.documents ?? [];
  const current = createMemo(() => props.context.document(props.documentId) ?? documents()[0]);
  const texts = () => (props.context.data()?.blocks ?? []).filter((block) => block.kind === "text" && block.id !== "web-tools");
  createEffect(() => { if (!props.context.document(props.documentId) && documents()[0]) props.onDocument(documents()[0]!.id); });
  const every = () => { const doc = current(); return doc ? [...doc.blocks, ...doc.live, ...doc.first] : []; };
  createEffect(() => { if (!every().includes(chosen())) setChosen(current()?.blocks[0] ?? ""); });
  createEffect(() => {
    const id = chosen();
    props.context.data();
    if (!id) return setDetail(null);
    void details(id).then((loaded) => { if (chosen() === id) setDetail(loaded); }, (cause) => setFailure(String(cause?.message || cause)));
  });
  createEffect(() => {
    const doc = current();
    props.context.data();
    if (view() !== "text" || !doc) return;
    void api<Preview>(`/v0/context/documents/${encodeURIComponent(doc.id)}/preview`).then(setPreview, (cause) => setFailure(String(cause?.message || cause)));
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
  const at = () => current()?.blocks.indexOf(chosen()) ?? -1;
  const edit = (change: (list: string[]) => void) => { const list = [...current()!.blocks]; change(list); void save(list); };
  const move = (to: number) => edit((list) => { const [item] = list.splice(at(), 1); list.splice(to, 0, item!); });
  const swap = (id: string) => { if (!id) return; const from = at(); edit((list) => { list[from] = id; }); setChosen(id); };
  const insert = (id: string) => { if (!id) return; const after = at(); edit((list) => list.splice(after + 1, 0, id)); setChosen(id); };
  const remove = () => edit((list) => list.splice(at(), 1));
  const placeOf = (id: string) => { const doc = current(); return !doc ? "" : doc.blocks.includes(id) ? "own" : doc.first.includes(id) ? "first" : "placed"; };
  const others = () => texts().filter((block) => !current()?.blocks.includes(block.id));
  const BlockPicker = (pickProps: { label: string; title: string; onPick: (id: string) => void }) => <Select bare search="Search blocks" aria-label={pickProps.title} value="" disabled={busy()} onChange={(event) => pickProps.onPick(event.currentTarget.value)}>
    <option value="">{pickProps.label}</option>
    <For each={others()}>{(block) => <option value={block.id}>{block.label}</option>}</For>
  </Select>;
  const link = (id: string, index?: number) => { const block = () => props.context.block(id);
    return <ChainLink index={index} live={block()?.kind === "live"} name={block()?.label ?? id} modified={block()?.modified} meta={block() ? (index == null ? block()!.tag ? `<${block()!.tag}>` : undefined : SOURCE[block()!.source]) : "missing"}
      size={block() ? tokens(block()!.chars) : undefined} current={chosen() === id} onSelect={() => setChosen(id)} />; };
  const Detail = () => <Show when={detail()} fallback={<SettingLoading>Loading…</SettingLoading>}>{(block) => {
    const own = () => placeOf(block().id) === "own";
    return <>
      <ChainDetailHead name={block().label} live={block().kind === "live"} size={tokens(block().chars)}
        meta={block().kind === "live" ? block().description : [own() ? SOURCE[block().source] : block().description, block().usedBy.length > 1 ? `in ${block().usedBy.length} documents` : "only in this document"].filter(Boolean).join(" · ")}
        actions={<>
          <Show when={block().kind === "text"}><Button variant="ghost" size="sm" onClick={() => props.onEditBlock(block().id)}><Icons.Edit />Edit</Button></Show>
          <Show when={block().kind === "live"}><Button variant="ghost" size="sm" onClick={() => props.onEditBlock(block().id)}><Icons.Preview />Where it is used</Button></Show>
          <Show when={own()}>
            <Button variant="ghost" size="icon-sm" aria-label="Move up" title="Move up" disabled={busy() || at() <= 0} onClick={() => move(at() - 1)}><Icons.ArrowUp /></Button>
            <Button variant="ghost" size="icon-sm" aria-label="Move down" title="Move down" disabled={busy() || at() >= current()!.blocks.length - 1} onClick={() => move(at() + 1)}><Icons.ArrowDown /></Button>
            <BlockPicker label="Swap for…" title={`Swap ${block().label} for another block`} onPick={swap} />
            <BlockPicker label="Add after…" title="Add a block after this one" onPick={insert} />
            <Button variant="ghost" size="icon-sm" aria-label="Remove from this document" title="Remove from this document" disabled={busy() || current()!.blocks.length < 2} onClick={remove}><Icons.Close /></Button>
          </Show>
        </>} />
      <Show when={block().kind === "live"} fallback={<TextEditor readOnly label={`${block().label} text`} value={block().content ?? ""} />}>
        <SettingGroup title="Template"><TextEditor readOnly label={`${block().label} template`} value={block().template ?? ""} /></SettingGroup>
        <Show when={block().preview && block().preview !== block().template}>
          <SettingGroup title="As it stands now"><TextEditor readOnly label={`${block().label} now`} value={block().preview!} /></SettingGroup>
        </Show>
      </Show>
    </>; }}</Show>;
  return <Show when={props.context.data()} fallback={<Show when={props.context.error()} fallback={<SettingLoading>Loading documents…</SettingLoading>}><SettingNote tone="error">{props.context.error()}</SettingNote></Show>}>
    <SettingGroup title="Document">
      <SettingLine label="Document" state={current()?.modified ? "changed" : undefined} title="The document a role starts its threads with. Changes apply when the next thread or turn starts.">
        <Select id="context-document" search="Search documents" aria-label="Document" value={current()?.id ?? ""} onChange={(event) => props.onDocument(event.currentTarget.value)}>
          <For each={documents()}>{(doc) => <option value={doc.id}>{doc.role.label} · {ROLE_KIND[doc.role.kind].toLowerCase()}</option>}</For>
        </Select>
        <Button variant="ghost" size="icon-sm" aria-label="Reset to its default blocks" title="Reset to its default blocks" disabled={busy() || !current()?.modified} onClick={() => void reset()}><Icons.Reset /></Button>
      </SettingLine>
      <SettingLine plain label="Show">
        <Segmented label="Show" value={view()} options={[{ value: "stack", label: "Blocks" }, { value: "text", label: "Text" }]} onChange={setView} />
      </SettingLine>
      <Show when={failure()}><SettingNote tone="error">{failure()}</SettingNote></Show>
    </SettingGroup>
    <Show when={current()}>{(doc) => <Show when={view() === "stack"} fallback={
      <SettingGroup title={preview() ? `As the model gets it now · ${tokens(preview()!.chars)}` : "As the model gets it now"}>
        <Show when={preview()} fallback={<SettingLoading>Putting it together…</SettingLoading>}>{(shown) => <div class="ui-prompt-pane" role="document" aria-label="The document as the model gets it" tabIndex={0}><For each={shown().sections}>{(section, index) => <>
          <Show when={section.part === "first" && shown().sections[index() - 1]?.part !== "first"}><ChainBreak label="First message" /></Show>
          <PromptSection name={section.label} live={section.kind === "live"} meta={section.kind === "live" ? "filled in by Conduit" : section.placed ? "placed by Conduit" : undefined} size={tokens(section.text.length)} text={section.text} />
        </>}</For></div>}</Show>
      </SettingGroup>}>
      <SettingGroup title="Blocks">
        <ChainLayout detail={<Detail />} map={<ChainMap label={`${doc().role.label}'s document`}>
          <ChainHead kind={ROLE_KIND[doc().role.kind]} name={doc().role.label} meta={ROLE_STARTS[doc().role.kind]} icon={ROLE_ICON[doc().role.kind]()} />
          <For each={doc().blocks}>{(id, index) => <><ChainGap />{link(id, index() + 1)}</>}</For>
          <Show when={doc().live.length}><ChainBreak label="Conduit adds" /><For each={doc().live}>{(id, index) => <><Show when={index() > 0}><ChainGap /></Show>{link(id)}</>}</For></Show>
          <Show when={doc().first.length}><ChainBreak label="First message" /><For each={doc().first}>{(id, index) => <><Show when={index() > 0}><ChainGap /></Show>{link(id)}</>}</For></Show>
        </ChainMap>} />
      </SettingGroup>
    </Show>}</Show>
  </Show>;
}

/** Settings › Blocks: every block, one open to edit, and the documents it is in (each opens in Prompts). */
export function BlocksSettings(props: { context: ContextData; blockId: string; onBlock: (id: string) => void; onOpenDocument: (id: string) => void }) {
  const [detail, setDetail] = createSignal<BlockDetail | null>(null);
  const [draft, setDraft] = createSignal("");
  const [label, setLabel] = createSignal("");
  const [state, setState] = createSignal<"idle" | "saving" | "saved">("idle");
  const [failure, setFailure] = createSignal("");
  const blocks = () => props.context.data()?.blocks ?? [];
  const current = createMemo(() => props.context.block(props.blockId) ?? blocks()[0]);
  createEffect(() => { if (!props.context.block(props.blockId) && blocks()[0]) props.onBlock(blocks()[0]!.id); });
  createEffect(() => {
    const block = current();
    if (!block) return;
    setDetail(null); setFailure(""); setState("idle");
    void api<BlockDetail>(`/v0/context/blocks/${encodeURIComponent(block.id)}`).then((loaded) => {
      if (loaded.id !== current()?.id) return;
      setDetail(loaded); setDraft(loaded.content ?? ""); setLabel(loaded.label);
    }, (cause) => setFailure(String(cause?.message || cause)));
  });
  const dirty = () => detail()?.kind === "text" && (draft() !== (detail()?.content ?? "") || (detail()?.source === "custom" && label() !== detail()?.label));
  const run = async (work: () => Promise<unknown>) => {
    setState("saving"); setFailure("");
    try { await work(); await props.context.load(); setState("saved"); }
    catch (cause) { setFailure(cause instanceof Error ? cause.message : String(cause)); setState("idle"); }
  };
  const save = () => run(async () => {
    const block = current()!;
    const saved = await api<BlockDetail>(`/v0/context/blocks/${encodeURIComponent(block.id)}`, { method: "PUT", body: JSON.stringify({ content: draft(), ...(block.source === "custom" ? { label: label() } : {}) }) });
    setDetail(saved); setDraft(saved.content ?? draft());
  });
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
    { title: "Yours", items: blocks().filter((block) => block.source === "custom") },
    { title: "Shipped", items: blocks().filter((block) => block.source === "shipped") },
    { title: "jbot's files", items: blocks().filter((block) => block.source === "jbot") },
    { title: "Filled in by Conduit", items: blocks().filter((block) => block.kind === "live") },
  ].filter((group) => group.items.length);
  const documentLabel = (id: string) => { const doc = props.context.document(id); return doc ? `${doc.role.label} · ${ROLE_KIND[doc.role.kind].toLowerCase()}` : id; };
  return <Show when={props.context.data()} fallback={<Show when={props.context.error()} fallback={<SettingLoading>Loading blocks…</SettingLoading>}><SettingNote tone="error">{props.context.error()}</SettingNote></Show>}>
    <SettingGroup title="Block">
      <SettingLine label="Block" state={current()?.modified ? "changed" : undefined}>
        <Select id="context-block" search="Search blocks" aria-label="Block" value={current()?.id ?? ""} onChange={(event) => props.onBlock(event.currentTarget.value)}>
          <For each={groups()}>{(group) => <For each={group.items}>{(block) => <option value={block.id}>{block.label} · {group.title.toLowerCase()}</option>}</For>}</For>
        </Select>
        <Button variant="ghost" size="icon-sm" aria-label="New block" title="New block" disabled={state() === "saving"} onClick={() => void create()}><Icons.Add /></Button>
      </SettingLine>
    </SettingGroup>
    <Show when={current()}>{(block) => <>
      <SettingGroup title="Used in">
        <Show when={block().usedBy.length} fallback={<SettingNote>In no document yet: add it to one from Prompts.</SettingNote>}>
          <For each={block().usedBy}>{(id) => <NavRow icon={ROLE_ICON[props.context.document(id)?.role.kind ?? "profile"]()} end={<Icons.ChevronRight />} onClick={() => props.onOpenDocument(id)}>{documentLabel(id)}</NavRow>}</For>
        </Show>
      </SettingGroup>
      <SettingGroup title={block().kind === "live" ? "Template" : "Text"}>
        <Show when={block().source === "custom"}>
          <SettingLine label="Name"><Input aria-label="Block name" value={label()} onInput={(event) => setLabel(event.currentTarget.value)} /></SettingLine>
        </Show>
        <SettingLine plain label={block().kind === "live" ? "Filled in" : SOURCE[block().source]} state={block().kind === "text" ? tokens(draft().length) : undefined}
          title={block().source === "jbot" ? "A file in jbot's folder: jbot can change it too (with your approval)." : undefined}>
          <Show when={block().kind === "text"}>
            <Button variant={dirty() ? "primary" : "ghost"} size="sm" disabled={!dirty() || !draft().trim() || state() === "saving"} onClick={() => void save()}>{state() === "saving" ? "Saving…" : dirty() ? "Save" : state() === "saved" ? "Saved" : "Save"}</Button>
            <Button variant="ghost" size="icon-sm" aria-label="Reset to default" title="Reset to default" disabled={!block().resettable || !block().modified || state() === "saving"} onClick={() => void reset()}><Icons.Reset /></Button>
            <Show when={block().deletable}><Button variant="ghost" size="icon-sm" aria-label="Delete block" title={block().usedBy.length ? "Remove it from every document first" : "Delete block"} disabled={block().usedBy.length > 0 || state() === "saving"} onClick={() => void remove()}><Icons.Delete /></Button></Show>
          </Show>
        </SettingLine>
        <Show when={block().description && block().kind === "live"}><SettingNote>{block().description!}</SettingNote></Show>
        <Show when={failure()}><SettingNote tone="error">{failure()}</SettingNote></Show>
        <Show when={detail()} fallback={<SettingLoading>Loading…</SettingLoading>}>{(loaded) => <SettingWide>
          <Show when={loaded().kind === "text"} fallback={<>
            <TextEditor readOnly label={`${loaded().label} template`} value={loaded().template ?? ""} />
            <Show when={loaded().preview && loaded().preview !== loaded().template}><SettingGroup title="As it stands now"><TextEditor readOnly label={`${loaded().label} now`} value={loaded().preview!} /></SettingGroup></Show>
          </>}>
            <TextEditor label={`${loaded().label} text`} value={draft()} onChange={(value) => { setDraft(value); setState("idle"); }} onSave={() => { if (dirty() && draft().trim()) void save(); }} />
          </Show>
        </SettingWide>}</Show>
      </SettingGroup>
      <Show when={block().kind === "text" && block().usedBy.some((id) => id === "agent" || id.startsWith("run:")) && props.context.data()?.vars?.length}>
        <SettingGroup title="Slots it can use">
          <SettingNote>Written as {"{{name}}"} in a jbot or run block, filled in when the thread or turn starts.</SettingNote>
          <For each={props.context.data()!.vars!}>{(slot) => <SettingLine plain label={<code>{`{{${slot.name}}}`}</code>} title={slot.description} state={slot.value || undefined} />}</For>
        </SettingGroup>
      </Show>
    </>}</Show>
  </Show>;
}
