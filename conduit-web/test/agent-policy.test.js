import test from "node:test";
import assert from "node:assert/strict";
import { decide } from "../src/agent/asks.js";
import { connectorWraps } from "../src/agent/policy.js";
import { parseRoutine } from "../src/agent/routine-files.js";
import { agentFixture } from "./helpers/agent-fixture.js";

// policy.js connectorWraps: reads go ahead; writes ask before the outward call.
test("connector reads run without approval while sending email waits for approval", async (t) => {
  const { agent, api, session } = await agentFixture(t, { youAsk: false, remindMinutes: 0 });
  const execute = t.mock.fn(async () => ({ output: [{ type: "text", text: "Connector result" }] }));
  const tool = { name: "mcp__mail__call", execute };
  const guarded = connectorWraps(agent.runtime, [tool])[0].wrap(tool);
  const callApi = { ...api, taskId: "connector-task", callId: "connector-call", getTask: (id) => session.commit((tx) => tx.task(id), agent.context) };
  await guarded.execute({ calls: { path: "gmail.messagesList", input: {} } }, callApi);
  assert.equal(execute.mock.callCount(), 1);
  assert.deepEqual((await agent.state()).asks, {});
  const input = { calls: { path: "gmail.messagesSend", input: { to: "person@example.test" } } };
  await guarded.execute(input, callApi);
  assert.equal(execute.mock.callCount(), 1, "the send must wait for the person");
  const asks = Object.values((await agent.state()).asks);
  assert.equal(asks.length, 1);
  assert.equal(asks[0].status, "pending");
  assert.deepEqual(asks[0].args, input);
});

// persistent-agent.md, Task: Executor gathering only reads; routineProblem checks it before a task runs.
test("routine gathering accepts connector reads and refuses email writes", () => {
  const file = (action) => `---\ntrigger: { every: 30 }\ntasks:\n  - id: mail\n    kind: executor\n    code: return tools.gmail.${action}({});\ngate: never\noutput: inbox\n---\n`;
  assert.equal(parseRoutine(file("messagesList"), "mail").tasks[0].kind, "executor");
  assert.throws(() => parseRoutine(file("messagesSend"), "mail"));
});

async function pending(t) {
  const { agent } = await agentFixture(t);
  const deliveries = [];
  agent.chatHost = { deliverApproval: async (...args) => { deliveries.push(args); } };
  const ask = { id: "approval", status: "pending", chatId: "home-chat", tool: "mcp__mail__send",
    ruleTarget: "person@example.test", ruleLabel: "Mail the person", title: "Send email",
    createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 3600_000).toISOString() };
  await agent.update((doc) => { doc.asks[ask.id] = ask; });
  return { agent, ask, deliveries };
}

// asks.js decide: always records exactly the ask's tool and reusable target.
test("always approval remembers only the approved tool and target", async (t) => {
  const { agent, ask, deliveries } = await pending(t);
  const outcome = await decide(agent, ask.id, "always");
  assert.equal(outcome.status, "allowed");
  const rules = Object.values((await agent.state()).rules);
  assert.equal(rules.length, 1);
  assert.equal(rules[0].tool, ask.tool);
  assert.equal(rules[0].target, ask.ruleTarget);
  assert.equal(deliveries.length, 1);
  await assert.rejects(decide(agent, ask.id, "allow"), { status: 409 });
});

// persistent-agent.md, approvals: don't refuses; no saved grant follows a refusal.
test("don't approval declines the action and creates no standing permission", async (t) => {
  const { agent, ask } = await pending(t);
  assert.equal((await decide(agent, ask.id, "deny")).status, "declined");
  assert.deepEqual((await agent.state()).rules, {});
  await assert.rejects(decide(agent, ask.id, "allow"), { status: 409 });
});
