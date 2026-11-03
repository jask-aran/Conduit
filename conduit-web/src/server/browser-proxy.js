import http from "node:http";
import https from "node:https";
import { lookup } from "node:dns/promises";
import { networkInterfaces } from "node:os";
import { isIP } from "node:net";
import { randomBytes } from "node:crypto";
import { pipeline } from "node:stream/promises";

const HOP_HEADERS = ["connection", "keep-alive", "proxy-authenticate", "proxy-authorization", "te", "trailer", "transfer-encoding", "upgrade"];
const hostnameOf = (url) => url.hostname.replace(/^\[|\]$/g, "");
const addressKey = (address) => isIP(address) === 6 ? new URL(`http://[${address}]/`).hostname : address;
const addressesOf = (hostname) => isIP(hostname)
  ? Promise.resolve([{ address: hostname, family: isIP(hostname) }]) : lookup(hostname, { all: true, verbatim: true });

function publicAddress(address) {
  if (isIP(address) === 4) {
    const [a, b] = address.split(".").map(Number);
    return a !== 0 && a !== 10 && a !== 127 && a < 224
      && !(a === 169 && b === 254) && !(a === 172 && b >= 16 && b <= 31)
      && !(a === 192 && b === 168) && !(a === 100 && b >= 64 && b <= 127)
      && !(a === 198 && (b === 18 || b === 19));
  }
  // Only global unicast IPv6; also exclude transition ranges that can encode private IPv4.
  const normalized = addressKey(address).slice(1, -1);
  return isIP(address) === 6 && /^[23]/.test(normalized)
    && !normalized.startsWith("2002:") && !/^2001:(0*:|db8:)/.test(normalized);
}

function cleanHeaders(source) {
  const headers = new Headers(source);
  const connection = headers.get("connection") || "";
  for (const name of [...HOP_HEADERS, ...connection.split(",").map((part) => part.trim()).filter(Boolean)]) headers.delete(name);
  return headers;
}

/** The request, connected to the address that was checked (never looked up again: no rebinding between check and connect). */
function requestPinned(target, { method, headers, body, signal }, address) {
  const transport = target.protocol === "https:" ? https : http;
  return new Promise((resolve, reject) => {
    const upstream = transport.request(target, { method, headers, agent: false, signal, servername: isIP(target.hostname) ? undefined : target.hostname,
      lookup: (_hostname, options, callback) => options?.all ? callback(null, [address]) : callback(null, address.address, address.family) }, resolve);
    upstream.on("error", reject);
    if (body) pipeline(body, upstream).catch(reject);
    else upstream.end();
  });
}

function rewritePolicy(value, conduitOrigin, proxyOrigin, nonce) {
  return value.split(",").map((policy) => {
    const directives = policy.split(";").map((part) => part.trim().split(/\s+/)).filter(([name]) => name);
    const find = (name) => directives.find(([key]) => key.toLowerCase() === name);
    const widen = (name, extra, fallback) => {
      let directive = find(name);
      if (!directive && fallback) { directive = [name, ...fallback.slice(1)]; directives.push(directive); }
      if (directive) {
        directive.splice(1, directive.length - 1, ...directive.slice(1).filter((part) => part !== "'none'"), ...extra);
      }
    };
    const ancestors = find("frame-ancestors");
    if (ancestors) ancestors.splice(1, ancestors.length - 1, conduitOrigin);
    else directives.push(["frame-ancestors", conduitOrigin]);
    widen("script-src", [`'nonce-${nonce}'`], find("default-src"));
    widen("script-src-elem", [`'nonce-${nonce}'`]);
    widen("connect-src", [proxyOrigin, proxyOrigin.replace(/^http/, "ws")], find("default-src"));
    return directives.map((parts) => parts.join(" ")).join("; ");
  }).join(", ");
}

