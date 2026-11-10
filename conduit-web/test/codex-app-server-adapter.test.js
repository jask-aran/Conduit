import assert from "node:assert/strict";
import test from "node:test";
import { CodexAppServerAdapter } from "../src/codex-app-server-adapter.js";

function record() {
  return {
    id: "live", chatId: "chat", status: "running", activity: "idle", active: false, stopping: false,
    sessionId: "thread-1", generation: null, clients: new Set(), events: [], pending: new Map(),
    steering: [], followUp: [], rpcRequestId: 0, generationSeq: 0, messageIds: new Set(),
  };
}

test("Codex notifications map to neutral streaming events", () => {
  const adapter = new CodexAppServerAdapter();
  const live = record();
  adapter.notification(live, "turn/started", { turn: { id: "turn-1" } });
  adapter.notification(live, "item/agentMessage/delta", { turnId: "turn-1", itemId: "message-1", delta: "Hello" });
  adapter.notification(live, "turn/completed", { turn: { id: "turn-1", status: "completed" } });
  // The turn ends without Codex ever reporting the item it streamed, which is
  // ordinary: the deltas are the whole of what it said. So the turn settles
  // that text as its answer rather than giving up the row -- which is what it
  // used to do, taking the text off the screen when the turn ended.
  assert.deepEqual(live.events.map(({ type }) => type),
    ["status", "assistant_content", "assistant_content", "assistant_content", "status"]);
  assert.equal(live.events[2].delta, "Hello");
  const settled = live.events[3];
  assert.equal(settled.phase, "final");
  assert.equal(settled.stopReason, "stop");
  assert.equal(settled.blocks[0].text, "Hello");
  // The transition is stated, not spelled out in `detail` for the browser to
  // string-match back into one.
  assert.equal(live.events[4].phase, "settled");
  assert.equal(live.active, false);
});

test("Codex prompt writes the installed app-server turn/start shape", async () => {
  const adapter = new CodexAppServerAdapter();
  const live = record();
  const writes = [];
  live.child = { stdin: { writable: true, write: (line) => writes.push(JSON.parse(line)) } };
  adapter.records.set(live.id, live);
  await adapter.setModel(live.id, "codex-other");
  await adapter.setThinkingLevel(live.id, "high");
  await adapter.setServiceLevel(live.id, "priority");
  const pending = adapter.prompt(live.id, "Test prompt");
  // The input items are built asynchronously (device attachments), so the write lands a tick later.
  await new Promise(setImmediate);
  const { clientUserMessageId, ...params } = writes[0].params;
  assert.equal(typeof clientUserMessageId, "string");
  assert.deepEqual({ ...writes[0], params }, { id: 1, method: "turn/start", params: {
    threadId: "thread-1", input: [{ type: "text", text: "Test prompt" }],
    model: "codex-other",
    effort: "high",
    serviceTier: "priority",
  } });
  adapter.receive(live, JSON.stringify({ id: 1, result: { turn: { id: "turn-1" } } }));
  assert.deepEqual(await pending, { generationId: "turn-1", attachmentIdentity: { messageId: clientUserMessageId } });
});

test("attached images become native localImage input items", async () => {
  const items = await CodexAppServerAdapter.inputItems("Look at this", [
    { type: "image/png", path: "/chats/c1/attachments/a--shot.png" },
    { type: "application/octet-stream", path: "/chats/c1/attachments/b--notes.bin" },
    { type: "image/webp", path: "/chats/c1/attachments/c--diagram.webp" },
  ]);
  assert.deepEqual(items, [
    { type: "localImage", path: "/chats/c1/attachments/a--shot.png" },
    { type: "localImage", path: "/chats/c1/attachments/c--diagram.webp" },
    { type: "text", text: "Look at this\n\nAttached file: /chats/c1/attachments/b--notes.bin" },
  ]);
});

/**
 * A long thread says where the rest of it is, like a long session file does.
 *
 * Every backend but Pi answered `page: { before: null }` from the route, hard
 * coded -- so a Codex thread that had been trimmed to its recent end told the
 * browser that what it had been given was the whole conversation, and there was
 * no way to ask for the rest.
 */
test("a thread trimmed to its recent end says where the rest of it starts", () => {
  const rows = [];
  for (let turn = 0; turn < 300; turn += 1) {
    rows.push({ turnId: `t${turn}`, item: { type: "userMessage", id: `u${turn}`, content: [{ type: "text", text: `ask ${turn}` }] } });
    rows.push({ turnId: `t${turn}`, item: { type: "agentMessage", id: `a${turn}`, text: `answer ${turn}` } });
  }
  const first = CodexAppServerAdapter.recent(rows);
  assert.ok(first.page.before, "a thread longer than the window has an earlier page");
  assert.equal(first.rows.at(-1).item.id, "a299", "the window is the recent end");

  // And that cursor reads the thread as it stood before it, with no overlap and
  // no gap.
  const older = CodexAppServerAdapter.recent(rows, { before: first.page.before });
  assert.equal(rows.indexOf(older.rows.at(-1)) + 1, rows.indexOf(first.rows[0]));

  // A thread that fits says so, and the browser stops asking.
  assert.equal(CodexAppServerAdapter.recent(rows.slice(-4)).page.before, null);
});

