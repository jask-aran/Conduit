import { defineExtension } from "@earendil-works/pi-durable";
import { ChatTools } from "./chat-tools.js";
import { EventTools } from "./events.js";
import { MemoryTools } from "./memory.js";
import { ApprovedTool, policyWraps } from "./policy.js";
import { ScheduleTools } from "./schedule.js";

/**
 * The persistent agent's extension, selected by its threads (the `agent`
 * template) and inherited by its runs: memory, schedules, watches and chats,
 * and the approval policy over every tool that could leave its folder.
 *
 * Each part is `Part(runtime) → { tools?, tasks?, sections? }` and reaches the
 * agent at call time as `runtime.agent` (agent.js), which the server makes
 * after the runtime: a part never holds it at install.
 */
export function AgentExtension(runtime, installed) {
  const parts = [MemoryTools(runtime), ScheduleTools(runtime), EventTools(runtime), ChatTools(runtime)];
  const own = parts.flatMap((part) => part.tools || []);
  // `approved` runs what an ask holds with the tool as installed: the policy has already been answered.
  const tools = [...own, ApprovedTool(runtime, [...installed, ...own])];
  return defineExtension({
    name: "agent",
    tools,
    tasks: parts.flatMap((part) => part.tasks || []),
    sections: parts.flatMap((part) => part.sections || []),
    // The device tools are another extension's; the agent's own outward tools are its own.
    wraps: policyWraps(runtime, [...installed, ...own]),
  });
}
