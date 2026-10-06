#!/usr/bin/env node
/**
 * Does a turn hold still as it settles? (docs/plans/transcript-projection-plan.md,
 * Regression coverage.) Each scenario starts a fresh chat on the Test profile --
 * deterministic, no model call -- streams a turn, tags the answer and its trace
 * while they are live, and asserts once everything has settled that:
 *
 * - the tagged nodes are the ones still mounted (nothing rebuilt them);
 * - a trace opened mid-stream is still open;
 * - the answer's text was not rewritten, only extended;
 * - once settled, nothing in the turn is added, removed or moved for two
 *   seconds, and its action row shows once;
 * - a queued message never shows queued and sent at once, no answer is drawn
 *   above its prompt, no earlier turn still says it is working once a later
 *   prompt is taken, and what settles is what a reload shows.
 *
 * Prints ok/FAIL per scenario and exits 1 on any failure.
 *
 *   node scripts/probes/settle-stability.mjs [--only settle,stop-answer,deny-tool,stop-approval,queued,queued-tool,history]
 */
import { arg, open, origin } from "./lib.mjs";

const { page, close } = await open({ width: 1400, height: 1000 });
const api = (url, method, body) => page.evaluate(async ([url, method, body]) => {
  const response = await fetch(url, { method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  return response.json().catch(() => null);
}, [url, method, body]);

await page.goto(origin);
await page.evaluate(async () => {
  for (const registration of await navigator.serviceWorker.getRegistrations()) await registration.unregister();
  for (const key of await caches.keys()) await caches.delete(key);
});

const composer = () => page.locator(".chat-main [data-part='composer'] textarea").first();
const stopButton = () => page.locator("[aria-label='Stop response']:visible").first();
const send = async (text) => { await composer().click(); await composer().fill(text); await page.keyboard.press("Enter"); };
const settled = () => page.waitForFunction(() => !document.querySelector("[aria-label='Stop response']"), null, { timeout: 60_000 });

/** Mark the live answer and trace of the last turn, and remember what they said. */
const tag = () => page.evaluate(() => {
  const answer = [...document.querySelectorAll(".bubble-assistant")].at(-1);
  const trace = [...document.querySelectorAll(".turn-trace:not(.turn-trace-starting)")].at(-1);
  if (answer) answer.dataset.probe = "answer";
  if (trace) trace.dataset.probe = "trace";
  return { answer: Boolean(answer), trace: Boolean(trace), text: answer?.textContent || "", open: trace?.dataset.open === "true" };
});

/** After settle: what survived, and whether anything churns for two seconds. */
const inspect = () => page.evaluate(() => new Promise((finish) => {
  const answer = document.querySelector("[data-probe='answer']");
  const trace = document.querySelector("[data-probe='trace']");
  const thread = document.querySelector(".thread") || document.body;
  const watched = () => [...thread.querySelectorAll(".bubble, .turn-trace, .response-actions")];
  const rects = () => watched().map((node) => { const r = node.getBoundingClientRect(); return `${Math.round(r.top)}:${Math.round(r.height)}`; }).join("|");
  let churn = 0;
  const kinds = {};
  const observer = new MutationObserver((records) => {
    for (const record of records) for (const [sign, list] of [["+", record.addedNodes], ["-", record.removedNodes]]) for (const node of list) if (node.nodeType === 1) {
      // By design: the word fade unwraps its spans once it ends (text unchanged),
      // and the action row replaces its placeholder once the answer has appeared.
      if (node.classList.contains("stream-word") || node.classList.contains("response-actions")) continue;
      churn += 1;
      const key = `${sign}${node.tagName.toLowerCase()}.${String(node.className || "").split(" ")[0]} in ${record.target.className ? String(record.target.className).split(" ")[0] : record.target.tagName}`;
      kinds[key] = (kinds[key] || 0) + 1;
    }
  });
  observer.observe(thread, { childList: true, subtree: true });
  const before = rects();
  setTimeout(() => {
    observer.disconnect();
    const actions = [...thread.querySelectorAll(".response-actions:not([aria-hidden='true'])")];
    finish({
      answerMounted: Boolean(answer?.isConnected),
      traceMounted: trace ? trace.isConnected : null,
      traceOpen: trace ? trace.dataset.open === "true" : null,
      text: answer?.textContent || "",
      churn: churn ? `${churn} ${JSON.stringify(Object.entries(kinds).sort((a, b) => b[1] - a[1]).slice(0, 5))}` : 0,
      moved: before !== rects(),
      actionsInLastTurn: answer ? actions.filter((node) => answer.compareDocumentPosition(node) & Node.DOCUMENT_POSITION_FOLLOWING).length : actions.length,
    });
  }, 2000);
}));

const waitForAnswer = () => page.waitForFunction(() => ([...document.querySelectorAll(".bubble-assistant")].at(-1)?.textContent || "").length > 200);

/**
 * Every frame from a queued send until the chat is quiet: no answer above its
 * prompt, never the message in both the queue and the transcript, and once a
 * later prompt is taken no earlier turn still says it is working.
 */
async function watchQueue(text) {
  const counts = await page.evaluate((text) => new Promise((finish) => {
    const bad = { above: 0, both: 0, stale: 0 };
    const started = performance.now();
    let quiet = null;
    let aboveFirst = null;
    const frame = () => {
      const nodes = [...document.querySelectorAll(".thread .bubble, .thread .turn-trace")];
      const users = nodes.filter((node) => node.classList.contains("bubble-user"));
      const sent = users.find((node) => node.textContent.trim().startsWith(text));
      if (sent) {
        const at = nodes.indexOf(sent);
        // Answers above the sent message may only shrink (one closing into the
        // trace); a new one there is an answer drawn above its prompt.
        const above = nodes.slice(0, at).filter((node) => node.classList.contains("bubble-assistant")).length;
        if (aboveFirst == null) aboveFirst = above;
        else if (above > aboveFirst) bad.above += 1;
        const queued = document.querySelector(".queued-float:not([data-leaving])")?.textContent || "";
        if (queued.includes(text)) bad.both += 1;
        if (nodes.slice(0, at).some((node) => node.classList.contains("turn-trace") && node.dataset.active === "true")) bad.stale += 1;
      }
      if (!document.querySelector("[aria-label='Stop response']")) quiet ??= performance.now(); else quiet = null;
      if ((quiet && performance.now() - quiet > 1500) || performance.now() - started > 60_000) finish(bad);
      else requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  }), text);
  return [
    ["no answer above its prompt", counts.above === 0, `${counts.above} frames`],
    ["never queued and sent at once", counts.both === 0, `${counts.both} frames`],
    ["no earlier turn still working", counts.stale === 0, `${counts.stale} frames`],
  ];
}

async function settledShape() {
  const shape = () => page.evaluate(() => [...document.querySelectorAll(".thread .bubble, .thread .turn-trace")]
    .map((node) => node.classList.contains("bubble-user") ? "U" : node.classList.contains("turn-trace") ? "T" : "A").join(""));
  const live = await shape();
  await page.reload();
  await composer().waitFor();
  await page.waitForTimeout(2000);
  return { live, reloaded: await shape() };
}

async function chat(model) {
  const created = await api("/v0/chats", "POST", { projectId: "test", profileId: "test-stream" });
  const id = created?.id ?? created?.chat?.id;
  await api(`/v0/chats/${id}/models`, "PATCH", { model });
  await page.goto(`${origin}/chat/${id}`);
  await composer().waitFor();
  return id;
}

const scenarios = {
  /** Thinking, two tools and a long answer, with the trace opened while it runs. */
  async settle() {
    await send("think 2 tools 1500t");
    await page.locator(".turn-trace:not(.turn-trace-starting) .turn-trace-header").last().waitFor();
    await page.locator(".turn-trace:not(.turn-trace-starting) .turn-trace-header").last().click();
    // The answer is what follows the last tool; text before a tool is the turn
    // talking as it works, and moves into the trace when its message closes.
    await page.waitForFunction(() => /\b2\b/.test([...document.querySelectorAll(".turn-trace-work")].at(-1)?.textContent || ""));
    await page.waitForFunction(() => ([...document.querySelectorAll(".bubble-assistant")].at(-1)?.textContent || "").length > 200);
    const live = await tag();
    await settled();
    const after = await inspect();
    return [
      ["trace opened", live.open],
      ["answer kept its node", after.answerMounted],
      ["trace kept its node", after.traceMounted],
      ["trace still open", after.traceOpen],
      ["answer only extended", after.text.startsWith(live.text.trimEnd())],
      ["nothing churned after settle", !after.churn, after.churn],
      ["nothing moved after settle", !after.moved],
      ["one action row", after.actionsInLastTurn === 1, after.actionsInLastTurn],
    ];
  },
  /** Stop while the answer is being written: the partial stands, in place. */
  async "stop-answer"() {
    await send("think 3000t");
    await page.waitForFunction(() => ([...document.querySelectorAll(".bubble-assistant")].at(-1)?.textContent || "").length > 200);
    const live = await tag();
    await stopButton().click();
    await settled();
    const after = await inspect();
    return [
      ["answer kept its node", after.answerMounted],
      ["trace kept its node", after.traceMounted !== false],
      ["answer only extended", after.text.startsWith(live.text.trimEnd())],
      ["nothing churned after settle", !after.churn, after.churn],
      ["nothing moved after settle", !after.moved],
    ];
  },
  /** Dismiss a tool's approval (a denial): the trace keeps its node and settles still. */
  async "deny-tool"() {
    await send("think 1 tool approve 300t");
    await page.waitForFunction(() => document.querySelector(".turn-trace:not(.turn-trace-starting)") && document.querySelector(".question-card, [data-takeover]"), null, { timeout: 30_000 });
    const live = await tag();
    await page.keyboard.press("Escape");
    await settled();
    const after = await inspect();
    return [
      ["trace tagged", live.trace],
      ["trace kept its node", after.traceMounted],
      ["nothing churned after settle", !after.churn, after.churn],
      ["nothing moved after settle", !after.moved],
    ];
  },
  /** Stop is on the approval card: it ends the turn and takes the card away. */
  async "stop-approval"() {
    await send("think 1 tool approve 300t");
    await page.waitForFunction(() => document.querySelector(".question-card"), null, { timeout: 30_000 });
    const live = await tag();
    await page.locator(".question-card .question-stop").click();
    await settled();
    await page.waitForTimeout(500);
    const after = await inspect();
    const card = await page.locator(".question-card").count();
    return [
      ["trace tagged", live.trace],
      ["card gone", card === 0, card],
      ["trace kept its node", after.traceMounted],
      ["nothing churned after settle", !after.churn, after.churn],
    ];
  },
  /**
   * A message sent mid-answer waits for the answer to end and starts the next
   * turn. The answer it waited for stays an answer.
   */
  async queued() {
    await send("think 200 1500t");
    await waitForAnswer();
    const live = await tag();
    await send("hmm");
    const frames = await watchQueue("hmm");
    const after = await inspect();
    const shapes = await settledShape();
    return [
      ["first answer kept its node", after.answerMounted],
      ["first answer only extended", after.text.startsWith(live.text.trimEnd())],
      ...frames,
      ["settled as a reload shows it", shapes.live === shapes.reloaded, `${shapes.live} vs ${shapes.reloaded}`],
    ];
  },
  /** A message sent while a turn runs tools joins that turn after the tool. */
  async "queued-tool"() {
    await send("think 200 2 tools 1500t");
    await page.locator(".turn-trace:not(.turn-trace-starting)").last().waitFor();
    await send("hmm");
    const frames = await watchQueue("hmm");
    const shapes = await settledShape();
    return [...frames, ["settled as a reload shows it", shapes.live === shapes.reloaded, `${shapes.live} vs ${shapes.reloaded}`]];
  },
  /**
   * Regenerate, edit, stop, and edit the stopped prompt after a reload: after
   * each, the transcript is what a reload shows and the app never reaches its
   * error screen.
   */
  async history() {
    const checks = [];
    const step = async (label, act) => {
      await act();
      await page.waitForTimeout(300);
      await settled();
      await page.waitForTimeout(1000);
      const crashed = await page.locator(".crash-screen").count();
      const shapes = await settledShape();
      checks.push([`${label}: no error screen`, crashed === 0]);
      checks.push([`${label}: as a reload shows it`, shapes.live === shapes.reloaded, `${shapes.live} vs ${shapes.reloaded}`]);
    };
    await step("two turns", async () => { await send("think 100 300t"); await settled(); await page.waitForTimeout(500); await send("1 tool 300t"); });
    await step("regenerate last", () => page.locator("[aria-label='Regenerate response']").last().click());
    await step("edit first", async () => { await page.locator("[aria-label='Edit from here']").first().click(); await composer().fill("2 tools 200t"); await page.keyboard.press("Enter"); });
    await step("stop", async () => { await send("think 100 3000t"); await waitForAnswer(); await stopButton().click(); });
    // The process goes, as an idle one is recycled, so the edit below is what
    // attaches a socket -- after this client has already cut its rows.
    await step("process recycled", () => page.evaluate(async () => {
      const chatId = location.pathname.split("/").pop();
      const live = (await (await fetch("/v0/live-sessions")).json()).sessions.find((item) => item.chatId === chatId);
      if (live) await fetch(`/v0/live-sessions/${live.id}/process`, { method: "DELETE" });
    }));
    await step("edit stopped prompt", async () => { await page.locator("[aria-label='Edit from here']").last().click(); await composer().fill("100t"); await page.keyboard.press("Enter"); });
    return checks;
  },
};

const only = arg("--only", "")?.split(",").filter(Boolean);
let failed = 0;
// A breach of the transcript contract is logged, not thrown, so it is caught here.
let breaches = [];
page.on("console", (message) => { if (message.type() === "error" && message.text().startsWith("transcript contract")) breaches.push(message.text()); });
for (const [name, run] of Object.entries(scenarios)) {
  if (only?.length && !only.includes(name)) continue;
  let id = null;
  try {
    id = await chat("fast-250");
    breaches = [];
    const checks = [...await run(), ["no contract breach", !breaches.length, breaches[0]]];
    const bad = checks.filter(([, ok]) => !ok);
    failed += bad.length ? 1 : 0;
    console.log(`${bad.length ? "FAIL" : "ok  "} ${name}${bad.length ? `: ${bad.map(([label, , detail]) => detail === undefined ? label : `${label} (${detail})`).join(", ")}` : ""}`);
  } catch (error) {
    failed += 1;
    console.log(`FAIL ${name}: ${error.message.split("\n")[0]}`);
  } finally {
    if (id) await api(`/v0/sessions/${id}`, "DELETE").catch(() => {});
  }
}
await close();
process.exit(failed ? 1 : 0);
