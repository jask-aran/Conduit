import { textBlockClassifications } from "../active-generation.js";
import type { Message, ToolItem, ToolKind } from "./api/contracts";

type LiveBlock = {
  kind: "thinking" | "narration" | "text" | "tool_call";
  identity: string;
  contentIndex: number;
  text?: string;
  toolCallId?: string;
  name?: string;
  toolKind?: ToolKind;
  subject?: string;
  redacted?: boolean;
  input?: unknown;
  status?: string;
};

export interface ActiveGenerationView {
  id: string;
  status: string;
  lastSeq: number;
  assistantMessages: Array<{
    id: string;
    stopReason?: string | null;
    errorMessage?: string | null;
    provider?: string | null;
    model?: string | null;
    timestamp?: string | null;
    blocks: LiveBlock[];
  }>;
  toolExecutions: Record<string, {
    toolCallId?: string;
    name?: string;
    kind?: ToolKind;
    subject?: string;
    timestamp?: string;
    completedAt?: string;
    input?: unknown;
    output?: unknown;
    status?: string;
    isError?: boolean;
  }>;
}

export type LiveGenerationChangeScope = "block" | "tool" | "structural";

export interface LiveGenerationChange {
  generationId: string;
  eventType: string;
  scope: LiveGenerationChangeScope;
  messageId?: string;
  contentIndex?: number;
  toolCallId?: string;
}

export type TraceSegment =
  // `discarded`: the harness does not carry this text into the next request. It is struck through, not collapsed:
  // it is already behind the rollup, and hiding it twice would lose it.
  // `hidden`: reasoning the provider kept to itself, with no text to show.
  | { kind: "thinking"; id: string; text: string; live?: boolean; discarded?: boolean; hidden?: boolean }
  | { kind: "narration"; id: string; text: string; live?: boolean; discarded?: boolean }
  | { kind: "error"; id: string; message: Message }
  | { kind: "context"; id: string; message: Message }
  | { kind: "tool"; id: string; tool: ToolItem };

export interface TurnTraceData {
  active: boolean;
  status: "thinking" | "executing_tool" | "interrupted" | "complete" | "failed";
  segments: TraceSegment[];
  startedAt?: string;
  endedAt?: string;
}

export type TurnRow =
  // precedingUserId is carried on the row: looking it up per row is a backwards scan per assistant row, quadratic in
  // a long chat. `traced` lets a stopped turn say "Interrupted" once, on whichever row comes first.
  | { key: string; type: "message"; value: Message; live?: boolean; streamVersion?: number; displayKey?: string; precedingUserId?: string; traced?: boolean; orb?: TurnOrbState }
  // `afterAnswer`: the answer before it carries the turn's foot, so this row has none.
  | { key: string; type: "trace"; value: TurnTraceData; precedingUserId?: string; answerless?: boolean; unstated?: boolean; timestamp?: string; orb?: TurnOrbState; continues?: boolean; afterAnswer?: boolean; goesOn?: boolean }
  | { key: string; type: "pending"; value: null; precedingUserId?: string; startedAt?: string; leaving?: boolean }
  | { key: string; type: "sent"; value: ToolItem; precedingUserId?: string }
  | { key: string; type: "reports"; value: Message[] }
  // The turn header holds no work of its own: the transcript reads its turn's runs from the rows above it.
  | { key: string; type: "turn"; value: { runs: number }; precedingUserId?: string; leaving?: boolean };

function liftScriptMessages(segment: TraceSegment): { segment: TraceSegment | null; messages: ToolItem[] } {
  if (segment.kind !== "tool" || segment.tool.kind !== "script" || !segment.tool.calls?.some((call) => call.kind === "message" && !call.planned)) return { segment, messages: [] };
  const script = segment.tool;
  const messages = script.calls!.flatMap((call, index): ToolItem[] => call.kind === "message" && !call.planned ? [{
    toolCallId: `${script.toolCallId}/${index}`, name: call.name, kind: "message", input: call.input, subject: call.subject,
    done: call.done !== false, isError: call.isError, timestamp: script.timestamp, completedAt: script.completedAt } as ToolItem] : []);
  const calls = script.calls!.filter((call) => !(call.kind === "message" && !call.planned));
  const alone = !calls.some((call) => !call.earlier) && script.done !== false && !script.isError;
  return { segment: alone ? null : { ...segment, tool: { ...script, calls } }, messages };
}

function splitSent(rows: TurnRow[], show: boolean): TurnRow[] {
  const sent: TurnRow[] = [];
  const out = rows.flatMap((row): TurnRow[] => {
    if (row.type !== "trace") return [row];
    const lifted = row.value.segments.map(liftScriptMessages);
    const messages = [...lifted.flatMap((item) => item.segment?.kind === "tool" && item.segment.tool.kind === "message" ? [item.segment.tool] : []),
      ...lifted.flatMap((item) => item.messages)];
    if (!messages.length) return [row];
    const segments = lifted.flatMap((item) => item.segment ? [item.segment] : []).filter((segment) => !(segment.kind === "tool" && segment.tool.kind === "message"));
    const own = messages.map((tool): TurnRow => ({ key: `sent:${tool.toolCallId}`, type: "sent", value: tool, precedingUserId: row.precedingUserId }));
    const kept = segments.length || row.value.active ? [{ ...row, value: { ...row.value, segments } }] : [];
    if (show) return [...kept, ...own];
    sent.push(...own);
    return kept;
  });
  return [...out, ...sent];
}

