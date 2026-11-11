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

// A room with anyone else is never written without approval.
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
    assert.match(outcome.output[0].text, /not sent/i);
  }
  assert.deepEqual(log.list().map((item) => item.id), before);
  assert.equal(sent.mock.callCount(), 0);
});

// Unknown senders wait in the mail room, held, without a model turn and outside the context
// inbox (which is what routines report, not mail to jbot).
test("unknown email waits in the mail room while the person's email starts a turn", async (t) => {
  const { log, email, agent, prompts } = await mailbox(t);
  const events = [];
  agent.fireEvent = async (name, event) => { events.push([name, event.key]); return []; };
  await email.receive(mail("unknown", { from: "other@example.test" }));
  assert.equal(prompts.length, 0);
  assert.deepEqual(events.map(([name]) => name), ["held-mail"], "held mail wakes routines on held-mail");
  assert.equal(log.list()[0].delivery.state, "held");
  assert.ok(log.list()[0].body.includes("Body of unknown"));
  assert.deepEqual(Object.values((await agent.state()).inbox || {}), []);
  await email.receive(mail("person"));
  assert.equal(prompts.length, 1);
  assert.ok(prompts[0][1].includes("Body of person"));
});

// Pending delivery after a restart is uncertain and is never resent automatically.
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

