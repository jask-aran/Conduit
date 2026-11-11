import { defineExtension, section, wrapSection } from "@earendil-works/pi-durable";
import { forkRecord, routineCompactionGuard, routineToolGuard } from "./routine-task.js";
import { AgentDoc } from "./agent-doc.js";
import { readPolicy, renderRules } from "./approval-policy.js";
import { ChatTools } from "./chat-tools.js";
import { EventTools } from "./events.js";
import { FeedTools } from "./feeds.js";
import { InboxTools } from "./inbox.js";
import { MemoryTools } from "./memory.js";
import { MessageTools } from "./messages.js";
import { policyWraps } from "./policy.js";
import { ScheduleTools } from "./schedule.js";
import { RoutineTools } from "./routines.js";

/** A part reaches the agent as `runtime.agent` at call time: the server makes it after the runtime. */
export function AgentExtension(runtime, installed) {
  const schedules = ScheduleTools(runtime);
  const parts = [MemoryTools(runtime), schedules, EventTools(runtime), ChatTools(runtime), InboxTools(runtime), MessageTools(runtime), FeedTools(runtime, schedules), RoutineTools(runtime)];
  const own = parts.flatMap((part) => part.tools || []);
  return defineExtension({
    name: "agent",
    tools: own,
    hooks: [routineToolGuard(runtime), routineCompactionGuard()],
    tasks: parts.flatMap((part) => part.tasks || []),
    // The person's approval rules, so it knows what will be asked before it tries.
    sections: [...parts.flatMap((part) => part.sections || []), section("approval-rules", async () => runtime.agent?.enabled() ? renderRules((await readPolicy(runtime.agent)).policy, runtime.agent.settings()) : undefined)],
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
