import { createEffect, createSignal, For, lazy, onCleanup, onMount, Show } from "solid-js";
import { Button, Icons, Input, LiveNote, Switch, Group, Loading, Note } from "@/components/ui";
import { Row } from "@/components/ui/row";
import { Actions, IconButton } from "@/components/ui/actions";
import { Heading } from "@/components/ui/header";
import { StatusText } from "@/components/ui/file";
import { Workbench, WorkbenchFact, WorkbenchPick, WorkbenchSplit, WorkbenchTitle } from "@/components/ui/workbench";
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
 * One workbench: the side column is every skill (installed, then shipped), each with its size, how many documents
 * list it and its switch, and under them the registry's search. Choosing one (`skillId`) shows it in the main pane:
 * the documents that list it, each opening in Prompts, beside its text in an editor. A skill's text is kept as the
 * block `skill-<id>` (context-store.js), which is how a document names it.
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
  // Always one open: the first when none is named, or the named one has gone.
  createEffect(() => { const list = skills(); if (list?.length && !opened()) props.onSkill((list.find((skill) => !skill.missing) ?? list[0]!).id); });

  // The opened skill's text: saved and reset through its block.
  const [detail, setDetail] = createSignal<BlockDetail | null>(null);
  const [draft, setDraft] = createSignal("");
  const [saving, setSaving] = createSignal(false);
  const [editing, setEditing] = createSignal(false);
  // The registry's search, shown at the head of the side column once asked for (the title's +).
  const [finding, setFinding] = createSignal(false);
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

  const about = (skill: Skill) => [skill.missing ? "missing" : tokens(skill.chars), uses(skill).length ? `${uses(skill).length} ${uses(skill).length === 1 ? "document" : "documents"}` : "unused"].join(" · ");
  const pick = (skill: Skill) =>
    <WorkbenchPick name={skill.name} context={about(skill)} title={skill.description} current={props.skillId === skill.id} onSelect={() => { props.onSkill(skill.id); setEditing(true); }}>
      <Switch label={`${skill.name} on`} checked={skill.enabled} disabled={!!busy() || skill.missing} onChange={(enabled) => void toggle(skill, enabled)} />
    </WorkbenchPick>;
  const Text = (one: { skill: Skill }) => <Show when={detail()} fallback={<Loading>Loading…</Loading>}>{(loaded) =>
    <TextEditor fill label={`${one.skill.name} text`} value={draft()} onChange={setDraft} onSave={save}
      head={<>
        <Heading kind="editor">SKILL.md</Heading>
        <Actions kind="editor">
          <Button variant={dirty() ? "primary" : "ghost"} size="sm" disabled={!dirty() || !draft().trim() || saving()} title="Save (Ctrl+S)" onClick={save}>{saving() ? "Saving…" : dirty() ? "Save" : "Saved"}</Button>
          <IconButton kind="file" label={one.skill.origin === "installed" ? "Reset to the installed text" : "Reset to the shipped text"} disabled={!loaded().resettable || !loaded().modified || saving()} onClick={reset}><Icons.Reset /></IconButton>
          <Show when={one.skill.origin === "installed"}><IconButton kind="file" label="Remove from the hub" disabled={!!busy()} onClick={() => void remove(one.skill)}><Icons.Delete /></IconButton></Show>
        </Actions>
      </>}
      status={<><StatusText>{tokens(draft().length)}</StatusText><StatusText>read when the model loads it</StatusText></>} />}</Show>;
  const Facts = (one: { skill: Skill }) => <>
    <Group kind="workbench" title="Used in">
      <Show when={uses(one.skill).length} fallback={<Note kind="workbench">In no document: add it to one from Prompts › Skills.</Note>}>
        <For each={uses(one.skill)}>{(id) => <Row density="nav" element="button" lead={ROLE_ICON[props.context.document(id)?.role.kind ?? "profile"]()} end={<Icons.ChevronRight />} title={`Open ${documentLabel(id)} in Prompts`} onClick={() => props.onOpenDocument(id)}>{documentLabel(id)}</Row>}</For>
      </Show>
    </Group>
    <Show when={one.skill.description}><Group kind="workbench" title="When it applies"><Note kind="workbench">{one.skill.description}</Note></Group></Show>
    <Show when={one.skill.origin === "installed"}><Group kind="workbench" title="From"><WorkbenchFact name="skills.sh" value={one.skill.source} /></Group></Show>
  </>;
  const Find = () => <Group kind="workbench" title="Find on skills.sh">
    <Input type="search" aria-label="Search skills.sh" ref={(element: HTMLInputElement) => queueMicrotask(() => element.focus())} placeholder="pdf, frontend design, git…" value={query()} onInput={(event) => search(event.currentTarget.value)} />
    <Show when={searching()}><Note kind="workbench">Searching…</Note></Show>
    <Show when={searchError()}><Note tone="error">{searchError()}</Note></Show>
    <Show when={found()}>{(results) =>
      <Show when={results().length} fallback={<Note kind="workbench">Nothing found for “{query().trim()}”.</Note>}>
        <For each={results()}>{(item) =>
          <WorkbenchFact name={item.name} value={item.installs != null ? `${count(item.installs)} installs` : undefined} title={`${item.source} › ${item.skillId}`}>
            <Show when={!item.installed} fallback={<Icons.Check />}>
              <Button variant="ghost" size="icon-xs" aria-label={`Install ${item.name}`} title={`Install from ${item.source}`} disabled={!!busy()} onClick={() => void install(item)}>
                <Show when={busy() === `${item.source}/${item.skillId}`} fallback={<Icons.Download />}><Icons.Clock /></Show>
              </Button>
            </Show>
          </WorkbenchFact>}
        </For>
      </Show>}
    </Show>
    <Note kind="workbench">A skill is instructions a model reads and files it can run: install from sources you trust.</Note>
    <LiveNote>{status()}</LiveNote>
  </Group>;

  return <Show when={skills()} fallback={<Show when={error()} fallback={<Loading>Loading skills…</Loading>}>
    <Note tone="error"><span>{error()}</span><Button variant="secondary" size="sm" onClick={() => void load()}>Retry</Button></Note>
  </Show>}>{(list) => <Workbench label="Skills">
    <WorkbenchTitle title={opened()?.name ?? "Skills"} meta={opened() ? [opened()!.enabled ? "" : "off", detail()?.modified ? "changed" : ""].filter(Boolean).join(" · ") || undefined : undefined}
      actions={<Button variant="ghost" size="icon-sm" aria-label="Find a skill on skills.sh" title="Find a skill on skills.sh" aria-pressed={finding()} onClick={() => { const next = !finding(); setFinding(next); if (!next) search(""); }}><Show when={finding()} fallback={<Icons.Add />}><Icons.Close /></Show></Button>} />
    <Show when={error()}><Note tone="error">{error()}</Note></Show>
    <WorkbenchSplit open={editing()} onOpenChange={setEditing} mainLabel={opened()?.name ?? "Skill"}
      side={<>
        <Show when={finding()}><Find /></Show>
        <Show when={list().some((skill) => skill.origin === "installed")}>
          <Group kind="workbench" title="Installed"><For each={list().filter((skill) => skill.origin === "installed")}>{pick}</For></Group>
        </Show>
        <Group kind="workbench" title="Shipped"><For each={list().filter((skill) => skill.origin === "shipped")}>{pick}</For></Group>
      </>}
      facts={<Show when={opened()}>{(skill) => <Facts skill={skill()} />}</Show>}
      main={<Show when={opened()} fallback={<Note kind="workbench">No skills yet: find one on skills.sh with the + above.</Note>}>{(skill) => <Text skill={skill()} />}</Show>} />
  </Workbench>}</Show>;
}
