import { createEffect, createMemo, createSignal, For, on, onMount, Show } from "solid-js";
import { Button, LiveNote, SettingDetails, SettingLine, SettingValue, Group, Loading, Note } from "@/components/ui";
import { Select } from "@/components/ui/menus";
import { api } from "../api/client";
import { agentView } from "../state/agent";

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
/** A connector (an integration declared to Conduit, Settings › Account): its toolset, which profiles consume. */
type Connector = { id: string; label: string; status: string };
type ConnectorTool = { name: string; description: string; readOnly?: boolean };

/** connector: start at that connector's toolset (from its tool count in Account). */
export function ToolsSettings(props: { connector?: string } = {}) {
  const [profiles, setProfiles] = createSignal<ProfileTools[] | null>(null);
  const [error, setError] = createSignal("");
  const [selected, setSelected] = createSignal("");
  const load = () => {
    setError("");
    return api<{ profiles: ProfileTools[] }>("/v0/profiles/tools").then(({ profiles }) => {
      setProfiles(profiles);
      if (props.connector) setSelected(`connector:${props.connector}`);
      else if (!selected().startsWith("connector:") && !profiles.some((profile) => profile.id === selected())) setSelected(profiles.find((profile) => !profile.internal)?.id || profiles[0]?.id || "");
    }).catch((failure) => setError(failure instanceof Error ? failure.message : String(failure)));
  };
  // Toolsets: what is declared to Conduit, whichever profiles take it up.
  const [connectors, setConnectors] = createSignal<Connector[]>([]);
  const [toolset, setToolset] = createSignal<ConnectorTool[] | null>(null);
  onMount(() => { void load(); void api<Connector[]>("/v0/agent/connectors").then((list) => setConnectors(list.filter((item) => item.status === "on"))).catch(() => {}); });
  const connectorId = () => selected().startsWith("connector:") ? selected().slice("connector:".length) : null;
  createEffect(on(connectorId, (id) => {
    setToolset(null);
    if (id) void api<ConnectorTool[]>(`/v0/agent/connectors/${encodeURIComponent(id)}/tools`).then(setToolset).catch(() => setToolset([]));
  }));
  const usedBy = () => { const id = connectorId(); return id ? (profiles() ?? []).filter((item) => item.tools.some((tool) => tool.name.startsWith(`mcp__${id}__`))) : []; };
  const profile = createMemo(() => profiles()?.find((item) => item.id === selected()) || null);
  const direct = createMemo(() => profile()?.tools.filter((tool) => tool.reach === "model") || []);
  const scripted = createMemo(() => profile()?.tools.filter((tool) => tool.reach === "codemode") || []);
  const asking = createMemo(() => profile()?.tools.filter((tool) => tool.asks !== "never").length || 0);
  const nameOf = (item: ProfileTools) => item.agent ? `${item.label} (${agentView()?.settings?.name || "jbot"})` : item.label;

  // Its description is its title (Settings list: descriptions go in a title); what it asks, when it does, its state.
  const line = (tool: ProfileTool) =>
    <SettingLine plain mono label={tool.name} state={tool.asks === "sometimes" ? tool.when : undefined}
      title={[tool.description, tool.extension ? `From ${tool.extension}.` : "", tool.when || ""].filter(Boolean).join(" ")}>
      <SettingValue>{SOURCE[tool.source]} · {ASKS[tool.asks]}</SettingValue>
    </SettingLine>;

  return <Show when={profiles()} fallback={<Show when={error()} fallback={<Loading>Loading tools…</Loading>}>
    <Note tone="error"><span>{error() || "Tools could not be loaded."}</span><Button variant="secondary" size="sm" onClick={() => void load()}>Retry</Button></Note>
  </Show>}>
    {(list) => <>
      <Group title="Profile">
        <SettingLine label="Show tools of">
          <Select id="tools-profile" aria-label="Profile or toolset" value={selected()} onChange={(event) => setSelected(event.currentTarget.value)}>
            <For each={list()}>{(item) => <option value={item.id}>{nameOf(item)}</option>}</For>
            <For each={connectors()}>{(item) => <option value={`connector:${item.id}`}>{item.label} (toolset)</option>}</For>
          </Select>
        </SettingLine>
        <Show when={connectorId()}>
          <Note>{connectors().find((item) => item.id === connectorId())?.label ?? "This connector"}'s tools, declared to Conduit and taken up by {usedBy().length
            ? usedBy().map(nameOf).join(", ") : "no profile yet"}. A profile's chats call them from codemode.</Note>
        </Show>
        <Show when={profile()}>{(current) =>
          <Note>{current().tools.length} tools; {asking() ? `${asking()} can ask you first` : "none asks you first"}.
            {scripted().length ? ` ${scripted().length} are called from codemode scripts, not by the model directly.` : ""}</Note>}
        </Show>
      </Group>
      <Show when={connectorId()}>
        <Show when={toolset()} fallback={<Loading>Loading tools…</Loading>}>{(tools) =>
          <Group title="Its tools"><For each={tools()}>{(tool) =>
            <SettingLine plain mono label={tool.name} title={tool.description}><SettingValue>{tool.readOnly ? "Reads" : "Can act"}</SettingValue></SettingLine>}</For>
          </Group>}
        </Show>
      </Show>
      <Show when={direct().length}><Group title="Called by the model"><For each={direct()}>{line}</For></Group></Show>
      <Show when={scripted().length}><Group title="Called from codemode"><For each={scripted()}>{line}</For></Group></Show>
      <McpAccess />
      <Group title="About this list">
        <SettingDetails summary="Where tools come from">
          <Note>Built-in tools are Conduit's own. Extensions are Pi packages a profile loads (web search). Connectors are your
            connected accounts, reached from codemode. Codemode is the code tool and the helpers its scripts call.</Note>
          <Note>jbot's threads work on any device, so their file tools take a device. A chat started on any device gets the same,
            plus devices and handoff. Connected accounts appear once a connector is connected (Account).</Note>
        </SettingDetails>
      </Group>
    </>}
  </Show>;
}

