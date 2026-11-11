import { headlineOf, inQuietHours, plainText } from "./inbox.js";

const LEVEL_WORD = /^\s*(?:[*_`#>\s]*)(?:URGENT|ATTENTION|FYI|NOTHING)\b[*_`]*\s*[:.-]?\s*/i;
const line = (text, max) => {
  const flat = plainText(String(text || "").replace(LEVEL_WORD, "")).replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
};

/** One gate for all push paths. Approval transport priority does not make an approval urgent. */
const pushAllowed = (agent, level) => level === "urgent" || !agent || !inQuietHours(agent.settings());

export function agentNotifier({ agent, push, hubId, hubName = () => null }) {
  // Resolves to the devices it reached and missed, by label (`{ to, missed }`), or null when nothing was sent.
  return ({ kind, conversationId, title, text, level, key, always = false, waiting = 0, path = null }) => (async () => {
    if (!pushAllowed(agent, level)) return { to: [], missed: [] };
    const thread = await agent.threadOf(conversationId);
    if (!thread?.chatId || thread.role === "run") return null;
    const chat = thread.role === "chat";
    if (!chat && !agent.enabled()) return null;
    if (chat && kind !== "approval") return null;
    const name = chat ? thread.title || "A chat" : agent.settings().name;
    const urgent = level === "urgent";
    const approval = kind === "approval";
    const tag = String(key || `${kind}-${conversationId}`);
    // Nowhere to send it: say so where the person will look, once a day, rather than drop it without a word.
    if (!push.list().length) {
      const today = agent.today();
      if ((await agent.state()).notices.some((notice) => notice.kind === "push" && agent.today(Date.parse(notice.at)) === today)) return null;
      await agent.notice("push", "A notification reached no device: turn notifications on in Settings on your phone.");
      return null;
    }
    const devices = push.list();
    // A message's heading is its title, else its first line, and the body is what follows, so neither says the other again.
    const heading = approval || chat ? "" : line(title || headlineOf(text, 60), 60);
    const said = line(text, 400);
    const stem = heading.replace(/…$/, "");
    const rest = heading && said.startsWith(stem) ? said.slice(stem.length).trim() : said;
    const body = line(heading && rest ? rest : said, 240);
    const results = await push.send({
      v: 1,
      title: approval ? `${name} needs your approval` : `${heading && rest ? `${name}: ${heading}` : name}${waiting ? ` · ${waiting} to approve` : ""}`,
      body,
      // Who it is from, and a report's name: the app shows it as a message from them (older apps read title and body).
      ...(approval || chat ? {} : { sender: name, ...(heading && rest ? { heading } : {}) }),
      path: path || (thread.role === "home" && !approval ? "/jbot" : `/chat/${thread.chatId}`),
      tag,
      hub: hubId(),
      // One phone can hear from several hubs.
      ...(hubName() ? { hubName: hubName() } : {}),
      ...(approval ? { answer: { token: push.answerToken(key), allow: "Allow", ...(always ? { always: "Always" } : {}), deny: "Don't" } } : {}),
      urgency: urgent || approval ? "high" : "normal",
    }, { urgency: urgent || approval ? "high" : "normal", topic: tag, ttl: approval ? 86400 : 43200 });
    const label = (id) => devices.find((device) => device.id === id)?.label || "a device";
    return { to: results.filter((result) => result.ok).map((result) => label(result.id)), missed: results.filter((result) => !result.ok).map((result) => label(result.id)) };
  })().catch((error) => { console.warn("[agent] push:", error?.message || error); return null; });
}
