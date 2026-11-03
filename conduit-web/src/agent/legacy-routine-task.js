import { defineTask, UsageDoc } from "@earendil-works/pi-durable";
import { AgentDoc } from "./agent-doc.js";

/** Retire tasks persisted by the previous build, without consuming their pending notes. */
export function legacyRoutineTask(runtime) {
  const retire = async (task, api, context) => {
    const record = (await api.snapshot(AgentDoc, context))?.reflection;
    if (record?.taskId === task.id) {
      if (record.conversationId) {
        const fork = await runtime.harness.conversation(record.conversationId, context);
        await fork?.abort(context);
      }
      if (record.compactionId) {
        const held = await runtime.harness.getTask(record.compactionId, context);
        if (held && held.state.status !== "terminal") {
          await runtime.harness.abortTask(record.compactionId, context);
          await runtime.harness.waitForTask(record.compactionId, context);
        }
      }
      const usage = record.conversationId ? await api.snapshot(UsageDoc, record.conversationId, context) : null;
      const cost = [...Object.values(usage?.models || {}), ...Object.values(usage?.tools || {})]
        .reduce((sum, item) => sum + (item.cost?.total || 0), 0);
      await api.commit(async (tx) => {
        const doc = await tx.doc(AgentDoc);
        if (doc.reflection?.taskId !== task.id) return;
        const day = runtime.agent.today(api.now());
        doc.spend[day] = (doc.spend[day] || 0) + cost;
        doc.routineState ||= {};
        doc.routineState.reflect = { ...doc.routineState.reflect, lastError: "Interrupted by routine upgrade." };
        delete doc.reflection;
      }, context);
    }
    await api.commit(() => ({ status: "terminal", outcome: { status: "aborted", reason: "Interrupted by routine upgrade." } }), context);
  };
  return defineTask({ name: "conduit.agent-reflection", version: 1, initial: () => ({ phase: "wait" }),
    phases: { wait: retire, run: retire, compact: retire }, abort: retire });
}
