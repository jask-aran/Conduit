// A paper's mated thread and its connections: the pane's Paper | Thread switch turns the same tab to the paper's own chat (made by the hub, in no list of
// chats) and back; a chat connected to the paper is a listener by name, a comment sent to it is taken in its name and written into the chat, which starts
// its agent; the chat shows the connection as a rider, which opens the paper beside it and disconnects it.
// Makes a chat on the scripted test-stream profile (no model is called) and deletes it; the comment it sends it resolves as the person.
import { open, origin } from "./lib.mjs";

const wait = (ms) => new Promise((done) => setTimeout(done, ms)), paper = "/v0/document/test";
const { page, close } = await open({ width: 1600, height: 950 });
const errors = []; page.on("pageerror", (error) => errors.push(String(error)));
const api = (url, method = "GET", body) => page.evaluate(async ([url, method, body]) => { const answer = await fetch(url, { method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined }); return answer.json().catch(() => null); }, [url, method, body]);
const view = () => page.evaluate(() => ({ shown: document.querySelector('[aria-label="View"] [aria-checked="true"], [aria-label="View"] [aria-pressed="true"], [aria-label="View"] [data-current]')?.textContent.trim(), tabs: [...document.querySelectorAll("main [role=tab]")].map((tab) => tab.textContent.trim()).join() }));
const turn = (to) => page.locator('[aria-label="View"]').getByText(to).click();
let chat, item;
try {
  await page.goto(`${origin}/?a=artifact:test`);
  await page.waitForSelector(".ui-document-text [data-id]", { timeout: 20000 }); await wait(1200);
  const before = await view();
  await turn("Thread"); await page.waitForSelector(".chat-main textarea", { timeout: 15000 }); await wait(1500);
  const thread = await view(), links = await api(`${paper}/connections`), listed = (await api("/v0/projects")).projects.flatMap((project) => project.sessions.map((one) => one.id));
  console.log("Thread turns the same tab to the paper's chat:", before.shown === "Paper" && thread.shown === "Thread" && before.tabs === thread.tabs && thread.tabs.endsWith("Test document"), JSON.stringify([before, thread]));
  console.log("the mated thread is a chat of the paper's, in no project's list:", Boolean(links.thread) && page.url().endsWith(links.thread) && !listed.includes(links.thread));
  await turn("Paper"); await page.waitForSelector(".pane-artifact .ui-document-text [data-id]", { timeout: 15000 });
  console.log("Paper turns it back:", (await view()).shown === "Paper" && (await view()).tabs === before.tabs);
  // A chat connected to the paper is handed what is sent to it.
  chat = (await api("/v0/chats", "POST", { projectId: "test", profileId: "test-stream" })).id;
  const name = `chat ${chat.slice(0, 8)}`;
  await api(`${paper}/connections/${chat}`, "PUT");
  const waiting = (await api(`${paper}/markup/waiting`)).waiting.map((one) => one.name);
  console.log("the hub's listeners are the mated thread, then the connected chat:", waiting[0] === "conduit" && waiting.includes(name), JSON.stringify(waiting));
  const mark = await api(`${paper}/markup/marks`, "POST", {});
  item = (await api(`${paper}/markup/marks/${mark.id}/send`, "POST", { to: name, comments: [{ n: 1, kind: "note", name: "note", comment: "Thread probe: say hello" }], client: { kind: "probe" } })).id;
  await wait(6000);
  const handed = await api(`${paper}/markup/items/${item}`), told = await api(`/v0/chats/${chat}`);
  console.log("the comment is taken in the chat's name:", handed.state === "taken" && handed.by === name, JSON.stringify({ state: handed.state, by: handed.by }));
  console.log("the chat was written to and its agent started:", told.status === "active" && Boolean(told.lastMessageAt), JSON.stringify({ status: told.status, at: told.lastMessageAt }));
  await page.goto(`${origin}/chat/${chat}`); await page.waitForSelector(".chat-main textarea", { timeout: 15000 }); await wait(2500);
  console.log("the chat reads the notice:", await page.evaluate(() => document.querySelector(".chat-main")?.textContent.includes('on the paper "Test document"') ?? false));
  const rider = page.getByRole("button", { name: "Open Connected to Test document" });
  console.log("the chat shows the connection as a rider:", await rider.count() === 1);
  await rider.click(); await page.waitForSelector(".pane-artifact .ui-document-text [data-id]", { timeout: 15000 });
  console.log("the rider opens the paper beside the chat:", await page.evaluate(() => document.querySelectorAll(".pane-artifact").length === 1 && Boolean(document.querySelector(".chat-main"))));
  await page.getByRole("button", { name: "Connect a chat" }).click(); await wait(500);
  console.log("the paper's menu has the chat ticked:", await page.evaluate(() => [...document.querySelectorAll('[role^="menuitem"]')].some((row) => row.getAttribute("aria-checked") === "true" || row.querySelector("svg") && row.dataset.picked !== undefined)));
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Disconnect Connected to Test document" }).click(); await wait(1500);
  console.log("Disconnect ends it:", (await api(`${paper}/connections`)).connections.length === 0 && await rider.count() === 0);
  // The other end: the chat's own menu connects it to an artifact of its project.
  const title = (await api(`/v0/chats/${chat}`)).title;
  await page.locator(".ui-row", { hasText: title }).first().click({ button: "right" });
  await page.getByRole("menuitem", { name: "Connect to artifact…" }).click();
  await page.getByRole("dialog").getByText("Test document").click(); await wait(1200);
  await page.keyboard.press("Escape"); await wait(600);
  console.log("Connect to artifact, from the chat's menu, connects it, and Escape shuts the dialog:", (await api(`${paper}/connections`)).connections.some((one) => one.chat === chat) && await page.getByRole("dialog").count() === 0 && await rider.count() === 1);
} finally {
  if (item) await api(`${paper}/markup/items/${item}/messages`, "POST", { n: 1, resolved: true });
  if (chat) { await api(`${paper}/connections/${chat}`, "DELETE"); await api(`/v0/sessions/${chat}`, "DELETE"); }
  console.log("errors:", JSON.stringify(errors));
  await close();
}