function pageScript(targetOrigin, conduitOrigin, nonce) {
  // Serialised values cannot terminate the script element.
  const literal = (value) => JSON.stringify(value).replace(/</g, "\\u003c");
  return `<script nonce="${nonce}">(() => {
    const parentOrigin = ${literal(conduitOrigin)}, realOrigin = ${literal(targetOrigin)};
    const report = () => parent.postMessage({type:"conduit-proxy",url:realOrigin+location.pathname+location.search+location.hash,title:document.title},parentOrigin);
    for (const method of ["pushState","replaceState"]) {
      const original = history[method];
      history[method] = function(...args) { const result = original.apply(this,args); report(); return result; };
    }
    addEventListener("load",report); addEventListener("popstate",report); addEventListener("hashchange",report);
    new MutationObserver(report).observe(document.head || document.documentElement,{subtree:true,childList:true,characterData:true});
    addEventListener("message",event => {
      if (event.origin !== parentOrigin || event.source !== parent || event.data?.type !== "conduit-proxy-command") return;
      if (event.data.command === "back") history.back();
      else if (event.data.command === "forward") history.forward();
      else if (event.data.command === "reload") location.reload();
    });
  })();</script>`;
}

export function createBrowserProxy({ conduitOrigin, host, cookieNames = [] }) {
  conduitOrigin = new URL(conduitOrigin).origin;
  const conduit = new URL(conduitOrigin);
  const listeners = new Map();
  // Keep retired origins blocked too: an evicted frame may still be open.
  const proxyOrigins = new Set();
  const protectedNames = new Set(cookieNames);
  const protectedCookie = (name) => name.toLowerCase().startsWith("conduit") || protectedNames.has(name);
  let closed = false;
  let opening = Promise.resolve();

  const validate = async (value) => {
    if (typeof value !== "string") throw new Error("proxy_invalid_url");
    const target = new URL(value);
    if (!["http:", "https:"].includes(target.protocol) || target.username || target.password) throw new Error("proxy_invalid_url");
    if (target.hostname === conduit.hostname) throw new Error("proxy_target_refused");
    const own = new Set(Object.values(networkInterfaces()).flat().filter(Boolean).map((entry) => addressKey(entry.address)));
    for (const entry of await addressesOf(hostnameOf(conduit))) own.add(addressKey(entry.address));
    const addresses = await addressesOf(hostnameOf(target));
    if (!addresses.length || addresses.some(({ address }) => !publicAddress(address) || own.has(addressKey(address)))) throw new Error("proxy_target_refused");
    return { target, address: addresses[0] };
  };
  const touch = (origin) => {
    const listener = listeners.get(origin);
    if (listener) { listeners.delete(origin); listeners.set(origin, listener); }
  };
  const dispose = (listener) => { listener.server.close(); listener.server.closeAllConnections(); };

  const serve = async (request, response, targetOrigin, proxyOrigin) => {
    const abort = new AbortController();
    response.on("close", () => abort.abort());
    try {
      if (request.headers.host !== new URL(proxyOrigin).host || !request.url?.startsWith("/") || request.method === "CONNECT") {
        response.writeHead(400); response.end("proxy_wrong_origin"); return;
      }
      const { target, address } = await validate(targetOrigin + request.url);
      if (target.origin !== targetOrigin) throw new Error("proxy_wrong_origin");
      touch(targetOrigin);
      const headers = cleanHeaders(Object.entries(request.headers).filter(([, value]) => value !== undefined)
        .map(([name, value]) => [name, Array.isArray(value) ? value.join(", ") : value]));
      for (const name of ["host", "authorization", "content-length", "accept-encoding", "referer"]) headers.delete(name);
      headers.set("accept-encoding", "identity");
      const cookies = (headers.get("cookie") || "").split(";").filter((part) => {
        const name = part.trim().split("=", 1)[0];
        return name && !protectedCookie(name);
      }).join(";");
      if (cookies) headers.set("cookie", cookies); else headers.delete("cookie");
      if (headers.get("origin") === proxyOrigin) headers.set("origin", targetOrigin);
      const body = !["GET", "HEAD"].includes(request.method) ? request : undefined;
      const answer = await requestPinned(target, { method: request.method, headers: Object.fromEntries(headers), body,
        signal: AbortSignal.any([abort.signal, AbortSignal.timeout(60_000)]) }, address);
      const outgoing = cleanHeaders(Object.entries(answer.headers).filter(([name, value]) => name !== "set-cookie" && value !== undefined)
        .map(([name, value]) => [name, Array.isArray(value) ? value.join(", ") : value]));
      for (const name of ["x-frame-options", "content-length", "content-encoding", "set-cookie"]) outgoing.delete(name);
      for (const name of [...outgoing.keys()]) if (name.startsWith("access-control-allow-")) outgoing.delete(name);
      const nonce = randomBytes(18).toString("base64");
      outgoing.set("content-security-policy", rewritePolicy(outgoing.get("content-security-policy") || "", conduitOrigin, proxyOrigin, nonce));
      if (outgoing.has("content-security-policy-report-only")) outgoing.set("content-security-policy-report-only",
        rewritePolicy(outgoing.get("content-security-policy-report-only"), conduitOrigin, proxyOrigin, nonce));
      const rewriteUrl = (value) => {
        try { const url = new URL(value, target); return url.origin === targetOrigin ? proxyOrigin + url.pathname + url.search + url.hash : value; }
        catch { return value; }
      };
      if (outgoing.has("location")) outgoing.set("location", rewriteUrl(outgoing.get("location")));
      const html = /\btext\/html\b/i.test(outgoing.get("content-type") || "");
      if (!html && ["same-origin", "same-site"].includes(outgoing.get("cross-origin-resource-policy"))) outgoing.set("cross-origin-resource-policy", "cross-origin");
      // Rewritten pages must not reuse validators for the upstream's original bytes.
      if (html) { outgoing.delete("etag"); outgoing.delete("last-modified"); outgoing.set("cache-control", "no-store"); }
      for (const [name, value] of outgoing) response.setHeader(name, value);
      const setCookies = (answer.headers["set-cookie"] || []).filter((cookie) => !protectedCookie(cookie.split("=", 1)[0].trim()))
        .map((cookie) => cookie.replace(/;\s*Domain\s*=[^;]*/ig, "").replace(/;\s*SameSite\s*=[^;]*/ig, "") + "; SameSite=Lax");
      if (setCookies.length) response.setHeader("set-cookie", setCookies);
      response.statusCode = answer.statusCode;
      if (!html || request.method === "HEAD") { await pipeline(answer, response); return; }
      const chunks = [];
      for await (const chunk of answer) chunks.push(chunk);
      let text = Buffer.concat(chunks).toString("utf8");
      text = text.replace(/(\s)(href|src|action)(\s*=\s*)(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/gi,
        (_match, space, name, equals, double, single, bare) => {
          const quote = double !== undefined ? '"' : single !== undefined ? "'" : "";
          return `${space}${name}${equals}${quote}${rewriteUrl(double ?? single ?? bare)}${quote}`;
        });
      const script = pageScript(targetOrigin, conduitOrigin, nonce);
      text = /<head\b[^>]*>/i.test(text) ? text.replace(/<head\b[^>]*>/i, (head) => head + script)
        : text.replace(/<html\b[^>]*>|^(?:<!doctype[^>]*>)?/i, (start) => start + `<head>${script}</head>`);
      response.end(text);
    } catch (error) {
      if (process.env.CONDUIT_PROXY_DEBUG) console.warn("browser proxy:", error);
      if (response.headersSent) response.destroy();
      else { for (const name of response.getHeaderNames()) response.removeHeader(name); response.writeHead(502); response.end("proxy_request_failed"); }
    }
  };

  return {
    open(targetUrl) {
      const work = opening.then(async () => {
        if (closed) throw new Error("proxy_closed");
        const { target } = await validate(targetUrl);
        let listener = listeners.get(target.origin);
        if (!listener) {
          if (listeners.size >= 16) { const [origin, oldest] = listeners.entries().next().value; listeners.delete(origin); dispose(oldest); }
          let proxyOrigin;
          const server = http.createServer((request, response) => void serve(request, response, target.origin, proxyOrigin));
          server.on("upgrade", (_request, socket) => socket.destroy());
          await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, host, resolve); });
          proxyOrigin = `http://${conduit.hostname}:${server.address().port}`;
          listener = { server, proxyOrigin };
          listeners.set(target.origin, listener);
          proxyOrigins.add(proxyOrigin);
        }
        touch(target.origin);
        return { proxyOrigin: listener.proxyOrigin, url: listener.proxyOrigin + target.pathname + target.search + target.hash };
      });
      opening = work.catch(() => {});
      return work;
    },
    isProxyOrigin(origin) { return proxyOrigins.has(origin); },
    async close() { closed = true; await opening; for (const listener of listeners.values()) dispose(listener); listeners.clear(); },
  };
}