export type TurnOrbState = "live" | "settled" | "failed";
/** Commentary is no answer: a turn a report cut off as it talked ends on its trace. */
function placeTurnOrb(rows: TurnRow[], state: TurnOrbState) {
  const own = (row: TurnRow) => row.type === "trace" || (row.type === "message" && row.value.role !== "user");
  const answer = (row: TurnRow) => row.type === "message" && row.value.role !== "user" && row.value.interim !== true;
  const index = state === "live" ? rows.findLastIndex(own)
    : rows.findLastIndex(answer) >= 0 ? rows.findLastIndex(answer) : rows.findLastIndex(own);
  const row = rows[index];
  if (row && (row.type === "trace" || row.type === "message")) rows[index] = { ...row, orb: state };
  const first = rows.findIndex(own);
  const answered = state !== "live" && row?.type === "message" ? index : -1;
  return rows.map((item, at) => item.type === "trace" && at > first
    ? { ...item, continues: true, ...(answered >= 0 && at > answered ? { afterAnswer: true } : {}) } : item);
}

interface PersistedTurn {
  userMessage: Message | null;
  assistants: Message[];
}

export interface PersistedTurnProjection {
  key: string;
  userMessage: Message | null;
  assistants: Message[];
  /** What the rows were built from, so an unchanged turn can keep them. */
  sourceTools: ToolItem[];
  rows: TurnRow[];
}

const thinkingOf = (message: Message): string => (message.blocks || [])
  .filter((block) => block.kind === "thinking")
  .map((block) => block.text || "")
  .join("\n")
  .trim();

const toolCallIdsOf = (message: Message): string[] => (message.blocks || [])
  .filter((block) => block.kind === "tool_call" && typeof block.toolCallId === "string")
  .map((block) => block.toolCallId as string);

// Narrated rows are keyed apart from folded ones: a turn's first answer is its final answer folded and its first
// narration shown, and a row kept across a layout change kept its other self's drawn Markdown.
const answerDisplayKey = (owner: Message | null, answerIndex: number, fallback: string, show: boolean) =>
  `${show ? "said" : "answer"}:${owner ? owner.id : fallback}:${answerIndex}`;
const active = (generation: ActiveGenerationView) => !["stopped", "complete", "failed"].includes(generation.status);

/** Live and settled rows share keys (`trace:<owner>`, `trace:<owner>:<n>`, `answer:<owner>:<n>`) so a turn settles in place. */
export type Narration = "fold" | "show";
export type TurnLayout = { narration?: Narration };
const traceGroupKey = (base: string, group: number) => group === 0 ? `trace:${base}` : `trace:${base}:${group}`;

export type LiveBlockLocation =
  | { kind: "trace"; rowKey: string; segmentIndex: number }
  | { kind: "answer"; rowKey: string; assistantId: string };

export interface LiveProjectionIndex {
  generationId: string;
  traceRowKey: string | null;
  blockLocations: Map<string, LiveBlockLocation>;
  toolLocations: Map<string, { rowKey: string; segmentIndex: number }>;
  answerBlockIdentities: Map<string, Set<string>>;
  answerRowKeys: Map<string, string>;
}

const lastPromptIndex = (messages: Message[]) => {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]!;
    if (message.role === "user" && !message.pending) return index;
  }
  return -1;
};
/**
 * No fallback: a harness that stated neither field would draw a plausible transcript until an answered turn was
 * steered, then silently fold that answer into a trace. It fails loudly on its first turn instead.
 */
const stateless = (message: Message, field: string): never => {
  throw new Error(`transcript contract: assistant message ${message.id} did not state \`${field}\`. A backend must state \`answers\` when it opens a message and \`interim\` when it closes one.`);
};
const statedInterim = (message: Message): boolean =>
  (typeof message.interim === "boolean" ? message.interim : stateless(message, "interim"));
const statedAnswers = (message: Message): string | null =>
  (message.answers !== undefined ? message.answers : stateless(message, "answers"));

/**
 * A steered message makes one generation answer two prompts. What answered the first is closed, so it is drawn as
 * stated, as a reload draws it; only what answers the latest prompt is drawn from paint.
 */
