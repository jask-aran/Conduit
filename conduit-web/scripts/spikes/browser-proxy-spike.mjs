#!/usr/bin/env node
/*
 * Spike: can a page be shown by proxying it -- each site on an origin of its own under the hub, framed in Conduit --
 * with its security headers kept? Three local servers (SITE, PROXY, PARENT) stand in for the real ones.
 */
import http from "node:http";
import crypto from "node:crypto";
import { WebSocketServer, WebSocket } from "ws";
import { createRequire } from "node:module";
// Playwright is global in the dev container, not a dependency of Conduit.
const { chromium } = createRequire(import.meta.url)("playwright");

const SITE = "http://127.0.0.1:7200", PROXY = "http://127.0.0.1:7101", PARENT = "http://127.0.0.1:7000";

const site = http.createServer((request, response) => {
  if (request.url === "/go") { response.writeHead(302, { Location: `${SITE}/landed` }); return response.end(); }
  if (request.url === "/api") { response.writeHead(200, { "Content-Type": "application/json", "Set-Cookie": "api=1; Path=/; SameSite=Lax" }); return response.end(JSON.stringify({ ok: true, cookie: request.headers.cookie || "" })); }
  response.writeHead(200, {
    "Content-Type": "text/html", "X-Frame-Options": "DENY",
    "Content-Security-Policy": "frame-ancestors 'self'; script-src 'self' 'nonce-site'; connect-src 'self'",
    "Set-Cookie": `session=s3cret; Path=/; HttpOnly; SameSite=Lax${request.url === "/landed" ? "" : ""}`,
  });
  response.end(`<!doctype html><title>Site ${request.url}</title><h1 id=h>Site at ${request.url}</h1>
<a id=abs href="${SITE}/landed">absolute link</a> <a id=rel href="/landed">relative link</a> <a id=redir href="/go">redirect</a>
<p id=fetch>…</p><p id=ws>…</p>
<script nonce=site>
fetch("${SITE}/api").then(r => r.json()).then(j => document.getElementById("fetch").textContent = "fetch ok " + JSON.stringify(j)).catch(e => document.getElementById("fetch").textContent = "fetch failed " + e);
try { const s = new WebSocket("${SITE.replace("http", "ws")}/ws"); s.onmessage = (m) => document.getElementById("ws").textContent = "ws " + m.data; s.onerror = () => document.getElementById("ws").textContent = "ws failed"; } catch (e) { document.getElementById("ws").textContent = "ws threw " + e; }
</script>`);
});
const siteWs = new WebSocketServer({ server: site, path: "/ws" });
siteWs.on("connection", (socket) => socket.send("hello from the site"));

const rewriteUrls = (text) => text.split(SITE).join(PROXY).split(SITE.replace("http", "ws")).join(PROXY.replace("http", "ws"));
const proxy = http.createServer((request, response) => {
  const upstream = http.request(`${SITE}${request.url}`, { method: request.method, headers: { ...request.headers, host: new URL(SITE).host } }, (answer) => {
    const headers = { ...answer.headers };
    const nonce = crypto.randomBytes(12).toString("base64");
    delete headers["x-frame-options"];
    if (headers["content-security-policy"]) {
      headers["content-security-policy"] = String(headers["content-security-policy"])
        .replace(/frame-ancestors[^;]*/i, `frame-ancestors ${PARENT}`)
        .replace(/script-src([^;]*)/i, `script-src$1 'nonce-${nonce}'`)
        .replace(/connect-src([^;]*)/i, `connect-src$1 ${PROXY} ${PROXY.replace("http", "ws")}`);
    }
    if (headers.location) headers.location = rewriteUrls(String(headers.location));
    // Cookies: no Domain (the proxy's host is not the site's); SameSite=None;Secure would be needed over https framing.
    if (headers["set-cookie"]) headers["set-cookie"] = [].concat(headers["set-cookie"]).map((cookie) => cookie.replace(/;\s*Domain=[^;]*/i, ""));
    const html = String(headers["content-type"] || "").includes("text/html");
    if (!html) { response.writeHead(answer.statusCode, headers); return answer.pipe(response); }
    let body = "";
    answer.setEncoding("utf8");
    answer.on("data", (chunk) => { body += chunk; });
    answer.on("end", () => {
      const injected = `<script nonce="${nonce}">parent.postMessage({ type: "conduit-page", url: location.href, title: document.title }, ${JSON.stringify(PARENT)});</script>`;
      body = rewriteUrls(body).replace(/<\/body>|$/i, `${injected}$&`);
      delete headers["content-length"];
      response.writeHead(answer.statusCode, headers);
      response.end(body);
    });
  });
  upstream.on("error", (error) => { response.writeHead(502); response.end(String(error)); });
  request.pipe(upstream);
});
proxy.on("upgrade", (request, socket, head) => {
  const upstream = new WebSocket(`${SITE.replace("http", "ws")}${request.url}`);
  const server = new WebSocketServer({ noServer: true });
  server.handleUpgrade(request, socket, head, (client) => {
    upstream.on("message", (data) => client.send(String(data)));
    client.on("message", (data) => upstream.send(data));
  });
});

