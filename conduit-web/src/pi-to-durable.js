import fs from "node:fs/promises";
import { convertToLlm, migrateSessionEntries, parseSessionEntries, sessionEntryToContextMessages } from "@earendil-works/pi-coding-agent";
import { ConduitIds, USER_ENTRY } from "./server/durable-runtime.js";

/**
 * A classic Pi chat (one session JSONL) placed once as a Conduit durable conversation.
 *
 * Only the session's active branch is kept: the path from its leaf (the last
 * entry written) back to the root, as Pi itself resumes it. Each entry becomes
 * the durable entry the runtime would have written live, so the model sees the
 * context Pi had and the transcript keeps Pi's entry ids as message ids:
 * user messages are `conduit.user` (data.messageId is the Pi id), answers are
 * `pi.assistant` (named in ConduitIds.messages), tool results `pi.tool-result`,
 * compactions `pi.compaction` headed at the first kept entry. Context Pi built
 * from its own message kinds (bash runs, extension messages, branch summaries)
 * is placed as `conduit.pi-context`, which the model sees and the transcript does not.
 */
export async function convertPiSession({ harness, sessionFile, chatId, cwd, model, thinkingLevel, context }) {
  const fileEntries = parseSessionEntries(await fs.readFile(sessionFile, "utf8"));
  migrateSessionEntries(fileEntries);
  const path = activePath(fileEntries);
  const spec = splitModel(model);
  let written = 0;
  const conversation = await harness.createConversation({
    ownership: { kind: "ownerless" },
    agent: { ...(spec ? { model: spec } : {}), ...(thinkingLevel ? { thinkingLevel } : {}), ...(cwd ? { cwd } : {}) },
    async init(tx, conversationId) {
      const ids = await tx.doc(ConduitIds, conversationId);
      ids.chatId = chatId;
      const placed = new Map(); // Pi entry id -> durable entry id
      const append = async (piId, draft) => {
        const entry = await tx.appendEntry(conversationId, draft);
        if (piId && !placed.has(piId)) placed.set(piId, entry.id);
        written += 1;
        return entry;
      };
      for (const [index, entry] of path.entries()) {
        if (entry.type === "compaction") {
          const head = headFor(path, index, entry.firstKeptEntryId, placed);
          const text = `${SUMMARY_PREFIX}${entry.summary || ""}${SUMMARY_SUFFIX}`;
          await append(entry.id, { kind: "pi.compaction", ...(head !== undefined ? { head } : { head: "self" }),
            model: [{ role: "user", content: [{ type: "text", text }], timestamp: stamp(entry.timestamp) }],
            data: { reason: "converted" } });
          continue;
        }
        if (entry.type === "context_edit") {
          const target = placed.get(entry.targetId);
          if (target === undefined) continue;
          const replacement = entry.replacement;
          const original = path.find((candidate) => candidate.id === entry.targetId);
          const edit = replacement === null || !original ? { target, action: "omit" }
            : { target, action: "replace", messages: llm(original).map((message) => ({ ...message,
              content: typeof replacement.content === "string" && message.role !== "user"
                ? [{ type: "text", text: replacement.content }] : replacement.content })) };
          await append(null, { kind: "conduit.pi-edit", edits: [edit] });
          continue;
        }
        if (entry.type !== "message") {
          const messages = llm(entry).filter((message) => message.role !== "system");
          if (messages.length) await append(entry.id, { kind: "conduit.pi-context", model: messages, data: { piType: entry.type } });
          continue;
        }
        const message = entry.message;
        if (message.role === "user") {
          const user = { ...message, content: userContent(message.content) };
          await append(entry.id, { kind: USER_ENTRY, model: [user], data: { messageId: entry.id, text: textOf(message.content),
            timestamp: new Date(stamp(message.timestamp ?? entry.timestamp)).toISOString() } });
        } else if (message.role === "assistant") {
          const placedEntry = await append(entry.id, { kind: "pi.assistant", model: [{ ...message, content: message.content ?? [] }] });
          ids.messages[placedEntry.id] = entry.id;
        } else if (message.role === "toolResult") {
          await append(entry.id, { kind: "pi.tool-result", model: [{ ...message, content: message.content ?? [] }] });
        } else if (message.role !== "system") {
          const messages = llm(entry);
          if (messages.length) await append(entry.id, { kind: "conduit.pi-context", model: messages, data: { piType: message.role } });
        }
      }
    },
  }, context);
  return { conversationId: conversation.id, entries: written };
}

// pi-durable's own compaction wording (harness/compaction.js), so a converted summary reads like a native one.
const SUMMARY_PREFIX = "The conversation history before this point was compacted into the following summary:\n\n<summary>\n";
const SUMMARY_SUFFIX = "\n</summary>";

/** Root to leaf, the leaf being the last entry written, as Pi's SessionManager resumes. */
function activePath(fileEntries) {
  const entries = fileEntries.filter((entry) => entry.type !== "session");
  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  const path = [];
  for (let current = entries.at(-1); current; current = current.parentId ? byId.get(current.parentId) : undefined) path.push(current);
  return path.reverse();
}

/** The durable id of the first kept entry, or of the first placed one after it when it placed nothing. */
function headFor(path, index, firstKept, placed) {
  const start = path.findIndex((entry) => entry.id === firstKept);
  if (start < 0 || start >= index) return undefined;
  for (let i = start; i < index; i += 1) if (placed.has(path[i].id)) return placed.get(path[i].id);
  return undefined;
}

const llm = (entry) => convertToLlm(sessionEntryToContextMessages(entry));
const stamp = (value) => (typeof value === "number" ? value : Date.parse(value) || Date.now());
const splitModel = (value) => {
  const text = String(value || "").trim();
  const slash = text.indexOf("/");
  return slash > 0 ? { provider: text.slice(0, slash), modelId: text.slice(slash + 1) } : null;
};
const textOf = (content) => (typeof content === "string" ? content
  : (content || []).filter((block) => block?.type === "text").map((block) => block.text).join("\n"));
/** pi-ai user content: text and image blocks pass through; anything else becomes a short note. */
const userContent = (content) => (typeof content === "string" ? [{ type: "text", text: content }]
  : (content || []).map((block) => (block?.type === "text" || (block?.type === "image" && block.data && block.mimeType) ? block
    : { type: "text", text: `[${block?.type || "attachment"} not carried over from the classic chat]` })));
