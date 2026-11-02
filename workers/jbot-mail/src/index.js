import { EmailMessage } from "cloudflare:email";

/*
 * jbot's mailbox. Email Routing hands each message for jbot@ to `email`, which keeps it whole in R2 (inbox/<time>-<id>.eml)
 * until the hub collects it: the hub may be asleep or on another network, so nothing is pushed to it. The hub, holding
 * the shared secret (HUB_SECRET), lists, reads and deletes what waits, and sends a whole MIME message through `SEND`.
 */
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

export default {
  async email(message, env) {
    const raw = await new Response(message.raw).arrayBuffer();
    const key = `inbox/${new Date().toISOString()}-${crypto.randomUUID()}.eml`;
    await env.MAIL.put(key, raw, { customMetadata: { from: message.from, to: message.to } });
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
    // POST /send { from, to: [...], raw }: a whole MIME message, to each recipient.
    if (request.method === "POST" && url.pathname === "/send") {
      const { from, to, raw } = await request.json();
      if (!from || !Array.isArray(to) || !to.length || !raw) return json({ error: "from, to and raw are required" }, 400);
      const sent = [], failed = [];
      for (const recipient of to) {
        try { await env.SEND.send(new EmailMessage(from, recipient, raw)); sent.push(recipient); }
        catch (error) { failed.push({ recipient, error: String(error?.message || error) }); }
      }
      return json({ sent, failed }, failed.length && !sent.length ? 502 : 200);
    }
    return json({ error: "not_found" }, 404);
  },
};
