import { Icons } from "@/components/ui";
import { createEffect, createMemo, createSignal, Index, Match, onCleanup, Show, Suspense, Switch } from "solid-js";

import type { AgentSummary, Message, ToolItem, ToolKind } from "../api/contracts";
import { spawned, TurnAgents } from "./agents";
import type { TraceSegment, TurnTraceData } from "../turn-rows";
import { elapsed, KIND_ICONS, scriptSaid, stepDuration, stepKind, stepText, stepVerb, toolName, ToolStep, toolStepBody, toolStepLine } from "./tool-card";
import { Orb, Step, StepProse, StepSections, Trace, TraceError as LibraryTraceError, Trail } from "@/components/ui";
import { Dynamic } from "solid-js/web";
import { ORBITS_TRAILED, PLAIN_SPHERE, SPUTTERING_SPHERE } from "./orb-frames";
import { type ModeFrame, type OrbState, settledOrbRate } from "./thinking-orb";
import { extendsText } from "./streaming-markdown";
import { ChatMarkdown } from "./lazy-markdown";
import { fullDateTime } from "./full-date-time";
import { digestDoing, digestDone } from "./turn-digest";

export type ContextText = { kind: string; sections: { name: string; text: string }[];
  tools?: { added: string[]; removed: string[]; changed?: string[]; restated?: number; all?: { name: string; description: string }[] }; summary?: string };
type RowProps = {
  loadContext?: (entryId: number) => Promise<ContextText>;
  onRendered?: () => void;
 
  profileLabel?: string;
  toolOpen?: (id: string) => boolean;
  onToolOpenChange?: (id: string, open: boolean) => void;
  settled?: boolean;
};

const GROUP_WORDS: Record<ToolKind, (count: number) => string> = {
  command: (count) => `Ran ${count} commands`,
  message: (count) => `Sent ${count} notifications`,
  read: (count) => `Read ${count} files`,
  edit: (count) => `Made ${count} edits`,
  search: (count) => `Ran ${count} searches`,
  fetch: (count) => `Ran ${count} fetches`,
  script: (count) => `Scripted tools ${count} times`,
  agent: (count) => `Managed agents ${count} times`,
  other: (count) => `Used ${count} tools`,
};
type TrailItem =
  | { type: "text"; segment: Extract<TraceSegment, { kind: "thinking" | "narration" }> }
  | { type: "error"; message: Message }
  | { type: "tool"; tool: ToolItem }
  | { type: "group"; kind: ToolKind; tools: ToolItem[] }
  | { type: "context"; message: Message }
  | { type: "hidden" };

// It gives way only once its agents are listed (`drawn`): the step and the agent line swap in one frame, where hiding
// it sooner leaves the turn empty a moment and pulls the transcript down.
const spawnsOnly = (tool: ToolItem, drawn: Set<string>) => tool.kind === "script" && !tool.isError && drawn.has(tool.toolCallId)
  && (!tool.calls?.length || tool.calls.every((call) => call.earlier || call.name === "subagent"));
/* A subagent's spawn is not a line: it is pinned under the head (TurnAgents), where the fold does not hide it. */
function trailOf(segments: TraceSegment[], drawn: Set<string> = new Set()): TrailItem[] {
  const items: TrailItem[] = [];
  let run: ToolItem[] = [];
  const flush = () => {
    // A script already holds its own list of tools; scripts are never folded
    // into a count of scripts on top of that.
    if (run.length > 1 && run[0]!.kind !== "script") items.push({ type: "group", kind: run[0]!.kind || "other", tools: run });
    else for (const tool of run) items.push({ type: "tool", tool });
    run = [];
  };
  let hiddenSaid = false;
  for (const segment of segments) {
    // Reasoning the provider kept to itself is said once, where it first
    // happened -- not once per step, and not splitting a run of tools.
    if (segment.kind === "thinking" && segment.hidden) {
      if (hiddenSaid) continue;
      hiddenSaid = true;
      flush();
      items.push({ type: "hidden" });
      continue;
    }
    if (segment.kind === "context") { flush(); items.push({ type: "context", message: segment.message }); continue; }
    if (segment.kind === "tool") {
      if (spawned(segment.tool) || spawnsOnly(segment.tool, drawn)) continue;
      if (run.length && (run[0]!.kind || "other") !== (segment.tool.kind || "other")) flush();
      run.push(segment.tool);
      continue;
    }
    // Text that has not said anything is not a line of the trail, and does
    // not split a run of tools either.
    if (segment.kind !== "error" && !segment.text.trim()) continue;
    flush();
    if (segment.kind === "error") items.push({ type: "error", message: segment.message });
    else items.push({ type: "text", segment });
  }
  flush();
  return items;
}

