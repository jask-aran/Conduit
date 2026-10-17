// Trace parity: does the library's Trace (the gallery's phone preview, behind the switch) read exactly as the app's on
// the same chat? Makes a Test-profile chat on the live server (no model call: thinking, tools, interrupted turns) in a
// new tab of headed Chrome on CDP :9222 -- or takes --chat <id> -- puts its saved session into the gallery's preview
// (localStorage gallery:seed, removed after) and walks both: each trace's Status and Latest lines, every step opened,
// its line and what it opens to, the footers' stopped markers. Prints each line that differs, then the count.
// From conduit-web, with the gallery served: node scripts/motion-check/trace-parity.mjs [--chat <id>]
const { chromium } = await import(new URL("../../../.smoke-tools/node_modules/playwright/index.mjs", import.meta.url).href);
const b = await chromium.connectOverCDP("http://127.0.0.1:9222");
const ctx = b.contexts()[0];
const live = await ctx.newPage();
await live.goto("http://127.0.0.1:4310/"); await live.waitForTimeout(2000);
const api = (url, method, body) => live.evaluate(async ([url, method, body]) => { const r = await fetch(url, { method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined }); return r.json().catch(() => null); }, [url, method, body]);
let id = process.argv[process.argv.indexOf("--chat") + 1];
if (!process.argv.includes("--chat")) {
  const created = await api("/v0/chats", "POST", { projectId: "test", profileId: "test-stream" });
  id = created?.id ?? created?.chat?.id;
  await api(`/v0/chats/${id}/models`, "PATCH", { model: "fast-250" });
  await live.goto(`http://127.0.0.1:4310/chat/${id}`);
  const ta = live.locator(".chat-main [data-part='composer'] textarea").first(); await ta.waitFor({ state: "attached" });
  const settled = () => live.waitForFunction(() => !document.querySelector("[aria-label='Stop response']"), null, { timeout: 90_000 });
  for (const [prompt, stopAfter] of [["think 600 3 tools 300t"], ["think 300 tool 200t"], ["think 400 2 tools 1500t", 2500], ["think 900 300t"], ["600t", 800]]) {
    await ta.fill(prompt); await live.keyboard.press("Enter");
    if (stopAfter) { await live.waitForTimeout(stopAfter); await live.click("[aria-label='Stop response']").catch(() => {}); }
    await live.waitForTimeout(500); await settled(); await live.waitForTimeout(800);
  }
}
console.log("chat", id);
const session = await api(`/v0/sessions/${id}`, "GET");
// The preview has no server: output a reload left there goes in with the seed (the app fetches it as it opens).
for (const tool of session.tools) if (tool.outputDeferred) { tool.output = (await api(`/v0/sessions/${id}/tools/${encodeURIComponent(tool.toolCallId)}`, "GET"))?.output ?? ""; delete tool.outputDeferred; }
await live.goto(`http://127.0.0.1:4310/chat/${id}`); await live.waitForTimeout(2500);
const g = ctx.pages().find((p) => p.url().includes("5180/gallery.html"));
await g.evaluate((s) => localStorage.setItem("gallery:seed", s), JSON.stringify({ messages: session.messages, tools: session.tools }));
await g.reload(); await g.waitForTimeout(3000);
const f = g.frames().find((f) => f.url().includes("frame=phone"));
const walk = async (root, S) => root.evaluate(async (S) => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const t = (e) => (e?.textContent ?? "").replace(/\s+/g, " ").trim();
  const out = [];
  const rows = async (list, depth) => { for (const row of [...list.querySelectorAll(S.row)].filter((r) => r.parentElement.closest(S.rowParent) === list.closest(S.rowParent) || r.parentElement === list)) {
    if (row.closest(S.rowParent) !== list.closest(S.rowParent) && row.parentElement !== list) continue;
    const head = row.querySelector(S.rowHead); out.push(`${"  ".repeat(depth)}- ${t(head ?? row).slice(0, 120)}${row.matches(S.discarded) ? " [discarded]" : ""}${head?.getAttribute("aria-label") ? ` {${head.getAttribute("aria-label")}}` : ""}`);
    if (head && head.tagName === "BUTTON" && !head.disabled) { if (head.getAttribute("aria-expanded") !== "true") { head.click(); await wait(250); }
      for (let i = 0; i < 30 && /Loading…/.test(t(row.querySelector(S.rowBody))); i++) await wait(100);
      const body = row.querySelector(S.rowBody); const nested = body?.matches(S.nestedList) ? body : body?.querySelector(S.nestedList);
      if (nested) await rows(nested, depth + 1); else out.push(`${"  ".repeat(depth + 1)}> ${t(body).slice(0, 160)}`); } } };
  for (const trace of document.querySelectorAll(".turn-trace")) {
    out.push(`TRACE ${t(trace.querySelector(S.line))} | ${t(trace.querySelector(S.latest))}${trace.querySelector(S.head)?.disabled ? " (no open)" : ""}`);
    const head = trace.querySelector(S.head); if (!head || head.disabled) continue;
    if (head.getAttribute("aria-expanded") !== "true") { head.click(); await wait(400); }
    const list = trace.querySelector(S.list); if (list) await rows(list, 1);
  }
  for (const e of document.querySelectorAll(S.extra)) out.push(`EXTRA ${t(e)}`);
  return out;
}, S);
const OLD = { line: ".turn-trace-line", latest: ".turn-trace-summary", head: ".turn-trace-header", list: ".turn-trace-body", row: ".trail-row, .tool-step-calls > li", rowParent: ".turn-trace-body, .tool-group-steps, .tool-step-calls", rowHead: ".trail-row-header", rowBody: ".tool-step-content, .text-step-content, .tool-group-steps", nestedList: ".tool-group-steps, .tool-step-calls", discarded: "[data-discarded=true]", extra: ".response-status, .turn-stop-row" };
const NEW = { line: ".ui-trace-line", latest: ".ui-trace-latest", head: "button.ui-trace", list: ".turn-trace .ui-trail", row: ".ui-step-item, .ui-trace-error", rowParent: ".ui-trail", rowHead: ".ui-step", rowBody: ".ui-step-body", nestedList: ".ui-trail", discarded: "[data-discarded]", extra: ".ui-message-status, .ui-stop-line" };
try {
  // A long chat's transcript holds only its latest turns until scrolled back: the traces compare from the last.
  const blocks = (lines) => lines.reduce((all, line) => { if (line.startsWith("TRACE") || !all.length) all.push([]); all.at(-1).push(line); return all; }, []);
  const ab = blocks(await walk(live, OLD)), zb = blocks(await walk(f, NEW)), k = Math.min(ab.length, zb.length);
  const a = ab.slice(-k).flat(), z = zb.slice(-k).flat();
  if (ab.length !== zb.length) console.log(`last ${k} traces (app shows ${ab.length}, library ${zb.length})\n  app:     ${ab.map((x) => x[0].slice(0, 90)).join("\n           ")}\n  library: ${zb.map((x) => x[0].slice(0, 90)).join("\n           ")}`);
  let diffs = 0;
  for (let i = 0; i < Math.max(a.length, z.length); i++) { if (a[i] === z[i]) continue; diffs++; console.log(`#${i}\n  app:     ${a[i]}\n  library: ${z[i]}`); }
  console.log(diffs ? "✗" : "✓", `${a.length} lines, ${diffs} differ`);
} finally { await g.evaluate(() => localStorage.removeItem("gallery:seed")); await g.reload(); await live.close(); await b.close(); }
