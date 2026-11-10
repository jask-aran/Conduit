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

