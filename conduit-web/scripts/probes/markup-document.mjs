// The test paper in a pane (/?a=artifact:test): the pane shows the hub's test paper; a block an agent writes with the CLI shows on the page and opening a page writes none; typing reaches the hub and a second page;
// the title is the paper's name; Alt+Shift+ArrowUp moves a block and it keeps its id; the block handle shows on hover and its menu's Duplicate makes a block with an id of its own;
// a property set on one page shows on the second and goes again; the rail makes a block another kind and asks the agent about it; the caret's empty paragraph hints, `/` makes a block a kind, selected text's Bold bolds it; a comment's card stands in the margin beside its text on a second page (under the text on a phone-sized one), an edit sent
// --for it tints its block, Revert puts the block back, a session's resolve leaves the card and the tint, the person's accepts the change; a phone-sized page types without harming the blocks; Markup's bar answers over it. Every block it adds
// it deletes and the one comment it sends (handed to no session) it finishes.
import { execFileSync } from "node:child_process";
import { open, origin, root } from "./lib.mjs";
const { context, page, cdp, close } = await open({ width: 1500, height: 900 });
const markup = (...args) => execFileSync("node", ["scripts/conduit-markup.mjs", ...args], { cwd: root, encoding: "utf8" });
const cli = (...args) => markup("document", ...args, "--as", "probe");
const ids = (text) => [...text.matchAll(/<!-- block (\w+) -->/g)].map((match) => match[1]);
let added = [], item;
try {
  await cdp.send("Network.setBypassServiceWorker", { bypass: true });
  // The comment is handed to no one: a session that is listening is not given a probe's words to act on. An artifact's ribbon always
  // hands on (to the paper's own thread, a real model), so here the hub is made to say no one is listening.
  await context.route("**/v0/document/*/markup/waiting", (route) => route.fulfill({ json: { waiting: [] } }));
  await context.addInitScript(() => { localStorage.setItem("ui-markup.hand", "off"); localStorage.setItem("ui-markup.live", "off"); });
  const errors = [];
  const watch = (target) => target.on("pageerror", (error) => errors.push(String(error.stack ?? error).slice(0, 400)));
  const visit = async (target) => { watch(target); await target.goto(`${origin}/?a=artifact:test`); await target.waitForSelector(".ui-document-text [data-id]", { timeout: 20000 }); };
  const shown = (target) => target.evaluate(() => [...document.querySelectorAll(".ui-document-text > [data-id]")].map((block) => `${block.dataset.id} ${block.textContent}`));
  const until = async (what, test) => { for (let tries = 0; tries < 40; tries += 1) { if (await test()) return console.log(`${what}: true`); await page.waitForTimeout(100); } console.log(`${what}: false`); };
  const before = cli("read", "test");
  await visit(page);
  console.log("the title is the paper's name:", await page.evaluate(() => { const title = document.querySelector(".ui-document-title"), name = document.querySelector(".ui-document-text")?.getAttribute("aria-label"); return Boolean(name) && (title?.value ?? title?.textContent) === name; }));
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
  const order = () => ids(cli("read", "test")).filter((id) => added.includes(id)).join(" ");
  await page.keyboard.press("Alt+Shift+ArrowUp");
  await until("Alt+Shift+ArrowUp moves the caret's block up, keeping its id and its text", async () => order() === [added[1], added[0], ...added.slice(2)].join(" ") && (await shown(second)).includes(`${added[1]} Probe types here: typed on the first page`));
  await page.keyboard.press("Alt+Shift+ArrowDown");
  await until("Alt+Shift+ArrowDown moves it back", async () => order() === added.join(" "));
  await page.keyboard.press("Enter"); await page.keyboard.type("# A heading");
  await until("a typed block has an id of its own and a kind", async () => page.evaluate(() => { const made = [...document.querySelectorAll(".ui-document-text > h1[data-id]")].at(-1); return made?.textContent === "A heading"; }));
  added.push(...ids(cli("read", "test")).filter((id) => !ids(before).includes(id) && !added.includes(id)));
  console.log("the format names its authors:", await page.evaluate(() => fetch("/v0/document/test?as=blocks").then((answer) => answer.json()).then((kept) => `${kept.format} ${kept.version}: ${[...new Set(Object.values(kept.authors))].sort().join(", ")}`)));
  const rail = page.locator(".ui-markup-bar [aria-label='Document tools']");
  await rail.locator("button[aria-label='Block']").click(); await page.getByRole("menuitem", { name: "Heading 2" }).click();
  await until("the ribbon makes the caret's block another kind", () => page.evaluate(() => { const made = [...document.querySelectorAll(".ui-document-text > h2[data-id]")].at(-1); return made?.textContent === "A heading"; }));
  console.log("the ribbon says which kind the caret is in:", await rail.locator("button[aria-label='Block']").textContent(), "| the document's own bar holds:", await page.locator(".ui-document .ui-pane-header button, .ui-document header button").allTextContents());
  // The paper's own tools: the caret's empty paragraph hints, `/` makes a block a kind, and selected text has its tools over it.
  await page.locator(".ui-document-text > h2[data-id]").last().click(); await page.keyboard.press("End"); await page.keyboard.press("Enter");
  console.log("the caret's empty paragraph hints:", await page.evaluate(() => { const hint = document.querySelector(".ui-document-text .ui-document-hint"); return hint ? getComputedStyle(hint, "::before").content : null; }));
  await page.keyboard.type("/quo");
  await until("/ offers the block kinds, filtered by what follows it", async () => (await page.locator("[aria-label='Blocks'] [role=option]").allTextContents()).join() === "Quote");
  await page.keyboard.press("Enter"); await page.keyboard.type("Quoted by the probe");
  await until("picked, the block is that kind and the typed /quo is gone", () => page.evaluate(() => [...document.querySelectorAll(".ui-document-text > blockquote")].some((block) => block.textContent === "Quoted by the probe")));
  await page.keyboard.press("Shift+Home");
  const format = page.locator("[role=toolbar][aria-label='Format']");
  await format.waitFor({ timeout: 3000 }).catch(() => {});
  console.log("selected text has its tools:", await format.locator("button").evaluateAll((buttons) => buttons.map((button) => button.getAttribute("aria-label")).join(", ")).catch(() => "none"));
  await format.locator("button[aria-label='Bold']").click();
  await until("Bold makes the selection bold, and its button says so", async () => await page.evaluate(() => [...document.querySelectorAll(".ui-document-text > blockquote strong")].some((bold) => bold.textContent === "Quoted by the probe")) && await format.locator("button[aria-label='Bold']").getAttribute("aria-pressed") === "true");
  added.push(...ids(cli("read", "test")).filter((id) => !ids(before).includes(id) && !added.includes(id)));

  // The block handle, beside the block the mouse is over; its menu's Duplicate writes a copy under it with an id of its own.
  const typed = await page.locator(`.ui-document-text > [data-id="${added[1]}"]`).boundingBox();
  await page.mouse.move(typed.x + 8, typed.y + typed.height / 2);
  await until("the handle shows beside the block pointed at", () => page.evaluate((box) => { const handle = document.querySelector(".ui-document-handle[data-shown]")?.getBoundingClientRect(); return Boolean(handle) && handle.right <= box.x && handle.bottom > box.y && handle.top < box.y + box.height; }, typed));
  await page.locator(".ui-document-handle[data-shown] [data-grip]").click();
  await page.getByRole("menuitem", { name: "Duplicate" }).click();
  await until("Duplicate writes a copy under the block, with an id of its own", () => {
    const text = cli("read", "test"), now = ids(text), copy = now[now.indexOf(added[1]) + 1];
    const made = Boolean(copy) && !added.includes(copy) && !ids(before).includes(copy) && Boolean(text.split(`<!-- block ${copy} -->`)[1]?.trim().startsWith("Probe types here: typed on the first page"));
    if (made) added.push(copy);
    return made;
  });

  // A property, written on one page, read on the second, then cleared away.
  await page.locator(".ui-document-head").hover(); await page.locator(".ui-document-head button", { hasText: "Add a property" }).click();
  await page.keyboard.type("Probe check"); await page.keyboard.press("Enter"); await page.keyboard.type("set by the probe"); await page.keyboard.press("Enter");
  const property = (target) => target.evaluate(() => [...document.querySelectorAll(".ui-document-property")].map((row) => `${row.querySelector(".ui-document-property-name").textContent}: ${row.querySelector("input")?.value}`).find((row) => row.startsWith("Probe check")));
  await until("a property set on one page shows on the second and reaches the hub", async () => await property(second) === "Probe check: set by the probe" && cli("read", "test").includes("Probe check"));
  await page.locator(".ui-document-property input[aria-label='Probe check']").fill(""); await page.locator(".ui-document-property input[aria-label='Probe check']").blur();
  await until("a property cleared and left goes, from both pages and the hub", async () => !await property(second) && !await property(page) && !cli("read", "test").includes("Probe check"));

  // One comment, made on the first page; what stands for it is read on the second.
  const at = await page.locator(`.ui-document-text > [data-id="${added[0]}"]`).boundingBox();
  await page.locator(".ui-markup-bar button[aria-label^='Select text']").click();
  await page.mouse.move(at.x + 4, at.y + at.height / 2); await page.mouse.down(); await page.mouse.move(at.x + 120, at.y + at.height / 2, { steps: 6 }); await page.mouse.up(); await page.waitForTimeout(400);
  await page.keyboard.type("Document probe: say this another way"); await page.keyboard.press("Enter");
  await page.locator(".ui-markup-bar button", { hasText: "Send" }).click();
  // The ribbon has no mode to press: the tool held is let go, and the app is in use.
  await page.locator(".ui-markup-bar [aria-label='Annotate with'] button[aria-pressed='true']").click({ timeout: 2000 }).catch(() => {});
  const card = (target) => target.evaluate(() => {
    const note = [...document.querySelectorAll(".ui-markup-margin .ui-markup-note")].find((one) => one.textContent.includes("Document probe")), mark = note && document.querySelector(`[data-comment~="${note.dataset.key}"]`);
    const box = note?.getBoundingClientRect(), about = mark?.getBoundingClientRect();
    return note ? { key: note.dataset.key, state: note.querySelector(".ui-markup-state")?.textContent, off: about && Math.round(box.top - about.top), beside: about && box.left > about.right, under: about && box.top > about.bottom, marked: mark?.textContent } : null;
  });
  const tinted = (target) => target.evaluate((id) => Boolean(document.querySelector(`.ui-document-text > [data-id="${id}"].ui-document-changed`)), added[0]);
  const mine = (target) => target.locator(".ui-markup-margin .ui-markup-note", { hasText: "Document probe" });
  await until("the comment's card stands beside its text on a second page", async () => { const now = await card(second); return Boolean(now?.beside) && Math.abs(now.off) <= 2; });
  const sent = await card(second), key = sent?.key ?? "none/0"; item = key.split("/")[0];
  console.log("the card:", JSON.stringify(sent), "| in the tool's corner:", await page.locator(".ui-markup-notes .ui-markup-note").count());
  cli("replace", "test", added[0], "A line the agent wrote **another way**.", "--for", key);
  await until("an edit sent for the comment tints its block, and the card says Changed", async () => await tinted(second) && (await card(second))?.state === "Changed");
  await mine(second).click(); await mine(second).locator("button", { hasText: "Revert" }).click();
  await until("Revert puts the block back and the tint goes", async () => cli("read", "test").includes("A line the **agent** wrote.") && !await tinted(second));
  cli("replace", "test", added[0], "A line the agent wrote **another way**.", "--for", key);
  await until("a second edit tints it again", () => tinted(page));
  markup("resolve", item, "1");
  await until("a session's resolve accepts nothing: the card stays, saying so, and the tint with it", async () => (await card(page))?.state === "Agent resolved" && await tinted(page));

  await second.setViewportSize({ width: 390, height: 800 });
  await until("a phone-sized page has the card under the text", async () => { const now = await card(second); return Boolean(now?.under) && !now.beside; });
  await second.locator(`.ui-document-text > [data-id="${added[1]}"]`).click();
  await second.keyboard.press("End"); await second.keyboard.type(" and on a phone");
  await until("a phone-sized page's typing merges", async () => cli("read", "test").includes("typed on the first page and on a phone"));
  console.log("phone page scrolls sideways:", await second.evaluate(() => document.documentElement.scrollWidth > innerWidth));
  await second.close();
  await mine(page).locator("button[aria-label='Resolve']").click();
  await until("resolving accepts the change: the card and the tint go, the text stays", async () => !await card(page) && !await tinted(page) && cli("read", "test").includes("another way"));

  const tools = () => page.evaluate(() => JSON.stringify([...document.querySelectorAll(".ui-markup-bar [role=radio]")].map((button) => button.getAttribute("aria-label").split(" ")[0] + (button.getAttribute("aria-checked") === "true" ? "*" : ""))));
  console.log("Markup's bar while the app is in use:", await tools());
  await page.locator(".ui-markup-bar button[aria-label^='Highlighter']").click(); await page.waitForTimeout(400);
  console.log("after pressing Highlighter from Use:", await tools(), "| layer selecting:", await page.evaluate(() => document.querySelector(".ui-markup-layer").hasAttribute("data-select")), "| thin:", await page.evaluate(() => document.querySelector(".ui-markup-rails").hasAttribute("data-thin")));
  await page.screenshot({ path: "/tmp/markup-probe-document.png" });
  console.log("errors:", JSON.stringify(errors));
} finally {
  try { const left = page.locator(".ui-document-property input[aria-label='Probe check']"); if (await left.count()) { await left.fill(""); await left.blur(); await page.waitForTimeout(300); } } catch { /* the page is gone */ }
  for (const id of added) try { cli("delete", "test", id); } catch { /* already gone */ }
  if (item) try { markup("done", item); } catch { /* never sent */ }
  await close();
}
