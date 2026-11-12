// /document: the page shows the hub's test document; a block an agent writes with the CLI shows on the page and opening a page writes none; typing reaches the hub and a second page;
// a phone-sized page types without harming the blocks; Markup's bar answers over it. Every block it adds it deletes, and it says whether the document ended as it began. Sends no markup.
import { execFileSync } from "node:child_process";
import { open, origin, root } from "./lib.mjs";
const { context, page, cdp, close } = await open({ width: 1500, height: 900 });
const cli = (...args) => execFileSync("node", ["scripts/conduit-markup.mjs", "document", ...args, "--as", "probe"], { cwd: root, encoding: "utf8" });
const ids = (text) => [...text.matchAll(/<!-- block (\w+) -->/g)].map((match) => match[1]);
let added = [];
try {
  await cdp.send("Network.setBypassServiceWorker", { bypass: true });
  const errors = [];
  const watch = (target) => target.on("pageerror", (error) => errors.push(String(error.stack ?? error).slice(0, 400)));
  const visit = async (target) => { watch(target); await target.goto(`${origin}/document`); await target.waitForSelector(".ui-document-text [data-id]", { timeout: 20000 }); };
  const shown = (target) => target.evaluate(() => [...document.querySelectorAll(".ui-document-text > [data-id]")].map((block) => `${block.dataset.id} ${block.textContent}`));
  const until = async (what, test) => { for (let tries = 0; tries < 40; tries += 1) { if (await test()) return console.log(`${what}: true`); await page.waitForTimeout(100); } console.log(`${what}: false`); };
  const before = cli("read", "test");
  await visit(page);
  console.log("page shows the hub's blocks, in order:", JSON.stringify((await shown(page)).map((line) => line.split(" ")[0])) === JSON.stringify(ids(before)));

  added = JSON.parse(cli("insert", "test", ids(before).at(-1), "A line the **agent** wrote.\n\nProbe types here:\n\n---")).blocks;
  await until("the agent's block shows on the page", async () => (await shown(page)).some((line) => line === `${added[0]} A line the agent wrote.`));

  const second = await context.newPage();
  await visit(second);
  await page.waitForTimeout(500);
  console.log("opening pages wrote no block:", JSON.stringify(ids(cli("read", "test"))) === JSON.stringify([...ids(before), ...added]));
  await page.locator(`.ui-document-text > [data-id="${added[1]}"]`).click();
  await page.keyboard.press("End"); await page.keyboard.type(" typed on the first page");
  await until("typing reaches the hub", async () => cli("read", "test").includes("Probe types here: typed on the first page"));
  await until("typing shows on a second page", async () => (await shown(second)).some((line) => line.includes("typed on the first page")));
  await page.keyboard.press("Enter"); await page.keyboard.type("# A heading");
  await until("a typed block has an id of its own and a kind", async () => page.evaluate(() => { const made = [...document.querySelectorAll(".ui-document-text > h1[data-id]")].at(-1); return made?.textContent === "A heading"; }));
  added.push(...ids(cli("read", "test")).filter((id) => !ids(before).includes(id) && !added.includes(id)));
  console.log("the format names its authors:", await page.evaluate(() => fetch("/v0/document/test?as=blocks").then((answer) => answer.json()).then((kept) => `${kept.format} ${kept.version}: ${[...new Set(Object.values(kept.authors))].sort().join(", ")}`)));
  console.log("block kind in the bar:", await page.locator(".ui-document button[aria-label='Block kind']").textContent());

  await second.setViewportSize({ width: 390, height: 800 });
  await second.locator(`.ui-document-text > [data-id="${added[1]}"]`).click();
  await second.keyboard.press("End"); await second.keyboard.type(" and on a phone");
  await until("a phone-sized page's typing merges", async () => cli("read", "test").includes("typed on the first page and on a phone"));
  console.log("phone page scrolls sideways:", await second.evaluate(() => document.documentElement.scrollWidth > innerWidth));
  await second.close();

  const tools = () => page.evaluate(() => JSON.stringify([...document.querySelectorAll(".ui-markup-bar [role=radio]")].map((button) => button.getAttribute("aria-label").split(" ")[0] + (button.getAttribute("aria-checked") === "true" ? "*" : ""))));
  console.log("Markup's bar on load:", await tools());
  await page.locator(".ui-markup-bar button[aria-label^='Highlighter']").click(); await page.waitForTimeout(400);
  console.log("after pressing Highlighter from Use:", await tools(), "| layer selecting:", await page.evaluate(() => document.querySelector(".ui-markup-layer").hasAttribute("data-select")), "| thin:", await page.evaluate(() => document.querySelector(".ui-markup-rails").hasAttribute("data-thin")));
  await page.screenshot({ path: "/tmp/markup-probe-document.png" });
  console.log("errors:", JSON.stringify(errors));
} finally {
  for (const id of added) try { cli("delete", "test", id); } catch { /* already gone */ }
  await close();
}
