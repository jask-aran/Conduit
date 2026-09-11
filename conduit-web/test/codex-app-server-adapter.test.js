import assert from "node:assert/strict";
import test from "node:test";
import { CodexAppServerAdapter, CODEX_CAPABILITIES } from "../src/codex-app-server-adapter.js";

function record() {
  return {
    id: "live", chatId: "chat", status: "running", activity: "idle", active: false, stopping: false,
    sessionId: "thread-1", generation: null, clients: new Set(), events: [], pending: new Map(),
    approvals: new Map(), steering: [], followUp: [], sequence: 0, eventSequence: 0, messageIds: new Set(),
  };
}

test("Codex notifications map to neutral streaming events", () => {
  const adapter = new CodexAppServerAdapter();
  const live = record();
  adapter.notification(live, "turn/started", { turn: { id: "turn-1" } });
  adapter.notification(live, "item/agentMessage/delta", { turnId: "turn-1", itemId: "message-1", delta: "Hello" });
  adapter.notification(live, "turn/completed", { turn: { id: "turn-1", status: "completed" } });
  assert.deepEqual(live.events.map(({ type }) => type), ["status", "assistant_content", "assistant_content", "status"]);
  assert.equal(live.events[2].delta, "Hello");
  assert.equal(live.events[3].detail, "settled");
  assert.equal(live.active, false);
});

test("Codex adapter advertises only implemented capabilities", () => {
  assert.deepEqual(CODEX_CAPABILITIES, {
    steer: true, followUpQueue: true, cancel: true, compaction: false,
    thinkingLevels: true, modelSwitch: true, toolUse: true, permissions: true,
    usage: false, replay: false,
  });
});

test("Codex prompt writes the installed app-server turn/start shape", async () => {
  const adapter = new CodexAppServerAdapter();
  const live = record();
  const writes = [];
  live.child = { stdin: { writable: true, write: (line) => writes.push(JSON.parse(line)) } };
  adapter.records.set(live.id, live);
  await adapter.setModel(live.id, "codex-other");
  await adapter.setThinkingLevel(live.id, "high");
  const pending = adapter.prompt(live.id, "Test prompt");
  assert.deepEqual(writes[0], { id: 1, method: "turn/start", params: {
    threadId: "thread-1", input: [{ type: "text", text: "Test prompt" }],
    model: "codex-other",
    effort: "high",
  } });
  adapter.receive(live, JSON.stringify({ id: 1, result: { turn: { id: "turn-1" } } }));
  assert.equal(await pending, "turn-1");
});

test("Codex discovery uses the metadata database and exact workspace filter", async () => {
  const adapter = new CodexAppServerAdapter();
  const live = record();
  live.id = "discovery";
  adapter.start = async ({ cwd }) => { live.cwd = cwd; return live; };
  adapter.close = async () => true;
  adapter.request = async (_record, method, params) => {
    assert.equal(method, "thread/list");
    assert.deepEqual(params, { cwd: "/workspace", limit: 50, sortKey: "recency_at", sortDirection: "desc", useStateDbOnly: true });
    return { data: [
      { id: "inside", cwd: "/workspace", preview: "Inside", recencyAt: 20, status: { type: "notLoaded" } },
      { id: "outside", cwd: "/other", preview: "Outside", recencyAt: 10 },
    ] };
  };
  assert.deepEqual(await adapter.listSessions({ cwd: "/workspace" }), [{
    id: "inside", title: "Inside", preview: "Inside", cwd: "/workspace", branch: null, originUrl: null,
    createdAt: null, updatedAt: 20, status: "notLoaded", source: "unknown", replayFidelity: "full",
  }]);
});

test("machine-wide discovery omits the workspace filter and reports repository identity", async () => {
  const adapter = new CodexAppServerAdapter();
  const live = record();
  live.id = "discovery";
  adapter.start = async ({ cwd }) => { live.cwd = cwd; return live; };
  adapter.close = async () => true;
  adapter.request = async (_record, method, params) => {
    assert.equal(method, "thread/list");
    assert.deepEqual(params, { limit: 60, sortKey: "recency_at", sortDirection: "desc", useStateDbOnly: true });
    return { data: [
      { id: "here", cwd: "/workspace", preview: "Here", recencyAt: 20, gitInfo: { branch: "main", originUrl: "git@example.test:repo.git" } },
      { id: "there", cwd: "/other", preview: "There", recencyAt: 10 },
    ] };
  };
  const threads = await adapter.listThreads();
  assert.deepEqual(threads.map((thread) => [thread.id, thread.cwd, thread.branch]), [
    ["here", "/workspace", "main"],
    ["there", "/other", null],
  ]);
  assert.equal(threads[0].originUrl, "git@example.test:repo.git");
});