export function currentSegment(generation: ActiveGenerationView, messages: Message[]): ActiveGenerationView {
  if (!generation.assistantMessages.length) return generation;
  const rows = new Map(messages.map((message) => [message.id, message]));
  const ownerOf = (id: string) => { const row = rows.get(id); return row ? statedAnswers(row) : undefined; };
  const latest = generation.assistantMessages.map((assistant) => ownerOf(assistant.id)).findLast((owner) => owner != null);
  if (latest == null) return generation;
  // Once the latest answer's turn has said how it ended, a later prompt is the one being answered, though nothing
  // answers it yet.
  const ownerIndex = messages.findIndex((message) => message.id === latest);
  const moved = ownerIndex >= 0 && lastPromptIndex(messages) > ownerIndex && Boolean(messages[ownerIndex]!.outcome)
    // An answer still arriving is drawn from paint until it closes.
    && !generation.assistantMessages.some((assistant) => rows.get(assistant.id)?.streaming);
  const kept = generation.assistantMessages.filter((assistant) => {
    const owner = ownerOf(assistant.id);
    return owner == null || (!moved && owner === latest);
  });
  return kept.length === generation.assistantMessages.length ? generation : { ...generation, assistantMessages: kept };
}

const liveOwnerIndex = (messages: Message[], generation?: ActiveGenerationView | null) => {
  const live = new Set((generation?.assistantMessages || []).map((message) => message.id));
  const answerIndex = live.size
    ? messages.findIndex((message) => live.has(message.id))
    : -1;
  if (answerIndex < 0) return lastPromptIndex(messages);
  const stated = statedAnswers(messages[answerIndex]!);
  return stated ? messages.findIndex((message) => message.id === stated) : -1;
};
const liveOwner = (messages: Message[], generation: ActiveGenerationView) => {
  const index = liveOwnerIndex(messages, generation);
  return index < 0 ? null : messages[index]!;
};

const says = (block: { kind: string; identity: string }, classifications: Record<string, "interim" | "answer">, show: boolean) =>
  show ? block.kind === "text" || block.kind === "narration" : block.kind === "text" && classifications[block.identity] === "answer";

/** The runtime writes the system prompt after the prompt that started the thread, but the thread begins from it. */
export function openingPrompt(messages: Message[]): Message | null {
  for (const message of messages) {
    if (message.role === "assistant") return null;
    if (message.role === "system" && message.context?.kind === "prompt") return message;
  }
  return null;
}

/**
 * pi-durable writes a prompt after the prompt that started the request but sends it first (leadWithSystem), so a
 * prompt resent after a compaction is read before the summary and is drawn just before it, in the summary's turn.
 */
function readingOrder(messages: Message[]): { ordered: Message[]; answers: Map<Message, string | null> } {
  const answers = new Map<Message, string | null>();
  if (!messages.some((message) => message.context?.resent)) return { ordered: messages, answers };
  const ordered: Message[] = [];
  for (const message of messages) {
    const summary = message.context?.resent ? ordered.findLast((item) => item.context?.kind === "compaction") : undefined;
    if (!summary) { ordered.push(message); continue; }
    ordered.splice(ordered.indexOf(summary), 0, message);
    answers.set(message, summary.answers ?? null);
  }
  return { ordered, answers };
}

function liveContexts(messages: Message[], generation: ActiveGenerationView, owner: Message | null): Map<string | null, Message[]> {
  const slots = new Map<string | null, Message[]>();
  const assistants = new Set(generation.assistantMessages.map((message) => message.id));
  let start = 0;
  if (!owner) {
    // Earlier settled preamble requests keep their context in the persisted history.
    const firstLive = messages.findIndex((message) => assistants.has(message.id));
    for (let at = 0; at < (firstLive < 0 ? messages.length : firstLive); at += 1) {
      if (messages[at]!.role === "assistant" && !messages[at]!.streaming) start = at + 1;
    }
  }
  let pending: Message[] = [];
  const opening = openingPrompt(messages);
  for (const message of messages.slice(start)) {
    if (message.role === "system" && message.context && message !== opening && !message.context.resent && message.answers === (owner?.id ?? null)) pending.push(message);
    if (assistants.delete(message.id) && pending.length) { slots.set(message.id, pending); pending = []; }
  }
  // Paint can arrive before its message.open; those blocks follow the context already received.
  if (pending.length) slots.set(generation.assistantMessages.find((message) => assistants.has(message.id))?.id ?? null, pending);
  return slots;
}