/*
 * Models reason as headed summaries (a bold line, perhaps a paragraph under it) or raw prose: the last heading if
 * there is one, otherwise the last sentence. Some models run sentences together without a space, so a sentence ends
 * at . ! or ? followed by a space or a capital.
 */
const HEADING_LINE = /^\s*\*\*(.+?)\*\*\s*$/;
const SENTENCE_BREAK = /(?<=[.!?])\s*(?=[A-Z])/;
/* A heading is a whole line, so lines already read are not read again: kept per text it extends, a few texts at a time
   (a turn's thinking and its answer). */
const headingScans: Array<{ text: string; read: number; heading: string | null }> = [];
function lastHeading(text: string): string | null {
  let scan = headingScans.find((entry) => extendsText(text, entry.text));
  if (!scan) {
    scan = { text: "", read: 0, heading: null };
    headingScans.unshift(scan);
    headingScans.length = Math.min(headingScans.length, 4);
  }
  const complete = text.lastIndexOf("\n") + 1;
  // Only a line with ** in it can be one: from each ** to the next.
  for (let start = scan.read; start < complete;) {
    const star = text.indexOf("**", start);
    if (star < 0 || star >= complete) break;
    const end = text.indexOf("\n", star);
    const match = HEADING_LINE.exec(text.slice(Math.max(start, text.lastIndexOf("\n", star) + 1), end));
    if (match) scan.heading = match[1]!.trim();
    start = end + 1;
  }
  scan.text = text;
  scan.read = Math.max(scan.read, complete);
  const open = HEADING_LINE.exec(text.slice(complete));
  return open ? open[1]!.trim() : scan.heading;
}
/* The last sentence, read from the end: a break inside the window is one in the whole text (its first character has
   no character before it to look behind at, so a sentence must start after it). Longer than the window, the whole. */
const SENTENCE_WINDOW = 4000;
function lastSentence(text: string): string {
  if (text.length > SENTENCE_WINDOW) {
    const pieces = text.slice(-SENTENCE_WINDOW).replace(/\s+/g, " ").split(SENTENCE_BREAK).map((sentence) => sentence.trim());
    for (let index = pieces.length - 1; index >= 1; index -= 1) if (pieces[index]) return pieces[index]!;
  }
  const sentences = text.replace(/\s+/g, " ").trim().split(SENTENCE_BREAK);
  return sentences.map((sentence) => sentence.trim()).filter(Boolean).at(-1) || "";
}
function summaryOf(text: string): string {
  return lastHeading(text) ?? lastSentence(text);
}
/* Text too long to be a summary is raw reasoning: one step, as summaryOf. */
const SUMMARY_LIMIT = 8000;
function sectionsOf(text: string): { heading: string; body: string }[] | null {
  if (text.length > SUMMARY_LIMIT || !text.includes("**")) return null;
  const sections: { heading: string; body: string }[] = [];
  let before = "";
  for (const line of text.split("\n")) {
    const heading = HEADING_LINE.exec(line);
    if (heading) sections.push({ heading: heading[1]!.trim(), body: "" });
    else if (sections.length) sections.at(-1)!.body += `${line}\n`;
    else before += `${line}\n`;
  }
  if (!sections.length) return null;
  if (before.trim()) sections[0]!.body = `${before}${sections[0]!.body}`;
  return sections.map((section) => ({ heading: section.heading, body: section.body.trim() }));
}

