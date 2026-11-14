// The thread card after a batched Send on Conduit (field keeps focus, Reply, times, Resolve, Back, the sent list), then the test paper (/?a=artifact:test) live with a staying listener, the comment's card in the margin.
import { open } from "./lib.mjs";
import { spawn, execFileSync } from "node:child_process";
import fs from "node:fs";
const out = "/tmp/markup-probe-thread2", script = new URL("../../../scripts/conduit-markup.mjs", import.meta.url).pathname;
const cli = (...args) => execFileSync("node", [script, ...args], { encoding: "utf8" }).trim();
const { page, cdp, close } = await open({ width: 1500, height: 900 });
let stay;
const mine = [];
try {
  await cdp.send("Network.setBypassServiceWorker", { bypass: true });
  const errors = [];
  page.on("pageerror", (error) => errors.push(String(error.stack ?? error).slice(0, 400)));
  const js = (expression) => page.evaluate(expression);
  const buttons = () => js("JSON.stringify([...document.querySelectorAll('.ui-markup-bar button')].map(e => (e.getAttribute('aria-label') ?? e.getAttribute('title') ?? e.innerText).trim() + (e.disabled ? ' (off)' : '')))");
  const cards = () => js("JSON.stringify([...document.querySelectorAll('.ui-markup-note')].map(n => ({ open: n.hasAttribute('data-open'), text: n.innerText.replace(/\\n+/g, ' | ').slice(0, 260), buttons: [...n.querySelectorAll('button')].map(b => b.innerText.trim() + (b.disabled ? ' (off)' : '')).filter(Boolean) })))");
  const press = (label) => page.locator(`.ui-markup-bar button[aria-label^='${label}'], .ui-markup-bar button[title^='${label}']`).first().click();
  const items = async () => JSON.parse(await js("fetch('/v0/markup/items').then(r => r.text())")).items;

  if (process.argv[2] !== "doc") {
  await page.goto("http://127.0.0.1:4310/");
  await page.waitForTimeout(12000);
  await page.keyboard.press("Alt+Shift+F");
  await page.waitForSelector(".ui-markup-bar", { state: "visible" });
  await page.waitForTimeout(3500);
  console.log("A bar (no Live expected):", await buttons());
  const row = await js("(() => { const r = [...document.querySelectorAll('.ui-row')].find(e => { const b = e.getBoundingClientRect(); return b.width > 60 && b.left >= 0 && b.top > 80 && b.top < innerHeight - 250; }); const b = r.getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; })()");
  await page.mouse.click(row.x, row.y); await page.waitForTimeout(400);
  await page.keyboard.type("Thread probe: one"); await page.keyboard.press("Enter"); await page.waitForTimeout(500);
  const dialogs = [];
  page.on("dialog", (d) => dialogs.push(d.message()));
  await js("window.__asked = 0; const g = navigator.mediaDevices.getDisplayMedia.bind(navigator.mediaDevices); navigator.mediaDevices.getDisplayMedia = (...a) => { window.__asked++; return g(...a); }");
  await page.locator(".ui-markup-bar button", { hasText: "Send" }).click();
  await page.waitForTimeout(5000);
  const id = (await items())[0].id; mine.push(id);
  console.log("A sent:", id, "| asked to share the tab:", await js("window.__asked"), "| screenshot:", JSON.stringify(JSON.parse(fs.readFileSync(`${process.env.HOME}/.conduit/data/feedback/${id}/item.json`, "utf8")).screenshot));
  console.log("A thread bar:", await buttons());
  await page.locator(".ui-markup-note").last().click(); await page.waitForTimeout(400);
  await page.keyboard.type("abc");
  await page.waitForTimeout(7500);
  await page.keyboard.type("def");
  console.log("A after two polls, typing went on:", await js("JSON.stringify({ focused: document.activeElement?.tagName, value: document.activeElement?.value })"));
  cli("reply", id, "1", "An answer from the agent.");
  await page.waitForTimeout(4500);
  console.log("A still focused after the reply came:", await js("JSON.stringify({ focused: document.activeElement?.tagName, value: document.activeElement?.value })"));
  console.log("A card:", await cards());
  await page.locator(".ui-markup-note button", { hasText: "Reply" }).click(); await page.waitForTimeout(1500);
  console.log("A after Reply:", await cards());
  await page.screenshot({ path: `${out}-thread.png`, clip: { x: 900, y: 400, width: 600, height: 500 } });
  await page.locator(".ui-markup-note").last().click(); await page.waitForTimeout(300);
  await page.locator(".ui-markup-note[data-open] button[aria-label='Resolve']").click(); await page.waitForTimeout(1500);
  // With no card open Escape would close Markup itself.
  if (await page.locator(".ui-markup-note[data-open]").count()) { await page.keyboard.press("Escape"); await page.waitForTimeout(400); }
  console.log("A resolved, shut:", await cards(), "| handled:", fs.existsSync(`${process.env.HOME}/.conduit/data/feedback/${id}/handled.json`));
  // Resolving its last comment handles the item, and the bar then leaves the thread by itself.
  if (await page.locator(".ui-markup-bar button[aria-label^='Back']").count()) await press("Back");
  await page.waitForTimeout(3500);
  console.log("A back:", await buttons());
  // The list is offered only while an item is unfinished; this probe's own was handled when its comment was resolved.
  if (await page.locator(".ui-markup-bar button[aria-label^='What was sent']").count()) await press("What was sent");
  await page.waitForTimeout(1500);
  console.log("A sent before:", await cards(), await buttons());
  await page.screenshot({ path: `${out}-list.png`, clip: { x: 900, y: 300, width: 600, height: 600 } });
  }

  stay = spawn("node", [script, "wait", "doc-probe", "--stay"]); let told = ""; stay.stdout.on("data", (data) => { told += data; });
  await page.goto("http://127.0.0.1:4310/?a=artifact:test");
  await page.waitForSelector(".ui-document-text [data-id]", { timeout: 20000 });
  await page.waitForTimeout(4500);
  console.log("B bar:", await buttons(), "| launch mark gone:", await js("!document.querySelector('[data-launch-mark], #launch-mark')"));
  // A paper's first listener is its mated thread, which a real model answers: the probe's own listener is chosen, and nothing is sent until it is.
  const picked = async (name) => { const next = page.locator('.ui-markup-bar button[title="The next waiting session"]'); if (!(await next.count())) { await page.locator("header button[aria-label='Agents']").click(); await page.locator("[role^=menuitem]", { hasText: name }).first().click(); await page.keyboard.press("Escape"); return; } for (let tries = 0; tries < 8 && (await next.textContent().catch(() => "")) !== name; tries++) { await next.click(); await page.waitForTimeout(150); } if ((await next.textContent()) !== name) throw new Error(`The bar does not hand to ${name}`); };
  await picked("doc-probe");
  await page.screenshot({ path: `${out}-doc0.png` });
  await page.waitForTimeout(300);
  await press("Select text"); await page.waitForTimeout(300);
  const line = await js("(() => { const l = document.querySelectorAll('.ui-document-text > [data-id]')[1].getBoundingClientRect(); return { x: l.left, y: l.top + l.height / 2 }; })()");
  await page.mouse.move(line.x + 4, line.y); await page.mouse.down(); await page.mouse.move(line.x + 180, line.y, { steps: 8 }); await page.mouse.up(); await page.waitForTimeout(500);
  await page.keyboard.type("Doc probe: tighten this"); await page.keyboard.press("Enter");
  await page.waitForTimeout(5000);
  // A document's comments are in its own store, and their cards in its margin.
  const doc = JSON.parse(await js("fetch('/v0/document/test/markup/open').then(r => r.text())")).items.find((one) => one.comments[0].comment === "Doc probe: tighten this"); mine.push(doc.id);
  const item = JSON.parse(fs.readFileSync(`${process.env.HOME}/.conduit/data/chat/files/test/.conduit/artifacts/test/markup/${doc.id}/item.json`, "utf8"));
  console.log("B item:", JSON.stringify({ id: doc.id, live: item.live, to: item.handed, quote: item.comments[0].quote, subject: { ...item.subject, text: item.subject?.text?.slice(0, 40) }, shot: item.screenshot }));
  console.log("B listener told:", told.trim().slice(0, 300));
  cli("reply", doc.id, "1", "Tightened.");
  await page.waitForTimeout(4500);
  console.log("B cards:", await cards(), "| bar:", await buttons());
  // Resolved by the session, the card stays, saying so; the person's tick puts it away.
  cli("resolve", doc.id, "1"); await page.waitForTimeout(4500);
  console.log("B after the session resolved it:", await cards());
  await page.locator(".ui-markup-bar [aria-label='Annotate with'] button[aria-pressed='true']").click({ timeout: 2000 }).catch(() => {}); // While annotating, the layer has every press.
  await page.locator(".ui-markup-margin .ui-markup-note", { hasText: "Doc probe" }).locator("button[aria-label='Resolve']").click(); await page.waitForTimeout(4500);
  console.log("B after the person's tick:", await cards());
  await page.screenshot({ path: `${out}-doc.png` });
  console.log("errors:", JSON.stringify(errors));
} finally {
  stay?.kill();
  for (const id of new Set(mine)) console.log(cli("done", id));
  await close();
}
