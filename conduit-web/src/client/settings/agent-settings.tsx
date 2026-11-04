import { createEffect, createSignal, For, lazy, on, Show } from "solid-js";
import { Button, Input, Segmented, Switch } from "@/components/ui/controls";
import { Select } from "@/components/ui/menus";
import { SettingLine, SettingWide } from "@/components/ui/overlay";
// CodeMirror: kept out of the settings chunk until a page shows it.
const TextEditor = lazy(() => import("@/components/ui/text-editor").then((module) => ({ default: module.TextEditor })));
import { api } from "../api/client";
import { agentView, refreshAgent, type AgentView, type AgentWorkKind } from "../state/agent";
import type { ModelOption, ModelState } from "../api/contracts";
import { ModelSelector } from "../chat/model-selector";
import { createAutosave } from "./autosave";
import { Group } from "@/components/ui/group";
import { Note } from "@/components/ui/state";

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
  // jbot's own model and effort (its home thread's): what a run "Same as jbot" uses, shown in the disabled selector.
  const [home, setHome] = createSignal<{ model: string; thinkingLevel: string } | null>(null);
  createEffect(on(() => agentView()?.home?.chatId, (chatId) => {
    if (!chatId) return setHome(null);
    void api<ModelState>(`/v0/chats/${encodeURIComponent(chatId)}/models`).then((state) => setHome({ model: state.model, thinkingLevel: state.thinkingLevel }), () => {});
  }));
  // The model and effort one kind of background run uses: the standard model selector, under a "Same as jbot"
  // switch that, on, stores nothing (the run takes jbot's model when it starts) and holds the selector on jbot's.
  const Work = (line: { kind: AgentWorkKind; label: string; title: string }) => {
    const current = () => settings()!;
    const choice = () => current().work?.[line.kind] ?? null;
    // Only this kind is sent (the hub merges it): two choices made in a row cannot undo each other.
    const setWork = (value: { model: string; thinkingLevel: string } | null) => set({ work: { [line.kind]: value } as Settings["work"] });
    const levels = (spec: string) => options.models().find((model) => model.spec === spec)?.thinkingLevels || ["off"];
    const choose = (spec: string) => {
      const keep = choice()?.thinkingLevel;
      const allowed = levels(spec);
      setWork({ model: spec, thinkingLevel: keep && allowed.includes(keep) ? keep : allowed.includes("medium") ? "medium" : allowed[0] || "off" });
    };
    // Off: starts from jbot's own choice, which the person then changes.
    const same = (on: boolean) => {
      if (on) return setWork(null);
      const start = home() ?? { model: options.models()[0]?.spec ?? "", thinkingLevel: "" };
      if (!start.model) return;
      const allowed = levels(start.model);
      setWork({ model: start.model, thinkingLevel: allowed.includes(start.thinkingLevel) ? start.thinkingLevel : allowed.includes("medium") ? "medium" : allowed[0] || "off" });
    };
    const shown = () => choice() ?? home();
    return <>
      <SettingLine label={`${line.label} uses ${current().name}'s model`} title={`On: it uses ${current().name}'s own model and effort, whatever they are when it starts.`}>
        <Switch label={`${line.label} uses ${current().name}'s model`} checked={!choice()} onChange={same} />
      </SettingLine>
      <SettingLine plain label={`${line.label} model`} title={line.title}>
        <ModelSelector models={options.models()} model={shown()?.model ?? ""} thinkingLevel={shown()?.thinkingLevel ?? ""} disabled={!choice()} placement="bottom-end"
          onModelChange={choose} onManageModels={options.onManageModels}
          onThinkingLevelChange={(thinkingLevel) => choice() && setWork({ ...choice()!, thinkingLevel })} />
      </SettingLine>
    </>;
  };

  const enable = async () => {
    setEnabling(true);
    try { await api("/v0/agent", { method: "POST", body: JSON.stringify({}) }); await refreshAgent(); }
    finally { setEnabling(false); }
  };

  const Page = () => <Show when={agentView()} fallback={<Note>Loading…</Note>}>
    <Show when={settings()} fallback={<Group title="Agent">
      <Note>This hub has no agent. One agent per hub works for you in the background, with its own threads and memory.</Note>
      <SettingLine label="Give this hub an agent"><Button size="sm" disabled={enabling()} onClick={() => void enable()}>Turn on</Button></SettingLine>
    </Group>}>{(current) => <>
      <Group title="Agent">
        <SettingLine label="Name" title="What it is called, here and in its notifications. Its home thread takes the name too." state={nameError() || undefined}>
          <Input id="agent-name" value={draft().name} maxLength={60} onInput={(event) => editName(event.currentTarget.value)} />
        </SettingLine>
        <SettingLine plain label="Speaks up" title={DIALS.find((dial) => dial.value === current().dial)?.title}>
          <Segmented label="Speaks up" value={current().dial} options={DIALS.map(({ value, label }) => ({ value, label }))} onChange={(dial) => set({ dial })} />
        </SettingLine>
        <SettingLine label="Daily budget" title="The most its background work may spend in a day, in dollars; 0 is no limit. Past it, scheduled work waits for tomorrow and says so." state={budgetError() || undefined}>
          <Input id="agent-budget" inputMode="decimal" value={draft().budget} onInput={(event) => editBudget(event.currentTarget.value)} />
        </SettingLine>
      </Group>
      <Group title="Approvals">
        <SettingLine label="What you ask, it does" title="When you ask it for something, edits to your own data (completing a task, moving an event, labelling mail) go ahead without an approval. Sending as you, deleting, and anything it starts on its own still ask.">
          <Switch label="What you ask, it does" checked={current().youAsk !== false} onChange={(youAsk) => set({ youAsk })} />
        </SettingLine>
        <SettingLine label="Executor decides" title="Executor's calls go to it unasked: reads run at once, and what Executor holds for approval (a send, a change) is what you are asked, once. Off: Conduit's list of reads decides before each call, and anything else asks.">
          <Switch label="Executor decides" checked={current().executorDecides !== false} onChange={(executorDecides) => set({ executorDecides })} />
        </SettingLine>
        <ApprovalRules />
        <SettingLine label="Remind me" title="Every approval is pushed to your devices, a background run's too. One still waiting is pushed once more after this long.">
          <Select id="agent-remind" value={String(current().remindMinutes ?? 10)} onChange={(event) => set({ remindMinutes: Number(event.currentTarget.value) })}>
            <For each={[[0, "Never"], [5, "After 5 minutes"], [10, "After 10 minutes"], [30, "After 30 minutes"], [60, "After an hour"]] as const}>{([value, label]) => <option value={String(value)}>{label}</option>}</For>
          </Select>
        </SettingLine>
      </Group>
      <Group title="Routine">
        <SettingLine label="Email" title="Every 30 minutes, new mail from each Gmail account connected in Executor goes into its context inbox, for the heartbeat to weigh. Run it now from its row under Timed.">
          <Switch label="Email" checked={current().email?.enabled === true} onChange={(enabled) => set({ email: { enabled } })} />
        </SettingLine>
        <SettingLine label="Morning brief" title="A short brief in its home thread each morning: what happened, what is coming, what waits on you.">
          <Switch label="Morning brief" checked={current().brief.enabled} onChange={(enabled) => set({ brief: { ...current().brief, enabled } })} />
        </SettingLine>
        <Show when={current().brief.enabled}>
          <SettingLine label="Brief at">
            <Input id="agent-brief-at" type="time" value={current().brief.at} onChange={(event) => { if (/^\d\d:\d\d$/.test(event.currentTarget.value)) set({ brief: { ...current().brief, at: event.currentTarget.value } }); }} />
          </SettingLine>
          <Work kind="brief" label="Brief" title="Reads your mail, calendar and chats and prepares first steps: worth a capable model." />
        </Show>
        <SettingLine label="Heartbeat" title="It looks at its inbox on this clock and calls a model only when something new came in. It speaks up only when something is worth it.">
          <Switch label="Heartbeat" checked={current().heartbeat.enabled} onChange={(enabled) => set({ heartbeat: { ...current().heartbeat, enabled } })} />
        </SettingLine>
        <Show when={current().heartbeat.enabled}>
          <SettingLine label="Every" title="How often it looks at its inbox (routines/heartbeat.md).">
            <Select id="agent-heartbeat" value={String(current().heartbeat.everyMinutes)} onChange={(event) => set({ heartbeat: { ...current().heartbeat, everyMinutes: Number(event.currentTarget.value) } })}>
              <For each={HEARTBEATS.includes(current().heartbeat.everyMinutes) ? HEARTBEATS : [current().heartbeat.everyMinutes, ...HEARTBEATS]}>{(minutes) => <option value={String(minutes)}>{every(minutes)}</option>}</For>
            </Select>
          </SettingLine>
          <Work kind="heartbeat" label="Heartbeat" title="Runs often and usually finds nothing: a quick, cheap model fits." />
        </Show>
        <SettingLine label="Quiet hours" title="No heartbeat in these hours. Something urgent still reaches you.">
          <Switch label="Quiet hours" checked={current().quietHours.enabled} onChange={(enabled) => set({ quietHours: { ...current().quietHours, enabled } })} />
        </SettingLine>
        <Show when={current().quietHours.enabled}>
          <SettingLine label="From">
            <Input id="agent-quiet-start" type="time" value={current().quietHours.start} onChange={(event) => { const start = event.currentTarget.value; if (/^\d\d:\d\d$/.test(start) && start !== current().quietHours.end) set({ quietHours: { ...current().quietHours, start } }); }} />
          </SettingLine>
          <SettingLine label="Until">
            <Input id="agent-quiet-end" type="time" value={current().quietHours.end} onChange={(event) => { const end = event.currentTarget.value; if (/^\d\d:\d\d$/.test(end) && end !== current().quietHours.start) set({ quietHours: { ...current().quietHours, end } }); }} />
          </SettingLine>
        </Show>
        <Work kind="other" label="Other runs" title="The model for check-backs it schedules, events, webhooks and tasks you run by hand." />
      </Group>
    </>}</Show>
  </Show>;

  return { autosave, Page };
}