const KIND_WORDS: Record<ToolKind, [string, string]> = {
  command: ["command", "commands"],
  message: ["message", "messages"],
  read: ["read", "reads"],
  edit: ["edit", "edits"],
  search: ["search", "searches"],
  fetch: ["fetch", "fetches"],
  script: ["script", "scripts"],
  agent: ["agent", "agents"],
  other: ["tool", "tools"],
};
const plural = (count: number, [one, many]: [string, string]) => `${count} ${count === 1 ? one : many}`;

/* A call whose name has not arrived yet is not counted: it would read as a
   tool and then turn into a fetch. */
const unnamed = (tool: ToolItem) => !tool.name || tool.name === "tool";

function workOf(tools: ToolItem[]): string {
  const counts = new Map<ToolKind, number>();
  // An agent is counted once, where it was handed its task; listing or messaging agents is not another.
  const count = (kind: ToolKind) => counts.set(kind, (counts.get(kind) || 0) + 1);
  for (const tool of tools) {
    if (unnamed(tool) || (tool.kind === "agent" && !spawned(tool))) continue;
    const calls = tool.kind === "script" ? (tool.calls || []).filter((call) => !call.planned && !call.earlier) : [];
    if (calls.length) for (const call of calls) count(call.facts?.kind || call.kind || "other");
    else count(tool.facts?.kind || tool.kind || "other");
  }
  return [...counts].sort((left, right) => right[1] - left[1])
    .map(([kind, count]) => plural(count, KIND_WORDS[kind])).join(", ");
}

/* The verb is always there, so a clean finish says Done rather than being told apart by what it lacks. */
type Mark = { orb: OrbState; frame?: ModeFrame };
const KIND_ORBS: Record<ToolKind, Mark> = {
  command: { orb: "solving" }, read: { orb: "weaving" }, edit: { orb: "working", frame: ORBITS_TRAILED },
  search: { orb: "searching" }, fetch: { orb: "searching" }, script: { orb: "solving" }, agent: { orb: "weaving" }, message: { orb: "weaving" }, other: { orb: "solving" },
};

function statusOf(trace: TurnTraceData, writing: boolean): Mark & { verb: string } {
  if (!trace.active) {
    const verb = ({ interrupted: "Interrupted", failed: "Failed" } as Record<string, string>)[trace.status] || "Done";
    return { verb, orb: "working", frame: verb === "Done" ? PLAIN_SPHERE : SPUTTERING_SPHERE };
  }
  const running = trace.segments.flatMap((segment) => segment.kind === "tool" && !segment.tool.done ? [segment.tool] : []);
  if (running.length > 1) return { verb: `Running ${running.length} tools`, orb: "solving" };
  const tool = running[0];
  if (!tool) return writing ? { verb: "Writing", orb: "composing" } : { verb: "Thinking", orb: "working" };
  if (unnamed(tool)) return { verb: "Calling a tool", orb: "solving" };
  const now = tool.kind === "script" ? scriptSaid(tool, true)?.call ?? tool : tool;
  return { verb: capitalised(digestDoing(trace) ?? "working"), ...KIND_ORBS[stepKind(now)] };
}

function actorPhrase(trace: TurnTraceData, writing: boolean): string {
  return digestDoing(trace, true) ?? (writing ? "writing" : "thinking");
}

/* A long path is kept from its end, since the file is the part worth reading. */
function toolLine(tool: ToolItem): string {
  if (tool.facts?.subject) return stepText(tool);
  const subject = tool.subject || "";
  if (tool.kind === "search") return subject ? `\u201c${subject}\u201d` : "";
  return subject.length > 80 && (tool.kind === "read" || tool.kind === "edit") ? `\u2026${subject.slice(-79)}` : subject;
}

/* Settled, the latest line is the last thinking if there was any, since that is what the turn concluded. Discarded
   text is that one step's loss, not the turn's, so it is passed over. */