test("one app-server serves repeated discovery instead of spawning per request", async () => {
  const adapter = new CodexAppServerAdapter();
  const live = record();
  live.id = "discovery";
  live.status = "running";
  let starts = 0;
  adapter.start = async ({ cwd }) => { starts += 1; live.cwd = cwd; adapter.records.set(live.id, live); return live; };
  adapter.close = async () => true;
  adapter.request = async () => ({ data: [] });
  await adapter.listThreads();
  await adapter.listThreads();
  await Promise.all([adapter.listThreads(), adapter.listThreads()]);
  assert.equal(starts, 1);
  await adapter.retireDiscovery();
  await adapter.listThreads();
  assert.equal(starts, 2, "a retired discovery process is replaced on the next lookup");
});

test("attached images become native localImage input items", () => {
  const items = CodexAppServerAdapter.inputItems("Look at this", [
    { type: "image/png", path: "/chats/c1/attachments/a--shot.png" },
    { type: "application/octet-stream", path: "/chats/c1/attachments/b--notes.bin" },
    { type: "image/webp", path: "/chats/c1/attachments/c--diagram.webp" },
  ]);
  assert.deepEqual(items, [
    { type: "localImage", path: "/chats/c1/attachments/a--shot.png" },
    { type: "localImage", path: "/chats/c1/attachments/c--diagram.webp" },
    { type: "text", text: "Look at this" },
  ]);
});

test("a prompt with no attachments is still a single text item", () => {
  assert.deepEqual(CodexAppServerAdapter.inputItems("Hello", undefined), [{ type: "text", text: "Hello" }]);
  assert.deepEqual(CodexAppServerAdapter.inputItems("Hello", []), [{ type: "text", text: "Hello" }]);
});

test("tool noise is trimmed to the recent end without dropping older messages", () => {
  // A real thread runs five tool items per message, so a single raw cap would
  // spend the whole budget on recent commands and lose the conversation.
  const rows = [];
  for (let turn = 0; turn < 120; turn += 1) {
    rows.push({ turnId: `t${turn}`, item: { type: "userMessage", id: `u${turn}`, content: [{ type: "text", text: `ask ${turn}` }] } });
    for (let call = 0; call < 5; call += 1) {
      rows.push({ turnId: `t${turn}`, item: { type: "commandExecution", id: `e${turn}-${call}`, command: "ls", status: "completed" } });
    }
    rows.push({ turnId: `t${turn}`, item: { type: "agentMessage", id: `a${turn}`, text: `answer ${turn}` } });
  }
  const kept = CodexAppServerAdapter.recent(rows);
  const messages = kept.filter((row) => row.item.type === "userMessage" || row.item.type === "agentMessage");
  const tools = kept.filter((row) => row.item.type === "commandExecution");
  assert.equal(messages.length, 240, "every message in a 120-turn thread survives");
  assert.equal(messages[0].item.id, "u0", "including the first one");
  assert.equal(tools.length, 200);
  assert.equal(tools.at(-1).item.id, "e119-4", "tools are kept from the recent end");
  assert.deepEqual(kept.map((row) => rows.indexOf(row)), [...kept.map((row) => rows.indexOf(row))].sort((a, b) => a - b), "and order is preserved");
});

test("reasoning summaries stay in the message budget and never spend the tool budget", () => {
  const rows = [];
  for (let index = 0; index < 400; index += 1) rows.push({ turnId: "t1", item: { type: "reasoning", id: `r${index}`, summary: [], content: [] } });
  rows.push({ turnId: "t1", item: { type: "commandExecution", id: "e1", command: "ls", status: "completed" } });
  assert.deepEqual(CodexAppServerAdapter.recent(rows).map((row) => row.item.id), [
    ...Array.from({ length: 400 }, (_, index) => `r${index}`), "e1",
  ]);
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
  assert.equal(messages[1].content, "Looking now.");
  assert.deepEqual(messages[1].blocks.map((block) => block.type), ["text", "toolCall"], "commands hang off the message that ran them");
  assert.equal(messages[2].content, "Built.");
  assert.deepEqual(tools, [{ id: "e1", name: "command", args: "npm run build", done: true, result: "ok", isError: false }]);
});

