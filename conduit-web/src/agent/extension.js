import { defineExtension, wrapSection } from "@earendil-works/pi-durable";
import { forkRecord, routineCompactionGuard, routineToolGuard } from "./routine-task.js";
import { AgentDoc } from "./agent-doc.js";
import { ChatTools } from "./chat-tools.js";
import { EventTools } from "./events.js";
import { FeedTools } from "./feeds.js";
import { InboxTools } from "./inbox.js";
import { MemoryTools } from "./memory.js";
import { MessageTools } from "./messages.js";
import { policyWraps } from "./policy.js";
import { ScheduleTools } from "./schedule.js";
import { RoutineTools } from "./routines.js";

/**
 * The persistent agent's extension, selected by its threads (the `agent`
 * template) and inherited by its runs: memory, schedules, watches, chats, the inbox,
 * and the approval policy over every tool that could leave its folder (a connector's tools and `approved` are the
 * connectors extension's, which the Assistant selects too).
 *
 * Each part is `Part(runtime) → { tools?, tasks?, sections? }` and reaches the
 * agent at call time as `runtime.agent` (agent.js), which the server makes
 * after the runtime: a part never holds it at install.
 */
export function AgentExtension(runtime, installed) {
  const schedules = ScheduleTools(runtime);
  const parts = [MemoryTools(runtime), schedules, EventTools(runtime), ChatTools(runtime), InboxTools(runtime), MessageTools(runtime), FeedTools(runtime, schedules), RoutineTools(runtime)];
  const own = parts.flatMap((part) => part.tools || []);
  return defineExtension({
    name: "agent",
    tools: own,
    hooks: [routineToolGuard(runtime), routineCompactionGuard()],
    tasks: parts.flatMap((part) => part.tasks || []),
    sections: parts.flatMap((part) => part.sections || []),
    // The device tools are another extension's; the agent's own outward tools are its own.
    wraps: [...policyWraps(runtime, [...installed, ...own]), ...["agent-memory", "agent-inbox"].map((key) =>
      wrapSection(key, (source) => ({ ...source, tag: false, render: async (input, context) => {
        const state = runtime.agent?.enabled() ? await input.read.snapshot(AgentDoc, context) : null;
        if (forkRecord(state, input.conversationId)) return input.shown[key];
        const text = await source.render(input, context);
        return text === undefined || source.tag === false ? text : `<${key}>\n${text}\n</${key}>`;
      } })))],
  });
}
