import { createEffect, createSignal, For, lazy, onCleanup, onMount, Show } from "solid-js";
import { Button, Icons, Input, LiveNote, SettingLine, SettingValue, Switch, Group, Loading, Note } from "@/components/ui";
import { Select } from "@/components/ui/menus";
import { Row } from "@/components/ui/row";
import { Actions, IconButton } from "@/components/ui/actions";
import { Heading } from "@/components/ui/header";
import { StatusText } from "@/components/ui/file";
import { Workbench, WorkbenchFact, WorkbenchSplit, WorkbenchTitle } from "@/components/ui/workbench";
import { ROLE_ICON, type BlockDetail, type ContextData } from "./context-settings";
// The editor brings CodeMirror: loaded when a skill is opened, never with the app.
const TextEditor = lazy(() => import("@/components/ui/text-editor").then((module) => ({ default: module.TextEditor })));
import { createDecisionScope } from "@/components/ui/decision-dialog";
import { api } from "../api/client";

/** GET /v0/skills (skill-store.js `list`). */
type Skill = {
  id: string; name: string; description: string; chars: number; missing: boolean; enabled: boolean;
  origin: "shipped" | "installed"; profiles: string[]; source?: string; skillId?: string; installedAt?: string;
};
/** GET /v0/skills/search: the registry's (skills.sh, the one `npx skills` searches). */
type Found = { source: string; skillId: string; name: string; installs: number | null; installed: boolean };

const tokens = (chars: number) => chars < 400 ? `${Math.max(1, Math.round(chars / 4))} tok` : `${(chars / 4000).toFixed(1)}k tok`;
const count = (value: number) => value >= 1_000_000 ? `${(value / 1_000_000).toFixed(1)}M`
  : value >= 1000 ? `${(value / 1000).toFixed(value >= 10_000 ? 0 : 1)}k` : String(value);

/**
 * AI › Skills: what the hub's agents know how to do beyond their prompt. Shipped with the profiles, or installed here
 * from a registry (skills.sh today; uploads and other registries later). Each is turned on or off for every profile at
 * once; an installed one joins every profile's default document (a document you saved keeps its own list: add it in
 * Prompts). A skill's line in a prompt is its description; its text is read when the model loads it, so its size is said.
 *
 * `skillId` opens one skill as a workbench (as Settings › Blocks does a block): its text in an editor, and beside it
 * whether it is on and the documents that list it, each opening in Prompts. A skill's text is kept as the block
 * `skill-<id>` (context-store.js), which is how a document names it.
 */
