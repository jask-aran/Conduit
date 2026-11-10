import { createEffect, createMemo, createSignal, For, lazy, onMount, Show } from "solid-js";
import { Button, LiveNote, Group, Loading, Note, Segmented } from "@/components/ui";
import { Heading } from "@/components/ui/header";
import { StatusText } from "@/components/ui/file";
import { Workbench, WorkbenchFact, WorkbenchPick, WorkbenchSplit, WorkbenchTitle } from "@/components/ui/workbench";
import { api } from "../api/client";
import { agentName } from "../state/agent";
import { ConnectorsGroup } from "./connectors-settings";
import { tokens } from "./context-settings";
// The editor brings CodeMirror: loaded when the page opens, never with the app.
const TextEditor = lazy(() => import("@/components/ui/text-editor").then((module) => ({ default: module.TextEditor })));

/** One tool of a profile (GET /v0/profiles/tools): where it comes from, who calls it, whether it asks first, and what
 *  the model is told of it (text, parameters: its JSON schema). */
type Schema = { type?: string | string[]; description?: string; properties?: Record<string, Schema>; required?: string[]; enum?: unknown[]; const?: unknown; items?: Schema; anyOf?: Schema[] };
type ProfileTool = {
  name: string; description: string; text?: string; parameters?: Schema | null; source: "built-in" | "extension" | "connector" | "codemode"; extension?: string;
  reach: "model" | "codemode"; asks: "never" | "always" | "sometimes"; when?: string;
};
type ProfileTools = { id: string; label: string; internal: boolean; agent: boolean; tools: ProfileTool[] };

const SOURCE = { "built-in": "Built-in", extension: "Extension", connector: "Connector", codemode: "Codemode" } as const;
const SOURCE_SAYS = {
  "built-in": "Conduit's own.", extension: "From a package the profile loads.",
  connector: "From your connected accounts.", codemode: "A helper the code tool's scripts call.",
} as const;
const ASKS = { never: "Runs", always: "Asks first", sometimes: "Sometimes asks" } as const;

/** A schema's type as a person reads it: string, "a" | "b", string[], object. */
function typeOf(schema: Schema): string {
  if (schema.const !== undefined) return JSON.stringify(schema.const);
  if (schema.enum) return schema.enum.map((value) => JSON.stringify(value)).join(" | ");
  if (schema.anyOf) return schema.anyOf.map(typeOf).join(" | ");
  if (schema.type === "array") return `${schema.items ? typeOf(schema.items) : "any"}[]`;
  return Array.isArray(schema.type) ? schema.type.join(" | ") : schema.type || "any";
}
/** What the model is told of a tool: its description, then each thing it takes. */
function told(tool: ProfileTool): string {
  const takes = Object.entries(tool.parameters?.properties ?? {});
  const required = new Set(tool.parameters?.required ?? []);
  return [(tool.text || tool.description).trim(), takes.length ? ["## Takes", "", ...takes.map(([name, schema]) =>
    `- \`${name}\` (${typeOf(schema)}${required.has(name) ? "" : ", optional"})${schema.description ? `: ${schema.description}` : ""}`)].join("\n") : "Takes nothing."].join("\n\n");
}
/** Where a tool sits in the side column: the model's own, or the codemode namespace its name puts it in. */
function groupOf(tool: ProfileTool): string {
  if (tool.reach === "model") return "Called by the model";
  const connector = /^mcp__([^_]+(?:_[^_]+)*)__/.exec(tool.name)?.[1];
  return connector ? `From codemode · ${connector}` : tool.name.startsWith("agent_browser_") ? "From codemode · hub browser" : "From codemode";
}
const shortName = (tool: ProfileTool) => tool.reach === "model" ? tool.name : tool.name.replace(/^mcp__.+?__|^agent_browser_|^pi\.codemode\./, "");

/**
 * AI › Tools, read-only: a profile's tools as its chats get them, on the workbench layout (workbench.tsx). The title's
 * switch picks the profile; the side column is its tools, by who calls them, each saying when it asks; the chosen
 * one's pane is what the model is told of it. Conduit decides the tools from the profile's template
 * (durable-runtime.js, `selectionFor`); what asks is the agent policy's (policy.js, `askOf`). Nothing here is set,
 * but for the connectors, which are signed in to from here.
 */