const parent = http.createServer((request, response) => {
  response.writeHead(200, { "Content-Type": "text/html" });
  response.end(`<!doctype html><p id=said>no message</p><iframe id=f src="${request.url === "/direct" ? SITE : PROXY}/" style="width:800px;height:400px"></iframe>
<script>addEventListener("message", (e) => { if (e.origin === ${JSON.stringify(PROXY)}) document.getElementById("said").textContent = "said " + JSON.stringify(e.data); });</script>`);
});

await Promise.all([[site, 7200], [proxy, 7101], [parent, 7000]].map(([server, port]) => new Promise((resolve) => server.listen(port, "127.0.0.1", resolve))));
const browser = await chromium.launch();
const page = await browser.newPage();
const report = (name, ok, detail = "", words = ["PASS", "FAIL"]) => console.log(`${ok ? words[0] : words[1]}  ${name}${detail ? `: ${detail}` : ""}`);
try {
  await page.goto(`${PARENT}/direct`); await page.waitForTimeout(800);
  report("direct framing is refused (the site's own headers work)", !(await page.frame({ url: /7200/ })?.$("#h").catch(() => null)));
  await page.goto(`${PARENT}/`); await page.waitForTimeout(1200);
  const frame = page.frame({ url: /7101/ });
  report("proxied page frames", Boolean(await frame?.$("#h")));
  report("injected script runs under the nonce, tells Conduit", (await page.textContent("#said")).startsWith("said"), await page.textContent("#said"));
  report("site's own nonce'd script still runs", (await frame.textContent("#fetch")) !== "…");
  report("absolute same-origin fetch, rewritten", (await frame.textContent("#fetch")).startsWith("fetch ok"), await frame.textContent("#fetch"));
  report("WebSocket, rewritten and proxied", (await frame.textContent("#ws")).startsWith("ws hello"), await frame.textContent("#ws"));
  const cookies = await page.context().cookies(PROXY);
  report("cookie set on the proxy's origin", cookies.some((cookie) => cookie.name === "session"), cookies.map((cookie) => `${cookie.name} sameSite=${cookie.sameSite}`).join(", "));
  await frame.click("#abs"); await page.waitForTimeout(800);
  report("absolute link stays in the proxy", Boolean(page.frame({ url: /7101\/landed/ })), page.frames().map((f) => f.url()).join(" "));
  await page.goto(`${PARENT}/`); await page.waitForTimeout(800);
  await page.frame({ url: /7101/ }).click("#redir"); await page.waitForTimeout(800);
  report("absolute redirect stays in the proxy", Boolean(page.frame({ url: /7101\/landed/ })));
  // What a page's script builds at runtime is not in the HTML the proxy rewrote.
  const escaped = await page.frame({ url: /7101/ }).evaluate((site) => { const a = document.createElement("a"); a.href = site + "/x"; return a.href; }, SITE);
  report("URLs built by script at runtime escape the proxy (needs a service worker or a runtime patch)", escaped.startsWith(SITE), escaped, ["GAP ", "ok  "]);
  // Cookies are per host, not per port: Conduit's own session cookie rides along to the proxied origin, and the proxy
  // would hand it to the site unless it strips it.
  await page.context().addCookies([{ name: "conduit_session", value: "person-token", url: PARENT, httpOnly: true, sameSite: "Lax" }]);
  await page.goto(`${PARENT}/`); await page.waitForTimeout(1200);
  const seen = await page.frame({ url: /7101/ }).textContent("#fetch");
  report("Conduit's session cookie reaches the site through a port-origin proxy", seen.includes("conduit_session"), seen, ["LEAK", "ok  "]);
} finally {
  await browser.close();
  for (const server of [site, proxy, parent]) server.close();
  process.exit(0);
}
