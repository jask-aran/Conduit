#!/usr/bin/env node
/**
 * What moves when a message is sent from the phone composer? A fresh Test
 * profile chat (no model call) with some history, a phone viewport, the
 * voice layout, animations slowed: records every frame's text pill, sent
 * bubble and scroll position, and saves a frame strip.
 *
 *   node scripts/probes/send-motion.mjs --windows [--layout bar] [--rate 0.2] [--out dir]
 */
import fs from "node:fs/promises";
import path from "node:path";
import { arg, capture, open, origin } from "./lib.mjs";

const rate = Number(arg("--rate", "0.2"));
const out = arg("--out", "/tmp/conduit-send-motion");
const layout = arg("--layout", "bar");
const { page, cdp, close } = await open({ width: 600, height: 1100 });
await cdp.send("Emulation.setDeviceMetricsOverride", { width: 412, height: 915, deviceScaleFactor: 2.625, mobile: true });
await cdp.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
// A phone's round trip: what the page sends reaches the server late.
const latency = Number(arg("--latency", "250"));
await page.addInitScript((latency) => {
  const send = WebSocket.prototype.send;
  WebSocket.prototype.send = function (data) { setTimeout(() => { try { send.call(this, data); } catch {} }, latency); };
}, latency);
await page.goto(origin);
await page.evaluate((layout) => localStorage.setItem("conduit:phone-composer", layout), layout);
const api = (url, method, body) => page.evaluate(async ([url, method, body]) => {
  const response = await fetch(url, { method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  return response.json().catch(() => null);
}, [url, method, body]);
const created = await api("/v0/chats", "POST", { projectId: "test", profileId: "test-stream" });
const id = created?.id ?? created?.chat?.id;
await api(`/v0/chats/${id}/models`, "PATCH", { model: "fast-1000" });
await page.goto(`${origin}/chat/${id}`);
page.on("framenavigated", (frame) => { if (frame === page.mainFrame()) console.log("navigated", frame.url()); });
const textarea = page.locator(".chat-main [data-part='composer'] textarea").first();
await textarea.waitFor({ state: "attached" });
const settled = () => page.waitForFunction(() => !document.querySelector("[aria-label='Stop response']"), null, { timeout: 60_000 });
for (const prompt of ["400t", "400t"]) {
  await page.evaluate(() => document.querySelector(".composer-keyboard-trigger")?.click());
  await textarea.fill(prompt); await page.keyboard.press("Enter"); await settled(); await page.waitForTimeout(500);
}
await page.evaluate(() => document.querySelector(".composer-keyboard-trigger")?.click());
await textarea.fill("Hello, this is a message being sent 300t");
await page.waitForTimeout(600);
// Scrolled up into the transcript, the way a send usually starts.
const up = Number(arg("--up", "0"));
if (up) { await page.evaluate((up) => { const v = document.querySelector(".message-scroller-viewport"); v.dispatchEvent(new WheelEvent("wheel", { deltaY: -up, bubbles: true })); v.scrollTop -= up; }, up); await page.waitForTimeout(600); }
await cdp.send("Animation.enable");
await cdp.send("Animation.setPlaybackRate", { playbackRate: rate });
await page.evaluate(() => {
  const log = window.__frames = []; const t0 = performance.now();
  const viewport = document.querySelector(".message-scroller-viewport");
  const frame = () => {
    const shell = document.querySelector(".composer-input-shell");
    const users = [...document.querySelectorAll("[data-slot='message-scroller-item']")].filter((row) => row.querySelector(".message-user"));
    const last = users.at(-1); const bubble = last?.querySelector("[data-slot='bubble']");
    const r = (el) => el ? el.getBoundingClientRect() : null;
    log.push({
      t: Math.round(performance.now() - t0),
      mode: document.querySelector(".composer-wrap")?.dataset.phoneMode,
      pillOp: shell ? +getComputedStyle(shell).opacity : null, pillH: Math.round(r(shell)?.height ?? 0),
      rowTop: Math.round(r(document.querySelector(".dictation-trigger"))?.top ?? 0),
      users: users.length, bubbleTop: bubble ? Math.round(r(bubble).top) : null,
      bubbleOp: bubble ? +getComputedStyle(bubble).opacity : null,
      scroll: Math.round(viewport.scrollTop), height: Math.round(viewport.scrollHeight),
      trace: (() => { const t = [...document.querySelectorAll(".thread .turn-trace")].at(-1); return t ? `${t.classList.contains("turn-trace-starting") ? "S" : "T"}${Math.round(t.getBoundingClientRect().top)}/${(+getComputedStyle(t).opacity).toFixed(2)}` : "-"; })(),
    });
    if (performance.now() - t0 < 4000) requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
});
await fs.mkdir(out, { recursive: true });
const shots = [];
const shoot = async (i) => { shots.push(await capture(cdp, page, { x: 0, y: 380, width: 412, height: 535 })); };
await page.evaluate(() => document.querySelector(".composer-send-trigger")?.click());
for (let i = 0; i < 16; i++) { await shoot(i); await page.waitForTimeout(150); }
await page.waitForTimeout(1500);
for (const [i, shot] of shots.entries()) await fs.writeFile(path.join(out, `f${String(i).padStart(2, "0")}.png`), shot);
const frames = await page.evaluate(() => window.__frames) || [];
console.log("url", page.url(), "frames", frames.length);
let previous = "";
for (const f of frames) {
  const key = JSON.stringify({ ...f, t: 0 });
  if (key !== previous) console.log([f.t, f.mode, `pill ${f.pillOp?.toFixed(2)}/${f.pillH}`, `row ${f.rowTop}`, `users ${f.users}`, `bubble ${f.bubbleTop}/${f.bubbleOp?.toFixed(2)}`, `scroll ${f.scroll}/${f.height}`, `trace ${f.trace}`].join("  "));
  previous = key;
}
await cdp.send("Animation.setPlaybackRate", { playbackRate: 1 });
await api(`/v0/chats/${id}`, "DELETE");
await close();
