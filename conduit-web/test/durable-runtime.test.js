import assert from "node:assert/strict";
import test, { before, after } from "node:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { startConduitHarness } from "./helpers/conduit-harness.js";
import { SCRIPTED_MODELS } from "../src/server/scripted-model.js";

let harness;
let dataRoot;
before(async () => {
  dataRoot = await fs.mkdtemp(path.join(os.tmpdir(), "conduit-durable-"));
  harness = await startConduitHarness({ env: { CONDUIT_DATA_ROOT: dataRoot } });
});
after(async () => {
  await harness?.stop();
  if (dataRoot) await fs.rm(dataRoot, { recursive: true, force: true });
});

async function json(route, body) {
  const response = await harness.request(route, { signal: AbortSignal.timeout(4000), ...(body === undefined ? {} : { method: "POST", body: JSON.stringify(body) }) });
  assert.ok(response.ok, `${route}: ${response.status} ${response.ok ? "" : await response.text()}`);
  return response.json();
}
async function chat(t) {
  const project = await harness.createProject(t.name);
  const created = await json("/v0/chats", { projectId: project.id, profileId: "test" });
  // The read tool needs an actual project file, not the checkout or the user's files.
  await fs.writeFile(path.join(project.workingRoot, "fixture.txt"), "durable fixture\n");
  const live = await json("/v0/live-sessions", { chatId: created.id, projectId: project.id, intent: "prompt", model: SCRIPTED_MODELS[0], thinkingLevel: "max" });
  const stream = harness.connectStream(live.id);
  t.after(() => stream.close());
  await stream.opened;
  return { id: created.id, stream, send: (message) => stream.socket.send(JSON.stringify(message)) };
}
const ops = (stream, op) => stream.messages.filter((event) => event.type === "transcript_op" && event.op === op);
const answer = (event) => event.type === "transcript_op" && event.op === "message.close" && !event.interim && event.stopReason === "stop" && event.content;
async function turn(c, message) {
  c.send({ type: "prompt", message });
  const started = await c.stream.next((event) => event.type === "status" && event.phase === "started", 4000);
  await c.stream.next((event) => event.type === "status" && event.phase === "settled" && event.generationId === started.generationId, 4000);
}

// Sources: docs/TESTING.md, The Test profile; README.md, Live session protocol;
// docs/plans/transcript-modes.md, The rule.
test("tool results stay in call order and a failed tool still permits a final answer", async (t) => {
  const c = await chat(t);
  await turn(c, "narrate tool bash fail");
  const opens = ops(c.stream, "tool.open");
  const closes = ops(c.stream, "tool.close");
  assert.deepEqual(opens.map((event) => event.name), ["read", "bash", "read"]);
  assert.deepEqual(closes.map((event) => event.toolCallId), opens.map((event) => event.toolCallId));
  assert.deepEqual(closes.map((event) => Boolean(event.isError)), [false, false, true]);
  assert.ok(closes.every((event) => event.output.length > 0));
  const final = c.stream.messages.findLast(answer);
  assert.ok(final, "the turn has a final answer");
  assert.ok(c.stream.messages.indexOf(final) > c.stream.messages.indexOf(closes.at(-1)));
  assert.ok(ops(c.stream, "message.close").filter((event) => event.blocks?.some((block) => block.kind === "tool_call")).every((event) => event.interim));
  const stored = await json(`/v0/sessions/${c.id}`);
  assert.deepEqual(stored.tools.map((tool) => [tool.toolCallId, tool.output, Boolean(tool.isError)]), closes.map((tool) => [tool.toolCallId, tool.output, Boolean(tool.isError)]));
  assert.ok(stored.messages.some((message) => message.content === final.content && !message.interim));
});

// Source: durable-adapter.js, "Codemode records nested calls only in its result's details".
test("a codemode script records its inner reads and commands for the UI", async (t) => {
  const c = await chat(t);
  await turn(c, "script");
  const script = ops(c.stream, "tool.open").find((event) => event.name === "codemode");
  const result = ops(c.stream, "tool.close").find((event) => event.toolCallId === script?.toolCallId);
  assert.ok(result && !result.isError, "the script completes successfully");
  assert.ok(Array.isArray(result.calls), "the script result exposes its inner calls");
  assert.deepEqual(result.calls.map((call) => call.name), ["read", "bash"]);
  assert.ok(result.calls.every((call) => call.done && !call.isError));
  const stored = await json(`/v0/sessions/${c.id}`);
  assert.deepEqual(stored.tools.find((tool) => tool.toolCallId === script.toolCallId).calls.map((call) => call.name), result.calls.map((call) => call.name));
});

// Sources: subagents.js, foreground ownership comment; persistent-agent.md, Agent ids and labels.
test("foreground agents finish before the parent answer and have distinct fg labels", async (t) => {
  const c = await chat(t);
  await turn(c, "spawn 3 spawns");
  const agents = (await json(`/v0/chats/${c.id}/agents`)).agents;
  assert.equal(agents.length, 4, "one direct spawn and three fan-out tasks");
  assert.equal(new Set(agents.map((agent) => agent.id)).size, agents.length);
  assert.ok(agents.every((agent) => /^fg-\d+$/.test(agent.id) && agent.status === "finished"));
  const children = (await json(`/v0/chats/${c.id}/subagents`)).subagents;
  assert.equal(children.length, agents.length);
  assert.ok(children.every((child) => child.answer));
  const final = c.stream.messages.findLast(answer);
  assert.ok(final);
  const results = ops(c.stream, "tool.close");
  assert.ok(results.every((event) => !event.isError && c.stream.messages.indexOf(event) < c.stream.messages.indexOf(final)));
});