export function buildLiveProjectionIndex(
  wholeGeneration: ActiveGenerationView,
  messages: Message[],
  layout: TurnLayout = {},
): LiveProjectionIndex {
  const show = layout.narration === "show";
  const generation = currentSegment(wholeGeneration, messages);
  const classifications = textBlockClassifications(generation) as Record<string, "interim" | "answer">;
  const owner = liveOwner(messages, generation);
  const contexts = liveContexts(messages, generation, owner);
  const base = owner ? owner.id : `live:${generation.id}`;
  const blockLocations = new Map<string, LiveBlockLocation>();
  const toolLocations = new Map<string, { rowKey: string; segmentIndex: number }>();
  const answerBlockIdentities = new Map<string, Set<string>>();
  const answerRowKeys = new Map<string, string>();
  let group = 0;
  let answers = 0;
  let segmentIndex = 0;
  for (const assistant of generation.assistantMessages) {
    segmentIndex += contexts.get(assistant.id)?.length || 0;
    const said = assistant.blocks.filter((block) => says(block, classifications, show));
    let answered = false;
    const answer = () => {
      if (answered || !said.length) return;
      answered = true;
      const rowKey = answerDisplayKey(owner, answers, `live:${generation.id}`, show);
      answerRowKeys.set(assistant.id, rowKey);
      answerBlockIdentities.set(assistant.id, new Set(said.map((block) => block.identity)));
      for (const block of said) blockLocations.set(block.identity, { kind: "answer", rowKey, assistantId: assistant.id });
      answers += 1;
      if (show) { group += 1; segmentIndex = 0; }
    };
    for (const block of assistant.blocks) {
      if (said.includes(block)) { if (show) answer(); continue; }
      const rowKey = traceGroupKey(base, group);
      blockLocations.set(block.identity, { kind: "trace", rowKey, segmentIndex });
      if (block.kind === "tool_call") toolLocations.set(block.toolCallId || block.identity, { rowKey, segmentIndex });
      segmentIndex += 1;
    }
    if (assistant.stopReason === "error" && (!show || generation.assistantMessages.at(-1) !== assistant)) segmentIndex += 1;
    answer();
  }
  segmentIndex += contexts.get(null)?.length || 0;
  return { generationId: generation.id, traceRowKey: segmentIndex ? traceGroupKey(base, group) : null, blockLocations, toolLocations,
    answerBlockIdentities, answerRowKeys };
}

export function buildLiveAnswerRow(
  generation: ActiveGenerationView,
  assistantId: string,
  index: LiveProjectionIndex,
  precedingUserId?: string,
): Extract<TurnRow, { type: "message" }> | null {
  const assistant = generation.assistantMessages.find((message) => message.id === assistantId);
  const answerIdentities = index.answerBlockIdentities.get(assistantId);
  if (!assistant || !answerIdentities) return null;
  const said = assistant.blocks.filter((block) => block.kind === "text" && answerIdentities.has(block.identity));
  const answer = said.map((block) => block.text || "").join("\n");
  const terminalError = generation.status === "failed"
    && assistant.stopReason === "error"
    && generation.assistantMessages.at(-1) === assistant;
  if (!answer && !terminalError) return null;
  const content = answer;
  return {
    key: index.answerRowKeys.get(assistantId) || `message:live:${generation.id}:${assistantId}`,
    displayKey: index.answerRowKeys.get(assistantId),
    type: "message",
    live: active(generation),
    streamVersion: generation.lastSeq,
    precedingUserId,
    value: liveAnswerMessage(generation, assistant, content, terminalError, interimText(said, textBlockClassifications(generation) as Record<string, "interim" | "answer">)),
  };
}

/** Live text the rule already calls commentary (textBlockClassifications) is interim now, as it will be saved: its row
 *  keeps the room it will settle with. */
const interimText = (said: { identity: string }[], classifications: Record<string, "interim" | "answer">) =>
  said.length > 0 && said.every((block) => classifications[block.identity] === "interim");
function liveAnswerMessage(generation: ActiveGenerationView, assistant: ActiveGenerationView["assistantMessages"][number], content: string, terminalError: boolean, interim = false) {
  return {
    ...(interim ? { interim: true } : {}),
    id: `live:${generation.id}:${assistant.id}`,
    role: "assistant",
    content,
    stopReason: assistant.stopReason || undefined,
    errorMessage: terminalError ? assistant.errorMessage || "The model request failed." : null,
    provider: assistant.provider || null,
    model: assistant.model || null,
    timestamp: assistant.timestamp || undefined,
    stopped: generation.status === "stopped",
    status: generation.status === "stopped" ? "stopped" : null,
  } satisfies Message;
}

export function buildLiveToolSegment(
  generation: ActiveGenerationView,
  block: LiveBlock,
  tools: ToolItem[] = [],
): Extract<TraceSegment, { kind: "tool" }> {
  const execution = generation.toolExecutions[block.toolCallId || ""] || {};
  const toolCallId = block.toolCallId || block.identity;
  const held = tools.find((tool) => tool.toolCallId === toolCallId);
  return {
    kind: "tool",
    id: `tool:${toolCallId}`,
    tool: buildLiveToolItem(toolCallId, execution, { name: block.name, kind: block.toolKind, subject: held?.agent ? held.subject : block.subject, input: block.input,
      calls: held?.calls, agent: held?.agent, facts: held?.facts }),
  };
}

function buildLiveErrorSegment(
  assistant: ActiveGenerationView["assistantMessages"][number],
): Extract<TraceSegment, { kind: "error" }> {
  return {
    kind: "error",
    id: `error:${assistant.id}`,
    message: {
      id: assistant.id,
      role: "assistant",
      content: "",
      stopReason: "error",
      errorMessage: assistant.errorMessage || "The model request failed.",
      provider: assistant.provider || null,
      model: assistant.model || null,
      timestamp: assistant.timestamp || undefined,
    },
  };
}

