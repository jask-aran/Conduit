import { Type } from "@earendil-works/pi-ai";
import { configure, defineExtension, defineTool } from "@earendil-works/pi-durable";

/**
 * Delegation (plan decision 10, the thread subagent): `subagent` hands a
 * self-contained task to a child conversation and returns its answer. The
 * child is owned by the call, as pi-durable's own subagent pattern has it, so
 * stopping the turn stops the child and the turn is idle only once the child
 * is; a restart reruns the call, which finds the same child and the same
 * submission rather than starting another. The child starts as a copy of
 * this conversation's agent (model, tools, folder or devices) without this
 * tool, so it does not delegate again, and without the question card, which
 * no one is watching it on. The call's details name the child, for a reader
 * that wants to show its work.
 */
export function Subagents(runtime) {
  const subagent = defineTool({
    name: "subagent",
    description: "Delegate a self-contained task to a subagent and get its final answer back. It has your tools and "
      + "works in the same place, but none of this conversation: say everything it needs in `task`. Use it for "
      + "independent work you can hand off whole, such as research or a contained change; several can run at once.",
    parameters: Type.Object({
      task: Type.String({ description: "The whole task: goal, context, constraints, and what to report back." }),
    }),
    replay: "safe",
    execute: async ({ task }, api, context) => {
      const child = await api.commit(async (tx) => {
        const existing = (await tx.scanConversations({ ownerTaskId: api.taskId }, 1)).items[0];
        if (existing !== undefined) return existing.id;
        const created = await tx.createConversation({ ownership: { kind: "task", taskId: api.taskId } });
        const askUser = runtime.extensions.get("conduit")?.tools?.find((tool) => tool.name === "ask_user");
        await configure(tx, created.id, { extensions: { remove: [extension] }, tools: { remove: [subagent, ...(askUser ? [askUser] : [])] } });
        return created.id;
      }, context);
      await api.details({ conversationId: child }, context);
      const handle = await api.conversation(child, context);
      // As a chat's prompt is stored, so the child's transcript reads like one.
      const requestId = `subagent:${api.taskId}`;
      const settled = await (await handle.submit({ type: "input", content: task, requestId,
        entry: { kind: "conduit.user", data: { messageId: requestId, text: task, timestamp: new Date().toISOString() } } }, context)).wait(context);
      const answer = await runtime.lastAnswer(child);
      if (settled.status !== "done" && !answer) {
        return { output: [{ type: "text", text: `The subagent did not finish (${settled.status}).` }], isError: true };
      }
      return { output: [{ type: "text", text: answer || "(The subagent finished without a reply.)" }] };
    },
  });
  const extension = defineExtension({ name: "subagents", tools: [subagent] });
  return extension;
}

/**
 * The agent's own reset (pi-durable's `control.handoff`): a long-lived
 * conversation ends its context and goes on from a note it writes, which is
 * how the persistent shape stays bounded besides compaction (decision 9).
 * The transcript keeps everything before it.
 */
export const Handoff = defineExtension({ name: "handoff", tools: [defineTool({
  name: "handoff",
  description: "Start your context again from a note, when what came before is finished and no longer worth carrying. "
    + "Write everything you will still need in `note`: the goal, decisions, open work and where things are. You will "
    + "see only the note afterwards; the person still sees the whole conversation.",
  parameters: Type.Object({ note: Type.String({ description: "What to carry into the new context." }) }),
  execute: async ({ note }) => ({ output: [{ type: "text", text: "Context will restart from the note." }], control: { handoff: note } }),
})] });
