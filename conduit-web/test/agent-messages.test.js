import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { EmailChannel } from "../src/agent/email.js";
import { MessageLog, MessageTools } from "../src/agent/messages.js";
import { agentFixture } from "./helpers/agent-fixture.js";

async function mailbox(t) {
  const fixture = await agentFixture(t);
  const { root, agent } = fixture;
  const log = await new MessageLog(path.join(root, "messages.jsonl")).load();
  t.after(async () => { await log.writing; });
  const email = new EmailChannel({ file: path.join(root, "email.json"), agent, log });
  email.config = { address: "bot@example.test", worker: "https://mail.example.test", secret: "test-only", person: ["person@example.test"], send: true };
  log.channels.email = email;
  agent.runtime.messageLog = log;
  // Model admission is outward I/O; messages and their rooms remain real.
  const prompts = [];
  agent.chatHost = { say: async (...args) => { prompts.push(args); } };
  return { ...fixture, log, email, prompts };
}

const mail = (id, { from = "person@example.test", cc, reply } = {}) => Buffer.from([
  // Cloudflare's receipt proving the From domain: only then is a mail from the person's address the person's.
  `Authentication-Results: mx.cloudflare.net; dkim=pass header.d=${from.split("@")[1]}; dmarc=pass header.from=${from.split("@")[1]}`,
  `Message-ID: <${id}@example.test>`, `From: ${from}`, "To: bot@example.test", "Subject: Plans",
  ...(cc ? [`Cc: ${cc}`] : []), ...(reply ? [`In-Reply-To: <${reply}@example.test>`] : []), "", `Body of ${id}`,
].join("\r\n"));

// persistent-agent.md, Rooms and Email: one app room; one room per email thread.
test("the app uses one room and separate email threads use separate rooms", async (t) => {
  const { log, email } = await mailbox(t);
  log.append({ id: "app-one", direction: "in", body: "One" });
  log.append({ id: "app-two", direction: "out", body: "Two" });
  assert.deepEqual(log.list().map(({ channel, room }) => [channel, room]), [["app", "app"], ["app", "app"]]);
  await email.receive(mail("first"));
  await email.receive(mail("second"));
  await email.receive(mail("reply", { reply: "first" }));
  const [first, second, reply] = log.list().filter((item) => item.channel === "email");
  assert.notEqual(first.room, second.room);
  assert.equal(reply.room, first.room);
  assert.equal(reply.native.inReplyTo, first.native.messageId);
});

// persistent-agent.md, Out final text and Email Replies: answer the originating room.
test("an answer returns to its originating email room and thread", async (t) => {
  const { log, email, api } = await mailbox(t);
  await email.receive(mail("origin"));
  const origin = log.list()[0];
  log.update(origin.id, () => ({ entryId: 10 }));
  await email.receive(mail("later"));
  log.update(log.list()[1].id, () => ({ entryId: 30 }));
  const reply = log.replyRoom(api.conversationId, 20);
  assert.deepEqual(reply, { channel: "email", room: origin.room });
  const destination = email.destination({ ...reply, body: "Thursday" });
  assert.deepEqual(destination.to, [origin.native.from.address]);
  assert.equal(destination.inReplyTo, origin.native.messageId);
  assert.ok(destination.references.includes(origin.native.messageId));
  assert.deepEqual(log.replyRoom("another-conversation", 20), { channel: "app", room: "app" });
});

// persistent-agent.md, Email Replies: a room with anyone else is never written without approval.
test("email to a room with another sender or copied recipient is refused before sending", async (t) => {
  const { log, email, agent, api } = await mailbox(t);
  const sent = t.mock.method(email, "send", async () => { throw new Error("must not send"); });
  await email.receive(mail("stranger", { from: "other@example.test" }));
  await email.receive(mail("copied", { cc: "other@example.test" }));
  const before = log.list().map((item) => item.id);
  const tool = MessageTools(agent.runtime).tools.find((tool) => tool.name === "message");
  for (const message of log.list()) {
    assert.equal(email.personOnly(message.room), false);
    const outcome = await tool.execute({ text: "Reply", room: message.room }, api);
    assert.equal(outcome.isError, true);
    assert.match(outcome.content[0].text, /not sent/i);
  }
  assert.deepEqual(log.list().map((item) => item.id), before);
  assert.equal(sent.mock.callCount(), 0);
});

