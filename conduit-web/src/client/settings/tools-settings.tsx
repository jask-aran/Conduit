import { createMemo, createSignal, For, onMount, Show } from "solid-js";
import { Button, LiveNote, SettingDetails, SettingLine, SettingValue, Group, Loading, Note } from "@/components/ui";
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

  return <Show when={profiles()} fallback={<Show when={error()} fallback={<Loading>Loading tools…</Loading>}>
    <Note tone="error"><span>{error() || "Tools could not be loaded."}</span><Button variant="secondary" size="sm" onClick={() => void load()}>Retry</Button></Note>
  </Show>}>
    {(list) => <>
      <Group title="Profile">
        <SettingLine label="Show tools of">
          <Select id="tools-profile" aria-label="Profile" value={selected()} onChange={(event) => setSelected(event.currentTarget.value)}>
            <For each={list()}>{(item) => <option value={item.id}>{nameOf(item)}</option>}</For>
          </Select>
        </SettingLine>
        <Show when={profile()}>{(current) =>
          <Note>{current().tools.length} tools; {asking() ? `${asking()} can ask you first` : "none asks you first"}.
            {scripted().length ? ` ${scripted().length} are called from codemode scripts, not by the model directly.` : ""}</Note>}
        </Show>
      </Group>
      <Show when={direct().length}><Group title="Called by the model"><For each={direct()}>{line}</For></Group></Show>
      <Show when={scripted().length}><Group title="Called from codemode"><For each={scripted()}>{line}</For></Group></Show>
      <McpAccess />
      <Group title="About this list">
        <SettingDetails summary="Where tools come from">
          <Note>Built-in tools are Conduit's own. Extensions are Pi packages a profile loads (web search). Connectors are your
            connected accounts, reached from codemode. Codemode is the code tool and the helpers its scripts call.</Note>
          <Note>jbot's threads work on any device, so their file tools take a device. A chat started on any device gets the same,
            plus devices and handoff. Connected accounts appear once a connector is connected (Models &amp; accounts).</Note>
        </SettingDetails>
      </Group>
    </>}
  </Show>;
}

/**
 * Conduit's tools for other harnesses: the hub's MCP endpoint (ui and browser). Claude Code started by Conduit on the
 * hub is given it; Codex and other MCP clients are added by hand, from what is copied here. The token is copied inside
 * the entry, never shown.
 */
function McpAccess() {
  const [access, setAccess] = createSignal<{ url: string; codex: string; browser: boolean } | null>(null);
  const [copied, setCopied] = createSignal("");
  onMount(() => void api<{ url: string; codex: string; browser: boolean }>("/v0/mcp/ui/access").then(setAccess).catch(() => {}));
  const copy = (what: string, text: string) => void navigator.clipboard.writeText(text).then(() => { setCopied(what); window.setTimeout(() => setCopied(""), 2000); })
    .catch(() => setCopied("Copying was not allowed here"));
  return <Show when={access()}>{(found) => <Group title="Other harnesses">
    <SettingLine plain label="conduit-ui" mono title="Conduit's ui tool over MCP (Streamable HTTP): what the person has open, and opening, closing and focusing panes. A signed-in session or the hub's token may call it.">
      <SettingValue mono>{found().url}</SettingValue>
    </SettingLine>
    <SettingLine plain label="Codex" state="paste into ~/.codex/config.toml" title="[mcp_servers.conduit-ui] with the hub's token as its Authorization header, and [mcp_servers.agent-browser] on the shared page.">
      <Button variant="ghost" size="sm" onClick={() => copy("Codex entry copied", found().codex)}>Copy entry</Button>
    </SettingLine>
    <Show when={copied()}><LiveNote>{copied()}</LiveNote></Show>
    <Note>The hub's browser is agent-browser's own MCP server on the page you share{found().browser ? "" : " (not installed on this hub)"}. Claude Code chats Conduit starts on the hub have both already.</Note>
  </Group>}</Show>;
}
