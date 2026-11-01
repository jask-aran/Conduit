import { createEffect, createMemo, createSignal, For, Show } from "solid-js";
import { api } from "../api/client.ts";
import { Select } from "@/components/menus";
import { Button, Input, Segmented, TextArea } from "@/components/ui/controls";
import * as Icons from "@/components/ui/icons";
import { NavRow } from "@/components/ui/nav";
import { ChainBreak, ChainGap, ChainHead, ChainLink, ChainMap } from "@/components/ui/network";
import { SettingGroup, SettingLine, SettingLoading, SettingNote, SettingWide } from "@/components/ui/overlay";

/*
 * What every thread Conduit starts is given (GET /v0/context, context-store.js): blocks, named pieces of text, stacked
 * into documents, one document per role -- a profile, jbot, a routine's run, a subagent, chat naming. Prompts shows a
 * document as its stack under the role it starts; Blocks edits one block and says which documents it is in.
 */
export type BlockSummary = { id: string; label: string; kind: "text" | "live"; source: "shipped" | "jbot" | "custom" | "conduit";
  description?: string; modified: boolean; editable: boolean; resettable: boolean; deletable: boolean; chars: number; usedBy: string[] };
export type RoleKind = "profile" | "agent" | "run" | "subagent" | "service";
export type DocumentView = { id: string; label: string; role: { kind: RoleKind; id: string; label: string };
  blocks: string[]; live: string[]; first: string[]; modified: boolean };
type BlockDetail = BlockSummary & { content?: string; preview?: string; defaultContent?: string };
type Preview = { sections: { blockId: string; label: string; kind: "text" | "live"; part: "system" | "first"; text: string }[]; chars: number };

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
const usage = (block: BlockSummary) => block.kind === "live" ? block.description || SOURCE.conduit
  : `${SOURCE[block.source]} · ${block.usedBy.length === 1 ? "only here" : `in ${block.usedBy.length} documents`}`;

