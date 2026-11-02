import { createMemo, createSignal, For, onMount, Show } from "solid-js";
import { Button, SettingDetails, SettingGroup, SettingLine, SettingLoading, SettingNote, SettingValue } from "@/components/ui";
import { Select } from "@/components/menus";
import { api } from "../api/client";

/** One tool of a profile (GET /v0/profiles/tools): where it comes from, who calls it, and whether it asks first. */
type ProfileTool = {
  name: string; description: string; source: "built-in" | "extension" | "connector" | "codemode"; extension?: string;
  reach: "model" | "codemode"; asks: "never" | "always" | "sometimes"; when?: string;
};
type ProfileTools = { id: string; label: string; internal: boolean; agent: boolean; tools: ProfileTool[] };

const SOURCE = { "built-in": "Built-in", extension: "Extension", connector: "Connector", codemode: "Codemode" } as const;
const ASKS = { never: "Runs", always: "Asks first", sometimes: "Sometimes asks" } as const;

/**
 * AI › Tools, read-only: a profile's tools as its chats get them. Conduit decides them from the profile's template
 * (durable-runtime.js, `selectionFor`); what asks is the agent policy's (policy.js, `askOf`). Nothing here is set.
 */
export function ToolsSettings() {
  const [profiles, setProfiles] = createSignal<ProfileTools[] | null>(null);
  const [error, setError] = createSignal("");
  const [selected, setSelected] = createSignal("");
  const load = () => {
    setError("");
    return api<{ profiles: ProfileTools[] }>("/v0/profiles/tools").then(({ profiles }) => {
      setProfiles(profiles);
      if (!profiles.some((profile) => profile.id === selected())) setSelected(profiles.find((profile) => !profile.internal)?.id || profiles[0]?.id || "");
    }).catch((failure) => setError(failure instanceof Error ? failure.message : String(failure)));
  };
  onMount(() => void load());
  const profile = createMemo(() => profiles()?.find((item) => item.id === selected()) || null);
  const direct = createMemo(() => profile()?.tools.filter((tool) => tool.reach === "model") || []);
  const scripted = createMemo(() => profile()?.tools.filter((tool) => tool.reach === "codemode") || []);
  const asking = createMemo(() => profile()?.tools.filter((tool) => tool.asks !== "never").length || 0);
  const nameOf = (item: ProfileTools) => item.agent ? `${item.label} (jbot)` : item.label;

  // Its description is its title (Settings list: descriptions go in a title); what it asks, when it does, its state.
  const line = (tool: ProfileTool) =>
    <SettingLine plain mono label={tool.name} state={tool.asks === "sometimes" ? tool.when : undefined}
      title={[tool.description, tool.extension ? `From ${tool.extension}.` : "", tool.when || ""].filter(Boolean).join(" ")}>
      <SettingValue>{SOURCE[tool.source]} · {ASKS[tool.asks]}</SettingValue>
    </SettingLine>;

  return <Show when={profiles()} fallback={<Show when={error()} fallback={<SettingLoading>Loading tools…</SettingLoading>}>
    <SettingNote tone="error"><span>{error() || "Tools could not be loaded."}</span><Button variant="secondary" size="sm" onClick={() => void load()}>Retry</Button></SettingNote>
  </Show>}>
    {(list) => <>
      <SettingGroup title="Profile">
        <SettingLine label="Show tools of">
          <Select id="tools-profile" aria-label="Profile" value={selected()} onChange={(event) => setSelected(event.currentTarget.value)}>
            <For each={list()}>{(item) => <option value={item.id}>{nameOf(item)}</option>}</For>
          </Select>
        </SettingLine>
        <Show when={profile()}>{(current) =>
          <SettingNote>{current().tools.length} tools; {asking() ? `${asking()} can ask you first` : "none asks you first"}.
            {scripted().length ? ` ${scripted().length} are called from codemode scripts, not by the model directly.` : ""}</SettingNote>}
        </Show>
      </SettingGroup>
      <Show when={direct().length}><SettingGroup title="Called by the model"><For each={direct()}>{line}</For></SettingGroup></Show>
      <Show when={scripted().length}><SettingGroup title="Called from codemode"><For each={scripted()}>{line}</For></SettingGroup></Show>
      <SettingGroup title="About this list">
        <SettingDetails summary="Where tools come from">
          <SettingNote>Built-in tools are Conduit's own. Extensions are Pi packages a profile loads (web search). Connectors are your
            connected accounts, reached from codemode. Codemode is the code tool and the helpers its scripts call.</SettingNote>
          <SettingNote>jbot's threads work on any device, so their file tools take a device. A chat started on any device gets the same,
            plus devices and handoff. Connected accounts appear once a connector is connected (Models &amp; accounts).</SettingNote>
        </SettingDetails>
      </SettingGroup>
    </>}
  </Show>;
}