type ApprovalPolicy = { version: string; may: string[]; always: string[]; limits: string[]; exact: string[] };
/**
 * The person's standing rules for the approval model (docs/plans/approval-model.md): what the agent may do, what is
 * always theirs, and limits they set; one rule a line, in plain words. Until saved, the starter rules apply.
 */
function ApprovalRules() {
  const [policy, setPolicy] = createSignal<ApprovalPolicy | null>(null);
  const [starter, setStarter] = createSignal(false);
  const [draft, setDraft] = createSignal({ may: "", always: "", limits: "" });
  const [saving, setSaving] = createSignal(false);
  const [error, setError] = createSignal("");
  const lines = (text: string) => text.split("\n").map((line) => line.trim()).filter(Boolean);
  const load = (loaded: { policy: ApprovalPolicy; starter: boolean }) => {
    setPolicy(loaded.policy); setStarter(loaded.starter);
    setDraft({ may: loaded.policy.may.join("\n"), always: loaded.policy.always.join("\n"), limits: loaded.policy.limits.join("\n") });
  };
  void api<{ policy: ApprovalPolicy; starter: boolean }>("/v0/agent/policy").then(load).catch((failure) => setError((failure as Error).message));
  const changed = () => { const current = policy(); return Boolean(current) && (starter() || draft().may !== current!.may.join("\n") || draft().always !== current!.always.join("\n") || draft().limits !== current!.limits.join("\n")); };
  const save = async () => {
    setSaving(true); setError("");
    try {
      const saved = await api<ApprovalPolicy>("/v0/agent/policy", { method: "PUT", body: JSON.stringify({ may: lines(draft().may), always: lines(draft().always), limits: lines(draft().limits) }) });
      load({ policy: saved, starter: false });
    } catch (failure) { setError((failure as Error).message); }
    finally { setSaving(false); }
  };
  // A list of rules: its name on a line, then the library's text editor, full width, without its bar or foot and as
  // tall as its rules (a line each, numbered). A component with a literal label, so settings search finds it.
  const RuleList = (props: { key: "may" | "always" | "limits"; label: string; title: string }) =>
    <><SettingLine plain label={props.label} title={props.title} state="one a line" />
      <SettingWide><TextEditor label={props.label} value={draft()[props.key]} markdown={false} bar={false} status={false} fit
        onChange={(value) => setDraft({ ...draft(), [props.key]: value })} /></SettingWide></>;
  return <Show when={policy()} fallback={<Show when={error()}><Note tone="error">{error()}</Note></Show>}>
    <RuleList key="may" label="It may" title="What the approval model may allow without asking you, one rule a line, in your own words." />
    <RuleList key="always" label="Always yours" title="What always comes to you, whatever else allows it: one class a line." />
    <RuleList key="limits" label="Never" title="Things it must not do at all (&quot;don't email Sam&quot;). Kept as rules, so a long thread cannot lose them." />
    <SettingLine label={starter() ? "Starter rules, not saved yet" : "Rules"} title="The approval model reads these with your own messages, never with what the agent read.">
      <Button size="sm" variant={changed() ? "primary" : "secondary"} disabled={saving() || !changed()} onClick={() => void save()}>{starter() ? "Save these rules" : "Save"}</Button>
    </SettingLine>
    <Show when={error()}><Note tone="error">{error()}</Note></Show>
  </Show>;
}