// Source: subagents.js, background ownership and reporter comments.
test("a background agent returns immediately and its later report wakes the parent", async (t) => {
  const c = await chat(t);
  await turn(c, "background 1t");
  const placed = await c.stream.next((event) => event.type === "transcript_op" && event.op === "message.open" && event.message.origin === "harness" && event.message.agent, 4000);
  await c.stream.next((event) => event.type === "transcript_op" && event.op === "turn.settle" && event.promptId === placed.message.id && event.outcome === "complete", 4000);
  const stored = await json(`/v0/sessions/${c.id}`);
  const agents = (await json(`/v0/chats/${c.id}/agents`)).agents;
  assert.equal(agents.length, 1);
  assert.match(agents[0].id, /^bg-\d+$/);
  const reportIndex = stored.messages.findIndex((message) => message.origin === "harness" && message.agent);
  const report = stored.messages[reportIndex];
  assert.equal(report.agent.id, agents[0].id);
  const child = (await json(`/v0/chats/${c.id}/subagents`)).subagents[0];
  assert.equal(report.content, child.answer, "the child's answer reaches the parent as a report");
  assert.ok(stored.messages.slice(0, reportIndex).some((message) => message.role === "assistant" && !message.interim && message.stopReason === "stop"), "the parent answered before the report arrived");
  assert.equal(ops(c.stream, "tool.close")[0].isError, false);
  assert.ok(stored.messages.some((message) => message.role === "assistant" && message.answers === report.id && message.content.includes(report.content)));
});

// Sources: durable-runtime.js, Ask the person; README.md, host_ui_response.
test("a question card pauses the turn and its answer resumes it", async (t) => {
  const c = await chat(t);
  c.send({ type: "prompt", message: "ask" });
  const request = await c.stream.next((event) => event.type === "permission_request" && event.kind === "question", 4000);
  assert.equal(ops(c.stream, "turn.settle").length, 0, "no answer while the card is pending");
  assert.equal(ops(c.stream, "tool.close").length, 0, "ask_user still waits");
  const question = request.questions[0];
  const freeform = "use the fixture choice";
  c.send({ type: "host_ui_response", id: request.id, answers: [{ questionId: question.id, optionIds: [question.options[0].id], freeform }] });
  await c.stream.next((event) => event.type === "status" && event.phase === "settled", 4000);
  const result = ops(c.stream, "tool.close")[0];
  assert.ok(result.output.includes(question.options[0].label));
  assert.ok(result.output.includes(freeform));
  assert.ok(c.stream.messages.some(answer));
  assert.ok(c.stream.messages.some((event) => event.type === "permission_resolved" && event.requestId === request.id));
});

// durable-runtime.js: committed turns and tool calls live in SQLite; the chat log is a projection.
test("finished turn messages and tool results survive a server restart", async (t) => {
  const c = await chat(t);
  await turn(c, "tool 1t");
  const before = await json(`/v0/sessions/${c.id}`);
  assert.ok(before.messages.some((message) => message.role === "assistant" && !message.interim));
  assert.ok(before.tools.some((tool) => tool.output));
  await harness.restart();
  const after = await json(`/v0/sessions/${c.id}`);
  // Compare history content and links, not live-only generation metadata or timestamps.
  const messages = (history) => history.messages.map(({ id, role, content, blocks, interim, answers, stopReason }) =>
    ({ id, role, content, blocks, interim, answers, stopReason }));
  const tools = (history) => history.tools.map(({ toolCallId, name, input, output, isError, calls }) =>
    ({ toolCallId, name, input, output, isError, calls }));
  assert.deepEqual(messages(after), messages(before));
  assert.deepEqual(tools(after), tools(before));
});

// Source: subagents.js, "A Stop leaves a chat's background agents working".
test("stop ends the turn but keeps a background report without waking the parent", async (t) => {
  const c = await chat(t);
  c.send({ type: "prompt", message: "background ask" });
  const question = await c.stream.next((event) => event.type === "permission_request" && event.kind === "question", 4000);
  c.send({ type: "stop_generation", generationId: question.generationId });
  await c.stream.next((event) => event.type === "status" && event.phase === "stopped", 4000);
  await c.stream.next((event) => event.type === "transcript_op" && event.op === "message.open" && event.message.origin === "harness" && event.message.agent, 2000);
  const stored = await json(`/v0/sessions/${c.id}`);
  assert.equal(stored.messages.find((message) => message.role === "user" && !message.origin).outcome, "interrupted");
  const report = stored.messages.find((message) => message.origin === "harness" && message.agent);
  const children = (await json(`/v0/chats/${c.id}/subagents`)).subagents;
  assert.equal(children.length, 1);
  assert.ok(children[0].answer, "the background child finished despite stop");
  assert.equal(report.content, children[0].answer);
  assert.match(report.agent.id, /^bg-\d+$/);
  assert.equal(stored.turnOpen, false);
  assert.ok(!stored.messages.some((message) => message.role === "assistant" && message.answers === report.id), "the kept report did not start another turn");
  assert.ok(!c.stream.messages.some(answer), "the stopped question turn has no final answer");
});

test("history survives a server restart", { skip: "startConduitHarness has no restart method" }, () => {});