test("a Codex turn maps onto Conduit's rollup: commentary and commands, then the answer", () => {
  const { messages, tools } = CodexAppServerAdapter.threadTranscript([
    { turnId: "t1", item: { type: "userMessage", id: "u1", content: [{ type: "text", text: "Fix the build." }] } },
    { turnId: "t1", item: { type: "agentMessage", id: "a1", text: "Looking now.", phase: "commentary" } },
    { turnId: "t1", item: { type: "commandExecution", id: "e1", command: "npm run build", aggregatedOutput: "ok", status: "completed" } },
    { turnId: "t1", item: { type: "agentMessage", id: "a2", text: "Built.", phase: "final_answer" } },
    { turnId: "t2", item: { type: "userMessage", id: "u2", content: [{ type: "text", text: "Ship it." }] } },
    { turnId: "t2", item: { type: "agentMessage", id: "a3", text: "Shipped.", phase: "final_answer" } },
  ]);
  // Interim work is marked toolUse, which is what folds it into the rollup;
  // only the final answer is left to render as the message body.
  assert.deepEqual(messages.map((message) => [message.role, message.stopReason]), [
    ["user", undefined], ["assistant", "toolUse"], ["assistant", "stop"],
    ["user", undefined], ["assistant", "stop"],
  ]);
  assert.deepEqual(messages.filter((message) => message.role === "assistant")
    .map(({ interim, answers }) => ({ interim, answers })),
  [{ interim: true, answers: "u1" }, { interim: false, answers: "u1" }, { interim: false, answers: "u2" }],
  "read back, a thread says what the socket said");
  assert.equal(messages[1].content, "Looking now.");
  assert.deepEqual(messages[1].blocks.map((block) => block.kind), ["text", "tool_call"], "commands hang off the message that ran them");
  assert.equal(messages[2].content, "Built.");
  assert.deepEqual(tools, [{ toolCallId: "e1", name: "command", kind: "command", subject: "npm run build", input: "npm run build", done: true, output: "ok", isError: false }]);
});

test("a live command hangs off the turn's message so the rollup claims it", () => {
  const adapter = new CodexAppServerAdapter();
  const live = record();
  adapter.notification(live, "turn/started", { turn: { id: "turn-1" } });
  adapter.notification(live, "item/completed", { turnId: "turn-1", item: { type: "agentMessage", id: "m1", text: "Looking now.", phase: "commentary" } });
  adapter.notification(live, "item/started", { turnId: "turn-1", item: { type: "commandExecution", id: "e1", command: "npm test" } });
  adapter.notification(live, "item/completed", { turnId: "turn-1", item: { type: "commandExecution", id: "e1", aggregatedOutput: "ok", status: "completed" } });
  adapter.notification(live, "item/completed", { turnId: "turn-1", item: { type: "agentMessage", id: "m2", text: "Green.", phase: "final_answer" } });

  const finals = live.events.filter((event) => event.type === "assistant_content" && event.phase === "final");
  // The commentary message is re-sent carrying the command, which is what marks
  // it interim; the answer that follows carries nothing after it.
  assert.deepEqual(finals.map((event) => [event.messageId, event.stopReason]), [["m1", "toolUse"], ["m1", "toolUse"], ["m2", "stop"]]);
  assert.deepEqual(finals[1].blocks.map((block) => block.kind), ["text", "tool_call"]);
  assert.equal(finals[1].blocks[1].toolCallId, "e1");
  assert.deepEqual(finals[2].blocks.map((block) => block.kind), ["text"]);
  const tools = live.events.filter((event) => event.type === "tool_activity");
  assert.deepEqual(tools.map((event) => [event.phase, event.name]), [["start", "command"], ["end", "command"]]);
});

// A record whose writes are captured, so the reply Codex receives is assertable.
function approvalHarness() {
  const adapter = new CodexAppServerAdapter();
  const live = record();
  live.active = true;
  live.generation = { id: "turn-1", settled: false };
  const written = [];
  adapter.write = (_record, message) => written.push(message);
  adapter.records.set(live.id, live);
  return { adapter, live, written };
}

