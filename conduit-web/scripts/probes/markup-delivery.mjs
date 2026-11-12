// One delivery: on Conduit comments wait for Send and go to one growing item; on /document Done sends while "Send now" is on, each to the document's own store and margin. Card states, folding, the corner's Resolve, the working mark.
import { open } from "./lib.mjs";
import { spawn, execFileSync } from "node:child_process";
import fs from "node:fs";
const out = "/tmp/markup-probe-one", script = new URL("../../../scripts/conduit-markup.mjs", import.meta.url).pathname;
const cli = (...args) => execFileSync("node", [script, ...args], { encoding: "utf8" }).trim();
const { page, cdp, close } = await open({ width: 1500, height: 900 });
const stay = spawn("node", [script, "wait", "one-probe", "--stay"]); let told = ""; stay.stdout.on("data", (data) => { told += data; });
const mine = new Set();
try {
  await cdp.send("Network.setBypassServiceWorker", { bypass: true });
  const errors = [];
  page.on("pageerror", (error) => errors.push(String(error.stack ?? error).slice(0, 400)));
  const js = (expression) => page.evaluate(expression);
  const buttons = () => js("JSON.stringify([...document.querySelectorAll('.ui-markup-bar button, .ui-markup-bar .ui-markup-status')].map(e => (e.getAttribute('aria-label') ?? e.getAttribute('title') ?? e.innerText).trim() + (e.disabled ? ' (off)' : '')).filter(l => !/^(Select|Pen|High|Shape|Text|Eraser|General|Undo|Redo|Use|Annotate)/.test(l)))");
  const cards = () => js("JSON.stringify([...document.querySelectorAll('.ui-markup-note')].map(n => (n.hasAttribute('data-open') ? 'OPEN ' : '') + n.innerText.replace(/\\n+/g, ' | ').slice(0, 200) + ' [' + [...n.querySelectorAll('button')].map(b => (b.getAttribute('aria-label') ?? b.innerText).trim() + (b.getAttribute('aria-checked') ? '=' + b.getAttribute('aria-checked') : '') + (b.disabled ? ' (off)' : '')).join(',') + ']'))");
  const item = (id) => JSON.parse(fs.readFileSync(`${process.env.HOME}/.conduit/data/feedback/${id}/item.json`, "utf8"));
  const latest = async () => JSON.parse(await js("fetch('/v0/markup/items').then(r => r.text())")).items[0].id;

  await page.goto("http://127.0.0.1:4310/");
  await page.waitForTimeout(12000);
  await page.keyboard.press("Alt+Shift+F");
  await page.waitForSelector(".ui-markup-bar", { state: "visible" });
  await page.waitForTimeout(3500);
  const rows = await js("[...document.querySelectorAll('.ui-row')].filter(e => { const b = e.getBoundingClientRect(); return b.width > 60 && b.left >= 0 && b.top > 80 && b.top < innerHeight - 300; }).slice(0, 3).map(r => { const b = r.getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; })");
  const comment = async (at, words) => { await page.mouse.click(rows[at].x, rows[at].y); await page.waitForTimeout(400); const float = await cards(); await page.keyboard.type(words); await page.keyboard.press("Enter"); await page.waitForTimeout(600); return float; };
  console.log("A float card (no Send now on Conduit):", await comment(0, "One: first"));
  await comment(1, "One: second");
  console.log("A two queued:", await cards(), await buttons());
  await page.locator(".ui-markup-bar button", { hasText: "Send" }).click(); await page.waitForTimeout(5000);
  const id = await latest(); mine.add(id);
  console.log("A sent:", id, "comments", item(id).comments.length, "live", item(id).live, "|", await cards(), await buttons());
  console.log("A listener told:", told.trim().slice(0, 160));
  await comment(2, "One: third, after the Send");
  console.log("A third queued:", await cards(), await buttons());
  await page.locator(".ui-markup-bar button", { hasText: "Send" }).click(); await page.waitForTimeout(6000);
  console.log("A third sent to the same item:", item(id).comments.map((c) => c.n + " " + c.comment).join(" / "), "|", await cards());
  cli("reply", id, "1", "A long answer from the agent that goes on for more than two lines of the card so that the fold can be seen cutting it short where the second line ends and no further than that at all.");
  await page.waitForTimeout(4500);
  console.log("A answered, shut:", await cards());
  await page.screenshot({ path: `${out}-stack.png`, clip: { x: 900, y: 300, width: 600, height: 600 } });
  await page.locator(".ui-markup-note").first().click(); await page.waitForTimeout(500);
  console.log("A opened:", (await cards()).slice(0, 420));
  await page.screenshot({ path: `${out}-open.png`, clip: { x: 900, y: 200, width: 600, height: 700 } });
  await page.keyboard.press("Escape"); await page.waitForTimeout(300);
  await page.locator(".ui-markup-note").nth(1).locator("button[aria-label='Resolve']").click(); await page.waitForTimeout(2000);
  console.log("A second resolved from its corner:", await cards());

  await page.goto("http://127.0.0.1:4310/document");
  await page.waitForSelector(".ui-document-text [data-id]", { timeout: 20000 });
  await page.waitForTimeout(4500);
  const press = (label) => page.locator(`.ui-markup-bar button[aria-label^='${label}'], .ui-markup-bar button[title^='${label}']`).first().click();
  await press("Use the app"); await page.waitForTimeout(300);
  await press("Select text"); await page.waitForTimeout(300);
  const line = await js("(() => { const l = document.querySelectorAll('.ui-document-text > [data-id]')[1].getBoundingClientRect(); return { x: l.left, y: l.top + l.height / 2 }; })()");
  const quote = async (from, words, off) => { await page.mouse.move(line.x + from, line.y); await page.mouse.down(); await page.mouse.move(line.x + from + 90, line.y, { steps: 8 }); await page.mouse.up(); await page.waitForTimeout(500); if (off) { await page.locator(".ui-markup-note[data-float] button[role=switch]").click(); await page.waitForTimeout(200); } const float = await cards(); await page.keyboard.type(words); await page.keyboard.press("Enter"); await page.waitForTimeout(4500); return float; };
  console.log("B float card:", await quote(4, "Doc: goes now"));
  // A document's comments go to its own store, each Send an item of its own, and stand in its margin.
  const sentDoc = async () => { const all = JSON.parse(await js("fetch('/v0/document/test/markup/open').then(r => r.text())")).items.filter((one) => one.comments.some((comment) => comment.comment.startsWith("Doc: "))); for (const one of all) mine.add(one.id); return all.map((one) => `${one.by}: ${one.comments.map((comment) => comment.comment).join(" / ")}`).join(" ; "); };
  console.log("B after Done:", await sentDoc(), "|", await cards(), await buttons());
  await page.screenshot({ path: `${out}-doc.png`, clip: { x: 900, y: 500, width: 600, height: 400 } });
  console.log("B float, Send now turned off:", await quote(200, "Doc: waits", true));
  console.log("B after Done:", await sentDoc(), "|", await cards(), await buttons());
  await page.locator(".ui-markup-bar button", { hasText: "Send" }).click(); await page.waitForTimeout(5000);
  console.log("B after Send:", await sentDoc(), "|", await cards());
  console.log("errors:", JSON.stringify(errors));
} finally {
  stay.kill();
  for (const id of mine) console.log(cli("done", id));
  await close();
}