/**
 * Conduit's tools for other harnesses: the hub's MCP endpoint (conduit_ui, conduit_inbox and browser). Claude Code started by Conduit on the
 * hub is given it; Codex and other MCP clients are added by hand, from what is copied here. The token is copied inside
 * the entry, never shown.
 */
function McpAccess() {
  const [access, setAccess] = createSignal<{ url: string; codex: string; browser: boolean } | null>(null);
  const [copied, setCopied] = createSignal("");
  onMount(() => void api<{ url: string; codex: string; browser: boolean }>("/v0/mcp/access").then(setAccess).catch(() => {}));
  const copy = (what: string, text: string) => void navigator.clipboard.writeText(text).then(() => { setCopied(what); window.setTimeout(() => setCopied(""), 2000); })
    .catch(() => setCopied("Copying was not allowed here"));
  return <Show when={access()}>{(found) => <Group title="Other harnesses">
    <SettingLine plain label="conduit" mono title="Conduit over MCP (Streamable HTTP): conduit_ui reads and arranges client tabs; conduit_inbox edits the hub's shared context inbox. A signed-in session or the hub's token may call it.">
      <SettingValue mono>{found().url}</SettingValue>
    </SettingLine>
    <SettingLine plain label="Codex" state="paste into ~/.codex/config.toml" title="[mcp_servers.conduit] with the hub's token as its Authorization header, and [mcp_servers.agent-browser] on the shared page.">
      <Button variant="ghost" size="sm" onClick={() => copy("Codex entry copied", found().codex)}>Copy entry</Button>
    </SettingLine>
    <Show when={copied()}><LiveNote>{copied()}</LiveNote></Show>
    <Note>The hub's browser is agent-browser's own MCP server on the page you share{found().browser ? "" : " (not installed on this hub)"}. Claude Code chats Conduit starts on the hub have both already.</Note>
  </Group>}</Show>;
}