export function buildLiveToolItem(
  toolCallId: string,
  execution: ActiveGenerationView["toolExecutions"][string] = {},
  fallback: { name?: string; kind?: ToolKind; subject?: string; input?: unknown; calls?: ToolItem["calls"]; agent?: ToolItem["agent"]; facts?: ToolItem["facts"] } = {},
): ToolItem {
  return {
    // A script's calls and a subagent's reference are stated as transcript ops, not generation events.
    ...(fallback.calls ? { calls: fallback.calls } : {}),
    ...(fallback.agent ? { agent: fallback.agent } : {}),
    ...(fallback.facts ? { facts: fallback.facts } : {}),
    toolCallId,
    name: execution.name || fallback.name || "tool",
    kind: execution.kind || fallback.kind || "other",
    ...(execution.subject || fallback.subject ? { subject: execution.subject || fallback.subject } : {}),
    ...(execution.timestamp ? { timestamp: execution.timestamp } : {}),
    ...(execution.completedAt ? { completedAt: execution.completedAt } : {}),
    input: execution.input ?? fallback.input,
    output: execution.output,
    done: execution.status === "complete" || execution.status === "error" || execution.status === "cancelled",
    isError: Boolean(execution.isError || execution.status === "error"),
    cancelled: execution.status === "cancelled",
  };
}

// A trace's time from the start of the message after it: reasoning in the message that then speaks has no end of its
// own, and its few milliseconds are not how long it thought -- so it says no time.
const spanTime = (startedAt?: string | null, endedAt?: string | null) =>
  startedAt && endedAt && Date.parse(endedAt) - Date.parse(startedAt) < 1000 ? {} : turnTime(startedAt, endedAt);
const workTime = (segments: TraceSegment[], since: string | null | undefined, end: string | null | undefined, live: boolean) => {
  const tools = segments.flatMap((segment) => segment.kind === "tool" ? [segment.tool] : []);
  const start = tools[0]?.timestamp || since;
  if (live) return turnTime(start, undefined);
  // Reasoning alone ends in the message that then speaks, whose start is all a settled turn knows: no time to give.
  if (!tools.length) return {};
  const ends = tools.map((tool) => tool.completedAt);
  const finished = ends.length && ends.every(Boolean) ? (ends as string[]).sort().at(-1) : undefined;
  return spanTime(start, finished || end);
};
const turnTime = (startedAt?: string | null, endedAt?: string | null) => ({
  ...(startedAt ? { startedAt } : {}),
  ...(endedAt ? { endedAt } : {}),
});

function liveRows(generation: ActiveGenerationView, owner: Message | null, tools: ToolItem[], show: boolean, messages: Message[]): TurnRow[] {
  const classifications = textBlockClassifications(generation) as Record<string, "interim" | "answer">;
  const base = owner ? owner.id : `live:${generation.id}`;
  const running = active(generation);
  const contexts = liveContexts(messages, generation, owner);
  const rows: TurnRow[] = [];
  const answers: TurnRow[] = [];
  let segments: TraceSegment[] = [];
  let group = 0;
  let count = 0;
  let since = owner?.timestamp;
  const trace = (last: boolean, answerless = last, end?: string) => {
    const latestTool = segments.findLast((segment) => segment.kind === "tool");
    const executingTool = running && latestTool?.kind === "tool" && latestTool.tool.done === false;
    const status = !last ? "complete" : generation.status === "stopped" ? "interrupted" : generation.status === "failed" ? "failed"
      : generation.status === "complete" ? "complete" : executingTool ? "executing_tool" : "thinking";
    rows.push({ key: traceGroupKey(base, group), type: "trace", value: { active: last && running, status, segments,
      ...(show ? workTime(segments, since, end || (last && !running ? owner?.timing?.endedAt || generation.assistantMessages.at(-1)?.timestamp : undefined), last && running)
        : turnTime(owner?.timestamp, last && running ? undefined : owner?.timing?.endedAt || generation.assistantMessages.at(-1)?.timestamp)) },
      precedingUserId: owner?.id, answerless, timestamp: generation.assistantMessages.at(-1)?.timestamp || undefined });
  };
  for (const assistant of generation.assistantMessages) {
    for (const message of contexts.get(assistant.id) || []) segments.push({ kind: "context", id: message.id, message });
    const said = assistant.blocks.filter((block) => says(block, classifications, show));
    const text = said.map((block) => block.text || "").join("\n");
    const terminalError = generation.status === "failed" && assistant.stopReason === "error" && generation.assistantMessages.at(-1) === assistant;
    let answered = false;
    const answer = () => {
      if (answered || !(text || terminalError)) return;
      answered = true;
      const content = text;
      const key = answerDisplayKey(owner, count, `live:${generation.id}`, show);
      const row = (traced: boolean): TurnRow => ({ key, displayKey: key, type: "message", traced, live: running,
        streamVersion: generation.lastSeq, precedingUserId: owner?.id, value: liveAnswerMessage(generation, assistant, content, terminalError, interimText(said, classifications)) });
      count += 1;
      if (!show) { answers.push(row(true)); return; }
      // Only work is a trace: text said first stands alone, an empty header over it said nothing.
      if (segments.length) trace(false, false, assistant.timestamp ?? undefined);
      rows.push(row(rows.some((item) => item.type === "trace")));
      group += 1; segments = []; since = assistant.timestamp ?? undefined;
    };
    for (const block of assistant.blocks) {
      if (said.includes(block)) { if (show) answer(); }
      else if (block.kind === "thinking") {
        segments.push({ kind: "thinking", id: block.identity, text: block.text || "", live: block.status === "streaming",
          ...(block.redacted && !block.text ? { hidden: true } : {}) });
      } else if (block.kind === "tool_call") segments.push(buildLiveToolSegment(generation, block, tools));
      else segments.push({ kind: "narration", id: block.identity, text: block.text || "", live: block.status === "streaming" });
    }
    // Only an error the turn moved past belongs in a trace: the last message is either the turn's own failure, drawn as
    // its answer, or one backend is still retrying -- and a retry in flight is not a failed request.
    if (assistant.stopReason === "error" && generation.assistantMessages.at(-1) !== assistant) segments.push(buildLiveErrorSegment(assistant));
    answer();
  }
  for (const message of contexts.get(null) || []) segments.push({ kind: "context", id: message.id, message });
  // Every turn that has shown anything has its trace: one with no thinking and no tools is its header alone -- the orb,
  // what it is doing, the time. One stopped or failed before it showed anything is that header too, as the saved turn is.
  const endedEarly = generation.status === "stopped" || generation.status === "failed";
  if (!show) {
    if (segments.length || answers.length || endedEarly) trace(true, answers.length === 0);
    rows.push(...answers);
  } else if (segments.length || (endedEarly && !rows.length)) trace(true);
  else {
    const index = rows.findLastIndex((row) => row.type === "trace");
    const last = rows[index];
    // While it talks the text is where it works: the trace before it stays settled, not "Writing".
    if (last?.type === "trace" && endedEarly) {
      rows[index] = { ...last, value: { ...last.value, status: generation.status === "stopped" ? "interrupted" : "failed" } };
    }
  }
  // Held only until something of the turn shows: its trace, once it has one, is what says it is working.
  if (!rows.length && running && generation.status !== "stopping") {
    rows.push({ key: `pending:${owner ? owner.id : generation.id}`, type: "pending", value: null, precedingUserId: owner?.id,
      ...(owner?.timestamp ? { startedAt: owner.timestamp } : {}) });
  }
  return placeTurnOrb(splitSent(rows, show), running ? "live" : endedEarly ? "failed" : "settled");
}

