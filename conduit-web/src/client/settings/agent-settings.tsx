import { createEffect, createSignal, For, on, Show } from "solid-js";
import { Button, Input, Segmented, Switch } from "@/components/ui/controls";
import { Select } from "@/components/menus";
import { SettingGroup, SettingLine, SettingNote } from "@/components/ui/overlay";
import { api } from "../api/client";
import { agentView, refreshAgent, type AgentView, type AgentWorkKind } from "../state/agent";
import type { ModelOption } from "../api/contracts";
import { ModelSelector } from "../chat/model-selector";
import { createAutosave } from "./autosave";

/**
 * The persistent agent's settings (PATCH /v0/agent): who it is, how much it says and spends, and its routine. Saved
 * as edited, as every Settings section is; `autosave` is the section's, for the header's status.
 */

type Settings = NonNullable<AgentView["settings"]>;
type Draft = { name: string; budget: string };

const DIALS = [
  { value: "quiet", label: "Quiet", title: "Only what is urgent or needs your answer." },
  { value: "normal", label: "Normal", title: "What needs your attention; FYIs wait on its page." },
  { value: "chatty", label: "Chatty", title: "Everything it finds worth saying, FYIs included." },
] as const;
const HEARTBEATS = [30, 60, 120, 240, 480, 1440];
const every = (minutes: number) => minutes < 60 ? `${minutes} min` : minutes === 1440 ? "Once a day" : `${minutes / 60} h`;
const zones = (() => { try { return Intl.supportedValuesOf("timeZone"); } catch { return [] as string[]; } })();

/* "Same as jbot": the home thread's model, whatever it is when the run starts. */
const SAME = (name: string): ModelOption => ({ provider: `${name}'s thread`, id: "", spec: "", label: `Same as ${name}`, thinkingLevels: [] });

