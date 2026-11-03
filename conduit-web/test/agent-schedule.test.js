import test from "node:test";
import assert from "node:assert/strict";
import { listSchedules, nextTime } from "../src/agent/schedule.js";
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

const rulesNext = (rules, now, lastAt = null, zone = "UTC", dailyLastAt = {}) => nextTime({ kind: "rules", rules, lastAt, dailyLastAt }, zone, Date.parse(now));
const iso = (time) => time === null ? null : new Date(time).toISOString();

test("a window beats the default cadence and a narrower window beats a wider one", () => {
  const rules = [{ kind: "every", everyMinutes: 60 },
    { kind: "every", everyMinutes: 120, during: "22:00-07:00" },
    { kind: "every", everyMinutes: 30, during: "23:00-01:00" }];
  assert.equal(iso(rulesNext(rules, "2030-01-15T22:30:00Z", "2030-01-15T22:00:00Z")), "2030-01-15T23:30:00.000Z");
  assert.equal(iso(rulesNext(rules.slice(0, 2), "2030-01-15T23:30:00Z", "2030-01-15T22:00:00Z")), "2030-01-16T00:00:00.000Z");
  assert.equal(iso(rulesNext([...rules, { kind: "every", everyMinutes: 5, during: "00:00-02:00" }], "2030-01-16T00:10:00Z")), "2030-01-16T00:30:00.000Z");
});

test("an interval in a midnight window counts from the start or the later last firing", () => {
  const rules = [{ kind: "every", everyMinutes: 120, during: "23:00-07:00" }];
  assert.equal(iso(rulesNext(rules, "2030-01-16T00:30:00Z")), "2030-01-16T01:00:00.000Z");
  assert.equal(iso(rulesNext(rules, "2030-01-16T00:30:00Z", "2030-01-16T00:00:00Z")), "2030-01-16T02:00:00.000Z");
});

test("the next firing crosses both window boundaries without firing the overridden rule", () => {
  const rules = [{ kind: "every", everyMinutes: 60 }, { kind: "every", everyMinutes: 120, during: "23:00-07:00" }];
  assert.equal(iso(rulesNext(rules, "2030-01-15T22:30:00Z", "2030-01-15T22:00:00Z")), "2030-01-16T01:00:00.000Z");
  assert.equal(iso(rulesNext(rules, "2030-01-16T06:30:00Z", "2030-01-16T06:00:00Z")), "2030-01-16T07:00:00.000Z");
});

test("disabled quiet windows do not override the default and can leave no firing", () => {
  const quiet = { kind: "every", everyMinutes: 120, during: null };
  assert.equal(iso(rulesNext([{ kind: "every", everyMinutes: 60 }, quiet], "2030-01-16T00:30:00Z")), "2030-01-16T01:30:00.000Z");
  assert.equal(rulesNext([quiet], "2030-01-16T00:30:00Z"), null);
});

test("daily times outside their window never fire; one-offs respect their window", () => {
  assert.equal(rulesNext([{ kind: "daily", at: "09:00", during: "10:00-12:00" }], "2030-01-15T00:00:00Z"), null);
  const once = { kind: "once", at: "2032-01-15T11:00:00Z", during: "10:00-12:00" };
  assert.equal(iso(rulesNext([once], "2030-01-15T00:00:00Z")), "2032-01-15T11:00:00.000Z");
  assert.equal(rulesNext([{ ...once, at: "2032-01-15T12:00:00Z" }], "2030-01-15T00:00:00Z"), null);
});

test("unwindowed list rules compete for the earliest slot, including one-offs", () => {
  const rules = [{ kind: "daily", at: "12:00" }, { kind: "every", everyMinutes: 30 }, { kind: "once", at: "2030-01-15T10:15:00Z" }];
  assert.equal(iso(rulesNext(rules, "2030-01-15T10:00:00Z")), "2030-01-15T10:15:00.000Z");
  assert.equal(iso(rulesNext(rules, "2030-01-15T10:15:00Z")), "2030-01-15T10:15:00.000Z");
});

test("window intervals use elapsed time through both DST changes", () => {
  const rules = [{ kind: "every", everyMinutes: 120, during: "00:00-07:00" }];
  assert.equal(iso(rulesNext(rules, "2030-03-10T05:30:00Z", null, "America/New_York")), "2030-03-10T07:00:00.000Z");
  assert.equal(iso(rulesNext(rules, "2030-11-03T04:30:00Z", null, "America/New_York")), "2030-11-03T06:00:00.000Z");
  const daily = [{ kind: "daily", at: "02:30", during: "00:00-05:00" }];
  assert.equal(iso(rulesNext(daily, "2030-03-10T05:00:00Z", null, "America/New_York")), "2030-03-10T07:30:00.000Z");
  assert.equal(iso(rulesNext([{ kind: "daily", at: "01:30", during: "00:00-05:00" }], "2030-11-03T05:45:00Z", "2030-11-03T05:30:00Z", "America/New_York", { "01:30": "2030-11-03T05:30:00Z" })), "2030-11-04T06:30:00.000Z");
});

test("legacy unwindowed schedules retain their interval and one-off times", () => {
  assert.equal(iso(nextTime({ kind: "every", everyMinutes: 60 }, "UTC", Date.parse("2030-01-15T10:30:00Z"))), "2030-01-15T11:30:00.000Z");
  assert.equal(iso(nextTime({ kind: "once", at: "2030-01-15T12:00:00Z" }, "UTC", Date.parse("2030-01-15T10:30:00Z"))), "2030-01-15T12:00:00.000Z");
});

test("different daily rules can fire on the same day without repeating a completed daily rule", () => {
  const rules = [{ kind: "daily", at: "09:00" }, { kind: "daily", at: "12:00" }];
  assert.equal(iso(rulesNext(rules, "2030-01-15T09:00:00Z", "2030-01-15T09:00:00Z", "UTC", { "09:00": "2030-01-15T09:00:00Z" })), "2030-01-15T12:00:00.000Z");
});

test("window-only rules wait until their next window and start their interval there", () => {
  const rules = [{ kind: "every", everyMinutes: 120, during: "23:15-07:00" }];
  assert.equal(iso(rulesNext(rules, "2030-01-15T22:50:00Z", "2030-01-15T22:30:00Z")), "2030-01-16T01:15:00.000Z");
});

test("a midnight window keeps elapsed intervals through DST changes", () => {
  const rules = [{ kind: "every", everyMinutes: 120, during: "23:00-07:00" }];
  assert.equal(iso(rulesNext(rules, "2030-03-10T05:30:00Z", null, "America/New_York")), "2030-03-10T06:00:00.000Z");
  assert.equal(iso(rulesNext(rules, "2030-11-03T04:30:00Z", null, "America/New_York")), "2030-11-03T05:00:00.000Z");
});
