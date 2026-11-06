import { createSignal, For, onCleanup, onMount, Show } from "solid-js";
import { Button, Icons, Input, LiveNote, SettingLine, SettingValue, Switch, Group, Loading, Note } from "@/components/ui";
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
 * Prompts). Each skill is in every turn's prompt, so its size is said.
 */
export function SkillsSettings() {
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
  onMount(() => void load());

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
    try { await api(`/v0/skills/${encodeURIComponent(skill.id)}`, { method: "DELETE" }); await load(); setStatus(`${skill.name} removed`); markFound(skill, false); }
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
    <SettingLine label={skill.name} state={[skill.missing ? "missing" : tokens(skill.chars), skill.origin === "installed" ? skill.source : skill.profiles.join(", ")].filter(Boolean).join(" · ")}
      title={[skill.description, skill.origin === "installed" ? `From ${skill.source} on skills.sh; in every profile's default document.` : `Shipped with ${skill.profiles.join(", ") || "Conduit"}.`].filter(Boolean).join("\n\n")}>
      <Show when={skill.origin === "installed"}>
        <Button variant="ghost" size="icon-xs" aria-label={`Remove ${skill.name}`} title="Remove" disabled={!!busy()} onClick={() => void remove(skill)}><Icons.Delete /></Button>
      </Show>
      <Switch label={`${skill.name} on`} checked={skill.enabled} disabled={!!busy() || skill.missing} onChange={(enabled) => void toggle(skill, enabled)} />
    </SettingLine>;

  return <Show when={skills()} fallback={<Show when={error()} fallback={<Loading>Loading skills…</Loading>}>
    <Note tone="error"><span>{error()}</span><Button variant="secondary" size="sm" onClick={() => void load()}>Retry</Button></Note>
  </Show>}>{(list) => <>
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
  </>}</Show>;
}