test("a command approval becomes a permission prompt and its answer reaches Codex", () => {
  const { adapter, live, written } = approvalHarness();
  adapter.receive(live, JSON.stringify({ id: 7, method: "item/commandExecution/requestApproval",
    params: { approvalId: "ap-1", turnId: "turn-1", command: "rm -rf build", reason: "Cleaning the tree" } }));

  const prompt = live.events.find((event) => event.type === "permission_request");
  assert.ok(prompt, "the request surfaces as a permission prompt");
  assert.equal(prompt.requestId, "ap-1");
  assert.equal(prompt.kind, "select");
  assert.match(prompt.message, /rm -rf build/);
  assert.match(prompt.message, /Cleaning the tree/);
  assert.deepEqual(prompt.options, ["Approve", "Approve for session", "Deny"]);
  assert.equal(adapter.view(live).activity, "waiting_for_user");
  assert.equal(written.length, 0, "nothing is sent back until the user answers");

  assert.equal(adapter.respondHostUi(live.id, { id: "ap-1", value: "Approve for session" }), "acceptForSession");
  assert.deepEqual(written, [{ id: 7, result: { decision: "acceptForSession" } }]);
  assert.ok(live.events.some((event) => event.type === "permission_resolved" && event.requestId === "ap-1"));
  assert.equal(adapter.view(live).activity, "working", "the turn resumes once the prompt clears");
});

test("a permission prompt fails closed", () => {
  for (const [response, expected] of [
    [{ id: "ap-1", value: "Deny" }, "decline"],
    [{ id: "ap-1", cancelled: true }, "decline"],
    [{ id: "ap-1" }, "decline"],
    [{ id: "ap-1", value: "something else" }, "decline"],
    [{ id: "ap-1", confirmed: true }, "accept"],
  ]) {
    const { adapter, live, written } = approvalHarness();
    adapter.receive(live, JSON.stringify({ id: 7, method: "item/commandExecution/requestApproval",
      params: { approvalId: "ap-1", command: "curl evil.example" } }));
    assert.equal(adapter.respondHostUi(live.id, response), expected, JSON.stringify(response));
    assert.equal(written[0].result.decision, expected);
  }
});

// The defect that motivated this: an unanswered server request stalls the turn.
test("a server request Conduit does not handle is refused rather than ignored", () => {
  const { adapter, live, written } = approvalHarness();
  adapter.receive(live, JSON.stringify({ id: 11, method: "mcpServer/elicitation/request", params: {} }));
  assert.equal(written.length, 1, "the request is always answered");
  assert.equal(written[0].id, 11);
  assert.match(written[0].error.message, /does not handle/);
  assert.equal(live.events.some((event) => event.type === "permission_request"), false);
});

test("thread policy overrides only what Conduit was asked for", () => {
  assert.deepEqual(CodexAppServerAdapter.policy(), {}, "no override leaves the user's config.toml alone");
  assert.deepEqual(CodexAppServerAdapter.policy("on-request"), { approvalPolicy: "on-request" });
  assert.deepEqual(CodexAppServerAdapter.policy("", "", "workspace-write"), { sandbox: { type: "workspace-write" } });
  assert.deepEqual(CodexAppServerAdapter.policy("nonsense"), {}, "an unknown policy is not forwarded");
  assert.deepEqual(
    CodexAppServerAdapter.policy("never", "", { type: "workspace-write", networkAccess: false, writableRoots: ["/repo"] }),
    { approvalPolicy: "never", sandbox: { type: "workspace-write", networkAccess: false, writableRoots: ["/repo"] } },
  );
});

test("steering stays visible until Codex reports that it consumed the message", async () => {
  const adapter = new CodexAppServerAdapter();
  const live = record();
  live.active = true;
  live.generation = { id: "turn-1", settled: false };
  adapter.records.set(live.id, live);
  const sent = [];
  adapter.request = (_record, method, params) => { sent.push({ method, params }); return Promise.resolve({}); };

  const result = await adapter.queue(live.id, "steer", `<conduit_attachments version="2" chat_id="chat-1234">
</conduit_attachments>
<user_message>
use the other file
</user_message>`);
  assert.equal(result.queued, "steer");
  assert.equal(typeof result.attachmentIdentity.messageId, "string");
  assert.equal(sent[0].method, "turn/steer");
  assert.equal(sent[0].params.expectedTurnId, "turn-1");
  assert.equal(sent[0].params.threadId, "thread-1");
  assert.equal(typeof sent[0].params.clientUserMessageId, "string");
  assert.deepEqual(sent[0].params.input, [{ type: "text", text: "use the other file" }]);

  const clientId = sent[0].params.clientUserMessageId;
  adapter.notification(live, "item/started", { turnId: "turn-1",
    item: { type: "userMessage", id: "user-2", clientId, content: [{ type: "text", text: "use the other file" }] } });
  const queues = live.events.filter((event) => event.type === "queue_state").map((event) => event.queue.steering);
  assert.deepEqual(queues, [["use the other file"], []]);
});