test("a turn with no final_answer phase still ends in an answer", () => {
  const { messages } = CodexAppServerAdapter.threadTranscript([
    { turnId: "t1", item: { type: "userMessage", id: "u1", content: [{ type: "text", text: "Go" }] } },
    { turnId: "t1", item: { type: "agentMessage", id: "a1", text: "Working." } },
    { turnId: "t1", item: { type: "commandExecution", id: "e1", command: "ls", status: "completed" } },
    { turnId: "t1", item: { type: "agentMessage", id: "a2", text: "Done." } },
  ]);
  assert.deepEqual(messages.map((message) => message.stopReason), [undefined, "toolUse", "stop"]);
});

test("a turn that only runs commands carries them without inventing an answer", () => {
  const { messages } = CodexAppServerAdapter.threadTranscript([
    { turnId: "t1", item: { type: "userMessage", id: "u1", content: [{ type: "text", text: "Go" }] } },
    { turnId: "t1", item: { type: "commandExecution", id: "e1", command: "ls", status: "completed" } },
  ]);
  assert.deepEqual(messages.map((message) => [message.role, message.stopReason]), [["user", undefined], ["assistant", "toolUse"]]);
  assert.deepEqual(messages[1].blocks.map((block) => block.type), ["toolCall"]);
});

test("a thread with no stored history yields an empty transcript", async () => {
  assert.deepEqual(CodexAppServerAdapter.threadTranscript(undefined), { messages: [], tools: [] });
  assert.deepEqual(await new CodexAppServerAdapter().readTranscript({ chatId: "missing" }), { messages: [], tools: [] });
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
  assert.deepEqual(finals.map((event) => [event.messageId, event.stopReason]), [["m1", "stop"], ["m1", "toolUse"], ["m2", "stop"]]);
  assert.deepEqual(finals[1].blocks.map((block) => block.kind), ["text", "tool_call"]);
  assert.equal(finals[1].blocks[1].toolCallId, "e1");
  assert.deepEqual(finals[2].blocks.map((block) => block.kind), ["text"]);
  const tools = live.events.filter((event) => event.type === "tool_activity");
  assert.deepEqual(tools.map((event) => [event.phase, event.name]), [["start", "command"], ["end", "command"]]);
});

test("a command with no message before it gets a carrier of its own", () => {
  const adapter = new CodexAppServerAdapter();
  const live = record();
  adapter.notification(live, "turn/started", { turn: { id: "turn-1" } });
  adapter.notification(live, "item/started", { turnId: "turn-1", item: { type: "fileChange", id: "f1", changes: [{ path: "/repo/a.ts", diff: "@@" }] } });
  const finals = live.events.filter((event) => event.type === "assistant_content" && event.phase === "final");
  assert.equal(finals.length, 1);
  assert.deepEqual(finals[0].blocks.map((block) => [block.kind, block.name]), [["tool_call", "file change"]]);
  assert.equal(finals[0].stopReason, "toolUse");
});

