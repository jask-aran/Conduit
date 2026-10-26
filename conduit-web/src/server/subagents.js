import { Type } from "@earendil-works/pi-ai";
import { configure, defineDoc, defineExtension, defineTask, defineTool, UsageDoc } from "@earendil-works/pi-durable";

const SubagentRoster = defineDoc({
  kind: "conduit.subagents", version: 1, scope: "conversation", history: "latest", fork: "initial",
  initial: () => ({ next: 1, children: {} }),
});
const emptyUsage = () => ({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } });
const addUsage = (total, usage) => {
  for (const key of ["input", "output", "cacheRead", "cacheWrite", "totalTokens", "cacheWrite1h", "reasoning"]) {
    if (usage[key] != null) total[key] = (total[key] || 0) + usage[key];
  }
  for (const key of Object.keys(total.cost)) total.cost[key] += usage.cost?.[key] || 0;
  return total;
};
const totalUsage = (state) => [...Object.values(state?.models || {}), ...Object.values(state?.tools || {})]
  .reduce((total, usage) => addUsage(total, usage), emptyUsage());
const textResult = (text) => ({ output: [{ type: "text", text }] });
const aborted = async (task, api, context) => {
  await api.commit(() => ({ status: "terminal", outcome: { status: "aborted" } }), context);
};

/** A conversation's background subagents, as `{ id, title, child, anchor, status }`. */
export async function backgroundSubagents(harness, conversationId, context) {
  return Object.values((await harness.snapshot(SubagentRoster, conversationId, context))?.children || {});
}

/** Stop a conversation's background subagents: its chat is going, and a late report would start a turn no one sees. */
export async function stopBackgroundSubagents(harness, conversationId, context) {
  for (const item of await backgroundSubagents(harness, conversationId, context)) {
    if (item.status !== "stopped") await harness.abortTask(item.anchor, context).catch(() => {});
  }
}

/**
 * Delegation (plan decision 10, the thread subagent): `subagent` hands a
 * self-contained task to a child conversation that starts as a copy of this
 * one's agent (model, tools, folder or devices) without `subagent`, so it does
 * not delegate again, and without the question card, which no one is watching
 * it on. The call's details name the child, for a reader that wants its work.
 *
 * In the foreground (the default) the child is owned by the call, as
 * pi-durable's own subagent pattern has it: stopping the turn stops the child,
 * the turn is idle only once the child is, and a restart reruns the call, which
 * finds the same child and submission rather than starting another. Its spend
 * comes back as the call's `usage`, so the parent's ledger counts it.
 *
 * In the background (pi-durable's background pattern) the child is owned by an
 * anchor task the parent conversation owns, so the parent's Esc and idle never
 * reach it, and stays to be messaged again until stopped or the parent resets.
 * Each message is delivered by a reporter task the anchor owns, which posts the
 * answer back to the parent as a follow-up (`conduit.subagent-report`, a short
 * harness row in the transcript); request ids keep a restart from sending a
 * message or a report twice. Its spend stays in the child's own ledger, which
 * the chat's totals add (`backgroundSubagents`): pi-durable's ledger is its own.
 */