// persistent-agent.md, Email Who wakes jbot: unknown senders wait as context, without a model turn.
test("unknown email waits in context while the person's email starts a turn", async (t) => {
  const { log, email, agent, prompts } = await mailbox(t);
  await email.receive(mail("unknown", { from: "other@example.test" }));
  assert.equal(prompts.length, 0);
  assert.equal(log.list()[0].delivery.state, "held");
  const entries = Object.values((await agent.state()).inbox);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].status, "unhandled");
  assert.ok(entries[0].body.includes("Body of unknown"));
  await email.receive(mail("person"));
  assert.equal(prompts.length, 1);
  assert.ok(prompts[0][1].includes("Body of person"));
});

// messages.js: pending delivery after a restart is uncertain and is never resent automatically.
test("an interrupted email delivery becomes uncertain after reload and is not resent", { timeout: 1500 }, async (t) => {
  const { root, log, email } = await mailbox(t);
  await email.receive(mail("origin"));
  const room = log.list()[0].room;
  let finish;
  const delivered = new Promise((resolve) => { finish = resolve; });
  const send = t.mock.method(email, "send", () => delivered);
  log.append({ id: "outgoing", direction: "out", channel: "email", room, body: "Reply", at: new Date().toISOString() });
  await log.writing;
  const loaded = new MessageLog(path.join(root, "messages.jsonl"));
  loaded.channels.email = email;
  await loaded.load();
  await loaded.writing;
  assert.equal(loaded.list().find((item) => item.id === "outgoing").delivery.state, "uncertain");
  assert.equal(send.mock.callCount(), 1);
  const settled = new Promise((resolve) => log.listeners.add(({ message }) => {
    if (message.id === "outgoing" && message.delivery.state === "sent") resolve();
  }));
  finish({ messageId: "sent-id" });
  await settled;
  await log.writing;
});

test("quiet hours suppress non-urgent pushes while retaining messages and approvals", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: Date.UTC(2030, 0, 15, 23, 30) });
  const { agent, log, api } = await mailbox(t);
  agent.cached.quietHours = { enabled: true, start: "23:00", end: "07:00" };
  const { agentNotifier } = await import("../src/agent/notify.js");
  const sent = [];
  const push = { list: () => [{ id: "phone", label: "Phone" }], send: async (message) => { sent.push(message); return [{ id: "phone", ok: true }]; } };
  agent.runtime.agentNotify = agentNotifier({ agent, push, hubId: () => "hub" });
  const tool = MessageTools(agent.runtime).tools.find((item) => item.name === "message");
  const call = (id) => ({ ...api, taskId: id, memo: async (_key, value) => value });
  await tool.execute({ text: "Night update", notify: "push" }, call("night"));
  assert.equal(log.list().find((item) => item.id === "tool:night").body, "Night update");
  assert.equal(sent.length, 0);
  assert.deepEqual(await agent.runtime.agentNotify({ kind: "approval", conversationId: api.conversationId, text: "Approval", key: "ask" }), { to: [], missed: [] });
  assert.equal(sent.length, 0, "approval priority cannot bypass quiet hours");
  await tool.execute({ text: "Urgent update", notify: "urgent" }, call("urgent"));
  assert.equal(sent.length, 1);
  assert.equal(log.list().find((item) => item.id === "tool:urgent").body, "Urgent update");
  t.mock.timers.setTime(Date.UTC(2030, 0, 16, 7));
  await agent.runtime.agentNotify({ kind: "approval", conversationId: api.conversationId, text: "Approval", key: "ask" });
  assert.equal(sent.length, 2, "approval pushes after quiet hours");
});

test("a person-requested test push works during quiet hours", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: Date.UTC(2030, 0, 15, 23, 30) });
  const { agent } = await agentFixture(t, { quietHours: { enabled: true, start: "23:00", end: "07:00" } });
  const { registerPushRoutes } = await import("../src/server/routes/push.js");
  const routes = new Map();
  const app = { post: (route, handler) => routes.set(route, handler), get() {}, delete() {} };
  let sent = 0;
  registerPushRoutes(app, { agent, hubId: () => "hub", push: { send: async () => { sent++; return []; } } });
  let body;
  const response = { json: (value) => { body = value; return response; } };
  await routes.get("/v0/push/test")({ body: {} }, response, (error) => { throw error; });
  assert.deepEqual(body, []);
  assert.equal(sent, 1);
  t.mock.timers.setTime(Date.UTC(2030, 0, 16, 7));
  await routes.get("/v0/push/test")({ body: {} }, response, (error) => { throw error; });
  assert.equal(sent, 2);
});