export function projectLiveTurn(
  persistedRows: TurnRow[],
  messages: Message[],
  wholeGeneration: ActiveGenerationView,
  tools: ToolItem[] = [],
  layout: TurnLayout = {},
): TurnRow[] {
  const generation = currentSegment(wholeGeneration, messages);
  const owner = liveOwner(messages, generation);
  const show = layout.narration === "show";
  const live = (generation: ActiveGenerationView, owner: Message | null, tools: ToolItem[]) => liveRows(generation, owner, tools, show, messages);
  if (!owner) {
    const contexts = new Set([...liveContexts(messages, generation, null).values()].flat().map((message) => message.id));
    const history = persistedRows.flatMap((row): TurnRow[] => {
      if (row.type !== "trace") return [row];
      const segments = row.value.segments.filter((segment) => segment.kind !== "context" || !contexts.has(segment.id));
      if (segments.length === row.value.segments.length) return [row];
      return segments.length ? [{ ...row, value: { ...row.value, segments } }] : [];
    });
    return [...history, ...live(generation, null, tools)];
  }
  const ownerRow = persistedRows.findIndex((row) => row.key === `message:${owner.id}`);
  if (ownerRow < 0) return [...persistedRows, ...live(generation, owner, tools)];
  let nextTurn = ownerRow + 1;
  while (nextTurn < persistedRows.length) {
    const row = persistedRows[nextTurn]!;
    if (row.type === "message" && row.value.role === "user") break;
    nextTurn += 1;
  }
  return [
    ...persistedRows.slice(0, ownerRow + 1),
    ...live(generation, owner, tools),
    ...persistedRows.slice(nextTurn),
  ];
}

function sameSources(
  left: PersistedTurnProjection,
  right: PersistedTurn,
  sourceTools: ToolItem[],
): boolean {
  return left.userMessage === right.userMessage
    && left.assistants.length === right.assistants.length
    && left.assistants.every((message, index) => message === right.assistants[index])
    && left.sourceTools.length === sourceTools.length
    && left.sourceTools.every((tool, index) => tool === sourceTools[index]);
}

