// One fast stream, several checks: DOM churn, every card shape seen while streaming, the settled answer's DOM.
// Headless (own browser, no cache to warm), fast-1000, waits on conditions, never longer than 60s.
import fs from "node:fs"; import { createHash } from "node:crypto";
import { open, origin } from "./lib.mjs";
const [prompt = "rich 2000t", out = "fast-check"] = process.argv.slice(2);
const deadline = setTimeout(() => { console.error("fastcheck: over 60s, giving up"); process.exit(3); }, 60_000);
const t0 = Date.now(); const at = () => ((Date.now() - t0) / 1000).toFixed(1) + "s";
const { page, close } = await open({ width: 1280, height: 900 });
let id = null; page.on("pageerror", (e) => console.log("pageerror:", e.message.slice(0, 300))); page.on("console", (m) => m.type() === "error" && console.log("console:", m.text().slice(0, 300)));
const api = (url, method, body) => page.evaluate(async ([url, method, body]) => (await fetch(url, { method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined })).json().catch(() => null), [url, method, body]);
try {
  await page.goto(origin + "/favicon.ico");
  id = (await api("/v0/chats", "POST", { projectId: "test", profileId: "test-stream" }))?.id;
  await api(`/v0/chats/${id}/models`, "PATCH", { model: process.env.MODEL ?? "fast-1000" });
  await page.goto(`${origin}/chat/${id}`);
  const ta = page.locator(".chat-main textarea").first(); await ta.waitFor({ timeout: 15000 });
  await page.evaluate(() => {
    const w = window; w.__churn = { added: {}, removed: {} }; w.__cards = new Set();
    const kind = (n) => n.nodeType === 3 ? "#text" : n.nodeType === 1 ? n.tagName.toLowerCase() + (n.classList[0] ? "." + n.classList[0] : "") : "#other";
    const count = (map, n) => { map[kind(n)] = (map[kind(n)] ?? 0) + 1; if (n.nodeType === 1) for (const c of n.querySelectorAll("*")) map[kind(c)] = (map[kind(c)] ?? 0) + 1; };
    new MutationObserver((list) => { for (const m of list) if (m.target.closest?.(".message-assistant") || m.target.parentElement?.closest(".message-assistant")) {
      m.addedNodes.forEach((n) => count(w.__churn.added, n)); m.removedNodes.forEach((n) => count(w.__churn.removed, n)); } }).observe(document.body, { childList: true, subtree: true });
    const grab = () => { for (const c of document.querySelectorAll(".artifact")) { const k = c.cloneNode(true); k.querySelector("code")?.replaceChildren(); k.removeAttribute("style");
      w.__cards.add(k.outerHTML.replace(/data-lines="\d+"/, 'data-lines="N"').replace(/>[^<]*\d+ (more )?lines?[^<]*</g, ">LABEL<")); } requestAnimationFrame(grab); };
    requestAnimationFrame(grab);
  });
  await ta.fill(prompt); await ta.press("Enter");
  await page.waitForFunction(() => /^(Done|Interrupted|Failed)/.test(document.querySelector(".ui-trace-line")?.textContent ?? ""), null, { timeout: Number(process.env.WAIT ?? 45000), polling: 100 }).catch(async (e) => {
    await page.screenshot({ path: out + "-stuck.png" }); console.log("url", page.url()); console.log("stuck:", JSON.stringify(await page.evaluate(() => ({ trace: document.querySelector(".ui-trace-line")?.textContent, answer: document.querySelector(".message-assistant")?.textContent?.length, assistants: document.querySelectorAll(".message-assistant").length, user: document.querySelectorAll(".message-user").length, draft: document.querySelector(".chat-main textarea")?.value?.slice(0, 40) }))));
    throw e; });
  await page.waitForFunction(() => document.querySelector(".chat-markdown[data-settled]"), null, { timeout: 10000, polling: 100 }).catch(() => {});
  const r = await page.evaluate(() => {
    const md = [...document.querySelectorAll(".chat-markdown")].at(-1);
    const html = md.outerHTML.replace(/ data-transcript-visibility="[a-z]*"/g, "").replace(/ style="[^"]*"/g, "");
    const c = window.__churn; return { html, cards: [...window.__cards].sort(), added: c.added, removed: c.removed };
  });
  fs.writeFileSync(out + ".html", r.html.replace(/></g, ">\n<")); fs.writeFileSync(out + ".cards", r.cards.join("\n"));
  const k = (name) => `${r.added[name] ?? 0}/${r.removed[name] ?? 0}`;
  console.log(`${at()} settled ${createHash("sha1").update(r.html).digest("hex").slice(0, 12)}, ${r.cards.length} card shapes; added/removed: code-line ${k("span.code-line")}, hljs-keyword ${k("span.hljs-keyword")}, pre ${k("pre")}, code ${k("code")}, div.artifact ${k("div.artifact")}`);
} finally { if (id) await api(`/v0/sessions/${id}`, "DELETE").catch(() => {}); await close(); clearTimeout(deadline); }