/** The blocks and documents, loaded once a page opens and again after every change (the server's word is the state). */
export function createContextData() {
  const [data, setData] = createSignal<{ blocks: BlockSummary[]; documents: DocumentView[] } | null>(null);
  const [error, setError] = createSignal("");
  const load = async () => {
    try { setData(await api<{ blocks: BlockSummary[]; documents: DocumentView[] }>("/v0/context")); setError(""); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
  };
  const block = (id: string) => data()?.blocks.find((item) => item.id === id);
  const document = (id: string) => data()?.documents.find((item) => item.id === id);
  return { data, error, load, block, document };
}
export type ContextData = ReturnType<typeof createContextData>;

/** Settings › Prompts: one document as its stack -- the role at the top, its blocks in the order the model reads them,
 *  then what Conduit adds, then a run's first message. A block opens in Blocks. */
export function PromptsSettings(props: { context: ContextData; documentId: string; onDocument: (id: string) => void; onEditBlock: (id: string) => void }) {
  const [view, setView] = createSignal<"stack" | "text">("stack");
  const [busy, setBusy] = createSignal(false);
  const [failure, setFailure] = createSignal("");
  const [preview, setPreview] = createSignal<Preview | null>(null);
  const documents = () => props.context.data()?.documents ?? [];
  const current = createMemo(() => props.context.document(props.documentId) ?? documents()[0]);
  const texts = () => (props.context.data()?.blocks ?? []).filter((block) => block.kind === "text");
  createEffect(() => { if (!props.context.document(props.documentId) && documents()[0]) props.onDocument(documents()[0]!.id); });
  createEffect(() => {
    const doc = current();
    if (view() !== "text" || !doc) return;
    setPreview(null);
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
  const move = (from: number, to: number) => { const list = [...current()!.blocks]; const [item] = list.splice(from, 1); list.splice(to, 0, item!); void save(list); };
  const swap = (at: number, id: string) => { const list = [...current()!.blocks]; list[at] = id; void save(list); };
  const insert = (at: number, id: string) => { if (!id) return; const list = [...current()!.blocks]; list.splice(at, 0, id); void save(list); };
  const remove = (at: number) => { const list = [...current()!.blocks]; list.splice(at, 1); void save(list); };
  /** Insert here: a search over the text blocks not already in it. */
  const Insert = (insertProps: { at: number }) => <Select bare search="Search blocks" aria-label="Add a block here" value="" disabled={busy()} onChange={(event) => insert(insertProps.at, event.currentTarget.value)}>
    <option value="">Add a block</option>
    <For each={texts().filter((block) => !current()?.blocks.includes(block.id))}>{(block) => <option value={block.id}>{block.label}</option>}</For>
  </Select>;
  const live = (ids: string[]) => <For each={ids}>{(id, index) => { const block = () => props.context.block(id);
    return <>
      <Show when={index() > 0}><ChainGap /></Show>
      <ChainLink live name={block()?.label ?? id} meta={block() ? usage(block()!) : undefined} onOpen={() => props.onEditBlock(id)} openLabel={`See ${block()?.label ?? id}`} />
    </>; }}</For>;
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
    <Show when={current()}>{(doc) => <Show when={view() === "stack"} fallback={<SettingWide>
        <Show when={preview()} fallback={<SettingLoading>Putting it together…</SettingLoading>}>{(shown) => <>
          <SettingNote>{`As the model gets it now, ${tokens(shown().chars)}: what Conduit fills in is shown as it stands, or described where it changes each thread.`}</SettingNote>
          <TextArea aria-label="The document as text" readOnly spellcheck={false} value={shown().sections.map((section, index) => `${index && section.part === "first" && shown().sections[index - 1]!.part === "system" ? "──── First message ────\n\n" : ""}${section.text}`).join("\n\n")} />
        </>}</Show>
      </SettingWide>}>
      <ChainMap label={`${doc().role.label}'s document`}>
        <ChainHead kind={ROLE_KIND[doc().role.kind]} name={doc().role.label} meta={ROLE_STARTS[doc().role.kind]} icon={ROLE_ICON[doc().role.kind]()} />
        <ChainGap><Insert at={0} /></ChainGap>
        <For each={doc().blocks}>{(id, index) => { const block = () => props.context.block(id);
          return <>
            <ChainLink index={index() + 1} name={block()?.label ?? id} modified={block()?.modified} meta={block() ? usage(block()!) : "missing"} size={block() ? tokens(block()!.chars) : undefined}
              onOpen={() => props.onEditBlock(id)} openLabel={`Edit ${block()?.label ?? id}`}
              actions={<>
                <Button variant="ghost" size="icon-sm" aria-label="Move up" title="Move up" disabled={busy() || index() === 0} onClick={() => move(index(), index() - 1)}><Icons.ArrowUp /></Button>
                <Button variant="ghost" size="icon-sm" aria-label="Move down" title="Move down" disabled={busy() || index() === doc().blocks.length - 1} onClick={() => move(index(), index() + 1)}><Icons.ArrowDown /></Button>
                <Select bare search="Search blocks" aria-label={`Swap ${block()?.label ?? id} for another block`} title="Swap for another block" value="" disabled={busy()} onChange={(event) => { if (event.currentTarget.value) swap(index(), event.currentTarget.value); }}>
                  <option value="">Swap</option>
                  <For each={texts().filter((item) => item.id === id || !doc().blocks.includes(item.id))}>{(item) => <option value={item.id === id ? "" : item.id} disabled={item.id === id}>{item.label}</option>}</For>
                </Select>
                <Button variant="ghost" size="icon-sm" aria-label="Remove from this document" title="Remove from this document" disabled={busy() || doc().blocks.length < 2} onClick={() => remove(index())}><Icons.Close /></Button>
              </>} />
            <ChainGap><Insert at={index() + 1} /></ChainGap>
          </>; }}</For>
        <Show when={doc().live.length}><ChainBreak label="Conduit adds" />{live(doc().live)}</Show>
        <Show when={doc().first.length}><ChainBreak label="First message" />{live(doc().first)}</Show>
      </ChainMap>
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
      <SettingGroup title={block().kind === "live" ? "What Conduit puts here" : "Text"}>
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
          <Show when={loaded().kind === "text"} fallback={<TextArea aria-label="What Conduit puts here" readOnly spellcheck={false} value={loaded().preview ?? ""} />}>
            <TextArea aria-label={`${loaded().label} text`} spellcheck={false} value={draft()} onInput={(event) => { setDraft(event.currentTarget.value); setState("idle"); }} />
          </Show>
        </SettingWide>}</Show>
      </SettingGroup>
    </>}</Show>
  </Show>;
}
