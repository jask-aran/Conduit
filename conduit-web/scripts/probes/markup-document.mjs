// /document: the page shows the hub's file, a tool pressed from Use starts annotating, the bar is solid, and a write to the file shows on the page. Sends nothing.
import { open } from "./lib.mjs";
import fs from "node:fs";
const file = `${process.env.HOME}/.conduit/data/documents/scratch.md`, before = fs.readFileSync(file, "utf8");
const { page, cdp, close } = await open({ width: 1500, height: 900 });
try {
  await cdp.send("Network.setBypassServiceWorker", { bypass: true });
  const errors = [];
  page.on("pageerror", (error) => errors.push(String(error.stack ?? error).slice(0, 400)));
  const js = (expression) => page.evaluate(expression);
  await page.goto("http://127.0.0.1:4310/document");
  await page.waitForSelector(".cm-content", { timeout: 20000 });
  await page.waitForTimeout(4500);
  const doc = () => js("[...document.querySelectorAll('.cm-line')].map(l => l.textContent).join('\\n')");
  console.log("page shows the file's first line:", (await doc()).split("\n")[0] === before.split("\n")[0]);
  const tools = () => js("JSON.stringify([...document.querySelectorAll('.ui-markup-bar [role=radio]')].map(b => b.getAttribute('aria-label').split(' ')[0] + (b.disabled ? ' (off)' : '') + (b.getAttribute('aria-checked') === 'true' ? '*' : '')))");
  console.log("on load:", await tools(), "| mode pressed:", await js("document.querySelector('.ui-markup-bar button[aria-pressed]')?.getAttribute('aria-pressed')"));
  await page.locator(".ui-markup-bar button[aria-label^='Highlighter']").click(); await page.waitForTimeout(400);
  console.log("after pressing Highlighter from Use:", await tools(), "| mode pressed:", await js("document.querySelector('.ui-markup-bar button[aria-pressed]')?.getAttribute('aria-pressed')"), "| layer selecting:", await js("document.querySelector('.ui-markup-layer').hasAttribute('data-select')"));
  console.log("bar fill:", await js("getComputedStyle(document.querySelector('.ui-markup-bar')).getPropertyValue('--frost-fill') + ' / thin: ' + document.querySelector('.ui-markup-rails').hasAttribute('data-thin')"));
  fs.writeFileSync(file, before + "\nA line the agent wrote.\n");
  await page.waitForTimeout(3500);
  console.log("agent's write shows:", (await doc()).includes("A line the agent wrote."));
  await page.locator(".ui-markup-bar button[aria-label^='Use the app']").click(); await page.waitForTimeout(300);
  await page.locator(".cm-content").click(); await page.keyboard.press("Control+End"); await page.keyboard.type("typed here"); await page.waitForTimeout(1500);
  console.log("typing reaches the file:", fs.readFileSync(file, "utf8").includes("typed here"));
  await page.screenshot({ path: "/tmp/markup-probe-doc2.png" });
  console.log("errors:", JSON.stringify(errors));
} finally { fs.writeFileSync(file, before); await close(); }
