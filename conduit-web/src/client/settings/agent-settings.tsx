import { createEffect, createSignal, For, on, Show } from "solid-js";
import { Button, Input, Segmented, Switch } from "@/components/ui/controls";
import { Select } from "@/components/menus";
import { SettingGroup, SettingLine, SettingNote } from "@/components/ui/overlay";
import { api } from "../api/client";
import { agentView, refreshAgent, type AgentView } from "../state/agent";
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

export function createAgentSettings() {
  const [draft, setDraft] = createSignal<Draft>({ name: "", budget: "" });
  const [enabling, setEnabling] = createSignal(false);
  const settings = () => agentView()?.settings;
  const autosave = createAutosave<Partial<Settings>>({
    save: async (patch) => (await api<AgentView>("/v0/agent", { method: "PATCH", body: JSON.stringify(patch) })).settings!,
    onSaved: () => void refreshAgent(),
  });
  // The fields follow what is stored until they are being typed in.
  createEffect(on(() => settings()?.name, () => {
    const stored = settings();
    if (stored && !autosave.busy()) setDraft({ name: stored.name, budget: String(stored.budgetUsdPerDay) });
  }));

  const nameError = () => { const name = draft().name.trim(); return !name ? "A name is needed." : name.length > 60 ? "At most 60 characters." : ""; };
  const budgetError = () => { const value = Number(draft().budget); return draft().budget.trim() === "" || !Number.isFinite(value) || value < 0 || value > 1000 ? "A dollar amount from 0 to 1000." : ""; };
  const editName = (name: string) => { setDraft({ ...draft(), name }); if (nameError()) return autosave.hold(); autosave.edit({ name: name.trim() }); };
  const editBudget = (budget: string) => { setDraft({ ...draft(), budget }); if (budgetError()) return autosave.hold(); autosave.edit({ budgetUsdPerDay: Number(budget) }); };
  const set = (patch: Partial<Settings>) => autosave.edit(patch, "now");

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
        <SettingLine label="Daily budget" title="The most its background work may spend in a day, in dollars. Past it, scheduled work waits for tomorrow and says so." state={budgetError() || undefined}>
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
        </Show>
      </SettingGroup>
    </>}</Show>
  </Show>;

  return { autosave, Page };
}
