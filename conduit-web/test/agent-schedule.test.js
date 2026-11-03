import test from "node:test";
import assert from "node:assert/strict";
import { listSchedules } from "../src/agent/schedule.js";
import { agentFixture } from "./helpers/agent-fixture.js";

async function next(t, timezone, now, schedule) {
  t.mock.timers.enable({ apis: ["Date"], now });
  const { agent } = await agentFixture(t, { timezone });
  await agent.update((doc) => { doc.schedules.daily = { id: "daily", title: "Review", kind: "daily", at: "09:00", ...schedule }; });
  return (await listSchedules(agent))[0].nextAt;
}

// persistent-agent.md, Trigger; schedule.js localTime never uses the server's zone.
test("a daily schedule fires at its local time across the daylight saving change", async (t) => {
  const now = Date.UTC(2030, 2, 9, 16);
  const at = "09:00";
  const actual = await next(t, "America/New_York", now, { at });
  const fields = new Intl.DateTimeFormat("en-GB", { timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(Date.parse(actual));
  assert.equal(fields, at);
  assert.ok(Date.parse(actual) > now);
  assert.ok(Date.parse(actual) - now < 24 * 3600_000);
});

// schedule.js nextDaily: for a gap, move the time forward by the gap.
test("a daily time inside the spring clock gap moves forward by that gap", async (t) => {
  const now = Date.UTC(2030, 2, 10, 5);
  const actual = await next(t, "America/New_York", now, { at: "02:30" });
  const local = new Intl.DateTimeFormat("en-GB", { timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(Date.parse(actual));
  assert.equal(local, "03:30");
  assert.ok(Date.parse(actual) - now < 4 * 3600_000);
});

// schedule.js nextDaily: a daily routine that ran today waits for the next local day.
test("a repeated local time cannot create a second daily slot after today's firing", async (t) => {
  const now = Date.UTC(2030, 10, 3, 5, 45);
  const actual = await next(t, "America/New_York", now, { at: "01:30", lastAt: new Date(now - 15 * 60000).toISOString() });
  const day = (time) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(time);
  assert.notEqual(day(Date.parse(actual)), day(now));
  assert.ok(Date.parse(actual) > now);
  assert.ok(Date.parse(actual) - now < 25 * 3600_000);
});