export function Subagents(runtime) {
  const resetSince = async (conversation, sinceEntry, context) => {
    if (!conversation) return true;
    let cursor;
    do {
      const page = await conversation.entries({ minEntryId: sinceEntry + 1 }, 50, cursor, context);
      if (page.items.some((entry) => entry.kind === "pi.reset")) return true;
      cursor = page.next;
    } while (cursor);
    return false;
  };
  const anchor = defineTask({
    name: "conduit.subagent-anchor", version: 1, initial: () => ({ phase: "hold" }),
    phases: { hold: async (task, api, context) => {
      const harness = runtime.harness;
      const stop = () => { void harness.abortTask(task.id, context).catch((error) => { if (!api.signal.aborted) api.report(error); }); };
      // Reset ends this child's context lease; ordinary Esc still leaves it alone.
      const unsubscribe = harness.subscribeCommits((publication) => {
        if (publication.changes.some((change) => change.type === "entry"
          && change.value.conversationId === api.conversationId && change.value.kind === "pi.reset")) stop();
      });
      try {
        const parent = await harness.conversation(api.conversationId, context);
        if (await resetSince(parent, task.input.sinceEntry || 0, context)) stop();
        await api.sleep(api.now() + 86400000, context);
        await api.commit(() => ({ status: "pending", checkpoint: { phase: "hold" } }), context);
      } finally { unsubscribe(); }
    } },
    abort: async (task, api, context) => {
      await api.commit(async (tx) => {
        const item = (await tx.doc(SubagentRoster, api.conversationId)).children[task.input.id];
        item.status = "stopped";
        return { status: "terminal", outcome: { status: "aborted" } };
      }, context);
    },
  });
  const reporter = defineTask({
    name: "conduit.subagent-reporter", version: 1, initial: () => ({ phase: "deliver" }),
    phases: { deliver: async (task, api, context) => {
      const { id, child, title, content, mode, number } = task.input;
      const handle = await api.conversation(child, context);
      const requestId = `subagent-message:${child}:${number}`;
      const settled = await (await handle.submit({ type: "input", content, whenBusy: mode, requestId,
        entry: { kind: "conduit.user", data: { messageId: requestId, text: content } } }, context)).wait(context);
      const conversation = await runtime.harness.conversation(child, context);
      const answerEntry = settled.status === "done" ? (await conversation.entries({ minEntryId: settled.answer,
        maxEntryId: settled.answer }, 1, undefined, context)).items[0] : null;
      const answer = (answerEntry?.model?.[0]?.content || []).filter((part) => part.type === "text").map((part) => part.text).join("")
        || (settled.status === "done" ? "(The subagent finished without a reply.)" : `The subagent did not finish (${settled.status}).`);
      // Persist the answer before submitting it, so a replay cannot pick up a later answer.
      const report = await api.memo("report", { answer, status: settled.status === "done" ? "finished" : "failed" }, context);
      let stopped = false;
      await api.commit(async (tx) => {
        const item = (await tx.doc(SubagentRoster, api.conversationId)).children[id];
        stopped = item.status === "stopped";
        if (!stopped && item.number === number) item.status = report.status;
      }, context);
      const parent = await runtime.harness.conversation(api.conversationId, context);
      if (!stopped && !await resetSince(parent, task.input.sinceEntry || 0, context)) {
        const requestId = `subagent-report:${child}:${number}`;
        const handle = await api.conversation(api.conversationId, context);
        await handle.submit({ type: "input", whenBusy: "followUp", requestId,
          content: report.answer, entry: { kind: "conduit.subagent-report",
            data: { subagentId: id, title, status: report.status, messageId: requestId } } }, context);
      }
      await api.commit(() => ({ status: "terminal", outcome: { status: "completed", result: report } }), context);
    } },
    abort: aborted,
  });
  const stripTools = async (tx, child) => {
    const askUser = runtime.extensions.get("conduit")?.tools?.find((tool) => tool.name === "ask_user");
    await configure(tx, child, { extensions: { remove: [extension] },
      tools: { remove: [subagent, ...(askUser ? [askUser] : [])] } });
  };
  const subagent = defineTool({
    name: "subagent",
    description: "Delegate a self-contained task with your tools and workspace but no conversation history. "
      + "Default: wait for its answer; Esc stops it. background:true returns an id immediately and reports the answer "
      + "as a follow-up while you can go idle; parent Esc leaves it running. Children cannot delegate or ask the user. "
      + "Manage your background children with action:list, message (id, task, mode:steer or followUp), wait (id), or stop (id). "
      + "Message sends new work and returns immediately; wait returns the latest delivery. stop ends the child and its reporters.",
    parameters: Type.Object({
      task: Type.Optional(Type.String({ description: "The whole task or message: goal, context, constraints, and what to report back." })),
      background: Type.Optional(Type.Boolean()),
      action: Type.Optional(Type.Union(["spawn", "list", "message", "wait", "stop"].map((value) => Type.Literal(value)))),
      id: Type.Optional(Type.String({ description: "This conversation's background subagent id, such as sa-3." })),
      mode: Type.Optional(Type.Union([Type.Literal("steer"), Type.Literal("followUp")])),
    }),
    replay: "safe",
    execute: async ({ task, background = false, action = "spawn", id, mode = "followUp" }, api, context) => {
      if (action === "list") {
        const roster = await api.snapshot(SubagentRoster, api.conversationId, context);
        return textResult(Object.entries(roster?.children || {}).map(([key, item]) => `${key}: ${item.status}: ${item.title}`).join("\n") || "No background subagents.");
      }
      if ((action === "spawn" || action === "message") && typeof task !== "string") throw new Error("subagent requires task for spawn or message.");
      if (action === "spawn" && !background) {
        const child = await api.commit(async (tx) => {
          const existing = (await tx.scanConversations({ ownerTaskId: api.taskId }, 1)).items[0];
          if (existing !== undefined) return existing.id;
          const created = await tx.createConversation({ ownership: { kind: "task", taskId: api.taskId } });
          await stripTools(tx, created.id);
          return created.id;
        }, context);
        await api.details({ conversationId: child }, context);
        const handle = await api.conversation(child, context);
        const requestId = `subagent:${api.taskId}`;
        const settled = await (await handle.submit({ type: "input", content: task, requestId,
          entry: { kind: "conduit.user", data: { messageId: requestId, text: task, timestamp: new Date().toISOString() } } }, context)).wait(context);
        const answer = await runtime.lastAnswer(child);
        const usage = totalUsage(await api.snapshot(UsageDoc, child, context));
        if (settled.status !== "done" && !answer) {
          return { ...textResult(`The subagent did not finish (${settled.status}).`), isError: true, usage };
        }
        return { ...textResult(answer || "(The subagent finished without a reply.)"), usage };
      }
      const item = await api.commit(async (tx) => {
        const roster = await tx.doc(SubagentRoster, api.conversationId);
        if (action === "spawn") {
          const existing = Object.values(roster.children).find((value) => value.spawn === api.taskId);
          if (existing) return JSON.parse(JSON.stringify(existing));
          id = `sa-${roster.next++}`;
          const title = task.trim().replace(/\s+/g, " ").slice(0, 80);
          const sinceEntry = (await tx.scanEntries({ conversationId: api.conversationId }, 1)).items[0]?.id || 0;
          const owner = await tx.createTask(anchor, { id, sinceEntry }, { ownership: { kind: "conversation" }, background: true });
          const child = await tx.createConversation({ ownership: { kind: "task", taskId: owner } });
          await stripTools(tx, child.id);
          roster.children[id] = { id, title, sinceEntry, child: child.id, anchor: owner, spawn: api.taskId, number: 0,
            status: "running", deliveries: {} };
        }
        const held = Object.hasOwn(roster.children, id) ? roster.children[id] : null;
        if (!held) throw new Error(`Unknown background subagent: ${id}`);
        if (action === "stop") held.status = "stopped";
        if (action === "spawn" || action === "message") {
          if (held.status === "stopped") throw new Error(`Subagent ${id} is stopped.`);
          if (!held.deliveries[api.taskId]) {
            const delivery = await tx.createTask(reporter, { id, child: held.child, title: held.title, content: task,
              mode, number: ++held.number, sinceEntry: held.sinceEntry || 0 }, { ownership: { kind: "task", taskId: held.anchor } });
            held.deliveries[api.taskId] = delivery;
            held.reporter = delivery;
            held.status = "running";
          }
        }
        return JSON.parse(JSON.stringify(held));
      }, context);
      await api.details({ conversationId: item.child, subagentId: item.id }, context);
      if (action === "stop") {
        await runtime.harness.abortTask(item.anchor, context);
        await api.waitForTask(item.anchor, context);
        return textResult(`Stopped subagent ${item.id}: ${item.title}`);
      }
      if (action === "wait") {
        const settled = await api.waitForTask(item.reporter, context);
        return textResult(settled.state.outcome.result?.answer || `Subagent ${item.id}: ${item.status}`);
      }
      return textResult(`${action === "spawn" ? "Started" : "Messaged"} subagent ${item.id}: ${item.title}`);
    },
  });
  const extension = defineExtension({ name: "subagents", tools: [subagent], tasks: [anchor, reporter] });
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
