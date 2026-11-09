/* A trace's digest (the shared turn-digest.js says what it is): its steps -- a script as the calls it made -- read off
   the trace. `own`: the trace is jbot's, its own folder and tools named for what they are to the person. */
import type { ToolCallStep, ToolItem } from "../api/contracts";
import type { TurnTraceData } from "../turn-rows";
import { digestActs, digestLine, doingOf, type DigestStep } from "../../turn-digest.js";
import { spawned } from "./agents";
import { scriptCalls } from "./tool-card";

const stepOf = (item: ToolItem | ToolCallStep): DigestStep =>
  "toolCallId" in item ? { ...item, spawn: spawned(item) } : item;
function stepsOf(tool: ToolItem): { step: DigestStep; failed: boolean; running: boolean }[] {
  const calls = tool.kind === "script" ? scriptCalls(tool) : [];
  if (calls.length) return calls.map((call) => ({ step: stepOf(call), failed: Boolean(call.isError), running: call.done === false }));
  return [{ step: stepOf(tool), failed: Boolean(tool.isError), running: !tool.done }];
}
const named = (tool: ToolItem) => Boolean(tool.name) && tool.name !== "tool";

/** Settled: what was done ("checked Gmail and searched the web"), "" when nothing to tell. */
export const digestDone = (trace: TurnTraceData, own = false) =>
  digestLine(digestActs(trace.segments.flatMap((segment) => segment.kind === "tool" && named(segment.tool) ? stepsOf(segment.tool) : []), own));

/** Live: the step under way ("checking Gmail"), or null between steps (thinking, writing: the caller's). */
export function digestDoing(trace: TurnTraceData, own = false): string | null {
  const tool = trace.segments.flatMap((segment) => segment.kind === "tool" && !segment.tool.done ? [segment.tool] : [])[0];
  if (!tool) return null;
  if (!named(tool)) return "using its tools";
  const steps = stepsOf(tool);
  return doingOf((steps.find((step) => step.running) ?? steps.at(-1)!).step, own);
}