function persistedRowsForTurn(turn: PersistedTurn, toolById: Map<string, ToolItem>, show: boolean): TurnRow[] {
  const rows: TurnRow[] = [];
  const owner = turn.userMessage;
  if (owner) rows.push({ key: `message:${owner.id}`, type: "message", value: owner });
  if (!turn.assistants.length) return rows;
  const base = owner ? owner.id : turn.assistants[0]!.id;
  const finalAssistant = turn.assistants.findLast((message) => message.role === "assistant") || null;
  const outcome = owner?.outcome;
  const claimed = new Set<string>();
  let segments: TraceSegment[] = [];
  let group = 0;
  let answers = 0;
  let traced = false;
  const answering: Message[] = [];
  let since = owner?.timestamp;
  const trace = (last: boolean, answerless = last, end?: string) => {
    traced = true;
    rows.push({ key: traceGroupKey(base, group), type: "trace", value: { active: false, status: last ? outcome || "complete" : "complete", segments,
      ...(show ? workTime(segments, since, end || owner?.timing?.endedAt || finalAssistant?.timestamp, false)
        : turnTime(owner?.timestamp, owner?.timing?.endedAt || finalAssistant?.timestamp)) }, precedingUserId: owner?.id, answerless,
      timestamp: finalAssistant?.timestamp || undefined,
      ...(last && owner && !outcome && segments.length > 0 ? { unstated: true } : {}) });
  };
  for (const assistant of turn.assistants) {
    if (assistant.role === "system" && assistant.context) {
      segments.push({ kind: "context", id: assistant.id, message: assistant });
      continue;
    }
    const discarded = assistant.discarded === true;
    const failed = assistant.stopReason === "error";
    const thinking = thinkingOf(assistant);
    if (thinking) segments.push({ kind: "thinking", id: `thinking:${assistant.id}`, text: thinking, ...(discarded ? { discarded } : {}) });
    else if ((assistant.blocks || []).some((block) => block.kind === "thinking" && block.redacted)) {
      segments.push({ kind: "thinking", id: `thinking:${assistant.id}`, text: "", hidden: true });
    }
    const text = String(assistant.content || "").trim();
    // A `discarded` message is not an answer but a trace's struck-through step, so a stopped turn is one row.
    const speaks = show ? !(discarded && text) && ((Boolean(text) && !(failed && assistant !== finalAssistant)) || (failed && assistant === finalAssistant))
      : !discarded && !(failed && assistant !== finalAssistant) && !statedInterim(assistant);
    if (!speaks && text && (!show || discarded)) {
      segments.push({ kind: "narration", id: `narration:${assistant.id}`, text: String(assistant.content), ...(discarded ? { discarded } : {}) });
    } else if (speaks && !show) answering.push(assistant);
    else if (speaks) {
      if (segments.length) trace(false, false, assistant.timestamp);
      const key = answerDisplayKey(owner, answers, `message:${assistant.id}`, true);
      rows.push({ key, displayKey: key, type: "message", value: assistant, precedingUserId: owner?.id, traced });
      answers += 1; group += 1; segments = []; since = assistant.timestamp ?? since;
    }
    for (const id of toolCallIdsOf(assistant)) {
      const tool = toolById.get(id);
      if (tool && !claimed.has(id)) { claimed.add(id); segments.push({ kind: "tool", id: `tool:${id}`, tool }); }
    }
    if (failed && assistant !== finalAssistant) segments.push({ kind: "error", id: `error:${assistant.id}`, message: assistant });
  }
  const endedEarly = outcome === "interrupted" || outcome === "failed" || Boolean(finalAssistant?.stopped);
  if (!show) {
    // A turn stopped before it wrote anything still has its trace header: it says so and Regenerate hangs off it.
    const answer = answering.at(-1) || null;
    const answerText = answering.map((assistant) => String(assistant.content || "").trim()).filter(Boolean).join("\n\n");
    const hasAnswerRow = Boolean(answer && (answerText || (answer === finalAssistant && answer.stopReason === "error")));
    if (segments.length > 0 || hasAnswerRow || endedEarly) trace(true, !hasAnswerRow);
    if (hasAnswerRow && answer) {
      const displayKey = answerDisplayKey(owner, 0, `message:${answer.id}`, false);
      rows.push({ key: displayKey, displayKey, type: "message", value: answering.length === 1 ? answer : { ...answer, content: answerText },
        precedingUserId: owner?.id, traced: true });
    }
    return placeTurnOrb(splitSent(rows, show), endedEarly ? "failed" : "settled");
  }
  if (segments.length || (endedEarly && !answers)) trace(true);
  else if (outcome && outcome !== "complete") {
    const index = rows.findLastIndex((row) => row.type === "trace");
    const last = rows[index];
    if (last?.type === "trace") rows[index] = { ...last, value: { ...last.value, status: outcome } };
  }
  return placeTurnOrb(splitSent(rows, show), endedEarly ? "failed" : "settled");
}

