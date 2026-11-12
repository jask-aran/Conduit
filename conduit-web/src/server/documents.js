import crypto from "node:crypto";
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { getSchema } from "@tiptap/core";
import { MarkdownManager } from "@tiptap/markdown";
import { WebSocketServer } from "ws";
import { updateYFragment, yXmlFragmentToProseMirrorRootNode } from "y-prosemirror";
import * as Y from "yjs";
import { AUTHORS, BLOCK_TYPES, CHANGES, FRAGMENT, FRAME, blockId, documentExtensions, frame } from "../document-format.js";
import { writePrivateFile } from "../private-file.js";
import { createMarkupStore } from "./markup-store.js";
import { startWebSocketKeepalive } from "./ws-keepalive.js";

/*
 * The hub's document service: it holds the live copy of each Conduit document (document-format.js) and is the only way
 * in. A person's editor merges with it over the live socket; an agent reads it as Markdown, each block under its id,
 * and changes one block at a time, which lands in every open editor as the smallest change that makes it so.
 * A document is kept as its Yjs state in <data>/documents/<id>.yjs. Its comments live with it: a Markup store of its
 * own (markup-store.js) in <data>/documents/<id>.markup/, whose listeners are the hub's one registry (the feedback
 * folder's), so a session that waits for interface feedback is handed a document's comments too.
 */
const SAVE_AFTER_MS = 500;
// The one document there is until documents live in projects (docs/plans/markup-and-conduit-documents.md, milestone 5).
const TEST = "test";
const START = "# Test document\n\nWrite here. Every device with this page open sees each change as it is typed, and an agent can read the page and change a block of it.\n";
const fault = (status, message) => Object.assign(new Error(message), { status });

