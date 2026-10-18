#!/usr/bin/env node
/**
 * How does the phone composer's button row move as dictation starts and
 * stops? A fresh Test-profile chat with history, scrolled up so scroll to
 * latest is in the row, a phone viewport and a synthetic microphone (a tone,
 * no real device). Runs start and stop with an empty draft and with a typed
 * one, logging every frame's row buttons: left/right edge and opacity.
 *
 *   node scripts/probes/dictation-row.mjs --windows
 */
import { arg, open, origin } from "./lib.mjs";

const { page, cdp, close } = await open({ width: 600, height: 1100 });
await cdp.send("Emulation.setDeviceMetricsOverride", { width: 412, height: 915, deviceScaleFactor: 2.625, mobile: true });
await cdp.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
// Always the build just made, not what the service worker cached.
await cdp.send("Network.enable");
await cdp.send("Network.setBypassServiceWorker", { bypass: true });
await page.addInitScript(() => {
  navigator.mediaDevices.getUserMedia = async () => {
    const context = new AudioContext(); const tone = context.createOscillator(); const gain = context.createGain();
    gain.gain.value = 0.2; tone.connect(gain); const out = context.createMediaStreamDestination(); gain.connect(out); tone.start();
    return out.stream;
  };
});
await page.goto(origin);
const api = (url, method, body) => page.evaluate(async ([url, method, body]) => {
  const response = await fetch(url, { method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  return response.json().catch(() => null);
}, [url, method, body]);
const created = await api("/v0/chats", "POST", { projectId: "test", profileId: "test-stream" });
const id = created?.id ?? created?.chat?.id;
await api(`/v0/chats/${id}/models`, "PATCH", { model: "fast-1000" });
await page.goto(`${origin}/chat/${id}`);
const textarea = page.locator(".chat-main [data-part='composer'] textarea").first();
await textarea.waitFor({ state: "attached" });
const settled = () => page.waitForFunction(() => !document.querySelector("[aria-label='Stop response']"), null, { timeout: 60_000 });
for (const prompt of ["400t", "400t"]) {
  await page.evaluate(() => document.querySelector(".composer-keyboard-trigger")?.click());
  await textarea.fill(prompt); await page.keyboard.press("Enter"); await settled(); await page.waitForTimeout(500);
}
await page.evaluate(() => document.activeElement?.blur());
await page.evaluate(() => { const v = document.querySelector(".message-scroller-viewport"); v.dispatchEvent(new WheelEvent("wheel", { deltaY: -800, bubbles: true })); v.scrollTop -= 800; });
await page.waitForTimeout(800);

const record = (label, action) => page.evaluate(async ([label, action]) => {
  const log = []; const t0 = performance.now();
  const short = (b) => ["composer-mobile-plus", "composer-camera-trigger", "composer-keyboard-trigger", "composer-latest-trigger", "dictation-trigger", "composer-stop-send", "composer-send-trigger", "composer-stop-aside"].find((c) => b.classList.contains(c))?.replace(/composer-|-trigger|-mobile/g, "") || b.className.slice(0, 12);
  const sample = () => {
    const mode = document.querySelector("[data-phone-mode]")?.dataset.phoneMode;
    const buttons = [...document.querySelectorAll(".chat-main [data-part='composer'] .composer-actions [data-slot='button']")];
    const track = document.querySelector(".composer-voice-track");
    const tr = track?.getBoundingClientRect();
    log.push(`${Math.round(performance.now() - t0)} ${mode} ` + buttons.map((b) => { const r = b.getBoundingClientRect(); return `${short(b)}[${Math.round(r.left)}-${Math.round(r.right)} ${(+getComputedStyle(b).opacity).toFixed(2)}]`; }).join(" ") + (tr ? ` track[${Math.round(tr.left)}-${Math.round(tr.right)} ${(+getComputedStyle(track).opacity).toFixed(2)}]` : ""));
  };
  let done = false; const tick = () => { sample(); if (!done) requestAnimationFrame(tick); };
  requestAnimationFrame(tick);
  await new Promise((r) => setTimeout(r, 50));
  if (action === "mic") document.querySelector(".dictation-trigger")?.click();
  await new Promise((r) => setTimeout(r, 900));
  done = true;
  return [`== ${label}`, ...log].join("\n");
}, [label, action]);
const changes = (text) => { let prev = ""; return text.split("\n").filter((line) => { const key = line.replace(/^\d+ /, ""); const keep = key !== prev; prev = key; return keep; }).join("\n"); };

for (const draft of ["", "a typed draft"]) {
  if (draft) { await page.evaluate(() => document.querySelector(".composer-keyboard-trigger")?.click()); await textarea.fill(draft); await page.evaluate(() => document.activeElement?.blur()); await page.waitForTimeout(800); }
  console.log(changes(await record(`start, draft ${draft ? "yes" : "no"}`, "mic")));
  await page.waitForTimeout(600);
  console.log(changes(await record(`stop, draft ${draft ? "yes" : "no"}`, "mic")));
  await page.waitForTimeout(1200);
}
await api(`/v0/chats/${id}`, "DELETE");
await close();