// A record whose writes are captured, so the reply Codex receives is assertable.
function approvalHarness() {
  const adapter = new CodexAppServerAdapter();
  const live = record();
  live.active = true;
  live.generation = { id: "turn-1", closed: false, settled: false };
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
  assert.equal(live.activity, "waiting_for_user");
  assert.equal(written.length, 0, "nothing is sent back until the user answers");

  assert.equal(adapter.respondHostUi(live.id, { id: "ap-1", value: "Approve for session" }), "acceptForSession");
  assert.deepEqual(written, [{ id: 7, result: { decision: "acceptForSession" } }]);
  assert.ok(live.events.some((event) => event.type === "permission_resolved" && event.requestId === "ap-1"));
  assert.equal(live.activity, "working", "the turn resumes once the prompt clears");
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

test("the pre-v2 approval spelling uses its own decision vocabulary", () => {
  const { adapter, live, written } = approvalHarness();
  adapter.receive(live, JSON.stringify({ id: 3, method: "execCommandApproval",
    params: { callId: "call-9", command: ["git", "push"] } }));
  assert.match(live.events.find((event) => event.type === "permission_request").message, /git push/);
  adapter.respondHostUi(live.id, { id: "call-9", value: "Approve" });
  assert.deepEqual(written, [{ id: 3, result: { decision: "approved" } }]);
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

test("an approval answered elsewhere clears locally, and answering twice is inert", () => {
  const { adapter, live, written } = approvalHarness();
  adapter.receive(live, JSON.stringify({ id: 5, method: "item/fileChange/requestApproval",
    params: { itemId: "item-2", reason: "Edit src/main.js", grantRoot: "/repo" } }));
  assert.match(live.events.find((event) => event.type === "permission_request").message, /Grants write access to \/repo/);

  adapter.notification(live, "serverRequest/resolved", { requestId: 5 });
  assert.ok(live.events.some((event) => event.type === "permission_resolved"));
  assert.equal(adapter.respondHostUi(live.id, { id: "item-2", value: "Approve" }), null);
  assert.equal(written.length, 0, "a resolved prompt never writes a decision");
});

test("a turn that completes with a prompt outstanding does not strand it", () => {
  const { adapter, live } = approvalHarness();
  adapter.receive(live, JSON.stringify({ id: 5, method: "item/commandExecution/requestApproval",
    params: { approvalId: "ap-3", command: "make" } }));
  adapter.notification(live, "turn/completed", { turn: { id: "turn-1", status: "completed" } });
  assert.equal(live.approvals.size, 0);
  assert.ok(live.events.some((event) => event.type === "permission_resolved" && event.requestId === "ap-3"));
});

test("thread policy overrides only what Conduit was asked for", () => {
  assert.deepEqual(CodexAppServerAdapter.policy(), {}, "no override leaves the user's config.toml alone");
  assert.deepEqual(CodexAppServerAdapter.policy("on-request"), { approvalPolicy: "on-request" });
  assert.deepEqual(CodexAppServerAdapter.policy("", "workspace-write"), { sandbox: { type: "workspace-write" } });
  assert.deepEqual(CodexAppServerAdapter.policy("nonsense"), {}, "an unknown policy is not forwarded");
  assert.deepEqual(
    CodexAppServerAdapter.policy("never", { type: "workspace-write", networkAccess: false, writableRoots: ["/repo"] }),
    { approvalPolicy: "never", sandbox: { type: "workspace-write", networkAccess: false, writableRoots: ["/repo"] } },
  );
});

test("steering reaches Codex immediately and leaves the queue once delivered", async () => {
  const adapter = new CodexAppServerAdapter();
  const live = record();
  live.active = true;
  live.generation = { id: "turn-1", closed: false, settled: false };
  adapter.records.set(live.id, live);
  const sent = [];
  adapter.request = (_record, method, params) => { sent.push({ method, params }); return Promise.resolve({}); };

  const result = await adapter.queue(live.id, "steer", "use the other file");
  assert.deepEqual(result, { queued: "steer" });
  assert.equal(sent[0].method, "turn/steer");
  assert.equal(sent[0].params.expectedTurnId, "turn-1");
  assert.equal(sent[0].params.threadId, "thread-1");
  assert.deepEqual(sent[0].params.input, [{ type: "text", text: "use the other file" }]);

  const queues = live.events.filter((event) => event.type === "queue_state").map((event) => event.queue.steering);
  assert.deepEqual(queues, [["use the other file"], []], "it appears while in flight, then clears");
});

test("steering a settled turn is refused rather than silently dropped", async () => {
  const adapter = new CodexAppServerAdapter();
  const live = record();
  adapter.records.set(live.id, live);
  await assert.rejects(() => adapter.queue(live.id, "steer", "too late"), { code: "invalid_request" });
  await assert.rejects(() => adapter.queue(live.id, "follow_up", "   "), { code: "invalid_request" });
});

test("a follow-up waits for the turn and then starts the next one", async () => {
  const adapter = new CodexAppServerAdapter();
  const live = record();
  live.active = true;
  live.generation = { id: "turn-1", closed: false, settled: false };
  adapter.records.set(live.id, live);
  const prompted = [];
  adapter.prompt = (id, message) => { prompted.push({ id, message }); return Promise.resolve("turn-2"); };

  assert.deepEqual(await adapter.queue(live.id, "follow_up", "then run the tests"), { queued: "follow_up" });
  assert.deepEqual(live.events.at(-1).queue.followUp, ["then run the tests"]);
  assert.deepEqual(prompted, [], "nothing is sent while the turn is running");

  adapter.notification(live, "turn/completed", { turn: { id: "turn-1", status: "completed" } });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(prompted, [{ id: live.id, message: "then run the tests" }]);
  assert.deepEqual(live.events.at(-1).queue.followUp, [], "the queue empties as it is sent");
});