export function createDocuments({ dataRoot }) {
  const folder = path.join(dataRoot, "documents"), extensions = documentExtensions(), schema = getSchema(extensions), markdown = new MarkdownManager({ extensions });
  const sockets = new WebSocketServer({ noServer: true }), open = new Map();
  const withIds = (node) => ({ ...node, ...(BLOCK_TYPES.includes(node.type) ? { attrs: { ...node.attrs, id: node.attrs?.id ?? blockId() } } : {}), ...(node.content ? { content: node.content.map(withIds) } : {}) });
  const parse = (text) => [...schema.nodeFromJSON(withIds(markdown.parse(text))).content.content];
  const blocksOf = (room) => [...yXmlFragmentToProseMirrorRootNode(room.blocks, schema).content.content];
  /** The document becomes these blocks. `by` names the agent writing: its changes are made under a Yjs client id of its own, so they stay told apart from the hub's and each person's. `also`: what else is written with them, as one change. */
  const set = (room, blocks, by, also = () => {}) => {
    const { doc } = room, hub = doc.clientID;
    if (by) doc.clientID = room.agents.get(by) ?? room.agents.set(by, crypto.randomInt(2 ** 32)).get(by);
    try {
      doc.transact(() => {
        updateYFragment(doc, room.blocks, schema.node("doc", null, blocks), { mapping: new Map(), isOMark: new Map() });
        if (by) room.authors.set(String(doc.clientID), by);
        also();
      });
    } finally { doc.clientID = hub; }
  };
  async function load(id) {
    const file = path.join(folder, `${id}.yjs`), kept = await fs.readFile(file).catch(() => null);
    const doc = new Y.Doc(), room = { doc, blocks: doc.getXmlFragment(FRAGMENT), authors: doc.getMap(AUTHORS), changes: doc.getMap(CHANGES), peers: new Set(), agents: new Map(), save: () => writePrivateFile(file, Y.encodeStateAsUpdate(doc)) };
    const store = createMarkupStore({
      folder: path.join(folder, `${id}.markup`), listeners: path.join(dataRoot, "feedback"), on: `the document ${id}`,
      about: ["To answer a comment by changing the document, add `--for <this item's id>/<n>` to `document replace`, `insert` or `delete`: the person then sees which blocks changed for comment n and can take the change back. Leave such a comment for the person to resolve: resolving it accepts the change."],
      log: (entry) => console.log(JSON.stringify({ ...entry, type: "conduit.document.markup", document: id })),
    });
    /** A change whose comment is resolved (or gone) is accepted: read on every look at the open threads, since an agent resolves by writing to the folder, with no hub in the path. */
    const open = async () => {
      const items = await store.open(), unsettled = new Set(items.flatMap((item) => item.comments.filter((comment) => !comment.resolved).map((comment) => `${item.id}/${comment.n}`)));
      const settled = [...room.changes.entries()].filter(([, change]) => !unsettled.has(change.for));
      if (settled.length) doc.transact(() => { for (const [block] of settled) room.changes.delete(block); });
      return items;
    };
    room.markup = { ...store, open, say: async (item, body) => { const said = await store.say(item, body); await open(); return said; } };
    if (kept) Y.applyUpdate(doc, kept);
    // The test document starts as what the scratchpad it replaces held.
    else { set(room, parse(await fs.readFile(path.join(folder, "scratch.md"), "utf8").catch(() => START))); await room.save(); }
    doc.on("update", (update, origin) => {
      for (const peer of room.peers) if (peer !== origin) peer.send(frame(FRAME.update, update));
      clearTimeout(room.saving);
      room.saving = setTimeout(() => void room.save().catch((error) => console.error(`Could not save document ${id}`, error)), SAVE_AFTER_MS);
    });
    return room;
  }
  const room = (id) => open.get(id) ?? (id === TEST || existsSync(path.join(folder, `${id}.yjs`)) ? open.set(id, load(id)).get(id) : null);
  const held = async (id) => await room(id) ?? (() => { throw fault(404, `No document ${id}`); })();

  return {
    /** As Markdown, each block under a comment that gives its id; `blocks`: the format itself. */
    async read(id, as) {
      const kept = await held(id), blocks = blocksOf(kept);
      if (as === "blocks") return { format: "conduit-document", version: 1, id, blocks: blocks.map((block) => block.toJSON()), authors: kept.authors.toJSON(), changes: kept.changes.toJSON() };
      return `${blocks.map((block) => `<!-- block ${block.attrs.id} -->\n${markdown.serialize({ type: "doc", content: [block.toJSON()] }).trim()}`).join("\n\n")}\n`;
    },
    /**
     * One block changed: `replace` it with the Markdown's blocks (the first keeps its id), `insert` them after it (after `start`: first), or `delete` it.
     * `for` ("<item>/<n>") is the comment it answers: what it changes is then kept in the document's changes until that comment is resolved.
     */
    async edit(id, { op, block, markdown: text = "", by, for: about } = {}) {
      const kept = await held(id), now = blocksOf(kept), at = now.findIndex((candidate) => candidate.attrs.id === block);
      if (!["replace", "insert", "delete"].includes(op)) throw fault(400, "op is replace, insert or delete");
      if (at < 0 && !(op === "insert" && block === "start")) throw fault(404, `No block ${block} in ${id}`);
      const fresh = op === "delete" ? [] : parse(String(text));
      if (op === "replace" && fresh[0]) fresh[0] = fresh[0].type.create({ ...fresh[0].attrs, id: block }, fresh[0].content);
      const next = [...now.slice(0, op === "insert" ? at + 1 : at), ...fresh, ...now.slice(at + 1)], name = typeof by === "string" && by ? by.slice(0, 80) : "agent";
      if (about !== undefined) await kept.markup.thread(String(about).split("/")[0]);
      set(kept, next.length ? next : [schema.nodes.paragraph.create({ id: blockId() })], name, about === undefined ? undefined : () => {
        const stamp = { for: String(about), by: name, at: new Date().toISOString() }, had = kept.changes.get(block), gone = op !== "insert" && !fresh.length;
        // The first `before` is the one kept: what is taken back is everything done for the comment, not its last step. A block made for a comment and then deleted leaves nothing to show.
        if (gone && had?.before === null) kept.changes.delete(block);
        else if (op !== "insert") kept.changes.set(block, { ...stamp, before: now[at].toJSON(), ...had, ...(gone ? { after: now[at - 1]?.attrs.id ?? null, at: stamp.at } : {}) });
        for (const written of fresh.slice(op === "replace" ? 1 : 0)) kept.changes.set(written.attrs.id, { ...stamp, before: null });
      });
      return { blocks: fresh.map((written) => written.attrs.id) };
    },
    /** Everything changed for one comment is put back as it was: a changed block is its `before` again, a new one goes, a deleted one returns after the block it followed. */
    async revert(id, thread) {
      const kept = await held(id), blocks = blocksOf(kept), mine = [...kept.changes.entries()].filter(([, change]) => change.for === thread);
      // Deleted blocks return latest first: two that followed the same block then stand in their old order.
      for (const [block, change] of mine.sort((a, b) => String(b[1].at).localeCompare(a[1].at))) {
        const at = blocks.findIndex((candidate) => candidate.attrs.id === block), before = change.before && schema.nodeFromJSON(change.before);
        if (at >= 0) blocks.splice(at, 1, ...(before ? [before] : []));
        else if (before) { const after = blocks.findIndex((candidate) => candidate.attrs.id === change.after); blocks.splice(change.after === null ? 0 : after < 0 ? blocks.length : after + 1, 0, before); }
      }
      set(kept, blocks.length ? blocks : [schema.nodes.paragraph.create({ id: blockId() })], undefined, () => { for (const [block] of mine) kept.changes.delete(block); });
      return { blocks: mine.map(([block]) => block) };
    },
    /** The document's Markup store: its comments, each a thread. */
    markup: async (id) => (await held(id)).markup,
    async handleUpgrade(id, request, socket, head) {
      const kept = await Promise.resolve(room(id)).catch(() => null);
      if (!kept) return socket.destroy();
      sockets.handleUpgrade(request, socket, head, (peer) => {
        startWebSocketKeepalive(peer);
        kept.peers.add(peer);
        peer.on("close", () => kept.peers.delete(peer));
        peer.on("message", (data, binary) => {
          // A frame that is not what document-format.js says ends the socket, never the hub.
          try {
            if (!binary) { const { client, name } = JSON.parse(data); peer.author = [String(Number(client)), String(name).slice(0, 80)]; }
            else if (data[0] === FRAME.have) peer.send(frame(FRAME.update, Y.encodeStateAsUpdate(kept.doc, data.subarray(1))));
            else if (data[0] === FRAME.update) {
              Y.applyUpdate(kept.doc, data.subarray(1), peer);
              if (peer.author && kept.authors.get(peer.author[0]) !== peer.author[1]) kept.authors.set(...peer.author);
            }
          } catch { peer.close(1003, "Not a document frame"); }
        });
        peer.send(frame(FRAME.have, Y.encodeStateVector(kept.doc)));
      });
    },
    async close() {
      for (const peer of sockets.clients) peer.close(1012, "Conduit is restarting");
      for (const kept of await Promise.all(open.values())) { clearTimeout(kept.saving); await kept.save(); }
    },
  };
}

export function registerDocumentRoutes(app, documents) {
  app.get("/v0/document/:id", async (request, response) => {
    const read = await documents.read(request.params.id, request.query.as);
    if (typeof read === "string") response.type("text/markdown").send(read); else response.json(read);
  });
  app.post("/v0/document/:id/blocks", async (request, response) => response.json(await documents.edit(request.params.id, request.body)));
  app.post("/v0/document/:id/changes", async (request, response) => {
    if (request.body?.op !== "revert" || typeof request.body.thread !== "string") throw fault(400, "A change is taken back with { op: \"revert\", thread: \"<item>/<n>\" }");
    response.json(await documents.revert(request.params.id, request.body.thread));
  });
}