type Detail = { text: string; markdown: boolean };
function stepLine(tool: ToolItem, live: boolean): string {
  const said = tool.kind === "script" ? scriptSaid(tool, live && !tool.done) : null;
  const item = said?.call ?? tool;
  const running = live && (said ? said.call.done === false : !tool.done);
  if (running && !said && !tool.facts?.verb) return toolLine(tool);
  const line = item.facts?.subject ? stepText(item) : toolLine({ toolCallId: "", kind: item.kind, subject: toolName(item.subject) });
  const verb = stepVerb(item, running);
  return [verb, line || (item.kind === "other" ? "" : item.name), said?.more ? `and ${said.more} more` : ""].filter(Boolean).join(" ").trim();
}
function previewOf(trace: TurnTraceData, writing: boolean): { status: ReturnType<typeof statusOf>; work: string; detail: Detail | null } {
  let latest: Detail | null = null;
  let thought: Detail | null = null;
  const tools: ToolItem[] = [];
  for (const segment of trace.segments) if (segment.kind === "tool") tools.push(segment.tool);
  // From the end, so only the one shown is summarised.
  for (let index = trace.segments.length - 1; index >= 0 && !thought; index -= 1) {
    const segment = trace.segments[index]!;
    let detail: Detail | null = null;
    if (segment.kind === "context") continue;
    if (segment.kind === "tool") {
      // A spawn says itself in its pinned row, under this line.
      const tool = segment.tool;
      const line = unnamed(tool) || spawned(tool) ? "" : stepLine(tool, trace.active);
      if (line) latest ??= { text: line, markdown: false };
      continue;
    }
    if (segment.kind === "error") detail = { text: segment.message.errorMessage || "The model request failed.", markdown: false };
    else if (!segment.discarded && segment.text.trim()) detail = { text: summaryOf(segment.text), markdown: true };
    if (detail) { thought = detail; latest ??= detail; }
  }
  return { status: statusOf(trace, writing), work: workOf(tools), detail: trace.active ? latest : thought || latest };
}

function duration(ms: number, settled: boolean): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  if (!settled) {
    const seconds = Math.max(0, Math.floor(ms / 1000));
    return seconds < 60 ? `${pad(seconds)}s` : `${Math.floor(seconds / 60)}m ${pad(seconds % 60)}s`;
  }
  return elapsed(ms);
}

function turnTime(trace: () => Pick<TurnTraceData, "active" | "startedAt" | "endedAt">) {
  const [now, setNow] = createSignal(Date.now());
  createEffect(() => {
    if (!trace().active) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    onCleanup(() => clearInterval(timer));
  });
  return () => {
    const { active, startedAt, endedAt } = trace();
    const start = startedAt ? Date.parse(startedAt) : NaN;
    const end = active ? now() : endedAt ? Date.parse(endedAt) : NaN;
    return Number.isNaN(start) || Number.isNaN(end) ? "" : duration(end - start, !active);
  };
}

function useFold(id: () => string, props: Pick<RowProps, "toolOpen" | "onToolOpenChange">) {
  const initial = Boolean(props.toolOpen?.(id()));
  const [open, setOpen] = createSignal(initial);
  return { open, toggle: () => { const next = !open(); setOpen(next); props.onToolOpenChange?.(id(), next); } };
}
/* Built once, its text growing in place: passed as a prop's expression it is built again on every read of the prop,
   a fresh renderer for each delta of a thought. */
const inline = (text: () => string) =>
  <Suspense fallback={text()}><ChatMarkdown inline>{text() || "\u2026"}</ChatMarkdown></Suspense>;