export function projectPersistedTurns(
  messages: Message[],
  tools: ToolItem[],
  previous: PersistedTurnProjection[] = [],
  layout: TurnLayout = {},
): { rows: TurnRow[]; turns: PersistedTurnProjection[] } {
  // Prompts first, so an answer can be given to the prompt it names whether or not that prompt has been reached yet.
  const turns: PersistedTurn[] = [];
  const byPrompt = new Map<string, PersistedTurn>();
  const turnAt = new Map<Message, PersistedTurn>();
  let current: PersistedTurn = { userMessage: null, assistants: [] };
  turns.push(current);
  for (const message of messages) {
    if (message.role !== "user") { turnAt.set(message, current); continue; }
    current = { userMessage: message, assistants: [] };
    turns.push(current);
    if (message.id) byPrompt.set(message.id, current);
  }
  const opening = openingPrompt(messages);
  const reading = readingOrder(messages);
  for (const message of reading.ordered) {
    if (message === opening) { turns[0]!.assistants.push(message); continue; }
    if (message.role !== "assistant" && !(message.role === "system" && message.context)) continue;
    // An answer still arriving is drawn by the live overlay; its row only holds the place.
    if (message.streaming) continue;
    const answers = reading.answers.has(message) ? reading.answers.get(message) : message.role === "system" ? message.answers : statedAnswers(message);
    const stated = answers ? byPrompt.get(answers) : null;
    (stated || turnAt.get(message) || current).assistants.push(message);
  }

  const previousByKey = new Map(previous.map((turn) => [turn.key, turn]));
  const toolById = new Map(tools.map((tool) => [tool.toolCallId, tool]));
  const projected = turns.map((turn) => {
    const key = turn.userMessage ? `user:${turn.userMessage.id}` : "preamble";
    const sourceTools = [
      ...turn.assistants.flatMap((assistant) => toolCallIdsOf(assistant).map((id) => toolById.get(id)).filter((tool): tool is ToolItem => Boolean(tool))),
    ];
    const cached = previousByKey.get(key);
    if (cached && sameSources(cached, turn, sourceTools)) return cached;
    return {
      key,
      userMessage: turn.userMessage,
      assistants: turn.assistants,
      sourceTools,
      rows: persistedRowsForTurn(turn, toolById, layout.narration === "show"),
    };
  });
  return { rows: projected.flatMap((turn) => turn.rows), turns: projected };
}

/** A background agent's report (not a run's, which has its routine, nor a heartbeat's quiet line). */
export const isAgentReport = (message: Message) => message.role === "user" && message.origin === "harness" && Boolean(message.agent?.id)
  && !message.run && !message.sender?.routine && !message.id.startsWith("beat:");
export function groupReports(rows: TurnRow[]): TurnRow[] {
  if (!rows.some((row) => row.type === "message" && isAgentReport(row.value))) return rows;
  const out: TurnRow[] = [];
  for (const row of rows) {
    if (row.type !== "message" || !isAgentReport(row.value)) { out.push(row); continue; }
    const last = out.at(-1);
    if (last?.type === "reports") out[out.length - 1] = { ...last, value: [...last.value, row.value] };
    else {
      // Reports that reached a turn as it worked moved it on: what came before has no end of its own (no foot).
      if (last?.type === "trace") out[out.length - 1] = { ...last, goesOn: true };
      out.push({ key: `reports:${row.value.id}`, type: "reports", value: [row.value] });
    }
  }
  return out;
}

export function buildTurnRows(
  messages: Message[],
  tools: ToolItem[],
  opts: {
    activeGeneration?: ActiveGenerationView | null;
  } & TurnLayout = {},
): TurnRow[] {
  const persisted = projectPersistedTurns(messages, tools, [], opts).rows;
  const rows = groupReports(opts.activeGeneration ? projectLiveTurn(persisted, messages, opts.activeGeneration, tools, opts) : persisted);
  return opts.narration === "show" ? placeTurnHeaders(rows) : rows;
}

export function liveTrace(messages: Message[], tools: ToolItem[], activeGeneration: ActiveGenerationView | null): TurnTraceData | null {
  if (!activeGeneration) return null;
  const from = messages.findLastIndex((message) => message.role === "user");
  const trace = buildTurnRows(messages.slice(Math.max(0, from)), tools, { activeGeneration, narration: "fold" }).findLast((row) => row.type === "trace");
  return trace?.type === "trace" ? trace.value : null;
}

export const isRun = (row: TurnRow): row is Extract<TurnRow, { type: "trace" }> =>
  row.type === "trace" && !row.afterAnswer && row.value.segments.some((segment) => segment.kind === "tool" || segment.kind === "error"
    || ((segment.kind === "thinking" || segment.kind === "narration") && !("hidden" in segment && segment.hidden) && segment.text.trim() !== ""));

/** A turn header is keyed by the run it follows, so it arrives anew under the next run. */
export function placeTurnHeaders(rows: TurnRow[]): TurnRow[] {
  const latest = new Map<string, number>(), runs = new Map<string, number>();
  rows.forEach((row, index) => { if (isRun(row) && row.precedingUserId) { latest.set(row.precedingUserId, index); runs.set(row.precedingUserId, (runs.get(row.precedingUserId) ?? 0) + 1); } });
  if (!latest.size) return rows;
  const placed: TurnRow[] = [];
  const after = new Map([...latest].map(([turn, index]) => [index, turn]));
  rows.forEach((row, index) => {
    placed.push(row);
    const turn = after.get(index);
    if (turn) placed.push({ key: `turn:${row.key}`, type: "turn", value: { runs: runs.get(turn)! }, precedingUserId: turn });
  });
  return placed;
}
