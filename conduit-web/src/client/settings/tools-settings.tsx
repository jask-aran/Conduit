import { createEffect, createMemo, createSignal, For, lazy, onMount, Show } from "solid-js";
import { Button, Group, Loading, Note, Segmented } from "@/components/ui";
import { Heading } from "@/components/ui/header";
import { StatusText } from "@/components/ui/file";
import { Workbench, WorkbenchFact, WorkbenchFold, WorkbenchPick, WorkbenchSplit, WorkbenchTitle } from "@/components/ui/workbench";
import { api } from "../api/client";
import { agentName } from "../state/agent";
import { tokens } from "./context-settings";
// The editor brings CodeMirror: loaded when the page opens, never with the app.
const TextEditor = lazy(() => import("@/components/ui/text-editor").then((module) => ({ default: module.TextEditor })));

type Schema = { type?: string | string[]; description?: string; properties?: Record<string, Schema>; required?: string[]; enum?: unknown[]; const?: unknown; items?: Schema; anyOf?: Schema[] };
type ProfileTool = {
  name: string; description: string; text?: string; parameters?: Schema | null; group?: string; source: "built-in" | "extension" | "connector" | "codemode"; extension?: string;
  reach: "model" | "codemode"; asks: "never" | "always" | "sometimes"; when?: string;
};
type ProfileTools = { id: string; label: string; internal: boolean; agent: boolean; tools: ProfileTool[] };

const SOURCE = { "built-in": "Built-in", extension: "Extension", connector: "Connector", codemode: "Codemode" } as const;
const SOURCE_SAYS = {
  "built-in": "Conduit's own.", extension: "From a package the profile loads.",
  connector: "From your connected accounts.", codemode: "A helper the code tool's scripts call.",
} as const;
const ASKS = { never: "Runs", always: "Asks first", sometimes: "Sometimes asks" } as const;

function typeOf(schema: Schema): string {
  if (schema.const !== undefined) return JSON.stringify(schema.const);
  if (schema.enum) return schema.enum.map((value) => JSON.stringify(value)).join(" | ");
  if (schema.anyOf) return schema.anyOf.map(typeOf).join(" | ");
  if (schema.type === "array") return `${schema.items ? typeOf(schema.items) : "any"}[]`;
  return Array.isArray(schema.type) ? schema.type.join(" | ") : schema.type || "any";
}
function told(tool: ProfileTool): string {
  const takes = Object.entries(tool.parameters?.properties ?? {});
  const required = new Set(tool.parameters?.required ?? []);
  return [(tool.text || tool.description).trim(), takes.length ? ["## Takes", "", ...takes.map(([name, schema]) =>
    `- \`${name}\` (${typeOf(schema)}${required.has(name) ? "" : ", optional"})${schema.description ? `: ${schema.description}` : ""}`)].join("\n") : "Takes nothing."].join("\n\n");
}
const shortName = (tool: ProfileTool) => tool.name.replace(/^mcp__.+?__|^agent_browser_|^pi\.codemode\.models\./, "");

/** A tool is one thing whichever profiles have it; where a profile's version differs (jbot's file tools take a device), the pane's switch shows each. */
type Entry = { name: string; group: string; in: { profile: ProfileTools; tool: ProfileTool }[] };
const same = (a: ProfileTool, b: ProfileTool) => (a.text ?? a.description) === (b.text ?? b.description) && JSON.stringify(a.parameters ?? null) === JSON.stringify(b.parameters ?? null);