/* A context piece by the name its block has in Settings › Blocks. */
const SECTION_LABELS: Record<string, string> = { instructions: "system prompt", cwd: "working folder", web: "web tools", codemode: "codemode tools", "agent-memory": "the agent's files", "agent-inbox": "waiting inbox" };
const sectionLabel = (name: string) => SECTION_LABELS[name] ?? name.replace(/[-_]+/g, " ");
export const capitalised = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);
const tokensOf = (chars: number) => chars < 400 ? `${Math.max(1, Math.round(chars / 4))} tok` : `${(chars / 4000).toFixed(1)}k tok`;
function ContextStep(props: RowProps & { message: Message; motion?: "entering" }) {
  const context = () => props.message.context!;
  const fold = useFold(() => props.message.id, props);
  const [text, setText] = createSignal<ContextText | null>(null);
  const [failure, setFailure] = createSignal("");
  let asked = false;
  createEffect(() => {
    if (!fold.open() || asked || !props.loadContext) return;
    asked = true;
    props.loadContext(context().entryId).then(setText, (cause) => { asked = false; setFailure(String(cause?.message || cause)); });
  });
  const pieces = () => context().sections.filter((section) => section.name !== "instructions").map((section) => `${section.removed ? "\u2212" : ""}${sectionLabel(section.name)}`);
  const tools = () => {
    const change = context().tools;
    if (!change) return "";
    if (change.restated) return `${change.restated} tools restated, unchanged`;
    const names = (list: string[], sign: string) => list.length > 2 ? `${sign}${list.length} tools` : list.map((name) => `${sign}${name}`).join(" ");
    return [context().kind === "prompt" ? (change.added.length ? `${change.added.length} tools` : "") : names(change.added, "+"), names(change.removed, "\u2212"),
      change.changed?.length ? `${change.changed.length > 2 ? `${change.changed.length} tools` : change.changed.join(", ")} changed` : ""].filter(Boolean).join(" ");
  };
  const verb = () => context().kind === "compaction" ? "Compacted" : context().kind !== "prompt" ? "Context changed"
    : context().opening ? "System prompt" : context().resent ? "System prompt, sent again after compacting" : "System prompt changed";
  const subject = () => context().kind === "compaction" ? "the conversation so far, as a summary" : [pieces().join(", "), tools()].filter(Boolean).join(" \u00b7 ") || (context().sections.some((section) => section.name === "instructions") ? "system prompt" : "");
  const chars = () => context().kind === "compaction" ? context().summary?.chars ?? 0 : context().sections.reduce((sum, section) => sum + section.chars, 0);
  const sections = () => {
    const loaded = text();
    if (!loaded) return undefined;
    // A piece taken away has no text to show; the line names it.
    return [...loaded.sections.filter((section) => section.text).map((section) => ({ label: capitalised(sectionLabel(section.name)), text: section.text })), ...(loaded.summary ? [{ label: "Summary", text: loaded.summary }] : [])];
  };
  const toolNames = () => { const loaded = text()?.tools; if (!loaded) return undefined;
    return loaded.all?.map((tool) => tool.name).join(", ") || [loaded.added.length ? `Added: ${loaded.added.join(", ")}` : "", loaded.removed.length ? `Removed: ${loaded.removed.join(", ")}` : "", loaded.changed?.length ? `Changed: ${loaded.changed.join(", ")}` : "", loaded.restated ? `${loaded.restated} restated, unchanged` : ""].filter(Boolean).join(" \u00b7 ") || undefined; };
  // It opens once its text is in: the text landing mid-move would jump what follows.
  const ready = () => Boolean(text() || failure() || !props.loadContext);
  return <Step icon={context().kind === "compaction" ? <Icons.Compact /> : <Icons.Context />} verb={verb()} subject={subject() || undefined} face="text" aside={chars() ? tokensOf(chars()) : undefined}
    motion={props.motion} opens open={fold.open() && ready()} onToggle={fold.toggle}>
    <StepSections error={failure() || undefined} sections={sections()} tools={toolNames()} />
  </Step>;
}
function trailText(item: TrailItem): string {
  if (item.type === "text") return `${summaryOf(item.segment.text)}\n${item.segment.text}`;
  if (item.type === "tool") return `${toolStepLine(item.tool)}\n${toolStepBody(item.tool)}`;
  if (item.type === "group") return [GROUP_WORDS[item.kind](item.tools.length), ...item.tools.map((tool) => `${toolStepLine(tool)}\n${toolStepBody(tool)}`)].join("\n");
  if (item.type === "error") return item.message.errorMessage || "The model request failed.";
  if (item.type === "hidden") return "Reasoning not shared by the provider";
  return "";
}
function TrailLine(props: RowProps & { item: TrailItem; arriving?: boolean }) {
  const motion = () => props.arriving ? "entering" as const : undefined;
  return <Switch>
    <Match when={props.item.type === "context" && props.item}>{(item) => <ContextStep message={(item() as Extract<TrailItem, { type: "context" }>).message} motion={motion()} loadContext={props.loadContext} toolOpen={props.toolOpen} onToolOpenChange={props.onToolOpenChange} />}</Match>
    <Match when={props.item.type === "text" && props.item.segment.kind === "thinking" && sectionsOf(props.item.segment.text) && props.item}>{(item) => {
      const segment = () => (item() as Extract<TrailItem, { type: "text" }>).segment;
      const sections = createMemo(() => sectionsOf(segment().text) ?? []);
      return <Index each={sections()}>{(section, index) => {
        const fold = useFold(() => `${segment().id}:${index}`, props);
        return <Step icon={<Icons.Thinking />} summary={inline(() => section().heading)} discarded={segment().discarded} motion={motion()} opens={Boolean(section().body)} open={fold.open()} onToggle={fold.toggle} find={() => `${section().heading}\n${section().body}`}>
          <StepProse><Suspense fallback={<div class="markdown-skeleton" />}><ChatMarkdown streaming={Boolean(segment().live)} onRendered={props.onRendered}>{section().body}</ChatMarkdown></Suspense></StepProse>
        </Step>;
      }}</Index>;
    }}</Match>
    <Match when={props.item.type === "text" && props.item}>{(item) => {
      const segment = () => item().segment, fold = useFold(() => segment().id, props);
      const summary = inline(() => summaryOf(segment().text));
      const thought = createMemo(() => segment().kind === "thinking");
      // A reasoning summary that is only its heading has nothing more to open to.
      const bare = (text: string) => text.replace(/[*_#`]/g, "").replace(/\s+/g, " ").trim();
      const more = createMemo(() => bare(segment().text) !== bare(summaryOf(segment().text)));
      return <Step icon={thought() ? <Icons.Thinking /> : <Icons.Message />} summary={summary} discarded={segment().discarded} motion={motion()} opens={more()} open={fold.open()} onToggle={fold.toggle} find={() => segment().text}>
        <StepProse><Suspense fallback={<div class="markdown-skeleton" />}><ChatMarkdown streaming={Boolean(segment().live)} onRendered={props.onRendered}>{segment().text}</ChatMarkdown></Suspense></StepProse>
      </Step>;
    }}</Match>
    <Match when={props.item.type === "error" && props.item}>{(item) => <LibraryTraceError time={fullDateTime(item().message.timestamp) || undefined}
      facts={[item().message.model && `Model: ${item().message.model}`, item().message.provider && `Provider: ${item().message.provider}`, props.profileLabel && `Profile: ${props.profileLabel}`].filter(Boolean) as string[]}
      message={item().message.errorMessage || "The model request failed."} />}</Match>
    <Match when={props.item.type === "tool" && props.item}>{(item) => { const fold = useFold(() => item().tool.toolCallId, props);
      return <ToolStep tool={item().tool} settled={props.settled} open={fold.open()} onToggle={fold.toggle} motion={motion()} />; }}</Match>
    <Match when={props.item.type === "hidden"}><Step note icon={<Icons.Thinking />} summary="Reasoning not shared by the provider" motion={motion()} /></Match>
    <Match when={props.item.type === "group" && props.item}>{(item) => {
      const tools = () => (item() as Extract<TrailItem, { type: "group" }>).tools, kind = () => (item() as Extract<TrailItem, { type: "group" }>).kind;
      const fold = useFold(() => `group:${tools()[0]!.toolCallId}`, props);
      return <Step icon={<Dynamic component={KIND_ICONS[kind()]} />} verb={GROUP_WORDS[kind()](tools().length)} state={!props.settled && tools().some((tool) => !tool.done) ? "running" : undefined}
        time={stepDuration(tools()[0]!.timestamp, tools().at(-1)!.completedAt) || undefined} motion={motion()} opens open={fold.open()} onToggle={fold.toggle}
        find={() => tools().map((tool) => `${toolStepLine(tool)}\n${toolStepBody(tool)}`).join("\n")}>
        <Trail nested="group"><Index each={tools()}>{(tool) => { const inner = useFold(() => tool().toolCallId, props);
          return <ToolStep tool={tool()} settled={props.settled} open={inner.open()} onToggle={inner.toggle} />; }}</Index></Trail>
      </Step>;
    }}</Match>
  </Switch>;
}
const LATEST_CHARS = 240;
export function TurnTrace(props: { trace: TurnTraceData; loadContext?: (entryId: number) => Promise<ContextText>; agents?: AgentSummary[]; onStopAgent?: (id: string) => void; writing?: boolean; profileLabel?: string; initialOpen?: boolean; onOpenChange?: (open: boolean) => void; toolOpen?: (id: string) => boolean; onToolOpenChange?: (id: string, open: boolean) => void; onRendered?: () => void; since?: number;
  onOpen?: () => void;
  narrated?: boolean;
  form?: "steps" | "header" | "hidden";
  turn?: boolean; opens?: boolean;
  actor?: string }) {
  const preview = createMemo(() => previewOf(props.trace, Boolean(props.writing)));
  const time = turnTime(() => props.trace);
  const unfinished = () => !props.trace.active && (props.trace.status === "failed" || props.trace.status === "interrupted");
  const [open, setOpen] = createSignal(Boolean(props.initialOpen));
  const drawn = createMemo(() => new Set((props.agents ?? []).flatMap((agent) => agent.via ? [agent.via] : [])));
  const trail = createMemo(() => trailOf(props.trace.segments, drawn()));
  const spawns = createMemo(() => props.trace.segments.flatMap((segment) => segment.kind === "tool" && spawned(segment.tool) ? [segment.tool] : []));
  const scripts = createMemo(() => props.trace.segments.flatMap((segment) => segment.kind === "tool" && segment.tool.kind === "script" ? [segment.tool.toolCallId] : []));
  let opened = 0;
  // One renderer for the line, its text growing in place: a new one each delta draws a blank frame between them.
  // It is given no more than a line's worth: a long sentence's whole text would be laid out and painted every frame.
  const text = () => { const full = preview().detail?.text ?? ""; return full.length > LATEST_CHARS ? `${full.slice(0, LATEST_CHARS)}\u2026` : full; };
  const thinking = <Suspense fallback={text()}><ChatMarkdown inline>{text() || "…"}</ChatMarkdown></Suspense>;
  const latest = () => { const detail = preview().detail; return detail ? detail.markdown ? thinking : detail.text : undefined; };
  // A settled run says what it did, never Done: that is how a whole turn ended.
  const narrated = () => Boolean(props.narrated);
  const single = () => narrated() && trail().filter((item) => item.type !== "text" && item.type !== "hidden" && item.type !== "context").length <= 1;
  const settledRun = () => narrated() && !props.trace.active && !unfinished();
  const capital = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);
  const onlyContext = () => props.trace.segments.length > 0 && props.trace.segments.every((segment) => segment.kind === "context");
  const form = () => props.form ?? "steps";
  const acting = () => Boolean(props.actor);
  const done = createMemo(() => props.actor && !props.trace.active ? digestDone(props.trace, true) : "");
  const actorStatus = () => props.trace.active ? `${props.actor} is ${actorPhrase(props.trace, Boolean(props.writing))}`
    : props.trace.status === "interrupted" ? `${props.actor} was interrupted` : props.trace.status === "failed" ? `${props.actor} failed`
    : done() ? `${props.actor} ${done()}` : time() ? `${props.actor} worked for ${time()}` : `${props.actor} worked`;
  const agentsRow = () => <TurnAgents tools={spawns()} scripts={scripts()} agents={props.agents ?? []} onStop={props.onStopAgent} />;
  if (narrated()) return <Show when={!onlyContext()} fallback={<Trail><Index each={trail()}>{(item) =>
      <TrailLine item={item()} arriving={props.trace.active} settled={!props.trace.active} profileLabel={props.profileLabel} loadContext={props.loadContext} toolOpen={props.toolOpen} onToolOpenChange={props.onToolOpenChange} onRendered={props.onRendered} />}</Index></Trail>}>
    <Switch>
      <Match when={form() === "hidden"}>{props.turn ? null : agentsRow()}</Match>
      <Match when={form() === "header"}>
        <Trace motion={props.since != null ? "entering" : undefined} since={props.since}
          status={settledRun() ? capital(preview().work) || "Thought" : preview().status.verb} time={time() || undefined}
          work={settledRun() ? undefined : preview().work || undefined} latest={props.turn || settledRun() ? undefined : latest()} live={props.trace.active && !props.turn}
          tone={unfinished() ? "failed" : undefined} pinned={props.turn ? undefined : agentsRow()}
          opens={Boolean(props.opens) && trail().length > 0} open={open()} onToggle={() => { const next = !open(); setOpen(next); props.onOpenChange?.(next); }}
          find={() => trail().map(trailText).join("\n")}>
          <Trail><Index each={trail()}>{(item) =>
            <TrailLine item={item()} arriving={props.trace.active} settled={!props.trace.active} profileLabel={props.profileLabel} loadContext={props.loadContext} toolOpen={props.toolOpen} onToolOpenChange={props.onToolOpenChange} onRendered={props.onRendered} />}</Index></Trail>
        </Trace>
      </Match>
      <Match when={true}>
        {agentsRow()}
        <Trail><Index each={trail()}>{(item) =>
          <TrailLine item={item()} arriving={props.trace.active} settled={!props.trace.active} profileLabel={props.profileLabel} loadContext={props.loadContext} toolOpen={props.toolOpen} onToolOpenChange={props.onToolOpenChange} onRendered={props.onRendered} />}</Index></Trail>
      </Match>
    </Switch>
  </Show>;
  return <Show when={!single() && !onlyContext()} fallback={<>
      <TurnAgents tools={spawns()} scripts={scripts()} agents={props.agents ?? []} onStop={props.onStopAgent} />
      <Trail><Index each={trail()}>{(item) =>
        <TrailLine item={item()} arriving={props.trace.active} settled={!props.trace.active} profileLabel={props.profileLabel} loadContext={props.loadContext} toolOpen={props.toolOpen} onToolOpenChange={props.onToolOpenChange} onRendered={props.onRendered} />}</Index></Trail>
    </>}>
    <Trace motion={props.since != null ? "entering" : undefined} since={props.since} orb={narrated() ? undefined : <Orb state={preview().status.orb} frame={preview().status.frame} tint={unfinished() ? "var(--destructive)" : undefined} rate={props.trace.active ? undefined : settledOrbRate(unfinished())} />}
      status={settledRun() ? capital(preview().work) || "Thought" : acting() ? actorStatus() : preview().status.verb}
      time={acting() && !props.trace.active && !unfinished() && !done() ? undefined : time() || undefined}
      work={acting() ? (unfinished() && done() ? done() : undefined) : settledRun() ? undefined : preview().work || undefined}
      latest={props.onOpen || settledRun() ? undefined : latest()} live={!props.onOpen && props.trace.active} tone={unfinished() ? "failed" : undefined}
      pinned={props.onOpen ? undefined : <TurnAgents tools={spawns()} scripts={scripts()} agents={props.agents ?? []} onStop={props.onStopAgent} />}
      opens={!props.onOpen && trail().length > 0} open={open()} goes={Boolean(props.onOpen)} onToggle={props.onOpen ?? (() => { const next = !open(); setOpen(next); props.onOpenChange?.(next); })}
      find={() => trail().map(trailText).join("\n")}>
      {(() => { opened = trail().length; return <Trail><Index each={trail()}>{(item, index) =>
        <TrailLine item={item()} arriving={index >= opened} settled={!props.trace.active} profileLabel={props.profileLabel} loadContext={props.loadContext} toolOpen={props.toolOpen} onToolOpenChange={props.onToolOpenChange} onRendered={props.onRendered} />}</Index></Trail>; })()}
    </Trace></Show>;
}

/* The trace takes its place when its first step arrives, in the same spot, at the same height. */
export function TraceStarting(props: { startedAt?: string; label?: string; since?: number; narrated?: boolean; line?: boolean; thinking?: boolean }) {
  const time = turnTime(() => ({ active: true, startedAt: props.startedAt }));
  if (props.narrated) return <Trail><Step state="running" verb={props.label || "Starting"} time={time() || undefined} motion={props.since != null ? "entering" : undefined} /></Trail>;
  return <Trace motion={props.since != null ? "entering" : undefined} since={props.since} orb={<Orb state={props.thinking ? "working" : "connecting"} />} status={props.label || "Starting"} time={time() || undefined} live={!props.line} />;
}
