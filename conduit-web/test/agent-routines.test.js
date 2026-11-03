import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { appendEntry } from "../src/agent/inbox.js";
import { executeRoutine, runInstructions } from "../src/agent/routines.js";
import { listRoutines, parseRoutine, readRoutine, ROUTINES_DIR, writeRoutine } from "../src/agent/routine-files.js";
import { agentFixture } from "./helpers/agent-fixture.js";

const now = Date.UTC(2030, 0, 15, 12);
const text = "---\ntitle: Review arrivals\ntrigger: { every: 30 }\ntasks: [{ id: arrivals, kind: inbox }]\ngate: when-new\noutput: jbot\n---\nReview the gathered facts.";
const routine = () => parseRoutine(text, "heartbeat");
const news = (key, status) => ({ key, status, kind: "task", level: "fyi", title: key, headline: key, body: `${key} detail` });

// persistent-agent.md, Structures: one routine file; front matter and body have separate roles.
test("a saved routine keeps its trigger, tasks and instructions in its own file", async (t) => {
  const { root } = await agentFixture(t);
  const expected = routine();
  await writeRoutine(root, expected);
  assert.deepEqual(await fs.readdir(path.join(root, ROUTINES_DIR)), [`${expected.name}.md`]);
  assert.deepEqual(await readRoutine(root, expected.name), expected);
});

// listRoutines reports a bad file rather than losing its valid neighbours.
test("an invalid routine is reported without hiding valid routines", async (t) => {
  const { root } = await agentFixture(t);
  await writeRoutine(root, routine());
  await fs.writeFile(path.join(root, ROUTINES_DIR, "broken.md"), "---\ntrigger: [\n---\nBad YAML");
  const listed = await listRoutines(root);
  assert.deepEqual(listed.find((item) => item.name === "heartbeat"), routine());
  assert.equal(typeof listed.find((item) => item.name === "broken")?.error, "string");
  assert.ok(listed.find((item) => item.name === "broken").error.length > 0);
});

// persistent-agent.md, Gate and Cursor: no new task output means no model run.
test("a heartbeat starts no run for an empty inbox or entries its cursor already saw", async (t) => {
  const { agent } = await agentFixture(t);
  const state = await agent.state();
  assert.equal((await executeRoutine(agent, routine(), { state, now })).run, false);
  const item = appendEntry(state, news("seen-news", "unhandled"), now - 1);
  const outcome = await executeRoutine(agent, routine(), { state, now, cursors: { arrivals: { since: item.at } } });
  assert.equal(outcome.run, false);
  assert.equal(outcome.fresh, 0);
});

// persistent-agent.md, Structures: heartbeat reads unhandled context only.
test("a heartbeat does not start a run for handled context", async (t) => {
  const { agent } = await agentFixture(t);
  const state = await agent.state();
  appendEntry(state, news("handled-news", "handled"), now - 1);
  const outcome = await executeRoutine(agent, routine(), { state, now });
  assert.equal(outcome.run, false);
  assert.equal(outcome.fresh, 0);
});

// persistent-agent.md, How prompts are assembled: each task's tagged output is in the first message.
test("tasks gather in order before a run and their output becomes its first message", async (t) => {
  const { agent } = await agentFixture(t);
  const calls = [];
  // Executor is outward I/O; keep task gathering, gating and prompt assembly real.
  t.mock.method(agent.connectors, "ready", async () => {});
  t.mock.method(agent.connectors, "tools", () => [{ name: "mcp__executor__execute", execute: async ({ code }) => {
    const key = code.includes("first-source") ? "first" : "second";
    calls.push(key);
    return { output: [{ type: "text", text: JSON.stringify([{ id: key, title: `${key} finding` }]) }] };
  } }]);
  const plan = { ...routine(), tasks: ["first", "second"].map((id) => ({ id, kind: "executor", code: `// ${id}-source\nreturn tools.mail.list({});` })) };
  const cursors = Object.fromEntries(plan.tasks.map(({ id }) => [id, { primed: true, seen: [] }]));
  const outcome = await executeRoutine(agent, plan, { state: await agent.state(), cursors, now });
  assert.deepEqual(calls, plan.tasks.map(({ id }) => id));
  assert.equal(outcome.run, true);
  for (const { id } of plan.tasks) {
    assert.ok(outcome.message.includes(`<${id} `));
    assert.ok(outcome.message.includes(`${id} finding`));
  }
  assert.ok(outcome.message.indexOf("first finding") < outcome.message.indexOf("second finding"));
});

// persistent-agent.md, Trigger: quiet hours hold work; executeRoutine allows a routine to opt out.
test("quiet hours hold a routine before its tasks gather", async (t) => {
  const { agent } = await agentFixture(t, { quietHours: { enabled: true, start: "23:00", end: "07:00" } });
  const state = await agent.state();
  const night = Date.UTC(2030, 0, 15, 23);
  const plan = { ...routine(), gate: "always" };
  assert.deepEqual(await executeRoutine(agent, plan, { state, now: night }), { skipped: "quiet" });
  assert.equal((await executeRoutine(agent, { ...plan, quiet: false }, { state, now: night })).run, true);
  assert.equal((await executeRoutine(agent, plan, { state, now: Date.UTC(2030, 0, 16, 7) })).run, true);
});

// persistent-agent.md, Slots and Run: fixed variables fill blocks; private context requires opt-in.
test("run blocks fill user variables, keep unknown slots visible and require private context opt-in", async (t) => {
  const { root, agent } = await agentFixture(t);
  await fs.writeFile(path.join(root, "USER.md"), "---\nname: Mira\nhome: Hobart\n---\nPrivate user notes");
  await fs.writeFile(path.join(root, "RUN.md"), "For {{person.name}} in {{person.home}}; {{missing.value}}; {{now}}");
  await fs.writeFile(path.join(root, "MEMORY.md"), "Private memory notes");
  const plan = { ...routine(), body: "Help {{person.name}}." };
  const prompt = await runInstructions(agent, plan, now);
  assert.ok(prompt.includes("For Mira in Hobart"));
  assert.ok(prompt.includes("Help Mira."));
  assert.ok(prompt.includes("{{missing.value}}"));
  assert.ok(prompt.includes("{{now}}"), "the changing clock is not a fixed system slot");
  assert.ok(!prompt.includes("Private user notes"));
  assert.ok(!prompt.includes("Private memory notes"));
  assert.ok((await runInstructions(agent, { ...plan, context: ["memory"] }, now)).includes("Private memory notes"));
});