export function ToolsSettings() {
  const [profiles, setProfiles] = createSignal<ProfileTools[] | null>(null);
  const [error, setError] = createSignal("");
  const [chosen, setChosen] = createSignal("");
  const [openGroup, setOpenGroup] = createSignal("");
  const [version, setVersion] = createSignal("");
  const [reading, setReading] = createSignal(false);
  const load = () => {
    setError("");
    return api<{ profiles: ProfileTools[] }>("/v0/profiles/tools").then(({ profiles }) => setProfiles(profiles))
      .catch((failure) => setError(failure instanceof Error ? failure.message : String(failure)));
  };
  onMount(() => void load());
  const nameOf = (item: ProfileTools) => item.agent ? agentName() : item.label;
  const entries = createMemo(() => {
    const found = new Map<string, Entry>();
    for (const profile of profiles() ?? []) for (const tool of profile.tools) {
      const entry = found.get(tool.name) ?? { name: tool.name, group: tool.group || "Other", in: [] };
      entry.in.push({ profile, tool }); found.set(tool.name, entry);
    }
    return [...found.values()];
  });
  const groups = createMemo(() => {
    const found = new Map<string, Entry[]>();
    for (const entry of entries()) found.set(entry.group, [...(found.get(entry.group) ?? []), entry]);
    return [...found].map(([title, items]) => ({ title, items }));
  });
  const entry = createMemo(() => entries().find((item) => item.name === chosen()) || null);
  createEffect(() => { if (entries().length && !entry()) { setChosen(entries()[0]!.name); setOpenGroup(entries()[0]!.group); } });
  // The versions of the chosen tool: profiles told the same thing are one.
  const versions = createMemo(() => {
    const out: { tool: ProfileTool; profiles: ProfileTools[] }[] = [];
    for (const { profile, tool } of entry()?.in ?? []) { const match = out.find((item) => same(item.tool, tool)); if (match) match.profiles.push(profile); else out.push({ tool, profiles: [profile] }); }
    return out;
  });
  const shown = createMemo(() => versions().find((item) => item.profiles[0]!.id === version()) ?? versions()[0] ?? null);
  const asks = (item: Entry) => { const kinds = new Set(item.in.map(({ tool }) => tool.asks)); return kinds.has("always") ? "asks first" : kinds.has("sometimes") ? "sometimes asks" : undefined; };

  return <Show when={profiles()} fallback={<Show when={error()} fallback={<Loading>Loading tools…</Loading>}>
    <Note tone="error"><span>{error() || "Tools could not be loaded."}</span><Button variant="secondary" size="sm" onClick={() => void load()}>Retry</Button></Note>
  </Show>}>
    <Workbench label="Tools">
      <WorkbenchTitle title={entry()?.name ?? "Tools"} meta={entry() ? `${entry()!.group} · one of ${entries().length} tools` : undefined} />
      <WorkbenchSplit open={reading()} onOpenChange={setReading} mainLabel={entry()?.name ?? "Tool"}
        side={<For each={groups()}>{(group) => <WorkbenchFold title={group.title} count={group.items.length} open={openGroup() === group.title} onToggle={() => setOpenGroup(openGroup() === group.title ? "" : group.title)}>
          <For each={group.items}>{(item) => <WorkbenchPick name={shortName(item.in[0]!.tool)} title={item.in[0]!.tool.description} current={item.name === chosen()}
            context={asks(item)} onSelect={() => { setChosen(item.name); setVersion(""); setReading(true); }} />}</For>
        </WorkbenchFold>}</For>}
        facts={<Show when={shown()}>{(current) => <Group kind="workbench" title="About it">
          <WorkbenchFact name="Given to" value={(entry()?.in ?? []).map(({ profile }) => nameOf(profile)).join(", ")} title="The profiles whose chats have it; their subagents and runs have it too" />
          <WorkbenchFact name="From" value={current().tool.extension && current().tool.source === "extension" ? `${SOURCE.extension} (${current().tool.extension})` : SOURCE[current().tool.source]} title={SOURCE_SAYS[current().tool.source]} />
          <WorkbenchFact name="Called by" value={current().tool.reach === "model" ? "the model" : "a codemode script"} />
          <WorkbenchFact name="When called" value={ASKS[current().tool.asks]} title={current().tool.when} />
          <Show when={current().tool.when}><Note kind="workbench">{current().tool.when}</Note></Show>
        </Group>}</Show>}
        main={<Show when={shown()} fallback={<Note kind="workbench">No tools.</Note>}>{(current) =>
          <TextEditor fill readOnly label={`${current().tool.name}'s definition`} value={told(current().tool)}
            head={<>
              <Heading kind="editor">Definition</Heading>
              <Show when={versions().length > 1}>
                <Segmented size="sm" label="Whose version" value={current().profiles[0]!.id} onChange={setVersion}
                  options={versions().map((item) => ({ value: item.profiles[0]!.id, label: item.profiles.map(nameOf).join(", ") }))} />
              </Show>
            </>}
            status={<><StatusText>{tokens(told(current().tool).length)}</StatusText><StatusText>sent to the model as the tool's definition</StatusText></>} />}</Show>} />
    </Workbench>
  </Show>;
}
