// Sites, the second kind of artifact: New artifact makes one (a .site.html file in the project's folder) and its pane draws the file in a frame with no
// origin, whose scripts cannot reach the hub as the person or the page that holds them; the file changed on disk is shown again where it was scrolled,
// in the same frame; the pane's switch says Site | Thread; a box drawn over the site with Markup is sent with the elements under it, to a chat connected
// to the site; the block routes refuse a site; Delete removes the file. Makes "Probe site" in the Test project and deletes it, with what the hub kept for
// it, and a chat on the scripted test-stream profile (no model is called), which it deletes. The comment is addressed to that chat by name: sent to the
// bar's own choice it would go to the site's thread and start a model.
import fs from "node:fs/promises";
import { open, origin } from "./lib.mjs";

const folder = `${process.env.HOME}/.conduit/data/chat/files/test`, file = `${folder}/Probe site.site.html`, wait = (ms) => new Promise((done) => setTimeout(done, ms));
const { page, close } = await open({ width: 1600, height: 950 });
const errors = []; page.on("pageerror", (error) => errors.push(String(error)));
const api = (url, method = "GET", body) => page.evaluate(async ([url, method, body]) => { const answer = await fetch(url, { method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined }); return { status: answer.status, body: await answer.json().catch(() => null) }; }, [url, method, body]);
const menu = async (target, item) => { await target.click({ button: "right" }); await page.getByRole("menuitem", { name: item }).click(); };
const site = () => page.frames().find((frame) => frame.parentFrame() === page.mainFrame() && frame !== page.mainFrame());
const until = async (name, test, ms = 8000) => { let found; for (const end = Date.now() + ms; Date.now() < end; await wait(250)) if ((found = await test().catch(() => false))) break; console.log(`${name}:`, Boolean(found)); return found; };
let made, chat; const sent = [];
page.on("request", (request) => { if (request.frame() !== page.mainFrame() && request.url().startsWith(origin)) sent.push(request); });
try {
  await page.goto(`${origin}/?a=artifact:test`);
  await page.waitForSelector(".ui-document-text [data-id]", { timeout: 20000 }); await wait(1200);
  const project = page.locator('.ui-nav-link:has-text("Test")').first();
  if (!(await page.locator('[data-doc-view="artifact:test"]').count())) await page.locator('button[title="Expand Test"]').click();
  await menu(project, "New artifact"); await page.locator(".ui-pane-home").getByRole("button", { name: /^Site/ }).click();
  await page.fill("#artifact-name", "Probe site"); await page.keyboard.press("Enter");
  const row = page.locator('[data-doc-view^="artifact:"]:has-text("Probe site")').first(); await row.waitFor(); await wait(1500);
  made = (await row.getAttribute("data-doc-view")).slice("artifact:".length);
  const html = await fs.readFile(file, "utf8").catch(() => "");
  console.log("New artifact makes the file, with its id in it, and opens it:", html.includes(`content="${made}"`) && page.url().includes(made));
  await until("the pane draws the file in a frame", async () => (await site()?.evaluate(() => document.querySelector("h1")?.textContent)) === "Probe site");
  console.log("the frame may run scripts and nothing else:", await page.evaluate(() => document.querySelector(".pane-artifact iframe")?.getAttribute("sandbox")) === "allow-scripts");
  console.log("the site's scripts cannot reach the hub as the person, its cookies or the page that holds it:", JSON.stringify(await site().evaluate(async (hub) => ({
    hub: await fetch(`${hub}/v0/projects`, { credentials: "include" }).then((answer) => answer.status, () => "refused"),
    blind: await fetch(`${hub}/v0/projects`, { credentials: "include", mode: "no-cors" }).then((answer) => answer.type, () => "refused"),
    cookie: (() => { try { return document.cookie; } catch { return "refused"; } })(),
    parent: (() => { try { return parent.document.title; } catch { return "refused"; } })(),
    top: (() => { try { top.location.href = "about:blank"; return "navigated"; } catch { return "refused"; } })(),
    origin: self.origin,
  }), origin)), "| what it asked the hub carried no sign-in:", sent.length === 2 && (await Promise.all(sent.map((request) => request.allHeaders()))).every((headers) => !headers.cookie && !headers.authorization), "| the person's own page still answers:", (await api("/v0/projects")).status === 200 && page.url().includes(made));
  console.log("the switch says Site | Thread, and the row has no Markdown to export:", (await page.locator('.pane-artifact [aria-label="View"]').textContent()).replace(/\s+/g, " ").trim(), "|", await (async () => { await row.click({ button: "right" }); const items = await page.getByRole("menuitem").allTextContents(); await page.keyboard.press("Escape"); return items.join(); })());
  // A new version of the file: the same frame, where it was scrolled.
  await page.evaluate(() => { document.querySelector(".pane-artifact iframe").dataset.probe = "kept"; });
  const tall = html.replace("</body>", `<section id="plans"><h2>Plans</h2><p class="lede">Three of them.</p></section><div style="height:3000px"></div></body>`);
  await fs.writeFile(file, tall);
  await until("a file changed on disk is shown", async () => (await site().evaluate(() => document.querySelector("h2")?.textContent)) === "Plans");
  await site().evaluate(() => scrollTo(0, 500)); await wait(600);
  await fs.writeFile(file, tall.replace("Three of them.", "Four of them."));
  await until("the next version opens where this one was scrolled, in the same frame", async () => (await site().evaluate(() => document.querySelector(".lede")?.textContent === "Four of them." && scrollY)) === 500 && await page.evaluate(() => document.querySelector(".pane-artifact iframe").dataset.probe === "kept"));
  await site().evaluate(() => scrollTo(0, 0)); await wait(400);
  // A box drawn over the heading, with Markup, for a chat connected to the site.
  chat = (await api("/v0/chats", "POST", { projectId: "test", profileId: "test-stream" })).body.id;
  const name = `chat ${chat.slice(0, 8)}`;
  await api(`/v0/document/${made}/connections/${chat}`, "PUT"); await wait(3500);
  const bar = page.locator(".pane-artifact ~ * .ui-markup-bar, .ui-markup-bar").last();
  console.log("Markup's bar on a site:", await page.evaluate(() => JSON.stringify([...document.querySelectorAll(".ui-markup-bar [role=radio]")].map((button) => button.getAttribute("aria-label").split(" ")[0]))));
  const heading = await page.evaluate(() => { const frame = document.querySelector(".pane-artifact iframe").getBoundingClientRect(); return { left: frame.left, top: frame.top }; });
  const inside = await site().evaluate(() => { const box = document.querySelector("#plans h2").getBoundingClientRect(); return { left: box.left, top: box.top, width: box.width, height: box.height }; });
  await bar.locator("button[aria-label^='Shape']").click(); await wait(300);
  const x = heading.left + inside.left, y = heading.top + inside.top;
  await page.mouse.move(x - 6, y - 6); await page.mouse.down(); await page.mouse.move(x + Math.min(inside.width, 200), y + inside.height + 6, { steps: 8 }); await page.mouse.up(); await wait(500);
  if (await page.locator(".ui-markup-note[data-float] button[role=switch][aria-checked=true]").count()) await page.locator(".ui-markup-note[data-float] button[role=switch]").click();
  await page.keyboard.type(`@${name} Site probe: make this heading larger`); await page.keyboard.press("Enter"); await wait(500);
  await page.locator("header button", { hasText: /^Send/ }).click({ force: true }); await wait(5000);
  const items = (await api(`/v0/document/${made}/markup/open`)).body?.items ?? [], comment = items[0]?.comments[0];
  console.log("the comment is sent with the elements under the box:", comment?.under?.elements, "| it is on the site's own store, taken by the connected chat:", items.length === 1 && items[0].by === name, items[0]?.state);
  const item = items[0] && JSON.parse(await fs.readFile(`${folder}/.conduit/artifacts/${made}/markup/${items[0].id}/item.json`, "utf8"));
  console.log("the item says which file to change:", item?.summary, "|", item?.read.some((line) => line.includes(file)));
  if (items[0]) await api(`/v0/document/${made}/markup/items/${items[0].id}/messages`, "POST", { n: 1, resolved: true });
  await page.locator(".ui-markup-bar [aria-label='Annotate with'] button[aria-pressed='true']").click({ timeout: 2000 }).catch(() => {});
  console.log("the block routes refuse a site and say where its file is:", JSON.stringify((await api(`/v0/document/${made}`)).body), (await api(`/v0/document/${made}/blocks`, "POST", { op: "insert", block: "start", markdown: "x" })).status);
  console.log("its HTML is never served as a page:", await page.evaluate(async (id) => (await fetch(`/v0/document/${id}?as=site`)).headers.get("content-type"), made));
  await menu(row, "Delete"); await page.getByRole("button", { name: "Delete", exact: true }).last().click(); await wait(2500);
  console.log("Delete removes the file and the row, and the pane says so:", !(await fs.stat(file).catch(() => null)) && !(await row.count()), "|", await page.evaluate(() => [...document.querySelectorAll(".pane-artifact")].some((pane) => pane.textContent.includes("This site could not be opened"))));
} finally {
  if (chat) await api(`/v0/sessions/${chat}`, "DELETE").catch(() => {});
  await fs.rm(file, { force: true });
  if (made) await fs.rm(`${folder}/.conduit/artifacts/${made}`, { recursive: true, force: true });
  console.log("errors:", JSON.stringify(errors));
  await close();
}