export function ToolsSettings() {
  const [profiles, setProfiles] = createSignal<ProfileTools[] | null>(null);
  const [error, setError] = createSignal("");
  const [selected, setSelected] = createSignal("");
  const [chosen, setChosen] = createSignal("");
  // A phone's: the tool's pane is a screen of its own, opened from the list.
  const [reading, setReading] = createSignal(false);
  const load = () => {
    setError("");
    return api<{ profiles: ProfileTools[] }>("/v0/profiles/tools").then(({ profiles }) => {
      setProfiles(profiles);
      if (!profiles.some((profile) => profile.id === selected())) setSelected(profiles.find((profile) => !profile.internal)?.id || profiles[0]?.id || "");
    }).catch((failure) => setError(failure instanceof Error ? failure.message : String(failure)));
  };
  onMount(() => void load());
  const profile = createMemo(() => profiles()?.find((item) => item.id === selected()) || null);
  const tool = createMemo(() => profile()?.tools.find((item) => item.name === chosen()) || null);
  createEffect(() => { if (profile() && !tool()) setChosen(profile()!.tools[0]?.name ?? ""); });
  const groups = createMemo(() => {
    const found = new Map<string, ProfileTool[]>();
    for (const item of profile()?.tools ?? []) found.set(groupOf(item), [...(found.get(groupOf(item)) ?? []), item]);
    return [...found].map(([title, items]) => ({ title, items }));
  });
  const asking = createMemo(() => profile()?.tools.filter((item) => item.asks !== "never").length || 0);
  const nameOf = (item: ProfileTools) => item.agent ? agentName() : item.label;
  const alsoIn = () => (profiles() ?? []).filter((item) => item.id !== selected() && item.tools.some((other) => other.name === chosen())).map(nameOf);

  return <Show when={profiles()} fallback={<Show when={error()} fallback={<Loading>Loading tools…</Loading>}>
    <Note tone="error"><span>{error() || "Tools could not be loaded."}</span><Button variant="secondary" size="sm" onClick={() => void load()}>Retry</Button></Note>
  </Show>}>
    {(list) => <Workbench label="Tools">
      <WorkbenchTitle title={tool()?.name ?? "Tools"}
        meta={profile() ? `${nameOf(profile()!)} has ${profile()!.tools.length} tools; ${asking() ? `${asking()} can ask you first` : "none asks you first"}` : undefined}
        actions={<Segmented size="sm" label="Profile" value={selected()} onChange={setSelected} options={list().map((item) => ({ value: item.id, label: nameOf(item) }))} />} />
      <WorkbenchSplit open={reading()} onOpenChange={setReading} mainLabel={tool()?.name ?? "Tool"}
        side={<>
          <ConnectorsGroup />
          <For each={groups()}>{(group) => <Group kind="workbench" title={group.title}>
            <For each={group.items}>{(item) => <WorkbenchPick name={shortName(item)} title={item.description} current={item.name === chosen()}
              context={item.asks === "never" ? undefined : ASKS[item.asks].toLowerCase()} onSelect={() => { setChosen(item.name); setReading(true); }} />}</For>
          </Group>}</For>
          <McpAccess />
        </>}
        facts={<Show when={tool()}>{(current) => <Group kind="workbench" title="About it">
          <WorkbenchFact name="From" value={current().extension && current().source === "extension" ? `${SOURCE.extension} (${current().extension})` : SOURCE[current().source]} title={SOURCE_SAYS[current().source]} />
          <WorkbenchFact name="Called by" value={current().reach === "model" ? "the model" : "a codemode script"} />
          <WorkbenchFact name="When called" value={ASKS[current().asks]} title={current().when} />
          <Show when={current().when}><Note kind="workbench">{current().when}</Note></Show>
          <Show when={alsoIn().length}><WorkbenchFact name="Also in" value={alsoIn().join(", ")} /></Show>
        </Group>}</Show>}
        main={<Show when={tool()} fallback={<Note kind="workbench">This profile has no tools.</Note>}>{(current) =>
          <TextEditor fill readOnly label={`What the model is told of ${current().name}`} value={told(current())}
            head={<Heading kind="editor">What the model is told</Heading>}
            status={<><StatusText>{tokens(told(current()).length)}</StatusText><StatusText>{SOURCE_SAYS[current().source]}</StatusText></>} />}</Show>} />
    </Workbench>}
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
  return <Show when={access()}>{(found) => <Group kind="workbench" title="For other harnesses">
    <WorkbenchFact code name="conduit" value={found().url} title="Conduit's MCP server: another harness can arrange your tabs and edit the hub's shared inbox. It needs a signed-in session or the hub's token." />
    <WorkbenchFact name="Codex" value="~/.codex/config.toml" title="Paste the entry into ~/.codex/config.toml">
      <Button variant="ghost" size="sm" onClick={() => copy("Codex entry copied", found().codex)}>Copy entry</Button>
    </WorkbenchFact>
    <Show when={copied()}><LiveNote>{copied()}</LiveNote></Show>
    <Note kind="workbench">Claude Code chats started on the hub have these already.{found().browser ? "" : " The hub browser is not installed on this hub."}</Note>
  </Group>}</Show>;
}