export function SkillsSettings(props: { context: ContextData; skillId: string; onSkill: (id: string) => void; onOpenDocument: (id: string) => void }) {
  const [skills, setSkills] = createSignal<Skill[] | null>(null);
  const [error, setError] = createSignal("");
  const [busy, setBusy] = createSignal("");
  const [status, setStatus] = createSignal("");
  const [query, setQuery] = createSignal("");
  const [found, setFound] = createSignal<Found[] | null>(null);
  const [searching, setSearching] = createSignal(false);
  const [searchError, setSearchError] = createSignal("");
  const { confirm } = createDecisionScope(() => "skills-settings");
  const failed = (failure: unknown) => failure instanceof Error ? failure.message : String(failure);
  const load = () => api<{ skills: Skill[] }>("/v0/skills").then((value) => { setSkills(value.skills); setError(""); }).catch((failure) => setError(failed(failure)));
  onMount(() => { void load(); if (!props.context.data()) void props.context.load(); });
  const uses = (skill: Skill) => props.context.block(`skill-${skill.id}`)?.usedBy ?? [];
  const opened = () => skills()?.find((skill) => skill.id === props.skillId);

  // The opened skill's text: saved and reset through its block.
  const [detail, setDetail] = createSignal<BlockDetail | null>(null);
  const [draft, setDraft] = createSignal("");
  const [saving, setSaving] = createSignal(false);
  const [editing, setEditing] = createSignal(false);
  const blockPath = () => `/v0/context/blocks/${encodeURIComponent(`skill-${props.skillId}`)}`;
  createEffect(() => {
    const id = opened()?.id;
    setDetail(null); setError("");
    if (!id) return;
    void api<BlockDetail>(blockPath()).then((loaded) => { if (opened()?.id === id) { setDetail(loaded); setDraft(loaded.content ?? ""); } }, (failure) => setError(failed(failure)));
  });
  const dirty = () => detail() !== null && draft() !== (detail()!.content ?? "");
  const write = async (request: () => Promise<BlockDetail>) => {
    setSaving(true); setError("");
    try { const saved = await request(); setDetail(saved); setDraft(saved.content ?? ""); await Promise.all([load(), props.context.load()]); }
    catch (failure) { setError(failed(failure)); }
    finally { setSaving(false); }
  };
  const save = () => { if (dirty() && draft().trim()) void write(() => api<BlockDetail>(blockPath(), { method: "PUT", body: JSON.stringify({ content: draft() }) })); };
  const reset = () => void write(() => api<BlockDetail>(`${blockPath()}/reset`, { method: "POST" }));
  const documentLabel = (id: string) => props.context.document(id)?.role.label ?? id;

  const toggle = async (skill: Skill, enabled: boolean) => {
    setBusy(skill.id);
    try {
      setSkills((await api<{ skills: Skill[] }>(`/v0/skills/${encodeURIComponent(skill.id)}`, { method: "PATCH", body: JSON.stringify({ enabled }) })).skills);
      setStatus(`${skill.name} ${enabled ? "on" : "off"}`);
    } catch (failure) { setError(failed(failure)); }
    finally { setBusy(""); }
  };
  const remove = async (skill: Skill) => {
    if (!(await confirm(`Remove ${skill.name}? Its files go from the hub; install it again to have it back.`, { destructive: true, confirmLabel: "Remove" }))) return;
    setBusy(skill.id);
    try { await api(`/v0/skills/${encodeURIComponent(skill.id)}`, { method: "DELETE" }); if (props.skillId === skill.id) props.onSkill(""); await Promise.all([load(), props.context.load()]); setStatus(`${skill.name} removed`); markFound(skill, false); }
    catch (failure) { setError(failed(failure)); }
    finally { setBusy(""); }
  };
  const markFound = (skill: { source?: string; skillId?: string }, installed: boolean) =>
    setFound((list) => list?.map((item) => item.source === skill.source && item.skillId === skill.skillId ? { ...item, installed } : item) ?? null);
  const install = async (item: Found) => {
    const key = `${item.source}/${item.skillId}`;
    setBusy(key); setSearchError("");
    try {
      const skill = await api<Skill>("/v0/skills/install", { method: "POST", body: JSON.stringify({ source: item.source, skillId: item.skillId }), timeout: false });
      await load(); markFound(item, true); setStatus(`${skill.name} installed`);
    } catch (failure) { setSearchError(failed(failure)); }
    finally { setBusy(""); }
  };

  // The registry is searched as you type, a moment after the last key.
  let timer: number | undefined;
  let asked = 0;
  const search = (value: string) => {
    setQuery(value);
    clearTimeout(timer);
    if (value.trim().length < 2) { setFound(null); setSearchError(""); return; }
    timer = window.setTimeout(async () => {
      const ask = ++asked;
      setSearching(true);
      try {
        const { results } = await api<{ results: Found[] }>(`/v0/skills/search?${new URLSearchParams({ q: value.trim(), limit: "12" })}`);
        if (ask === asked) { setFound(results); setSearchError(""); }
      } catch (failure) { if (ask === asked) setSearchError(failed(failure)); }
      finally { if (ask === asked) setSearching(false); }
    }, 300);
  };
  onCleanup(() => clearTimeout(timer));

  const skillLine = (skill: Skill) =>
    <SettingLine label={skill.name} state={[skill.missing ? "missing" : tokens(skill.chars), uses(skill).length ? `in ${uses(skill).length} ${uses(skill).length === 1 ? "document" : "documents"}` : "in no document", skill.origin === "installed" ? skill.source : ""].filter(Boolean).join(" · ")}
      title={[skill.description, skill.origin === "installed" ? `From ${skill.source} on skills.sh; in every profile's default document.` : `Shipped with ${skill.profiles.join(", ") || "Conduit"}.`].filter(Boolean).join("\n\n")}>
      <Show when={skill.origin === "installed"}>
        <Button variant="ghost" size="icon-xs" aria-label={`Remove ${skill.name}`} title="Remove" disabled={!!busy()} onClick={() => void remove(skill)}><Icons.Delete /></Button>
      </Show>
      <Switch label={`${skill.name} on`} checked={skill.enabled} disabled={!!busy() || skill.missing} onChange={(enabled) => void toggle(skill, enabled)} />
      <Button variant="ghost" size="icon-xs" aria-label={`Open ${skill.name}`} title="Its text and where it is used" disabled={skill.missing} onClick={() => props.onSkill(skill.id)}><Icons.ChevronRight /></Button>
    </SettingLine>;

  const One = (one: { skill: Skill }) => <Workbench label="Skill">
    <WorkbenchTitle meta={[one.skill.origin === "installed" ? `installed from ${one.skill.source}` : "shipped", detail()?.modified ? "changed" : ""].filter(Boolean).join(" · ")}
      title={<Select look="title" id="settings-skill" search="Search skills" aria-label="Skill" title="Choose a skill" value={one.skill.id} onChange={(event) => props.onSkill(event.currentTarget.value)}>
        <For each={skills() ?? []}>{(item) => <option value={item.id}>{item.name}</option>}</For>
      </Select>}
      actions={<Button variant="ghost" size="sm" title="Back to every skill" onClick={() => props.onSkill("")}><Icons.ChevronLeft /> All skills</Button>} />
    <Show when={error()}><Note tone="error">{error()}</Note></Show>
    <WorkbenchSplit open={editing()} onOpenChange={setEditing} mainLabel={one.skill.name} opens="Text"
      main={<Show when={detail()} fallback={<Loading>Loading…</Loading>}>{(loaded) =>
        <TextEditor fill label={`${one.skill.name} text`} value={draft()} onChange={setDraft} onSave={save}
          head={<>
            <Heading kind="editor">SKILL.md</Heading>
            <Actions kind="editor">
              <Button variant={dirty() ? "primary" : "ghost"} size="sm" disabled={!dirty() || !draft().trim() || saving()} title="Save (Ctrl+S)" onClick={save}>{saving() ? "Saving…" : dirty() ? "Save" : "Saved"}</Button>
              <IconButton kind="file" label={one.skill.origin === "installed" ? "Reset to the installed text" : "Reset to the shipped text"} disabled={!loaded().resettable || !loaded().modified || saving()} onClick={reset}><Icons.Reset /></IconButton>
              <Show when={one.skill.origin === "installed"}><IconButton kind="file" label="Remove from the hub" disabled={!!busy()} onClick={() => void remove(one.skill)}><Icons.Delete /></IconButton></Show>
            </Actions>
          </>}
          status={<><StatusText>{tokens(draft().length)}</StatusText><StatusText>read when the model loads it; its description is in every prompt that lists it</StatusText></>} />}</Show>}
      side={<>
        <Group kind="workbench" title="On this hub">
          <WorkbenchFact name="On" title="Off: left out of every document that lists it"><Switch label={`${one.skill.name} on`} checked={one.skill.enabled} disabled={!!busy()} onChange={(enabled) => void toggle(one.skill, enabled)} /></WorkbenchFact>
        </Group>
        <Group kind="workbench" title="Used in">
          <Show when={uses(one.skill).length} fallback={<Note kind="workbench">In no document: add it to one from Prompts › Skills.</Note>}>
            <For each={uses(one.skill)}>{(id) => <Row density="nav" element="button" lead={ROLE_ICON[props.context.document(id)?.role.kind ?? "profile"]()} end={<Icons.ChevronRight />} title={`Open ${documentLabel(id)} in Prompts`} onClick={() => props.onOpenDocument(id)}>{documentLabel(id)}</Row>}</For>
          </Show>
        </Group>
        <Show when={one.skill.description}><Group kind="workbench" title="When it applies"><Note kind="workbench">{one.skill.description}</Note></Group></Show>
      </>} />
  </Workbench>;

  return <Show when={skills()} fallback={<Show when={error()} fallback={<Loading>Loading skills…</Loading>}>
    <Note tone="error"><span>{error()}</span><Button variant="secondary" size="sm" onClick={() => void load()}>Retry</Button></Note>
  </Show>}>{(list) => <Show when={opened()} fallback={<>
    <Group title="Installed">
      <Show when={list().some((skill) => skill.origin === "installed")} fallback={<Note tone="quiet">None yet: find one below.</Note>}>
        <For each={list().filter((skill) => skill.origin === "installed")}>{skillLine}</For>
      </Show>
    </Group>
    <Group title="Shipped">
      <For each={list().filter((skill) => skill.origin === "shipped")}>{skillLine}</For>
    </Group>
    <Group title="Find">
      <SettingLine label="skills.sh" state={searching() ? "searching…" : undefined}>
        <Input type="search" aria-label="Search skills.sh" placeholder="pdf, frontend design, git…" value={query()} onInput={(event) => search(event.currentTarget.value)} />
      </SettingLine>
      <Show when={searchError()}><Note tone="error">{searchError()}</Note></Show>
      <Show when={found()}>{(results) =>
        <Show when={results().length} fallback={<Note tone="quiet">Nothing found for “{query().trim()}”.</Note>}>
          <For each={results()}>{(item) =>
            <SettingLine plain label={item.name} state={[item.source, item.installs != null ? `${count(item.installs)} installs` : ""].filter(Boolean).join(" · ")} title={`${item.source} › ${item.skillId}`}>
              <Show when={!item.installed} fallback={<SettingValue>Installed</SettingValue>}>
                <Button variant="secondary" size="sm" disabled={!!busy()} onClick={() => void install(item)}>
                  <Show when={busy() === `${item.source}/${item.skillId}`} fallback={<><Icons.Download /> Install</>}>Installing…</Show>
                </Button>
              </Show>
            </SettingLine>}
          </For>
        </Show>}
      </Show>
      <Note tone="quiet">A skill is instructions every profile's model reads, and files it can run: install from sources you trust.</Note>
      <LiveNote>{status()}</LiveNote>
    </Group>
  </>}>{(skill) => <One skill={skill()} />}</Show>}</Show>;
}
