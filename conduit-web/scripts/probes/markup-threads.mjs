// A paper's mated thread and its connections: the pane's Paper | Thread switch turns the same tab to the paper's own chat (made by the hub, in no list of
// chats) and back; a chat connected to the paper is a listener by name, a comment sent to it is taken in its name and written into the chat, which starts
// its agent; the chat shows the connection as a rider, which opens the paper beside it and disconnects it.
// The chat's harness answers through the tool conduit_paper (Conduit's MCP endpoint).
// Makes a chat on the scripted test-stream profile (no model is called) and deletes it; the comment it sends it resolves as the person.
import { open, origin } from "./lib.mjs";

const wait = (ms) => new Promise((done) => setTimeout(done, ms)), paper = "/v0/document/test";
const { page, close } = await open({ width: 1600, height: 950 });
const errors = []; page.on("pageerror", (error) => errors.push(String(error)));
const api = (url, method = "GET", body) => page.evaluate(async ([url, method, body]) => { const answer = await fetch(url, { method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined }); return answer.json().catch(() => null); }, [url, method, body]);
const view = () => page.evaluate(() => ({ shown: document.querySelector('[aria-label="View"] [aria-checked="true"], [aria-label="View"] [aria-pressed="true"], [aria-label="View"] [data-current]')?.textContent.trim(), tabs: [...document.querySelectorAll("main [role=tab]")].map((tab) => tab.textContent.trim()).join() }));
const turn = (to) => page.locator('[aria-label="View"]').getByText(to).click();
let chat, item; const extra = [];
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
  // Addressing by name, with the bar still handing to conduit: `@` typed in the paper offers the listeners and opens a comment for the one picked; `@name` in a comment's words sends it there.
  await page.reload(); await page.waitForSelector(".ui-document-text [data-id]", { timeout: 20000 }); await wait(3000);
  const last = page.locator(".ui-document-text > [data-id]").last(), was = await last.textContent(), note = () => page.locator(".ui-markup-note[data-float]").textContent();
  // A line with nothing else on it asks too: the `@` offers who is listening there as anywhere.
  await last.click(); await page.keyboard.press("End"); await page.keyboard.press("Enter"); await page.keyboard.type("@"); await wait(600);
  const alone = await page.evaluate(() => [...document.querySelectorAll("[role=option]")].map((one) => one.textContent.trim()));
  await page.keyboard.press("Escape"); await page.keyboard.press("Backspace"); await page.keyboard.press("Backspace"); await wait(300);
  console.log("@ alone on a new line offers the listeners:", alone[0] === "conduit" && alone.includes(name) && (await last.textContent()) === was, JSON.stringify(alone));
  await last.click(); await page.keyboard.press("Home"); await page.keyboard.type("@chat"); await wait(600);
  const offered = await page.evaluate(() => [...document.querySelectorAll("[role=option]")].map((one) => one.textContent.trim()));
  await page.keyboard.press("Enter"); await wait(800);
  console.log("@ in the paper offers the listeners; the one picked gets a comment on that block, the mention gone:", offered.join() === name && (await note()).includes(`Ask ${name}`) && (await last.textContent()) === was, JSON.stringify(offered));
  await page.keyboard.type("Thread probe: by the at sign"); await page.keyboard.press("Enter"); await wait(2500);
  await page.locator(".ui-markup-bar button[title^='Select text'], .ui-markup-bar button[aria-label^='Select text']").first().click(); await wait(300);
  const line = await page.evaluate(() => { const box = document.querySelectorAll(".ui-document-text > [data-id]")[1].getBoundingClientRect(); return { x: box.left, y: box.top + box.height / 2 }; });
  await page.mouse.move(line.x + 4, line.y); await page.mouse.down(); await page.mouse.move(line.x + 94, line.y, { steps: 8 }); await page.mouse.up(); await wait(500);
  await page.keyboard.type(`Thread probe: by name, @${name}`); await wait(300);
  const forName = (await note()).includes(`For ${name}`);
  await page.keyboard.press("Enter"); await wait(900);
  // The chat handed a comment is seen at work on the block it is about (its seat), before it has answered.
  console.log("the chat's agent is seen at work in the paper (its seat):", await page.evaluate(() => { const seat = document.querySelector(".ui-document-seat-name"); return seat ? `${seat.textContent} | blocks held: ${document.querySelectorAll(".ui-document-seat-held").length}` : null; }));
  await wait(2100);
  const named = (await api(`${paper}/markup/open`)).items.filter((one) => one.comments.some((comment) => comment.comment.startsWith("Thread probe: by")));
  extra.push(...named.map((one) => one.id));
  console.log("both went to the chat named, each an item of its own:", forName && named.length === 2 && named.every((one) => one.by === name), JSON.stringify(named.map((one) => [one.by, one.comments[0].comment])));
  await page.locator(".ui-markup-bar [aria-label='Annotate with'] button[aria-pressed='true']").click({ timeout: 2000 }).catch(() => {});
  // The chat's first turn names it, and a connected chat listens by its title: the name is read again.
  let titled = name; for (let tries = 0; tries < 16 && titled === name; tries++) { await wait(500); titled = (await api(`${paper}/markup/waiting`)).waiting.map((one) => one.name).find((one) => one !== "conduit") ?? name; }
  const mark = await api(`${paper}/markup/marks`, "POST", {});
  item = (await api(`${paper}/markup/marks/${mark.id}/send`, "POST", { to: titled, comments: [{ n: 1, kind: "note", name: "note", comment: "Thread probe: say hello" }], client: { kind: "probe" } })).id;
  await wait(6000);
  const handed = await api(`${paper}/markup/items/${item}`), told = await api(`/v0/chats/${chat}`);
  console.log("the comment is taken in the chat's name:", handed.state === "taken" && handed.by === titled, JSON.stringify({ state: handed.state, by: handed.by, titled }));
  console.log("the chat was written to and its agent started:", told.status === "active" && Boolean(told.lastMessageAt), JSON.stringify({ status: told.status, at: told.lastMessageAt }));
  // The same chat's harness, through Conduit's tools: the paper is the one it is connected to.
  const tool = async (args) => (await api(`/v0/mcp/chat/${chat}`, "POST", { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "conduit_paper", arguments: args } })).result;
  const asked = await tool({ action: "comments" }), read = await tool({ action: "read" });
  console.log("conduit_paper reads the paper and what was asked, with no paper named:", !asked.isError && asked.content[0].text.includes(item) && asked.content[0].text.includes("Thread probe: say hello") && /<!-- block \w+ -->/.test(read.content[0].text));
  await tool({ action: "reply", item, n: 1, text: "Hello from the tool" });
  console.log("its reply is in the thread:", (await api(`${paper}/markup/items/${item}`)).messages.some((message) => message.from === "agent" && message.text === "Hello from the tool"));
  await page.goto(`${origin}/chat/${chat}`); await page.waitForSelector(".chat-main textarea", { timeout: 15000 }); await wait(2500);
  console.log("the chat shows the comment, on the paper:", await page.evaluate(() => { const main = document.querySelector(".chat-main"); return Boolean(main?.textContent.includes("Thread probe: say hello") && [...main.querySelectorAll(".ui-reference")].some((one) => one.textContent.includes("Test document"))); }));
  const rider = page.getByRole("button", { name: "Open Test document" });
  console.log("the chat shows the connection as a rider:", await rider.count() === 1);
  await rider.click(); await page.waitForSelector(".pane-artifact .ui-document-text [data-id]", { timeout: 15000 });
  console.log("the rider opens the paper beside the chat:", await page.evaluate(() => document.querySelectorAll(".pane-artifact").length === 1 && Boolean(document.querySelector(".chat-main"))));
  await page.getByRole("button", { name: "Connect a chat" }).click(); await wait(500);
  console.log("the paper's menu has the chat ticked:", await page.evaluate(() => [...document.querySelectorAll('[role^="menuitem"]')].some((row) => row.getAttribute("aria-checked") === "true" || row.querySelector("svg") && row.dataset.picked !== undefined)));
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Disconnect Test document" }).click(); await wait(1500);
  console.log("Disconnect ends it:", !(await api(`${paper}/connections`)).connections.some((one) => one.chat === chat) && await rider.count() === 0);
  // The other end: the chat's own menu connects it to an artifact of its project.
  // The chat's row is drawn again as its first turn names it, which shuts a menu open on it: the row is pressed once it has its name.
  const row = page.locator(`[data-chat-id="${chat}"]`).first();
  for (let tries = 0; tries < 40 && !((await api(`/v0/chats/${chat}`)).title && (await row.textContent())?.includes((await api(`/v0/chats/${chat}`)).title)); tries++) await wait(500);
  await wait(800); await row.click({ button: "right" });
  await page.getByRole("menuitem", { name: "Connect to artifact…" }).click();
  await page.getByRole("dialog").getByText("Test document").click(); await wait(1200);
  await page.keyboard.press("Escape"); await wait(600);
  console.log("Connect to artifact, from the chat's menu, connects it, and Escape shuts the dialog:", (await api(`${paper}/connections`)).connections.some((one) => one.chat === chat) && await page.getByRole("dialog").count() === 0 && await rider.count() === 1);
} finally {
  for (const id of [item, ...extra].filter(Boolean)) await api(`${paper}/markup/items/${id}/messages`, "POST", { n: 1, resolved: true });
  if (chat) { await api(`${paper}/connections/${chat}`, "DELETE"); await api(`/v0/sessions/${chat}`, "DELETE"); }
  console.log("errors:", JSON.stringify(errors));
  await close();
}