export function createAgentSettings(options: { models: () => ModelOption[]; onManageModels?: () => void }) {
  const [draft, setDraft] = createSignal<Draft>({ name: "", budget: "" });
  const [enabling, setEnabling] = createSignal(false);
  const settings = () => agentView()?.settings;
  // Edits made before a save goes out travel together (a name typed, then a budget): the autosave keeps only its latest.
  let gathered: Partial<Settings> = {};
  const autosave = createAutosave<Partial<Settings>>({
    save: async (patch) => { gathered = {}; return (await api<AgentView>("/v0/agent", { method: "PATCH", body: JSON.stringify(patch) })).settings!; },
    onSaved: () => void refreshAgent(),
  });
  // The fields follow what is stored until they are being typed in.
  createEffect(on(() => settings()?.name, () => {
    const stored = settings();
    if (stored && !autosave.busy()) setDraft({ name: stored.name, budget: String(stored.budgetUsdPerDay) });
  }));

  const nameError = () => { const name = draft().name.trim(); return !name ? "A name is needed." : name.length > 60 ? "At most 60 characters." : ""; };
  const budgetError = () => { const value = Number(draft().budget); return draft().budget.trim() === "" || !Number.isFinite(value) || value < 0 || value > 1000 ? "A dollar amount from 0 to 1000." : ""; };
  const edit = (patch: Partial<Settings>, when?: "now") => {
    gathered = { ...gathered, ...patch, ...(patch.work ? { work: { ...gathered.work, ...patch.work } as Settings["work"] } : {}) };
    autosave.edit(gathered, when);
  };
  const editName = (name: string) => { setDraft({ ...draft(), name }); if (nameError()) return autosave.hold(); edit({ name: name.trim() }); };
  const editBudget = (budget: string) => { setDraft({ ...draft(), budget }); if (budgetError()) return autosave.hold(); edit({ budgetUsdPerDay: Number(budget) }); };
  const set = (patch: Partial<Settings>) => edit(patch, "now");
  // The model and effort one kind of background run uses; "Same as jbot" stores nothing.
  const Work = (line: { kind: AgentWorkKind; label: string; title: string }) => {
    const current = () => settings()!;
    const choice = () => current().work?.[line.kind] ?? null;
    // Only this kind is sent (the hub merges it): two choices made in a row cannot undo each other.
    const setWork = (value: { model: string; thinkingLevel: string } | null) => set({ work: { [line.kind]: value } as Settings["work"] });
    const levels = (spec: string) => options.models().find((model) => model.spec === spec)?.thinkingLevels || ["off"];
    const choose = (spec: string) => {
      if (!spec) return setWork(null);
      const keep = choice()?.thinkingLevel;
      const allowed = levels(spec);
      setWork({ model: spec, thinkingLevel: keep && allowed.includes(keep) ? keep : allowed.includes("medium") ? "medium" : allowed[0] || "off" });
    };
    return <SettingLine plain label={line.label} title={line.title}>
      <ModelSelector models={[SAME(current().name), ...options.models()]} model={choice()?.model ?? ""} thinkingLevel={choice()?.thinkingLevel ?? ""}
        quiet={choice() ? undefined : ""} onModelChange={choose} onManageModels={options.onManageModels}
        onThinkingLevelChange={(thinkingLevel) => choice() && setWork({ ...choice()!, thinkingLevel })} />
    </SettingLine>;
  };

  const enable = async () => {
    setEnabling(true);
    try { await api("/v0/agent", { method: "POST", body: JSON.stringify({}) }); await refreshAgent(); }
    finally { setEnabling(false); }
  };

  const Page = () => <Show when={agentView()} fallback={<SettingNote>Loading…</SettingNote>}>
    <Show when={settings()} fallback={<SettingGroup title="Agent">
      <SettingNote>This hub has no agent. One agent per hub works for you in the background, with its own threads and memory.</SettingNote>
      <SettingLine label="Give this hub an agent"><Button size="sm" disabled={enabling()} onClick={() => void enable()}>Turn on</Button></SettingLine>
    </SettingGroup>}>{(current) => <>
      <SettingGroup title="Agent">
        <SettingLine label="Name" title="What it is called, here and in its notifications. Its home thread takes the name too." state={nameError() || undefined}>
          <Input id="agent-name" value={draft().name} maxLength={60} onInput={(event) => editName(event.currentTarget.value)} />
        </SettingLine>
        <SettingLine label="Speaks up" title={DIALS.find((dial) => dial.value === current().dial)?.title}>
          <Segmented label="Speaks up" value={current().dial} options={DIALS.map(({ value, label }) => ({ value, label }))} onChange={(dial) => set({ dial })} />
        </SettingLine>
        <SettingLine label="Daily budget" title="The most its background work may spend in a day, in dollars; 0 is no limit. Past it, scheduled work waits for tomorrow and says so." state={budgetError() || undefined}>
          <Input id="agent-budget" inputMode="decimal" value={draft().budget} onInput={(event) => editBudget(event.currentTarget.value)} />
        </SettingLine>
        <SettingLine label="Time zone" title="Where its day, its brief and its budget are counted.">
          <Select id="agent-zone" value={current().timezone} onChange={(event) => set({ timezone: event.currentTarget.value })}>
            <For each={zones.includes(current().timezone) ? zones : [current().timezone, ...zones]}>{(zone) => <option value={zone}>{zone.replace(/_/g, " ")}</option>}</For>
          </Select>
        </SettingLine>
      </SettingGroup>
      <SettingGroup title="Routine">
        <SettingLine label="Morning brief" title="A short brief in its home thread each morning: what happened, what is coming, what waits on you.">
          <Switch label="Morning brief" checked={current().brief.enabled} onChange={(enabled) => set({ brief: { ...current().brief, enabled } })} />
        </SettingLine>
        <Show when={current().brief.enabled}>
          <SettingLine label="Brief at">
            <Input id="agent-brief-at" type="time" value={current().brief.at} onChange={(event) => { if (/^\d\d:\d\d$/.test(event.currentTarget.value)) set({ brief: { ...current().brief, at: event.currentTarget.value } }); }} />
          </SettingLine>
          <Work kind="brief" label="Brief model" title="Reads your mail, calendar and chats and prepares first steps: worth a capable model." />
        </Show>
        <SettingLine label="Heartbeat" title="It wakes on its own to check on things (HEARTBEAT.md in its memory says what), and speaks up only when something is worth it.">
          <Switch label="Heartbeat" checked={current().heartbeat.enabled} onChange={(enabled) => set({ heartbeat: { ...current().heartbeat, enabled } })} />
        </SettingLine>
        <Show when={current().heartbeat.enabled}>
          <SettingLine label="Every">
            <Select id="agent-heartbeat" value={String(current().heartbeat.everyMinutes)} onChange={(event) => set({ heartbeat: { ...current().heartbeat, everyMinutes: Number(event.currentTarget.value) } })}>
              <For each={HEARTBEATS.includes(current().heartbeat.everyMinutes) ? HEARTBEATS : [current().heartbeat.everyMinutes, ...HEARTBEATS]}>{(minutes) => <option value={String(minutes)}>{every(minutes)}</option>}</For>
            </Select>
          </SettingLine>
          <Work kind="heartbeat" label="Heartbeat model" title="Runs often and usually finds nothing: a quick, cheap model fits." />
        </Show>
        <Work kind="other" label="Other runs" title="The model for check-backs it schedules, events, webhooks and tasks you run by hand." />
      </SettingGroup>
    </>}</Show>
  </Show>;

  return { autosave, Page };
}
