/*
 * jbot's mailbox. Email Routing hands each message for jbot@ to `email`, which keeps it whole in R2 (inbox/<time>-<id>.eml)
 * until the hub collects it: the hub may be asleep or on another network, so nothing is pushed to it. The hub, holding
 * the shared secret (HUB_SECRET), lists, reads and deletes what waits. Receiving only: it sends nothing, and mail over
 * MAX_BYTES is refused at the door, so the bucket never holds much.
 */
const MAX_BYTES = 10 * 1024 * 1024;
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

export default {
  async email(message, env) {
    if (message.rawSize > MAX_BYTES) { message.setReject("Message too large"); return; }
    const raw = await new Response(message.raw).arrayBuffer();
    const key = `inbox/${new Date().toISOString()}-${crypto.randomUUID()}.eml`;
    await env.MAIL.put(key, raw, { customMetadata: { from: message.from, to: message.to } });
    // Tell the hub, if it can be reached, to collect now; if not, its minute's poll will.
    if (env.HUB_URL) await fetch(`${env.HUB_URL}/v0/agent/email/wake`, { method: "POST", headers: { authorization: `Bearer ${env.HUB_SECRET}` } }).catch(() => {});
  },

  async fetch(request, env) {
    if (!env.HUB_SECRET || request.headers.get("authorization") !== `Bearer ${env.HUB_SECRET}`) return json({ error: "unauthorized" }, 401);
    const url = new URL(request.url);
    // GET /mail: what waits, oldest first.
    if (request.method === "GET" && url.pathname === "/mail") {
      const listed = await env.MAIL.list({ prefix: "inbox/", limit: 100 });
      return json({ messages: listed.objects.map((item) => ({ key: item.key, size: item.size, from: item.customMetadata?.from, to: item.customMetadata?.to })) });
    }
    const key = url.pathname.startsWith("/mail/") ? decodeURIComponent(url.pathname.slice(6)) : null;
    // GET /mail/<key>: the raw message.
    if (request.method === "GET" && key) {
      const object = await env.MAIL.get(key);
      return object ? new Response(object.body, { headers: { "content-type": "message/rfc822" } }) : json({ error: "not_found" }, 404);
    }
    // DELETE /mail/<key>: collected.
    if (request.method === "DELETE" && key) { await env.MAIL.delete(key); return json({ deleted: key }); }
    return json({ error: "not_found" }, 404);
  },
};
