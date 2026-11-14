import { execFile } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { getSchema } from "@tiptap/core";
import express from "express";
import { WebSocketServer } from "ws";
import { updateYFragment, yXmlFragmentToProseMirrorRootNode } from "y-prosemirror";
import * as Y from "yjs";
import { excludeConduitFromGit } from "../attachment-store.js";
import { AUTHORS, BLOCK_TYPES, CHANGES, FORMAT, FRAGMENT, FRAME, IMAGE_NAME, PROPERTIES, SUGGESTION, blockId, documentExtensions, fitted, frame, holding, isSuggestion, markdownFor } from "../document-format.js";
import { remoteNode } from "../place.js";
import { writePrivateFile } from "../private-file.js";
import { createMarkupStore } from "./markup-store.js";
import { sheetKind } from "./sheets.js";
import { startWebSocketKeepalive } from "./ws-keepalive.js";

/*
 * The hub's document service: it holds the live copy of each paper (document-format.js) and is the only way in while
 * Conduit runs. A person's editor merges with it over the live socket; an agent reads it as Markdown, each block under
 * its id, and changes one block at a time, which lands in every open editor as the smallest change that makes it so.
 *
 * A paper is a file, <name>.paper, anywhere in its project's folder: its blocks, and its id, so a rename or a move
 * keeps what belongs to it. The file is the paper: the hub writes it after each change, and what it holds that the
 * live copy does not (a checkout, a hand edit, a clone) is taken as the paper. What cannot be read back from the file
 * lives beside the project's chats, in <project>/.conduit/artifacts/<id>/: the Yjs state (who wrote what, and what
 * agents changed for a comment) and the paper's comments, a Markup store of its own (markup-store.js) whose listeners
 * are the hub's one registry (the feedback folder's), so a session that waits for interface feedback is handed a
 * paper's comments too. Which papers there are is read from the folders, never kept.
 *
 * A project's folder can be on another device: the paper's file is then read and written through that device
 * (workspace-host.js), and what belongs to it stays on the hub, where that project's chats are. While the device is out
 * of reach the live copy goes on and the file is written when it answers again.
 *
 * A Markdown file (<name>.md) is a paper's blocks with nothing written in it but Markdown: their ids, and its id (by its
 * path, as a site's), are kept beside it, and a `.md` is an artifact only when it was made or opened as one.
 *
 * A site is another kind of artifact: one HTML file, <name>.site.html, that an agent writes with its own tools and the
 * person sees drawn. The hub holds no live copy of it: it reads the file when a pane asks, and keeps only its comments
 * and its chats. Its id is in the file when the file says one (a meta tag, written when Conduit makes the file) and is
 * otherwise kept by the file's path, since the hub writes nothing into a file an agent is at work on.
 *
 * A sheet (<name>.csv, sheets.js) is held live as a paper is, in a Yjs doc of its own format: its file holds what its cells show, and what was typed
 * in them (its formulas) is kept beside it. A `.csv` is an artifact only when made or opened as one.
 *
 * An artifact is tied to chats (links.json, beside its state). Its mated thread is its own chat, the paper's second view and
 * never in the project's list of chats, made when it is first asked for or first sent a comment: the listener named
 * `conduit`, the first one, so a comment goes to it unless the person says otherwise. A chat the person connected is a
 * listener by its title. The hub holds both itself: a comment sent to one is written into that chat as a notice, which
 * starts its agent on it; what the agent answers with is the CLI, as for any session. A session Conduit does not run
 * keeps `wait`.
 */
// A seat with no word from its agent is left after SEAT_IDLE_MS (a turn that ended unheard), and one whose chat has no turn running SEAT_START_MS after a
// comment was handed to it is left then; pages are told of more of what it writes at most once each SEAT_TELL_MS, and a seat heard writing that then
// goes SEAT_QUIET_MS with no more of it and no edit landing (a call cut off, a tool that failed) is thinking again.
const SEAT_IDLE_MS = 600_000, SEAT_TELL_MS = 80, SEAT_START_MS = 5_000, SEAT_QUIET_MS = 5_000;
const ESCAPES = { '"': '"', "\\": "\\", "/": "/", b: "\b", f: "\f", n: "\n", r: "\r", t: "\t" };
/**
 * What can be read of a JSON object a model is still writing: its top-level string values as far as they are written (`values`), and `open`, the
 * key whose value is cut off (null once each read value is whole). Read as JSON is, never by pattern, so a key's name inside a value is only
 * text, and keys come in any order. An escape cut mid-way, and half a surrogate pair, are held back until the rest comes; anything that is not
 * JSON ends the read where it starts.
 */
export function readPartial(input) {
  const values = {}, text = String(input);
  let at = 0;
  const space = () => { while (/\s/.test(text[at] ?? "")) at += 1; };
  // A string from its opening quote: its text so far, and whether its closing quote came.
  const string = () => {
    let out = "";
    for (at += 1; at < text.length; at += 1) {
      const c = text[at];
      if (c === '"') { at += 1; return { out, whole: true }; }
      if (c !== "\\") { out += c; continue; }
      const next = text[at + 1];
      if (next === undefined) break;
      if (next === "u") {
        const hex = text.slice(at + 2, at + 6);
        if (hex.length < 4) break;
        if (!/^[0-9a-f]{4}$/i.test(hex)) return null;
        out += String.fromCharCode(parseInt(hex, 16)); at += 5; continue;
      }
      if (!(next in ESCAPES)) return null;
      out += ESCAPES[next]; at += 1;
    }
    return { out: /[\ud800-\udbff]$/.test(out) ? out.slice(0, -1) : out, whole: false };
  };
  // Any other value, passed over: to the comma or brace that ends it, strings and nesting included.
  const skip = () => {
    let depth = 0;
    while (at < text.length) {
      const c = text[at];
      if (c === '"') { if (!string()?.whole) return false; continue; }
      if (c === "{" || c === "[") depth += 1;
      else if (c === "}" || c === "]") { if (!depth) return true; depth -= 1; }
      else if (c === "," && !depth) return true;
      at += 1;
    }
    return false;
  };
  space();
  if (text[at] !== "{") return { values, open: null };
  at += 1;
  for (;;) {
    space();
    if (text[at] === ",") { at += 1; space(); }
    if (text[at] !== '"') return { values, open: null };
    const key = string();
    if (!key?.whole) return { values, open: null };
    space();
    if (text[at] !== ":") return { values, open: null };
    at += 1; space();
    if (at >= text.length) return { values, open: key.out };
    if (text[at] !== '"') { if (!skip()) return { values, open: null }; continue; }
    const value = string();
    if (!value) return { values, open: null };
    values[key.out] = value.out;
    if (!value.whole) return { values, open: key.out };
  }
}
const SAVE_AFTER_MS = 500, LOOK_EVERY_MS = 2_000, SCAN_AFTER_MS = 3_000, FAR_SCAN_MS = 15_000;
// The own thread's listener name; OLD is what it was, still taken as it (old taken.json files, an old page's `to`, an agent told to write as it).
const MATED = "thread", OLD = "conduit", alias = (name) => name === OLD ? MATED : name, SCRIPT = path.resolve(import.meta.dirname, "../../../scripts/conduit-markup.mjs");
const ID = /^[a-z0-9-]{1,64}$/, WALK = { entries: 20_000, depth: 6 };
const SITE_ID = /<meta\s+name=["']conduit-artifact["']\s+content=["']([a-z0-9-]{1,64})["']/i;
/** A paper's images, kept beside it (<side>/images/<name>) and named for their bytes; what they are is read from the bytes, never from what the sender said. SVG is not taken: it can carry script. */
const IMAGE_MAX = 10 * 1024 * 1024, IMAGE_TYPES = { png: "image/png", jpg: "image/jpeg", gif: "image/gif", webp: "image/webp", avif: "image/avif" };
const sniff = (bytes) => {
  const ascii = (from, to) => bytes.subarray(from, to).toString("latin1");
  return ascii(0, 8) === "\x89PNG\r\n\x1a\n" ? "png" : ascii(0, 3) === "\xff\xd8\xff" ? "jpg" : /^GIF8[79]a$/.test(ascii(0, 6)) ? "gif"
    : ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP" ? "webp" : /^ftypavi[fs]$/.test(ascii(4, 12)) ? "avif" : null;
};
/**
 * Who leads an artifact other than its own thread (links.json `lead`, none for the thread): what is sent to nobody by name goes to it.
 * @typedef {{ kind: "chat", chat: string } | { kind: "agent" }} Lead
 */
/** @returns {Lead | undefined} links.json's `lead`, which was once a bare chat id. */
const leadFrom = (kept) => typeof kept === "string" ? { kind: "chat", chat: kept } : kept?.kind === "agent" ? { kind: "agent" } : kept?.kind === "chat" && typeof kept.chat === "string" ? { kind: "chat", chat: kept.chat } : undefined;
const escaped = (text) => text.replace(/[&<>"]/g, (character) => `&#${character.charCodeAt(0)};`);
/**
 * One comment as the agent reads it, from the hand-off (`MarkupHandoff`, chat-backend-contract.d.ts) the chat is also
 * given beside the text for its transcript to draw; `said`: "reply" or "reopened" for what the person wrote back on an
 * item already handed over. Its `context` is what the comment is on as it is now, written as `read` writes a paper, so answering needs no read.
 */
const contextOf = (context) => context.map((one) => `${one.id ? `<!-- block ${one.id}${one.target ? " (commented)" : ""} -->\n` : ""}${one.md}`).join("\n\n");
const handoff = ({ quote, words, context, ...fields }) => `<conduit_markup ${Object.entries(fields).map(([key, value]) => `${key}="${escaped(String(value))}"`).join(" ")}>\n${quote ? `<quote>${escaped(quote)}</quote>\n` : ""}${words ? `<words>${escaped(words)}</words>\n` : ""}${context?.length ? `<context>\n${escaped(contextOf(context))}\n</context>\n` : ""}</conduit_markup>`;
/** A new site: a page that says what it is, in the colours of whoever looks at it, for an agent to write over. */
const SITE = (id, name) => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="conduit-artifact" content="${id}">
<title>${escaped(name)}</title>
<style>
  :root { color-scheme: light dark; font: 16px/1.5 system-ui, sans-serif; }
  body { max-width: 44rem; margin: 3rem auto; padding: 0 1.5rem; }
</style>
</head>
<body>
<h1>${escaped(name)}</h1>
<p>This site is one HTML file in its project's folder. Ask an agent to build it: mark it up here, or write in its Thread.</p>
</body>
</html>
`;
const fault = (status, message) => Object.assign(new Error(message), { status });
const run = promisify(execFile);
const under = (root, file) => file === root || file.startsWith(root + path.sep);
const partOf = (at) => [...at.split("/").slice(0, -1), `.${at.split("/").at(-1)}.${crypto.randomBytes(4).toString("hex")}.part`].join("/");
const endsIn = (endings, at) => endings.some((ending) => at.endsWith(ending));
/** Every artifact's file under a folder (one with one of the kinds' `endings`), by a walk that `ls(dir)` feeds with a directory's `{ name, file, dir }` entries. */
async function walk(ls, endings) {
  const found = [], queue = [["", 0]];
  for (let seen = 0; queue.length && seen < WALK.entries;) {
    const [dir, depth] = queue.shift();
    for (const entry of await ls(dir)) {
      seen += 1;
      const at = dir ? `${dir}/${entry.name}` : entry.name;
      if (entry.file && endsIn(endings, entry.name)) found.push(at);
      else if (entry.dir && depth < WALK.depth && !entry.name.startsWith(".") && entry.name !== "node_modules") queue.push([at, depth + 1]);
    }
  }
  return found;
}
/*
 * A project's folder as its papers' files are reached, by paths relative to it and `/`-separated. `stat` is null for a
 * file that is not there and fails when the folder cannot be reached; `write` is whole or not at all (a part file,
 * then a rename), so a crash while writing leaves the paper as it was; `create` fails with EEXIST over a file.
 */
function localDisk(root, endings) {
  const at = (relative) => path.join(root, relative);
  return {
    key: root, far: false, at,
    read: (relative) => fs.readFile(at(relative), "utf8"),
    stat: (relative) => fs.stat(at(relative)).then(({ mtimeMs, birthtimeMs }) => ({ mtimeMs, born: birthtimeMs }), (error) => error.code === "ENOENT" ? null : Promise.reject(error)),
    async write(relative, text) { const part = at(partOf(relative)); await fs.writeFile(part, text); await fs.rename(part, at(relative)).catch(async (error) => { await fs.rm(part, { force: true }); throw error; }); },
    create: (relative, text) => fs.writeFile(at(relative), text, { flag: "wx" }),
    rename: (from, to) => fs.rename(at(from), at(to)),
    remove: (relative) => fs.rm(at(relative), { force: true }),
    /** The file as it really is must be inside the folder: a link out of it is not followed. */
    async inside(relative) {
      const [folder, home, file] = await Promise.all([fs.realpath(path.dirname(at(relative))), fs.realpath(root), fs.realpath(at(relative)).catch(() => null)]).catch(() => [null, null, null]);
      if ((folder && !under(home, folder)) || (file && !under(home, file))) throw fault(400, "That is not a path in this project's folder");
    },
    /** What git tracks or would (so nothing it ignores), or a walk where the folder is no repository. */
    files: async () => await run("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard", "--", ...endings.map((ending) => `*${ending}`)], { cwd: root, maxBuffer: 8 * 1024 * 1024, timeout: 15_000 }).then(({ stdout }) => stdout.split("\0").filter(Boolean), () => null)
      ?? walk(async (dir) => (await fs.readdir(at(dir), { withFileTypes: true }).catch(() => [])).map((entry) => ({ name: entry.name, file: entry.isFile(), dir: entry.isDirectory() })), endings),
  };
}
/** The same over a device's folder (`host`: workspace-host.js's). It has no time a file was made, a link is not followed there at all, and a folder that cannot be listed fails the listing (a part of it would read as papers deleted). */
function deviceDisk(host, endings) {
  return {
    key: host.key, far: true, at: (relative) => `${host.key}\n${relative}`,
    read: async (relative) => (await host.read(relative)).toString("utf8"),
    stat: async (relative) => { const info = await host.lstat(relative); return info && { mtimeMs: info.mtimeMs, born: 0 }; },
    // A file a sync client holds open cannot be renamed over: it is then written in place. The part file has one name, so one a lost device leaves behind is the next write's.
    async write(relative, text) {
      const part = [...relative.split("/").slice(0, -1), `.${relative.split("/").at(-1)}.part`].join("/");
      await host.write(part, text, {});
      await host.rename(part, relative).catch(async () => { try { await host.write(relative, text, {}); } finally { await host.unlink(part).catch(() => {}); } });
    },
    create: (relative, text) => host.write(relative, text, { exclusive: true }),
    rename: (from, to) => host.rename(from, to),
    remove: (relative) => host.unlink(relative).catch((error) => { if (error.code !== "ENOENT") throw error; }),
    inside: async () => {},
    files: async () => (await host.files({ exclude: ["node_modules", ".conduit"], limit: WALK.entries }))?.filter((at) => endsIn(endings, at))
      ?? walk(async (dir) => (await host.list(dir, { limit: WALK.entries }).catch((error) => dir && ["ENOENT", "permission_denied"].includes(error.code) ? [] : Promise.reject(error)) ?? []).map((entry) => ({ name: entry.name, file: entry.type === "file", dir: entry.type === "directory" })), endings),
  };
}
const spot = (entry) => entry.disk.at(entry.path);
const hash = (text) => crypto.createHash("sha256").update(text).digest("hex");
const shown = ({ id, kind, name, path: at, project }) => ({ id, kind, name, path: at, project });

/**
 * The hub's chats as the artifacts reach them (server.js gives them).
 * @typedef {object} ChatHost
 * @property {(asked: { workspace: string, title: string, mark: object }) => Promise<{ id: string }>} open  Makes one.
 * @property {(id: string) => { title?: string, projectId?: string } | null} get  Its summary, or null for none.
 * @property {(id: string, text: string, markup: object[]) => Promise<unknown>} notify  Writes a notice into it, `markup` its hand-offs.
 * @property {(id: string | undefined) => boolean} working  It has a turn running.
 * @property {(id: string) => Promise<unknown>} stop  Ends its turn.
 * @property {() => { name: string, chat: () => Promise<string> } | null} agent  The person's own agent while it is on: the name it listens under, and its home chat.
 */
/**
 * `chats`: () => the hub's ChatHost, once it has one.
 * `devices`: (project) => the host of a folder on another device.
 * @param {{ dataRoot: string, projects: any, changed?: (projectId: string) => void, chats?: () => ChatHost | null, devices?: any }} options
 */
export function createDocuments({ dataRoot, projects, changed = () => {}, chats = () => null, devices = null }) {
  const folder = path.join(dataRoot, "documents");
  const sockets = new WebSocketServer({ noServer: true }), rooms = new Map(), known = new Map(), scans = new Map(), rescans = new Map(), scanned = new Map();
  const withIds = (node) => ({ ...node, ...(BLOCK_TYPES.includes(node.type) ? { attrs: { ...node.attrs, id: node.attrs?.id ?? blockId() } } : {}), ...(node.content ? { content: node.content.map(withIds) } : {}) });
  /**
   * The schema and the Markdown reader and writer of a kind's blocks, made once for each set of extras a kind holds (`holds`, unsaid: every one).
   * @typedef {{ schema: import("@tiptap/pm/model").Schema, markdown: object, parse: (text: string) => any[], md: (blocks: any[]) => string, empty: () => any }} Format
   * @returns {Format}
   */
  const formats = new Map(), formatOf = (holds) => {
    const key = holds ? holds.join(" ") : "*";
    if (formats.has(key)) return formats.get(key);
    const schema = getSchema(documentExtensions(holds)), markdown = markdownFor(schema);
    return formats.set(key, { schema, markdown,
      parse: (text) => [...schema.nodeFromJSON(withIds(fitted(markdown.parse(text)))).content.content],
      md: (blocks) => markdown.serialize({ type: "doc", content: blocks.map((block) => block.toJSON()) }).trim(),
      empty: () => schema.nodes.paragraph.create({ id: blockId() }) }).get(key);
  };
  const blocksOf = (room) => [...yXmlFragmentToProseMirrorRootNode(room.blocks, room.format.schema).content.content];
  /**
   * `change(sign)` run with the live copy written by `by`, the agent writing: its changes are made under a Yjs client id of its own, so they stay told
   * apart from the hub's and each person's. `sign()`, called inside the change, records whose that id is.
   */
  const as = (room, by, change) => {
    const { doc } = room, hub = doc.clientID;
    if (by) doc.clientID = room.agents.get(by) ?? room.agents.set(by, crypto.randomInt(2 ** 32)).get(by);
    try { return change(() => { if (by) room.authors.set(String(doc.clientID), by); }); } finally { doc.clientID = hub; }
  };
  /** The document becomes these blocks, written by `by`. `also`: what else is written with them, as one change. */
  const set = (room, blocks, by, also = () => {}) => as(room, by, (sign) => room.doc.transact(() => {
    updateYFragment(room.doc, room.blocks, room.format.schema.node("doc", null, blocks), { mapping: new Map(), isOMark: new Map() });
    sign();
    also();
  }));

  /** A paper's file: each block on a line of its own, so a diff of the file is a diff of blocks; its front matter (properties) before them, where it has any. */
  const written = (id, blocks, properties = {}) => `{"format":"conduit-document","version":1,"id":${JSON.stringify(id)},${Object.keys(properties).length ? `"properties":${JSON.stringify(properties)},` : ""}"blocks":[\n${blocks.map((block) => JSON.stringify(block.toJSON())).join(",\n")}\n]}\n`;
  /** What a file holds. A block with no id, or a second with the same one (a line copied by hand), is given its own. A file that is not a paper is said to be so, never guessed at. */
  const paper = (text, name) => {
    const { schema, empty } = formatOf(KINDS.paper.holds);
    try {
      const file = JSON.parse(text), ids = new Set();
      if (file?.format !== "conduit-document" || !Array.isArray(file.blocks)) throw new Error("it is not in the conduit-document format");
      const blocks = file.blocks.map((json) => {
        const block = schema.nodeFromJSON(withIds(json));
        block.check();
        if (!ids.has(block.attrs.id)) { ids.add(block.attrs.id); return block; }
        return block.type.create({ ...block.attrs, id: blockId() }, block.content, block.marks);
      });
      const properties = Object.fromEntries(Object.entries(file.properties && typeof file.properties === "object" && !Array.isArray(file.properties) ? file.properties : {}).filter(([, value]) => typeof value === "string"));
      return { id: typeof file.id === "string" && ID.test(file.id) ? file.id : null, blocks: blocks.length ? blocks : [empty()], properties };
    } catch (error) { throw fault(422, `${name}${KINDS.paper.ext} is not a paper Conduit can read: ${error.message}`); }
  };
  /** A block as it reads with no ids, so two blocks of the same text are the same block. */
  const content = (block) => JSON.stringify(block.toJSON(), (name, value) => name === "id" ? undefined : value);
  /**
   * The file's blocks (`read`, with ids of their own) given the live copy's ids (`live`): each one whose content is unchanged keeps its block's id, matched
   * in order (the longest run in common); between two matched blocks, one changed keeps the id of the block of its type that stood there, as a block typed
   * in does. The rest are new: a comment on a block that is gone stands on the document, as one does on a block deleted in the editor.
   */
  const matched = (live, read) => {
    const out = [...read], a = live.map(content), b = read.map(content);
    let start = 0, end = 0;
    while (start < a.length && start < b.length && a[start] === b[start]) { out[start] = live[start]; start += 1; }
    while (end < a.length - start && end < b.length - start && a.at(-1 - end) === b.at(-1 - end)) { out[out.length - 1 - end] = live.at(-1 - end); end += 1; }
    const n = a.length - start - end, m = b.length - start - end, longest = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
    for (let i = n - 1; i >= 0; i -= 1) for (let j = m - 1; j >= 0; j -= 1) longest[i][j] = a[start + i] === b[start + j] ? longest[i + 1][j + 1] + 1 : Math.max(longest[i + 1][j], longest[i][j + 1]);
    let gone = [], made = [];
    const pair = () => {
      made.forEach((at, nth) => { const was = live[gone[nth]]; if (was?.type === read[at].type) out[at] = read[at].type.create({ ...read[at].attrs, id: was.attrs.id }, read[at].content, read[at].marks); });
      gone = []; made = [];
    };
    for (let i = 0, j = 0; i < n || j < m;) {
      if (i < n && j < m && a[start + i] === b[start + j]) { pair(); out[start + j] = live[start + i]; i += 1; j += 1; }
      else if (j < m && (i >= n || longest[i][j + 1] >= longest[i + 1][j])) { made.push(start + j); j += 1; }
      else { gone.push(start + i); i += 1; }
    }
    pair();
    return out;
  };
  /** A Markdown file's front matter, kept as it is with the blank lines after it. */
  const FRONT = /^---[ \t]*\n[\s\S]*?\n(?:---|\.\.\.)[ \t]*(?:\n|$)\n*/;
  /**
   * A Markdown file as blocks. Each top-level piece of it (what the Markdown reader lexes as one) is read alone, so each block knows the text it came
   * from and is written back as that text while it is unchanged: what the schema cannot hold, and the file's own way of writing, stay as they were. A
   * piece that reads as no block (a link's definition) is a paragraph of its text. `kept`: what the file is written with (`write`).
   */
  const plain = (text, room) => {
    const { schema, markdown, parse } = room.format, eol = text.includes("\r\n") ? "\r\n" : "\n", lf = text.replace(/\r\n?/g, "\n");
    const front = FRONT.exec(lf)?.[0] ?? "", groups = [];
    let lead = "";
    for (const token of markdown.createLexer().lex(lf.slice(front.length))) {
      const raw = token.raw.replace(/\s+$/, ""), gap = token.raw.slice(raw.length);
      if (!raw) { if (groups.length) groups.at(-1).gap += gap; else lead += gap; continue; }
      const blocks = parse(raw);
      groups.push({ raw, gap, blocks: blocks.length ? blocks : [schema.nodes.paragraph.create({ id: blockId() }, schema.text(raw))] });
    }
    const all = matched(room.blocks.length ? blocksOf(room) : [], groups.flatMap((group) => group.blocks));
    let at = 0;
    for (const group of groups) group.blocks = group.blocks.map(() => all[at++]);
    return { id: null, blocks: all.length ? all : [room.format.empty()], kept: { front, lead, groups, eol } };
  };
  /** What a Markdown file is written as: each run of blocks still as the file had it is its text, with the space the file had after it; any other block is written anew. */
  const plainly = (room, { blocks, kept = { front: "", lead: "", groups: [], eol: "\n" } }) => {
    const first = new Map(kept.groups.map((group, nth) => [group.blocks[0]?.attrs.id, nth])), pieces = [];
    for (let at = 0; at < blocks.length;) {
      const nth = first.get(blocks[at].attrs.id), group = kept.groups[nth];
      if (group?.blocks.every((block, k) => blocks[at + k] && (block === blocks[at + k] || JSON.stringify(block.toJSON()) === JSON.stringify(blocks[at + k].toJSON())))) { pieces.push({ text: group.raw, nth }); at += group.blocks.length; continue; }
      const text = room.format.md([blocks[at]]);
      if (text) pieces.push({ text });
      at += 1;
    }
    const after = (piece, next) => piece.nth !== undefined && (next ? next.nth === piece.nth + 1 : piece.nth === kept.groups.length - 1) ? kept.groups[piece.nth].gap : next ? "\n\n" : "\n";
    const body = pieces.length ? `${pieces[0].nth === 0 ? kept.lead : ""}${pieces.map((piece, nth) => piece.text + after(piece, pieces[nth + 1])).join("")}` : kept.groups.length ? "" : kept.lead;
    return `${kept.front}${body}`.replace(/\n/g, kept.eol);
  };
  /**
   * How a kind drawn in the paper's editor is read from its file and written to it, by where its blocks' ids are (ArtifactKind `ids`). `read` gives the
   * file's blocks, the id it carries, its `properties` where it has them, and `kept`, what the room holds to write it again; `write` is the file for
   * what was read, or for the live copy (`now`).
   * @typedef {{ blocks: any[], properties?: Record<string, string>, kept?: object }} FileRead
   * @typedef {{ read: (text: string, name: string, room: object) => FileRead & { id: string | null }, write: (room: object, read: FileRead) => string }} LiveFile
   * @type {Record<"inline" | "side", LiveFile>}
   */
  const FILES = {
    inline: { read: (text, name) => paper(text, name), write: (room, read) => written(room.id, read.blocks, read.properties) },
    side: { read: (text, name, room) => plain(text, room), write: plainly },
  };
  /** @returns {FileRead} The live copy, to be written with what was kept of the file (unsaid: what the room keeps). */
  const now = (room, kept = room.kept) => ({ blocks: blocksOf(room), properties: room.properties.toJSON(), kept });
  const fileOf = (room) => FILES[KINDS[room.entry.kind].ids];

  const kindOf = (at) => Object.keys(KINDS).find((kind) => at.endsWith(KINDS[kind].ext)), nameOf = (at) => path.basename(at, KINDS[kindOf(at)].ext);
  const place = (project) => {
    const far = Boolean(remoteNode(project)), endings = Object.values(KINDS).map((kind) => kind.ext);
    if (far && !(devices && project.chatRoot)) throw fault(501, "This hub cannot reach papers in a project on another device");
    return { disk: far ? deviceDisk(devices(project), endings) : localDisk(path.resolve(project.workingRoot), endings), side: path.join(path.resolve(project.chatRoot || project.workingRoot), ".conduit", "artifacts") };
  };
  const projectOf = async (id) => await projects.get(id) ?? (() => { throw fault(404, `No project ${id}`); })();
  const here = async () => (await projects.list()).filter((project) => !remoteNode(project));
  /** A file is one project's: the one whose folder holds it most closely (a project's folder can stand inside another's, as every managed one stands inside Chats'). */
  const owner = (file, all) => all.filter((project) => under(path.resolve(project.workingRoot), file)).sort((a, b) => path.resolve(b.workingRoot).length - path.resolve(a.workingRoot).length)[0];
  /** A name a file can have, on any device the project is opened from. */
  const named = (name) => {
    const clean = String(name ?? "").replace(/[\\/:*?"<>|\0-\x1f]/g, " ").replace(/\s+/g, " ").trim().replace(/^\.+/, "").slice(0, 120).trim();
    return clean || (() => { throw fault(400, "An artifact needs a name"); })();
  };
  /** A path inside the project's folder, `/`-separated; never the folder Conduit keeps its own files in. */
  const within = (relative) => {
    const parts = String(relative ?? "").split(/[\\/]+/).filter((part) => part && part !== ".");
    if (parts.some((part) => part === ".." || part === ".conduit" || part === ".git")) throw fault(400, "That is not a path in this project's folder");
    return parts.join("/");
  };
  /** The CLI finds a paper's comments through this list: it runs beside the hub and cannot ask it where the projects are. */
  const tell = () => writePrivateFile(path.join(folder, "roots.json"), `${JSON.stringify([...known.values()].map((entry) => path.join(entry.side, "markup")))}\n`).catch((error) => console.error("Could not write the papers' Markup folders", error));
  /** The ids of the sites whose files do not say one, by path (paths.json, beside the project's artifacts); `change` is made to them and kept, one at a time. */
  let filing = Promise.resolve();
  const paths = (side, change) => (filing = filing.catch(() => {}).then(async () => {
    const file = path.join(side, "paths.json"), kept = await fs.readFile(file, "utf8").then(JSON.parse).then((read) => read && typeof read === "object" && !Array.isArray(read) ? read : {}, () => ({})), before = JSON.stringify(kept);
    change(kept);
    if (JSON.stringify(kept) !== before) await writePrivateFile(file, `${JSON.stringify(kept)}\n`);
    return kept;
  }));
  /**
   * The paper in this file is known. One that carries no id, or the id of a paper that is still in another file (a copy), is given its own, written into it.
   * Null for a file of a kind whose files are artifacts only when asked (`adopts`), never made or asked to be one: `asked` makes it one.
   */
  async function adopt(project, at, asked = false) {
    const { disk, side } = place(project), kind = kindOf(at), name = nameOf(at);
    let id = await KINDS[kind].filed?.(side, at) ?? null;
    if (!id && KINDS[kind].adopts === "asked" && !asked) return null;
    await disk.inside(at);
    if (id && !await disk.stat(at)) throw Object.assign(new Error(`No file ${at}`), { code: "ENOENT" });
    if (!id) {
      const text = await disk.read(at), read = KINDS[kind].identify(text, name);
      const other = read.id && known.get(read.id), copy = other && spot(other) !== disk.at(at) && await other.disk.stat(other.path).catch(() => true);
      id = read.id && !copy ? read.id : crypto.randomBytes(8).toString("hex");
      await KINDS[kind].adopted({ disk, side, at, id, read });
    }
    const links = known.get(id)?.links ?? await fs.readFile(path.join(side, id, "links.json"), "utf8").then(JSON.parse).then((kept) => ({ thread: kept.thread ?? null, connections: [...kept.connections ?? []], ...(leadFrom(kept.lead) ? { lead: leadFrom(kept.lead) } : {}) }), () =>({ thread: null, connections: [] }));
    return known.set(id, { id, kind, name, path: at, project: project.id, disk, side: path.join(side, id), links }).get(id);
  }
  /**
   * A project's folder is read for its papers once, and again when one of them is found missing. The oldest file is read first, so of a paper and its copy the
   * paper keeps the id (a device does not say when a file was made: there the first by path keeps it).
   */
  const scan = (project) => scans.get(project.id) ?? scans.set(project.id, (async () => {
    const { disk, side } = place(project), all = disk.far ? [] : await here(), ours = (await disk.files()).filter((at) => disk.far || owner(path.join(disk.key, at), all)?.id === project.id).sort();
    // A file of a kind that is an artifact only when asked is passed over unless it was made or asked to be one: a listing makes none.
    const mine = (await Promise.all(ours.map(async (at) => KINDS[kindOf(at)].adopts !== "asked" || await KINDS[kindOf(at)].filed?.(side, at) ? at : null))).filter(Boolean);
    // A device that drops while it is read fails the reading: files it did not answer for are not papers deleted.
    const found = await Promise.all(mine.map(async (at) => ({ at, born: (await disk.stat(at).catch((error) => disk.far ? Promise.reject(error) : null))?.born }))), kept = new Set();
    // A paper whose file cannot be read just now (a merge's conflict in it) is still that paper, at that path.
    const still = (at) => [...known.values()].find((entry) => entry.project === project.id && entry.path === at)?.id;
    for (const { at } of found.filter((file) => file.born !== undefined).sort((a, b) => a.born - b.born)) kept.add(await adopt(project, at).then((entry) => entry?.id,(error) => disk.far && !error.status ? Promise.reject(error) : still(at)));
    for (const [id, entry] of known) if (entry.project === project.id && !kept.has(id)) known.delete(id);
    scanned.set(project.id, Date.now());
    await tell();
  })().catch((error) => { scans.delete(project.id); throw error; })).get(project.id);
  /** True when the folder was read. */
  const again = async (id) => {
    const before = listing(id);
    scans.delete(id);
    const project = await Promise.resolve(projects.get(id)).catch(() => null), read = project ? await scan(project).then(() => true, () => false) : false;
    // Whoever found a file gone (a pane's look, a list) has read the folder before the watcher's own reading: clients are told from here.
    if (read && listing(id) !== before) changed(id);
    return read;
  };
  const ready = (async () => {
    for (const project of await here()) await scan(project).catch((error) => console.error(`Could not read ${project.name}'s papers`, error));
  })().catch((error) => console.error("Could not read the projects' papers", error));
  // A folder on another device is read when it is first asked about, since the device may not be there when the hub starts.
  const distant = async () => { for (const project of (await projects.list()).filter(remoteNode)) await scan(project).catch(() => {}); };
  void ready.then(distant).catch(() => {});
  const entryOf = async (id) => known.get(id) ?? (await ready, known.get(id)) ?? (await distant(), known.get(id)) ?? (() => { throw fault(404, `No artifact ${id}`); })();

  const host = () => chats() ?? (() => { throw fault(503, "The hub's chats are not ready yet"); })();
  const link = async (entry) => { await writePrivateFile(path.join(entry.side, "links.json"), `${JSON.stringify(entry.links)}\n`); changed(entry.project); };
  /** The paper's mated thread, made if it has none (or the one it had is gone: an empty chat is not kept for long). */
  const making = new Map();
  async function mated(id) {
    const entry = await entryOf(id), had = entry.links.thread && host().get(entry.links.thread);
    if (had) return had;
    // One at a time: the Thread view and a first comment may ask together.
    if (!making.has(id)) making.set(id, (async () => {
      const chat = await host().open({ workspace: entry.project, title: entry.name, mark: { mated: id } });
      (known.get(id) ?? entry).links.thread = chat.id;
      await link(known.get(id) ?? entry);
      return host().get(chat.id);
    })().finally(() => making.delete(id)));
    return making.get(id);
  }
  /**
   * The listeners the hub holds on an artifact, its lead first: its own thread, then the person's own agent (on every artifact while it is on, under the name
   * they gave it, and told in its home chat, known here once it has been handed something), then each connected chat by its title (the first to have a title keeps it).
   * The lead is the one `links.lead` names while it is a listener, else the own thread, which is always listed: it is never "no listener". Sessions are the store's.
   * @returns {import("./markup-store.js").Listener[]}
   */
  let agentChat;
  const listeners = (id) => {
    const entry = known.get(id), names = new Set([MATED, OLD]), own = chats()?.agent?.(), lead = entry?.links.lead;
    if (!entry) return [];
    const thread = { name: MATED, kind: "thread", ...(entry.links.thread ? { chat: entry.links.thread } : {}) };
    const agent = own && !names.has(own.name) ? [{ name: own.name, kind: "agent", ...(agentChat ? { chat: agentChat } : {}) }] : [];
    for (const one of agent) names.add(one.name);
    // A lead chat is named first, so it keeps its title.
    const leads = (chat) => Number(lead?.kind === "chat" && lead.chat === chat), order = chats() ? [...entry.links.connections].sort((a, b) => leads(b) - leads(a)) : [];
    const others = order.flatMap((chat) => {
      const title = chats().get(chat)?.title, name = title && !names.has(title) ? title : `chat ${chat.slice(0, 8)}`;
      if (!chats().get(chat) || names.has(name)) return [];
      names.add(name);
      return [{ name, kind: "chat", chat }];
    });
    const all = [thread, ...agent, ...others], first = all.find((one) => lead?.kind === "agent" ? one.kind === "agent" : lead?.kind === "chat" && one.kind === "chat" && one.chat === lead.chat) ?? thread;
    return [{ ...first, lead: true }, ...all.filter((one) => one !== first)];
  };
  /** The listener the hub holds under this name (the own thread's old name too). */
  const listener = (id, name) => listeners(id).find((one) => one.name === alias(name));
  /**
   * How many of an artifact's comments the person has not settled (a session's resolve leaves one standing until they
   * confirm it), as its listing says. Read with a store of its own, so a list loads no paper; a change seen in an open
   * item (a pane looks every few seconds, the hub after each send, reply and resolve) tells the project's clients.
   */
  const counted = new Map(), counters = new Map();
  const unsettled = (items) => items.reduce((sum, item) => sum + item.comments.filter((comment) => !(comment.resolved && comment.resolvedBy === "person")).length, 0);
  const recount = (id, items) => {
    const entry = known.get(id), open = unsettled(items);
    if (!entry || counted.get(id) === open) return;
    const told = counted.has(id);
    counted.set(id, open);
    if (told) changed(entry.project);
  };
  const openOf = async (entry) => {
    if (!counters.has(entry.id)) counters.set(entry.id, createMarkupStore({ folder: path.join(entry.side, "markup") }));
    const open = unsettled(await counters.get(entry.id).open().catch(() => []));
    counted.set(entry.id, open);
    return open;
  };
  /** Whether a mated thread has a turn running: `chats().working`, told of each change through `turned`. */
  const working = new Map();
  const workingOf = (entry) => Boolean(entry.links.thread && chats()?.working?.(entry.links.thread));
  /**
   * An agent's seat in a paper: where a listener the hub holds is at work, told to every page that has the paper open so the person sees it as they
   * would see someone else writing. `{ name, state, blocks, for?, text? }`: `thinking` from the moment a comment is handed to it (the blocks the
   * comment is about), `reading` when it reads the paper, `writing` on the block it changes, with `text` the Markdown it has written so far where the
   * hub can hear the model write it. It leaves when its chat's turn ends, or after SEAT_IDLE_MS with no word from it. Never kept: a seat is not the paper.
   */
  const seated = (room, to = room.peers) => {
    // A chat disconnected or deleted is no longer at work here.
    for (const name of room.seats?.keys() ?? []) if (!listener(room.id, name)) { clearTimeout(room.leaving?.get(name)); room.seats.delete(name); }
    const bytes = frame(FRAME.seats, Buffer.from(JSON.stringify([...(room.seats?.values() ?? [])]))); for (const peer of to) peer.send(bytes);
  };
  const sit = (room, name, change) => {
    room.seats ??= new Map(); room.leaving ??= new Map();
    clearTimeout(room.leaving.get(name));
    if (!change) { room.leaving.delete(name); if (room.seats.delete(name)) seated(room); return; }
    const was = room.seats.get(name), now = { blocks: [], ...was, ...change, name };
    room.seats.set(name, now);
    const idle = setTimeout(() => sit(room, name, null), SEAT_IDLE_MS); idle.unref?.(); room.leaving.set(name, idle);
    // A seat that moves or changes what it does is told at once, so it follows the edit it lands with in the same breath (the update goes out first);
    // more of what it is writing waits, told at most once each SEAT_TELL_MS: a model writes many times a second.
    if (was?.state === now.state && was.op === now.op && String(was.blocks) === String(now.blocks)) room.telling ??= setTimeout(() => { room.telling = null; seated(room); }, SEAT_TELL_MS);
    else { clearTimeout(room.telling); room.telling = null; seated(room); }
  };
  /** Only a listener the hub holds has a seat, and only while it has one already or its chat has a turn running: a script that edits under a name is not at work for the person. The one that sits, or none. */
  const sits = (id, name, room) => { const one = listener(id, name); return one && (room?.seats?.has(one.name) || chats()?.working?.(one.chat)) ? one : undefined; };
  /** What is heard of each chat's conduit_artifact call as the model writes it (`heard`): the call, its latest input, and once read, where it writes. */
  const hearing = new Map();
  const hear = async (one, documents) => {
    const { values, open } = readPartial(one.input), whole = (key) => key in values && open !== key ? values[key] : undefined;
    one.action ??= whole("action"); one.block ??= whole("block"); one.for ??= whole("for");
    one.papers ??= documents.of(one.chat).papers;
    one.paper ??= whole("paper") ?? (one.papers.length === 1 ? one.papers[0].id : undefined);
    one.as ??= one.papers.find((paper) => paper.id === one.paper)?.as;
    if (!one.as || !one.block || (one.action !== "replace" && one.action !== "insert")) return;
    await documents.seat(one.paper, one.as, { state: "writing", op: one.action, blocks: [one.block], text: values.markdown ?? "", ...(one.for ? { for: one.for } : {}) });
    clearTimeout(one.hush);
    one.hush = setTimeout(() => quiet(one), SEAT_QUIET_MS); one.hush.unref?.();
  };
  /** A call heard no more, its edit not landed (cut off, superseded, failed): its seat, still writing what it was heard writing, is thinking again. */
  const quiet = (one) => {
    clearTimeout(one.reading); clearTimeout(one.hush);
    if (one.as) void rooms.get(one.paper)?.then((room) => {
      const seat = room?.seats?.get(one.as);
      if (seat?.state === "writing" && seat.op === one.action && String(seat.blocks) === one.block) sit(room, one.as, { state: "thinking", op: undefined, text: undefined });
    }, () => {});
  };

  /**
   * What the hub does for a listener it holds, as the CLI's `wait` does for a session: the item is taken in its name,
   * each comment is marked as being worked on, and the chat is handed each comment with what it is on now and how to answer it in one call. `said`: what the person wrote
   * back on an item already handed over.
   * @param {object} room
   * @param {string} item
   * @param {import("./markup-store.js").Listener} to  One the hub holds (never a `session`).
   * @param {{ n: number | null, text: string }} [said]
   */
  async function hand(room, item, to, said) {
    // The mated thread is made again where it has gone (an empty chat is not kept): what is sent to the paper always has a chat to reach.
    const dir = path.join(room.entry.side, "markup", item), chat = to.kind === "thread" ? (await mated(room.id)).id : to.kind === "agent" ? agentChat = await host().agent().chat() : to.chat, at = new Date().toISOString();
    // The name is the file's, which anyone who can write the folder chooses: it reaches the agent as a quoted name, never as lines of its own.
    const name = JSON.stringify(room.entry.name.replace(/\s+/g, " ").slice(0, 120)), taken = path.join(dir, "taken.json");
    const comments = JSON.parse(await fs.readFile(path.join(dir, "item.json"), "utf8")).comments ?? [];
    const kind = KINDS[room.entry.kind], rev = await kind.revision?.(room).catch(() => undefined);
    const handed = (comment, words, said) => Object.fromEntries(Object.entries({ artifact: room.id, kind: room.entry.kind, name: room.entry.name.replace(/\s+/g, " ").slice(0, 120), item, n: comment?.n, ...kind.where?.(comment?.under, room), said, rev,
      quote: comment?.quote || undefined, words: words || undefined, context: kind.context?.(room, comment?.under, 1) }).filter(([, value]) => value !== undefined && value !== null && !(Array.isArray(value) && !value.length)));
    // How to answer, the tool first: one call does the edits, the reply and the resolve, so nothing needs reading first.
    const answering = (n) => `${kind.cells ? `Change its cells with the tool \`conduit_artifact\`: action "set" (at: "B4", value) or "fill" (range: "B2:C5", values: rows of cells' text; a formula's references follow each cell), with paper "${room.id}" and for "${item}/${n ?? "<n>"}"; "cells" reads it (range optional). Then answer with action "answer", paper "${room.id}", item "${item}"${n ? `, n ${n}` : ""}, \`reply\` (what the person reads beside the comment) and \`resolve\`.` : kind.blocks ? `Answer in one call: the tool \`conduit_artifact\`, action "answer", with paper "${room.id}", item "${item}"${n ? `, n ${n}` : ""}, \`edits\` ([{ op: "replace" | "insert" | "delete", at: <block id>, markdown }], each made for this comment), \`reply\` (what the person reads beside the comment) and \`resolve\`.` : `Change the site's file ${room.file?.() ?? room.entry.path} with your own tools, then answer with the tool \`conduit_artifact\`, action "answer", paper "${room.id}", item "${item}"${n ? `, n ${n}` : ""}, \`reply\` and \`resolve\`.`} Without the tool: ${kind.cells ? `\`node ${SCRIPT} document set ${room.id} <A1> <value> --for ${item}/${n ?? "<n>"}\` (or \`document fill\`), then ` : ""}\`node ${SCRIPT} answer ${item}${n ? ` ${n}` : ""} --json '{${kind.blocks ? `"edits":[…],` : ""}"reply":"…","resolve":true}'\`.`;
    const about = (list) => [...new Set(list.flatMap((comment) => kind.places?.(comment?.under) ?? []))];
    // Seated once the chat has been told, never before: a chat that could not be told is not at work. One that is already reading or writing keeps that;
    // and one whose chat answered before it was seated, or never began a turn, has no turn end to leave by, so it leaves SEAT_START_MS on.
    const seat = (blocks, about) => {
      if (!kind.seats) return;
      if (!["reading", "writing"].includes(room.seats?.get(to.name)?.state)) sit(room, to.name, { state: "thinking", blocks, for: about, text: undefined });
      setTimeout(() => { if (!chats()?.working?.(chat)) sit(room, to.name, null); }, SEAT_START_MS).unref?.();
    };
    const back = said && handed(comments.find((comment) => comment.n === said.n) ?? { n: said.n }, said.text, said.text ? "reply" : "reopened");
    if (said) return host().notify(chat, `${handoff(back)}\nOn the ${kind.noun} ${name}, markup item ${item}: ${said.text ? `the person wrote back${Number.isInteger(said.n) ? ` on comment ${said.n}` : ""}: ${said.text}` : `the person reopened comment ${said.n}.`} The comment and what it is on now are in the card above. ${answering(said.n ?? (comments.length === 1 ? comments[0].n : null))}`, [back]).then(() => seat(about([comments.find((comment) => comment.n === said.n)]), `${item}/${said.n ?? 1}`));
    // Taken once: a session that took it first (a `wait` under the same name) keeps it, and the chat is told nothing.
    const mine = await fs.writeFile(taken, `${JSON.stringify({ name: to.name, held: true, kind: to.kind, chat, at })}\n`, { flag: "wx" }).then(() => true, async () => (await fs.readFile(taken, "utf8").then(JSON.parse).catch(() => null))?.held === true);
    if (!mine) return;
    // What the chat has not been told of yet: the comments with no line saying one is being worked on.
    const told = new Set((await fs.readFile(path.join(dir, "thread.jsonl"), "utf8").catch(() => "")).split("\n").filter(Boolean).map((line) => JSON.parse(line)).filter((line) => line.working).map((line) => line.n));
    const fresh = comments.filter((comment) => !told.has(comment.n));
    if (!fresh.length) return;
    // A chat that cannot be told has not taken it: the item goes back to waiting, which is what the person then reads.
    const cards = fresh.map((comment) => handed(comment, comment.comment));
    await host().notify(chat, `${cards.map((one) => handoff(one)).join("\n")}\n${fresh.length === comments.length ? "The person" : "The person added to what they"} sent you ${fresh.length === 1 ? "a comment" : `${fresh.length} comments`} on the ${kind.noun} ${name}${fresh.length === comments.length ? "" : ` (${fresh.map((comment) => comment.n).join(", ")})`}: what each asks, the text it quotes and what it is on now are in the ${fresh.length === 1 ? "card" : "cards"} above. ${answering(fresh.length === 1 ? fresh[0].n : null)}${fresh.length > 1 ? " One answer per comment, with its n." : ""} The person reads the ${kind.noun}'s margin, not this chat: say what you did, or ask what you need to know, in the reply, in a line or two; what you write here is only your own log. (Everything else about the item is in ${path.join(dir, "item.json")}.)${to.name === MATED ? kind.signing?.(MATED) ?? "" : ""}`, cards)
      .catch(async (error) => { if (!told.size) await fs.rm(taken, { force: true }); throw error; });
    await fs.appendFile(path.join(dir, "thread.jsonl"), fresh.map((comment) => `${JSON.stringify({ at, from: "agent", by: to.name, n: comment.n, working: true })}\n`).join(""));
    seat(about(fresh), `${item}/${fresh[0].n}`);
  }

  /**
   * The file is the paper: what it holds that the live copy does not is taken, as the smallest change that makes the live copy so. What was written while
   * the folder could not be reached is owed to a file that has not changed since (`owed`): the kept state is then the paper, and the file takes it.
   */
  async function take(room) {
    const { disk, path: at } = room.entry, text = await disk.read(at);
    if (text !== room.text) {
      await KINDS[room.entry.kind].live.take(room, text, Boolean(room.owed && room.owed === hash(text)));
      room.text = text;
    }
    room.owed = null;
    room.seen = (await disk.stat(at))?.mtimeMs;
    room.unread = null;
  }
  /** Has the file changed under the hub? A file that has gone, or is now another paper's (a checkout), is looked for under another name; a paper whose file is nowhere is closed, never written again. */
  async function look(room) {
    // A folder that cannot be reached (its device is away) is not a file that has gone: the live copy goes on, and nothing is written until it answers.
    const stat = await room.entry.disk.stat(room.entry.path).catch((error) => { room.away = error.message; });
    if (stat === undefined) return;
    room.away = null;
    if (stat?.mtimeMs === room.seen) return;
    // A file that cannot be read stays as it is until it can: the hub writes nothing over a person's edit.
    const unread = (error) => {
      if (error.other) return true;
      // A device that went between the look and the reading is away, and the file is read when it answers.
      if (room.entry.disk.far && error.status !== 422) { room.away = error.message; return false; }
      room.unread = error.message; room.seen = stat?.mtimeMs; console.error(error.message); return false;
    };
    if (stat && !await take(room).then(() => false, unread)) return;
    if (!await again(room.entry.project) && room.entry.disk.far) { room.away = "The folder could not be read"; return; }
    const now = known.get(room.id);
    if (!now || spot(now) === spot(room.entry)) return shut(room, `This ${KINDS[room.entry.kind].noun} is gone from its folder`);
    room.entry = now;
    await take(room).catch(unread);
  }
  async function save(room) {
    await look(room);
    if (room.gone) return;
    const live = KINDS[room.entry.kind].live, text = live.write(room), { disk, path: at } = room.entry;
    const owed = path.join(room.entry.side, "unwritten");
    if (!room.unread && !room.away && text !== room.text) {
      // A device that goes as it is written to is away: the state is kept, and the file is written when it answers.
      await disk.write(at, text).then(async () => { room.text = text; room.seen = (await disk.stat(at))?.mtimeMs; if (disk.far) await fs.rm(owed, { force: true }); }, (error) => { if (!disk.far) throw error; room.away = error.message; });
    }
    await writePrivateFile(path.join(room.entry.side, "state.yjs"), Y.encodeStateAsUpdate(room.doc));
    await live.saved?.(room);
    // Kept across a restart: which file the state is ahead of, so the file read then is not taken over what was written here.
    if (room.away && room.text !== undefined && text !== room.text) await writePrivateFile(owed, hash(room.text));
  }
  function shut(room, why) {
    clearTimeout(room.saving);
    room.gone = true;
    rooms.delete(room.id);
    KINDS[room.entry.kind].live?.close?.(room);
    for (const peer of room.peers) peer.close(4404, why);
  }
  /**
   * An artifact's comments: a Markup store of its own, and what the hub does for the listeners it holds. `where`: what an
   * item's summary says after the artifact's name; `about`: lines for the item's `read` (both read at each Send: a site
   * is renamed and moved while its store, which holds what is being marked, goes on); `seen`: told the open threads on each look at them.
   */
  function markupOf(room, where, about, seen = () => {}) {
    const { id, entry } = room, store = createMarkupStore({
      folder: path.join(entry.side, "markup"), listeners: path.join(dataRoot, "feedback"), on: () => `the ${KINDS[entry.kind].noun} ${room.entry.name} ${where()}`,
      held: async () => listeners(id), done: (item) => `node ${SCRIPT} done ${item}`,
      about: () => [`Where a line here says \`node scripts/conduit-markup.mjs\`, run \`node ${SCRIPT}\`: it works from any folder.`, ...about()],
      log: (line) => console.log(JSON.stringify({ ...line, type: "conduit.document.markup", document: id })),
    });
    const open = async () => { const items = await store.open(); seen(items); recount(room.id, items); return items; };
    // What is sent to a listener the hub holds, or written back on an item one of them took, is handed to its chat. The person's page is answered first: a chat that cannot be started is said in the log, and the item stays in the folder.
    // Who holds an item is the chat that took it, whatever it is called now: a chat's listener name is its title, which changes.
    // A taken.json written before it said its kind says `agent: true` for the agent and the old name for the own thread.
    /** @returns {Promise<import("./markup-store.js").Listener | undefined>} */
    const held = async (name, item) => {
      const took = item && await fs.readFile(path.join(entry.side, "markup", item, "taken.json"), "utf8").then(JSON.parse).catch(() => null);
      if (!took?.held) return name ? listener(id, name) : undefined;
      const kind = took.kind ?? (took.name === OLD ? "thread" : took.agent ? "agent" : "chat"), all = listeners(id);
      return kind === "chat" ? all.some((one) => one.chat === took.chat) ? { name: took.name, kind, chat: took.chat } : undefined : all.find((one) => one.kind === kind);
    };
    const failed = (error) => console.error(`Could not hand a comment on the ${KINDS[entry.kind].noun} ${room.entry.name} to its chat: ${error.message}`);
    return { ...store, open,
      send: async (item, body) => { const sent = await store.send(item, body?.to === OLD ? { ...body, to: MATED } : body), to = await held(sent.handed?.to?.name, sent.id); if (to) void hand(room, sent.id, to).catch(failed); void open().catch(() => {}); return sent; },
      answer: async (item, body) => { const answered = await store.answer(item, body); void open().catch(() => {}); return answered; },
      say: async (item, body) => {
        const said = await store.say(item, body), to = await held(said.by, item);
        await open();
        if (to && (body?.text || body?.resolved === false)) void hand(room, item, to, { n: Number.isInteger(body.n) ? body.n : null, text: body.text ? String(body.text).trim() : "" }).catch(failed);
        return said;
      } };
  }
  /** A site as the hub holds it: its comments and nothing of its file, which is read when it is asked for. */
  async function loadSite(entry) {
    const room = { id: entry.id, entry, peers: new Set(), queue: Promise.resolve() };
    room.work = (job) => (room.queue = room.queue.then(job, job));
    await fs.mkdir(entry.side, { recursive: true });
    if (!entry.disk.far) void excludeConduitFromGit(entry.disk.key).catch(() => {});
    // Where the site is now: `known` is told of a rename and of a file found moved.
    const file = room.file = () => { const now = known.get(entry.id) ?? room.entry; return now.disk.far ? `${now.path} in the project's folder, on the device that holds it` : now.disk.at(now.path); };
    room.markup = markupOf(room, () => `(the file ${file()})`, () => [`This site is one HTML file, ${file()}, which the person sees drawn in a pane. To answer a comment, change that file with your own tools: the pane shows the new version a moment after it is saved. Leave its \`conduit-artifact\` meta tag as it is, and do not rename or move the file.`,
      "A comment's `under.elements` names what of the site its marks were drawn over, each as its parent and itself (`section#plans > h2`) with the text it shows; `rect` and `drawings` are in the pixels of the person's window, not of the site.",
      "If you have the tool `conduit_artifact`, its comments, reply and resolve work on a site by its id."]);
    return room;
  }
  /** A kind held live (ArtifactKind `live`): a Yjs doc of its kind's format, read from its file and written back to it. */
  async function loadLive(entry) {
    const { id } = entry, live = KINDS[entry.kind].live, doc = new Y.Doc(), room = { id, entry, doc, authors: doc.getMap(AUTHORS), peers: new Set(), agents: new Map(), queue: Promise.resolve() };
    /** One at a time: a save, a look at the file and a rename never cross. */
    room.work = (job) => (room.queue = room.queue.then(job, job));
    await fs.mkdir(entry.side, { recursive: true });
    if (!entry.disk.far) void excludeConduitFromGit(entry.disk.key).catch(() => {});
    const kept = await fs.readFile(path.join(entry.side, "state.yjs")).catch(() => null);
    if (kept) Y.applyUpdate(doc, kept);
    // Opened on the kept state, so what is built from it (a sheet's formula engine) is built once.
    Object.assign(room, live.open(doc, KINDS[entry.kind]));
    room.owed = await fs.readFile(path.join(entry.side, "unwritten"), "utf8").catch(() => null);
    await take(room);
    room.markup = markupOf(room, () => `(document ${id})`, () => live.about(room), (items) => live.seen?.(room, items));
    doc.on("update", (update, origin) => {
      for (const peer of room.peers) if (peer !== origin) peer.send(frame(FRAME.update, update));
      clearTimeout(room.saving);
      room.saving = setTimeout(() => void room.work(() => save(room)).catch((error) => console.error(`Could not save the ${KINDS[room.entry.kind].noun} ${room.entry.name}`, error)), SAVE_AFTER_MS);
    });
    // What the file brought that the kept state did not have is kept, and a file read without ids is written with them.
    await save(room);
    return room;
  }
  /** The ids of the sites whose files do not say one are kept by path: a path's record goes with its file, and only that site's. */
  const unfiled = (entry, to) => paths(path.dirname(entry.side), (kept) => { if (kept[entry.path] === entry.id) { delete kept[entry.path]; if (to) kept[to] = entry.id; } });
  /**
   * One block's edit worked out over `now` (the paper, or what the edits before it in the same change make of it), writing nothing: what the paper
   * becomes, the blocks it writes, and `also`, what it keeps in the changes, run in the change that writes it. A block that is not there is `missing`.
   */
  const planned = (kept, now, { op, block, markdown: text = "", by, for: about, suggest }) => {
    const { id } = kept, at = now.findIndex((candidate) => candidate.attrs.id === block);
    if (!["replace", "insert", "delete"].includes(op)) throw fault(400, "op is replace, insert, delete or set");
    if (at < 0 && !(op === "insert" && block === "start")) throw Object.assign(fault(404, `No block ${block} in ${id}: read it again for its blocks as they are now (the person may be typing in it)`), { missing: block });
    const fresh = op === "delete" ? [] : kept.format.parse(String(text ?? ""));
    // Markdown that reads as blocks the paper cannot hold is refused here, never left to fail when someone next types in them.
    for (const made of fresh) { try { made.check(); } catch (error) { throw fault(400, `That Markdown makes a block the ${KINDS[kept.entry.kind].noun} cannot hold (${error.message}): write it another way`); } }
    if (op === "replace" && fresh[0]) fresh[0] = fresh[0].type.create({ ...fresh[0].attrs, id: block }, fresh[0].content);
    const next = [...now.slice(0, op === "insert" ? at + 1 : at), ...fresh, ...now.slice(at + 1)], name = typeof by === "string" && by ? by.slice(0, 80) : "agent";
    if (suggest && about !== undefined) throw fault(400, "An edit either answers a comment (for) or is a suggestion (suggest), not both");
    if (suggest && suggest !== true && ![...kept.changes.values()].some((change) => change.for === suggest)) throw fault(404, `No suggestion ${suggest} in ${id}: suggestions lists them`);
    const suggestion = suggest ? suggest === true ? `${SUGGESTION}${blockId()}` : String(suggest) : undefined, key = suggestion ?? (about === undefined ? undefined : String(about));
    return { next, fresh, name, suggestion, also: key === undefined ? undefined : () => {
      const stamp = { for: key, by: name, at: new Date().toISOString() }, had = kept.changes.get(block), gone = op !== "insert" && !fresh.length;
      // The first `before` is the one kept: what is taken back is everything done for the comment, not its last step. A block made for a comment and then deleted leaves nothing to show.
      if (gone && had?.before === null) kept.changes.delete(block);
      else if (op !== "insert") kept.changes.set(block, { ...stamp, before: now[at].toJSON(), ...had, ...(gone ? { after: now[at - 1]?.attrs.id ?? null, at: stamp.at } : {}) });
      for (const made of fresh.slice(op === "replace" ? 1 : 0)) kept.changes.set(made.attrs.id, { ...stamp, before: null });
    } };
  };

  /**
   * A kind of artifact as the hub holds it: everything the hub does that differs by kind. What a kind leaves out it refuses or does not do: with
   * no `live` it has no live copy (no socket), with no `blocks` or `cells` nothing in it to read or change, with no `images` it keeps none, with no
   * `seats` no agent is drawn at work in it.
   * @typedef {object} ArtifactKind
   * @property {string} ext  Its file's ending.
   * @property {string} noun  What it is called in a sentence, after "a" or "the": what the hub tells chats and people of it.
   * @property {"found" | "asked"} adopts  Which files with its ending are artifacts: each one found in a project's folder, or only one made as one or
   *   asked to be one (`at` with `adopt`); a listing never makes one of those.
   * @property {readonly string[]} [holds]  With `blocks`: what of the format beyond plain Markdown its blocks can hold (document-format.js
   *   documentExtensions); unsaid, everything. Its schema and its Markdown reader and writer are made of these alone.
   * @property {"inline" | "side"} [ids]  With `blocks`: where its blocks' ids are kept, written in its file (FILES.inline, the conduit-document format)
   *   or only beside it in the Yjs state (FILES.side, plain Markdown, whose blocks are matched to the live copy's by content when the file is read).
   * @property {"properties" | "verbatim"} [front]  With `blocks`: its front matter is its properties, which `set` writes, or the file's own text, kept
   *   as it is and written back unchanged.
   * @property {(id: string, name: string) => string} made  What a new file of it holds.
   * @property {(text: string, name: string) => { id: string | null }} identify  What its file says of it: the id it carries, where it says one (a paper also its `blocks` and `properties`).
   * @property {(side: string, at: string) => Promise<string | undefined>} [filed]  An id kept for the file's path, taken before what the file says.
   * @property {(found: { disk: object, side: string, at: string, id: string, read: { id: string | null } }) => Promise<void>} adopted  A file read without its id (none, or a copy's) is given `id`.
   * @property {(side: string, at: string) => Promise<void>} [created]  After a new file is made at `at`.
   * @property {(entry: object, to: string) => Promise<void>} [renamed]  After its file is moved to `to`.
   * @property {(entry: object) => Promise<void>} [removed]  After its file is deleted.
   * @property {LiveKind} [live]  It is held live, as a Yjs doc its pages merge with over the live socket.
   * @property {(entry: object) => Promise<object>} load  Its room: `{ id, entry, peers, work, markup }`, its comments a Markup store from markupOf, and whatever live copy it keeps.
   * @property {(entry: object, have?: string) => Promise<{ revision: string, html?: string }>} [content]  What a pane draws, by HTTP, with a revision that changes when it does; `have` is not sent again.
   * @property {{ [op in "read" | "edit" | "revert" | "suggestions" | "accept" | "reject"]: (room: object, ...args: any[]) => Promise<any> }} [blocks]  Its blocks, read and changed in its live room (`doc`, loaded on `about`).
   * @property {{ read: (room: object, as?: string, range?: string) => Promise<string | object>, edit: (room: object, body: object) => Promise<object> }} [cells]
   *   Its cells, read and changed in its live room (sheets.js; the routes' `/cells`): what was typed in each, by A1 address, and its rows and columns.
   *   Nothing done for a comment is kept to take back.
   * @property {true} [images]  It keeps images beside it.
   * @property {true} [seats]  An agent the hub holds is drawn at work in it, on the `places` of what it was handed (a seat: who is writing where).
   * @property {(under: object | undefined, room?: object) => Record<string, string | undefined>} [where]  What a hand-off card says of where a comment is, from the comment's `under` (and the room, where the kind reads it there).
   * @property {(under: object | undefined) => string[]} [places]  What of it a comment's `under` names.
   * @property {(room: object, under: object | undefined, radius: number) => { id?: string, md: string, target?: true }[] | undefined} [context]  What a comment is on as it is now, with `radius` blocks (or cells) around, for a hand-off to carry.
   * @property {(room: object) => Promise<string>} [revision]  What it is at now, as its `content` says (a paper's live copy has none).
   * @property {(name: string) => string} [signing]  What its mated thread, listening as `name`, is told of writing in it under that name.
   */
  /**
   * How a live kind's room is made and kept in step with its file (loadLive, take, save).
   * @typedef {object} LiveKind
   * @property {number} format  What a page's handshake on the live socket must say (document-format.js FORMAT, sheet-format.js SHEET_FORMAT).
   * @property {(doc: Y.Doc, kind: ArtifactKind) => object} open  The room's own fields over the doc, once its kept state is in it.
   * @property {(room: object) => boolean} empty  The live copy holds nothing yet (a first read takes the file whole).
   * @property {(room: object, text: string, owed: boolean) => void | Promise<void>} take  The file's text taken into the live copy; `owed`: the live copy is ahead of this very text.
   * @property {(room: object) => string} write  The file for the live copy.
   * @property {(room: object) => Promise<void>} [saved]  After each save: what it keeps beside the file.
   * @property {(room: object) => void} [close]  The room is shut.
   * @property {(room: object) => string[]} about  Lines for a Markup item's `read`: how an agent changes it.
   * @property {(room: object, items: object[]) => void} [seen]  Told the open threads on each look at them.
   */
  const places = (under) => String(under?.blocks ?? "").split(" ").filter(Boolean);
  /** What every kind drawn in the paper's editor does the same: its room, its comments' places, and its blocks' verbs. */
  const LIVE = {
    load: loadLive,
    images: true,
    seats: true,
    live: {
      format: FORMAT,
      open: (doc, kind) => ({ format: formatOf(kind.holds), blocks: doc.getXmlFragment(FRAGMENT), changes: doc.getMap(CHANGES), properties: doc.getMap(PROPERTIES) }),
      empty: (room) => !room.blocks.length,
      take(room, text, owed) {
        const file = fileOf(room), read = file.read(text, room.entry.name, room), { properties } = read;
        if (read.id && read.id !== room.id) throw Object.assign(new Error("Another paper's file is at this path"), { other: true });
        if (!(owed && room.blocks.length) && (!room.blocks.length || file.write(room, read) !== file.write(room, now(room, read.kept)))) set(room, read.blocks, undefined, () => { if (properties) { for (const name of room.properties.keys()) if (!(name in properties)) room.properties.delete(name); for (const [name, value] of Object.entries(properties)) if (room.properties.get(name) !== value) room.properties.set(name, value); } });
        room.kept = read.kept;
      },
      write: (room) => fileOf(room).write(room, now(room)),
      about: (room) => [...KINDS[room.entry.kind].front === "verbatim" ? [`It is the plain Markdown file ${room.entry.path} in its project's folder: change it through these, not by writing the file (the hub holds its live copy), and leave its front matter as it is.`] : [], `An image block reads as \`![caption](name)\`; its picture is the file ${path.join(room.entry.side, "images")}/<name>.`, "If you have the tool `conduit_artifact`, its action `answer` makes a comment's edits, reply and resolve in one call (the CLI's `answer <item> [n] --json '{…}'` does too); read, replace, insert, delete (with `for`), reply and resolve do each alone.", "To answer a comment by changing the document, add `--for <this item's id>/<n>` to `document replace`, `insert` or `delete`: the person then sees which blocks changed for comment n and can take the change back. Resolving the comment yourself does not accept the change for the person: the comment stays in their margin, marked as resolved by you, with the change shown, until they resolve it too.", "Where the person asked for proposals rather than changes, add `--suggest` instead: the edit stands as a suggestion they accept or reject (`--suggest <key>` adds to one; `document suggestions <id>` lists them)."],
      // A change is accepted when the person resolves its comment (a session's resolve accepts nothing); read on every look at the open threads, which hold every comment the person has not resolved.
      seen(room, items) {
        const unsettled = new Set(items.flatMap((item) => item.comments.filter((comment) => !(comment.resolved && comment.resolvedBy === "person")).map((comment) => `${item.id}/${comment.n}`)));
        const settled = [...room.changes.entries()].filter(([, change]) => !isSuggestion(change.for) && !unsettled.has(change.for));
        if (settled.length) room.doc.transact(() => { for (const [block] of settled) room.changes.delete(block); });
      },
    },
    where: (under) => ({ block: places(under)[0] }),
    places,
    context(room, under, radius) {
      const all = blocksOf(room), targets = new Set(places(under)), hit = all.flatMap((block, nth) => targets.has(block.attrs.id) ? [nth] : []);
      if (!hit.length) return undefined;
      return all.slice(Math.max(0, hit[0] - radius), hit.at(-1) + radius + 1).map((block) => ({ id: block.attrs.id, md: room.format.md([block]), ...(targets.has(block.attrs.id) ? { target: true } : {}) }));
    },
    signing: (name) => ` Write in it as \`${name}\`: the tool \`conduit_artifact\` does, and the CLI's \`document\` commands take \`--as ${name}\`.`,
    blocks: {
      /** As Markdown, each block under a comment that gives its id; `markdown`: the Markdown alone, to export (a Markdown file's: the file as it is written); `blocks`: the format itself. */
      async read(kept, as) {
        const { md } = kept.format, blocks = blocksOf(kept), properties = kept.properties.toJSON(), verbatim = KINDS[kept.entry.kind].front === "verbatim";
        if (as === "blocks") return { format: "conduit-document", version: 1, id: kept.id, properties, blocks: blocks.map((block) => block.toJSON()), authors: kept.authors.toJSON(), changes: kept.changes.toJSON() };
        if (as === "markdown" && verbatim) return fileOf(kept).write(kept, now(kept));
        const front = verbatim ? kept.kept?.front ?? "" : Object.keys(properties).length ? `---\n${Object.entries(properties).map(([name, value]) => `${name}: ${JSON.stringify(value)}`).join("\n")}\n---\n\n` : "";
        if (as === "markdown") return `${front}${md(blocks)}\n`;
        return `${front}${blocks.map((block) => `<!-- block ${block.attrs.id} -->\n${md([block])}`).join("\n\n")}\n`;
      },
      /**
       * One block changed: `replace` it with the Markdown's blocks (the first keeps its id), `insert` them after it (after `start`: first), or `delete` it.
       * `set` writes its front matter instead.
       * `for` ("<item>/<n>") is the comment it answers: what it changes is then kept in the document's changes until that comment is resolved.
       * `suggest`: the edit is a suggestion instead, kept the same way until the person accepts or rejects it; true starts one, a suggestion's key adds to it.
       */
      async edit(kept, { op, block, markdown: text = "", by, for: about, suggest } = {}) {
        const { id } = kept;
        // `set`: one property of its front matter (`block` its name, the Markdown its value as plain text; none removes it).
        if (op === "set") {
          if (KINDS[kept.entry.kind].front !== "properties") throw fault(400, `A ${KINDS[kept.entry.kind].noun}'s front matter is kept as its file has it: it has no properties to set`);
          const name = String(block ?? "").trim(), value = String(text).trim();
          if (!name || name.length > 60 || /[\n:]/.test(name)) throw fault(400, "A property's name is a few words, with no colon");
          kept.doc.transact(() => value ? kept.properties.set(name, value.slice(0, 2000)) : kept.properties.delete(name));
          return { properties: kept.properties.toJSON() };
        }
        const { next, fresh, name, also, suggestion } = planned(kept, blocksOf(kept), { op, block, markdown: text, by, for: about, suggest });
        if (about !== undefined) await kept.markup.thread(String(about).split("/")[0]);
        set(kept, next.length ? next : [kept.format.empty()], name, also);
        // Its seat moves to what it wrote, and what it was heard writing is the paper's now.
        const sitting = sits(id, name, kept);
        if (sitting) sit(kept, sitting.name, { state: "thinking", blocks: fresh.length ? fresh.map((made) => made.attrs.id) : [], text: undefined, ...(about === undefined ? {} : { for: String(about) }) });
        return { blocks: fresh.map((made) => made.attrs.id), ...(suggestion ? { suggestion } : {}) };
      },
      /** Everything changed for one comment is put back as it was: a changed block is its `before` again, a new one goes, a deleted one returns after the block it followed. */
      async revert(kept, thread) {
        const blocks = blocksOf(kept), mine = [...kept.changes.entries()].filter(([, change]) => change.for === thread);
        // Deleted blocks return latest first: two that followed the same block then stand in their old order.
        for (const [block, change] of mine.sort((a, b) => String(b[1].at).localeCompare(a[1].at))) {
          const at = blocks.findIndex((candidate) => candidate.attrs.id === block), before = change.before && kept.format.schema.nodeFromJSON(change.before);
          if (at >= 0) blocks.splice(at, 1, ...(before ? [before] : []));
          else if (before) { const after = blocks.findIndex((candidate) => candidate.attrs.id === change.after); blocks.splice(change.after === null ? 0 : after < 0 ? blocks.length : after + 1, 0, before); }
        }
        set(kept, blocks.length ? blocks : [kept.format.empty()], undefined, () => { for (const [block] of mine) kept.changes.delete(block); });
        return { blocks: mine.map(([block]) => block) };
      },
      /** The suggestions standing in the paper, oldest first: who made each, its blocks (in the paper's order, then those it deleted), and their text before and now. */
      async suggestions(kept) {
        const blocks = blocksOf(kept), found = new Map(), clip = (text) => text.length > 200 ? `${text.slice(0, 199)}…` : text;
        const order = new Map(blocks.map((block, nth) => [block.attrs.id, nth]));
        for (const [block, change] of kept.changes.entries()) {
          // A block made for a suggestion and deleted since is not part of it.
          if (!isSuggestion(change.for) || (change.before === null && !order.has(block))) continue;
          const one = found.get(change.for) ?? found.set(change.for, { key: change.for, by: change.by, at: change.at, entries: [] }).get(change.for);
          if (String(change.at) < String(one.at)) one.at = change.at;
          one.entries.push([block, change]);
        }
        return [...found.values()].sort((a, b) => String(a.at).localeCompare(b.at)).map(({ entries, ...one }) => {
          entries.sort((a, b) => (order.get(a[0]) ?? Infinity) - (order.get(b[0]) ?? Infinity));
          const was = entries.flatMap(([, change]) => change.before ? [kept.format.schema.nodeFromJSON(change.before).textContent] : []), now = entries.flatMap(([block]) => order.has(block) ? [blocks[order.get(block)].textContent] : []);
          return { ...one, blocks: entries.map(([block]) => block), before: clip(was.join("\n")), after: clip(now.join("\n")) };
        });
      },
      /** A suggestion is accepted: its blocks stay as they are and stop standing as suggested. */
      async accept(kept, key) {
        const mine = [...kept.changes.entries()].filter(([, change]) => change.for === key);
        if (!isSuggestion(key) || !mine.length) throw fault(404, `No suggestion ${key} in ${kept.id}: suggestions lists them (a comment's change is accepted by resolving the comment)`);
        kept.doc.transact(() => { for (const [block] of mine) kept.changes.delete(block); });
        return { blocks: mine.map(([block]) => block) };
      },
      /** A suggestion is rejected: taken back, as a comment's change is. */
      async reject(kept, key) {
        if (!isSuggestion(key) || ![...kept.changes.values()].some((change) => change.for === key)) throw fault(404, `No suggestion ${key} in ${kept.id}: suggestions lists them`);
        return this.revert(kept, key);
      },
    },
  };
  /**
   * An id kept by its file's path (paths.json), for a kind whose file does not say it: the id its path has is the artifact's, before what the file says,
   * which is read only for a path that has none (a new file, or one moved by hand). An id is one path's.
   */
  const BY_PATH = {
    filed: async (side, at) => (await paths(side, () => {}))[at],
    adopted: ({ side, at, id }) => paths(side, (kept) => { for (const was of Object.keys(kept)) if (kept[was] === id) delete kept[was]; kept[at] = id; }),
    // A new file is not the artifact that was once at its path.
    created: (side, at) => paths(side, (kept) => { delete kept[at]; }),
    renamed: (entry, to) => unfiled(entry, to),
    // Deleted here, its path is free: a file later written there is another one. (One deleted by hand and brought back is still itself.)
    removed: (entry) => unfiled(entry),
  };
  /** @type {Record<string, ArtifactKind>} */
  const KINDS = {
    // Cells in a CSV file, computed as a spreadsheet computes them.
    sheet: {
      ...sheetKind({ fault, as }),
      ...BY_PATH,
      load: loadLive,
      signing: LIVE.signing,
    },
    paper: {
      ext: ".paper", noun: "paper", adopts: "found", ids: "inline", front: "properties",
      made: (id) => written(id, [formatOf().empty()]),
      identify: (text, name) => paper(text, name),
      adopted: async ({ disk, at, id, read }) => { if (id !== read.id) await disk.write(at, written(id, read.blocks, read.properties)); },
      ...LIVE,
    },
    // A paper's blocks in a file of Markdown alone, which other tools read and write too.
    markdown: {
      ext: ".md", noun: "Markdown file", adopts: "asked", holds: ["callout", "toggle"], ids: "side", front: "verbatim",
      made: () => "",
      identify: () => ({ id: null }),
      ...BY_PATH,
      ...LIVE,
    },
    site: {
      ext: ".site.html", noun: "site", adopts: "found",
      made: (id, name) => SITE(id, name),
      identify: (text) => ({ id: SITE_ID.exec(text)?.[1] ?? null }),
      // A site's file is its agent's to write, and one written whole may no longer say its id.
      ...BY_PATH,
      load: loadSite,
      // What its marks were drawn over, as the site named it when the comment was sent: the hub reads nothing of the file for it.
      context: (room, under) => under?.elements ? [{ md: String(under.elements) }] : undefined,
      revision: async (room) => { const now = known.get(room.id) ?? room.entry, stat = await now.disk.stat(now.path); return stat ? String(stat.mtimeMs) : undefined; },
      async content(entry, have) {
        const { id } = entry;
        let stat = await entry.disk.stat(entry.path);
        // A file that has gone may have been moved: the folder is read again, and a site that says its id is found where it is now.
        if (!stat) { await again(entry.project); entry = known.get(id); stat = entry && KINDS[entry.kind].content ? await entry.disk.stat(entry.path) : null; }
        if (!stat) throw fault(404, "This site's file is gone");
        await entry.disk.inside(entry.path);
        const revision = String(stat.mtimeMs);
        return revision === have ? { revision } : { revision, html: await entry.disk.read(entry.path) };
      },
    },
  };
  const held = async (id) => {
    const entry = await entryOf(id);
    if (!rooms.has(id)) { const loading = KINDS[entry.kind].load(entry); rooms.set(id, loading); loading.catch(() => { if (rooms.get(id) === loading) rooms.delete(id); }); }
    return rooms.get(id);
  };
  /** The live copy, the file looked at first: what an agent reads or changes is the paper as it is on disk now. */
  /** The file is looked at; what was written while its folder could not be reached is put in it once it can be. */
  const troubleOf = (room) => room?.unread ? `Nothing typed now is kept, because the file cannot be read: ${room.unread}` : room?.away ? "The device that holds this file is away. What is written here is put in the file when it answers." : null;
  const see = async (room) => {
    const was = room.away, said = troubleOf(room);
    await look(room);
    if (was && !room.away) await save(room);
    // A pane asks what is wrong when it is told something changed.
    if (!room.gone && troubleOf(room) !== said) changed(room.entry.project);
  };
  /** How a kind is changed, for one that cannot be changed the way asked. */
  const changedBy = (entry) => { const kind = KINDS[entry.kind]; return kind.blocks ? "its blocks are read and changed with read, replace, insert and delete" : kind.cells ? "its cells are read and changed with cells, set, fill, rows and cols" : `it is the file ${entry.path} in its project's folder, changed as any file is`; };
  /** The live room, the file looked at first; `need`: what of the kind the asker uses (ArtifactKind `blocks`, `cells` or `live`). */
  const current = async (id, need = "blocks") => {
    const entry = await entryOf(id);
    if (!KINDS[entry.kind][need]) throw fault(400, `${entry.name} is a ${KINDS[entry.kind].noun}, which has no ${need === "live" ? "live copy" : need}: ${changedBy(entry)}`);
    const room = await held(id); await room.work(() => see(room));
    return room.gone ? (() => { throw fault(404, `No paper ${id}`); })() : room;
  };
  const blocks = async (id, op, ...args) => { const room = await current(id); return KINDS[room.entry.kind].blocks[op](room, ...args); };
  const cells = async (id, op, ...args) => { const room = await current(id, "cells"); return KINDS[room.entry.kind].cells[op](room, ...args); };
  const looking = setInterval(() => { for (const loading of rooms.values()) void loading.then((room) => room.peers.size || room.away ? room.work(() => see(room)) : null).catch(() => {}); }, LOOK_EVERY_MS);
  looking.unref();
  const told = async (entry) => { await tell(); changed(entry.project); return shown(entry); };
  const listing = (project) => JSON.stringify([...known.values()].filter((entry) => entry.project === project).map((entry) => [entry.id, entry.path]).sort());

  return {
    /** A project's artifacts, by name. */
    async list(project) {
      const of = await projectOf(project), mine = () => [...known.values()].filter((entry) => entry.project === of.id);
      await scan(of);
      // A folder on this disk is cheap to ask about each paper. One on a device is read again, behind the answer, when it was last read a while ago: its changes are not told to the hub, and reading it is a call to the device for each directory.
      if (!remoteNode(of)) { if (!(await Promise.all(mine().map((entry) => entry.disk.stat(entry.path).catch(() => null)))).every(Boolean)) await again(of.id); }
      else if (Date.now() - (scanned.get(of.id) ?? 0) > FAR_SCAN_MS) { scanned.set(of.id, Date.now()); void again(of.id); }
      return (await Promise.all(mine().map(async (entry) => ({ ...shown(entry), open: await openOf(entry), working: workingOf(entry) })))).sort((a, b) => a.name.localeCompare(b.name));
    },
    /** A new artifact (a paper or a Markdown file, empty, or a site that says what it is), in a folder of the project (unsaid: its root). */
    async create(project, { kind = "paper", name, folder: into = "" } = {}) {
      if (typeof kind !== "string" || !Object.hasOwn(KINDS, kind)) throw fault(400, `There is no artifact of the kind ${kind}`);
      const of = await projectOf(project), { disk } = place(of), at = [within(into), `${named(name)}${KINDS[kind].ext}`].filter(Boolean).join("/"), id = crypto.randomBytes(8).toString("hex");
      await disk.inside(at);
      await disk.create(at, KINDS[kind].made(id, nameOf(at))).catch((error) => {
        throw error.code === "EEXIST" ? fault(409, `A ${KINDS[kind].noun} named ${nameOf(at)} is already there`) : error.code === "ENOENT" ? fault(404, `No folder ${into} in this project`) : error;
      });
      await KINDS[kind].created?.(place(of).side, at);
      return told(await adopt(of, at, true));
    },
    /**
     * The artifact a file of the project is. A file of a kind that `adopts` only when asked, and was never made or asked to be one, is not one
     * (404 `not_an_artifact`) unless `adopt`, which makes it one.
     * @param {{ adopt?: boolean }} [options]
     */
    async at(project, file, { adopt: asking = false } = {}) {
      const asked = await projectOf(project), far = Boolean(remoteNode(asked)), full = far ? null : path.join(path.resolve(asked.workingRoot), within(file)), of = far ? asked : owner(full, await here()) ?? asked;
      const at = far ? within(file) : path.relative(path.resolve(of.workingRoot), full).split(path.sep).join("/");
      if (!kindOf(at)) throw fault(400, `${file} is not an artifact`);
      const before = listing(of.id), entry = await adopt(of, at, asking === true).catch((error) => { throw error.code === "ENOENT" ? fault(404, `No file ${file} in this project`) : error; });
      if (!entry) throw Object.assign(fault(404, `${file} is not an artifact: open it as a ${KINDS[kindOf(at)].noun} to make it one`), { code: "not_an_artifact" });
      const room = await rooms.get(entry.id)?.catch(() => null);
      if (room) room.entry = entry;
      // Pressing a paper the hub already knows changes nothing, so nobody is told.
      return listing(of.id) === before ? shown(entry) : told(entry);
    },
    /** `trouble`: why what a paper's pane shows may not be what its file holds; `edited`: a paper's, false until anyone (a person, an agent, a hand edit of the file) has changed it since it was made. */
    async about(id) {
      const entry = await entryOf(id), room = await (KINDS[entry.kind].live ? held(id) : rooms.get(id))?.catch(() => null);
      // Made, its blocks are written under one Yjs client; any later change is written under another.
      return { ...shown(entry), trouble: troubleOf(room), changes: KINDS[entry.kind].blocks ? "blocks" : KINDS[entry.kind].cells ? "cells" : "file", ...(room?.doc ? { edited: room.doc.store.clients.size > 1 } : {}) };
    },
    /** A site's HTML as its file holds it now, with a revision that changes when the file does; `have`: the revision the asker shows, which is not sent again. */
    async site(id, have) {
      const entry = await entryOf(id), kind = KINDS[entry.kind];
      if (!kind.content) throw fault(400, `${entry.name} is not a site`);
      return kind.content(entry, have);
    },
    /** A chat's turn started or ended: where it is an artifact's mated thread, that project's clients are told. */
    /** A listener the hub holds read the paper (`reading`), or is heard writing a change to it before it is made (`writing`, with the block and the Markdown so far). */
    async seat(id, by, change) { const room = await rooms.get(id)?.catch(() => null), one = room && KINDS[room.entry.kind].seats && sits(id, by, room); if (one) sit(room, one.name, { text: undefined, ...change }); },
    /**
     * A chat is heard writing a call to conduit_artifact: `input` is its JSON so far, cut wherever the model has got to; `call` names the call in its turn,
     * and `done` says its input is whole. What can be read of it (readPartial: the action, the block, the Markdown so far) seats the chat's agent on
     * that block, writing. The latest input is read at most once each SEAT_TELL_MS, and where a call writes is read once.
     */
    async heard(chat, input, call = "", done = false) {
      let one = hearing.get(chat);
      // A new call: what the last one was heard writing is not what this one writes.
      if (one?.call !== call) { if (one) quiet(one); one = { chat, call }; hearing.set(chat, one); }
      if (one.done) return;
      Object.assign(one, { input, done });
      if (!done) { one.reading ??= setTimeout(() => { one.reading = null; void hear(one, this).catch(() => {}); }, SEAT_TELL_MS); return; }
      clearTimeout(one.reading); one.reading = null;
      await hear(one, this);
    },
    /** A chat's turn ended or began: the seats it holds are left when it is no longer at work. */
    async left(chat) {
      if (chats()?.working?.(chat)) return;
      const one = hearing.get(chat);
      if (one) { clearTimeout(one.reading); clearTimeout(one.hush); hearing.delete(chat); }
      for (const entry of known.values()) { const as = listeners(entry.id).find((one) => one.chat === chat)?.name, room = as && await rooms.get(entry.id)?.catch(() => null); if (room?.seats?.has(as)) sit(room, as, null); }
    },
    turned(chat) {
      void this.left(chat);
      const entry = [...known.values()].find((one) => one.links.thread === chat);
      if (!entry || working.get(entry.id) === workingOf(entry)) return;
      working.set(entry.id, workingOf(entry));
      changed(entry.project);
    },
    /** The paper's mated thread, as a chat's summary. */
    thread: async (id) => ({ chat: await mated(id), project: (await entryOf(id)).project }),
    /** The chats tied to a paper: its mated thread (none until it is made) and those the person connected. */
    async connections(id) {
      const { links } = await entryOf(id);
      return { thread: links.thread && chats()?.get(links.thread) ? links.thread : null, lead: links.lead?.kind === "chat" && links.connections.includes(links.lead.chat) && chats()?.get(links.lead.chat) ? links.lead.chat : null, connections: links.connections.flatMap((chat) => { const found = chats()?.get(chat); return found ? [{ chat, title: found.title || "Untitled chat" }] : []; }) };
    },
    /** A chat is connected to a paper, or (`on` false) no longer: the hub then hands it the comments sent to it. */
    async connect(id, chat, on = true) {
      const entry = await entryOf(id);
      if (!host().get(chat)) throw fault(404, `No chat ${chat}`);
      if (chat === entry.links.thread) throw fault(400, "That is the paper's own thread");
      entry.links.connections = [...entry.links.connections.filter((one) => one !== chat), ...(on ? [chat] : [])];
      if (!on && entry.links.lead?.kind === "chat" && entry.links.lead.chat === chat) delete entry.links.lead;
      await fs.mkdir(entry.side, { recursive: true });
      await link(entry);
      return this.connections(id);
    },
    /** A chat takes the lead on an artifact: it is connected, and what the person sends to nobody by name is handed to it before the artifact's own thread. The own thread taking it clears any other lead. */
    async lead(id, chat) {
      const entry = await entryOf(id);
      if (chat === entry.links.thread) delete entry.links.lead;
      else { await this.connect(id, chat); entry.links.lead = { kind: "chat", chat }; }
      await fs.mkdir(entry.side, { recursive: true });
      await link(entry);
      return this.connections(id);
    },
    /** The person puts a listener the hub holds on an artifact in the lead, by its name; none (or the own thread's) gives the lead back to the own thread. */
    async leader(id, name) {
      const entry = await entryOf(id), one = name === null ? undefined : listener(id, name);
      if (name !== null && !one) throw fault(404, `No listener ${name} on ${entry.name}`);
      if (one?.kind === "agent") entry.links.lead = { kind: "agent" };
      else if (one?.kind === "chat") entry.links.lead = { kind: "chat", chat: one.chat };
      else delete entry.links.lead;
      await fs.mkdir(entry.side, { recursive: true });
      await link(entry);
      const first = listeners(id)[0];
      return { lead: { name: first.name, kind: first.kind } };
    },
    /** What a chat has to do with papers: its project, and the papers it is the thread of or connected to, each with the name it listens under there. */
    of(chat) {
      const found = chat ? chats()?.get(chat) : null;
      return { project: found?.projectId ?? null, papers: found ? [...known.values()].flatMap((entry) => { const as = listeners(entry.id).find((one) => one.chat === chat)?.name; return as ? [{ id: entry.id, as }] : []; }) : [] };
    },
    /** The papers a chat is connected to. */
    connectedTo: (chat) => [...known.values()].filter((entry) => entry.links.connections.includes(chat)).map(shown),
    /** Files changed in these projects (a paper pulled in, moved or deleted outside Conduit): once the changes stop, each folder is read again and its clients are told when its papers are others. */
    filesChanged(ids) {
      for (const id of ids) {
        if (!scans.has(id)) continue;
        clearTimeout(rescans.get(id));
        rescans.set(id, setTimeout(() => { rescans.delete(id); void again(id); }, SCAN_AFTER_MS));
      }
    },
    /** Its file takes the new name, where it is; what belongs to it stays, since that is kept by its id. */
    async rename(id, name) {
      const entry = await entryOf(id), room = await rooms.get(id)?.catch(() => null), to = [path.dirname(entry.path), `${named(name)}${KINDS[entry.kind].ext}`].filter((part) => part && part !== ".").join("/");
      const move = async () => {
        if (to !== entry.path && await entry.disk.stat(to)) throw fault(409, `A ${KINDS[entry.kind].noun} named ${nameOf(to)} is already there`);
        await entry.disk.rename(entry.path, to);
        await KINDS[entry.kind].renamed?.(entry, to);
        const next = known.set(id, { ...entry, path: to, name: nameOf(to) }).get(id);
        if (room) room.entry = next;
        return next;
      };
      return told(await (room ? room.work(move) : move()));
    },
    /** Its file is deleted. Its comments and history stay in the project's .conduit folder, so a file brought back (from git, say) is the paper it was. */
    async remove(id) {
      const entry = await entryOf(id), room = await rooms.get(id)?.catch(() => null);
      if (room) await room.work(() => shut(room, `This ${KINDS[entry.kind].noun} was deleted`));
      await entry.disk.remove(entry.path);
      await KINDS[entry.kind].removed?.(entry);
      known.delete(id);
      await told(entry);
    },
    /** A paper's blocks, read and changed as its kind's `blocks` say; a sheet's cells read as its `cells` say (`range`: only those). */
    read: async (id, as, range) => KINDS[(await entryOf(id)).kind].cells ? cells(id, "read", as, range) : blocks(id, "read", as),
    /** A sheet's cells, or its rows and columns, changed. */
    cells: (id, body) => cells(id, "edit", body ?? {}),
    edit: (id, body) => blocks(id, "edit", body),
    revert: (id, thread) => blocks(id, "revert", thread),
    suggestions: (id) => blocks(id, "suggestions"),
    accept: (id, key) => blocks(id, "accept", key),
    reject: (id, key) => blocks(id, "reject", key),
    /** Stops whoever the hub handed an item to: its chat's turn ends, and the comment stays as it is for the person to ask again or settle. */
    async stop(id, item) {
      const entry = await entryOf(id);
      if (!/^[\w-]+$/.test(item)) throw fault(400, "Which item to stop is not said");
      const took = await fs.readFile(path.join(entry.side, "markup", item, "taken.json"), "utf8").then(JSON.parse).catch(() => null);
      if (!took?.held || !took.chat) throw fault(409, "No chat the hub holds is at work on this");
      await host().stop(took.chat);
      const room = await rooms.get(id)?.catch(() => null);
      if (room?.seats?.has(alias(took.name))) sit(room, alias(took.name), null);
      return { stopped: true };
    },
    /**
     * One comment answered at once: every edit (made for `<item>/<n>`, in one change), then the reply and the resolve, then the seat is left. `n` may be
     * left out of an item with one comment. Nothing is written unless all of it can be: an edit on a block that is not there fails with the comment's blocks
     * as they are now, so the next try needs no read.
     */
    async answer(id, { item, n, edits = [], reply, resolve, by } = {}) {
      const entry = await entryOf(id), kind = KINDS[entry.kind], name = typeof by === "string" && by ? by.slice(0, 80) : "agent";
      if (!Array.isArray(edits)) throw fault(400, "edits is a list of { op, at, markdown }");
      if (edits.length && !kind.blocks) throw fault(400, `${entry.name} is a ${kind.noun}, which has no blocks: ${kind.cells ? "change its cells with set or fill (with for)" : `change its file ${entry.path} with your own tools`}, then answer with reply and resolve alone`);
      const words = typeof reply === "string" ? reply.trim() : "";
      if (reply !== undefined && !words) throw fault(400, "reply is the words the person reads beside the comment");
      if (!edits.length && !words && !resolve) throw fault(400, "An answer has edits, a reply or resolve");
      const room = edits.length ? await current(id) : await held(id);
      return room.work(async () => {
        const thread = await room.markup.thread(String(item ?? "")), at = Number.isInteger(n) ? n : thread.comments.length === 1 ? thread.comments[0].n : undefined;
        const comment = thread.comments.find((one) => one.n === at);
        if ((edits.length || resolve || at !== undefined) && !comment) throw fault(400, at === undefined ? `Say which comment of ${item} this answers (n: ${thread.comments.map((one) => one.n).join(", ")})` : `No comment ${at} in ${item}`);
        const written = [];
        if (edits.length) {
          let now = blocksOf(room);
          const alsos = [];
          for (const edit of edits) {
            let one;
            try { one = planned(room, now, { op: edit?.op, block: edit?.at, markdown: edit?.markdown, by: name, for: `${item}/${at}` }); } catch (error) {
              if (!error.missing) throw fault(error.status ?? 400, `Nothing was written: ${error.message}`);
              const context = kind.context(room, comment.under, 1);
              throw fault(409, `Nothing was written: there is no block ${error.missing} in the paper now (the person may have changed it). ${context ? `What comment ${at} is on now:\n\n${contextOf(context)}` : `None of the blocks comment ${at} was on is left: read the paper for its blocks.`}`);
            }
            now = one.next; alsos.push(one.also); written.push(...one.fresh.map((made) => made.attrs.id));
          }
          set(room, now.length ? now : [room.format.empty()], name, () => { for (const also of alsos) also?.(); });
        }
        if (words) await room.markup.answer(thread.id, { n: at ?? null, text: words, by: name });
        const done = resolve ? await room.markup.answer(thread.id, { n: at, resolved: true, by: name }) : null;
        await room.markup.open();
        if (room.seats?.has(alias(name))) sit(room, alias(name), null);
        return { item: thread.id, n: at ?? null, blocks: written, replied: Boolean(words), resolved: Boolean(resolve), ...(done ? { handled: done.state === "handled" } : {}) };
      });
    },
    /** An image is kept beside the paper, under a name its block holds in place of the bytes. */
    async keepImage(id, bytes) {
      const entry = await entryOf(id), kind = Buffer.isBuffer(bytes) && bytes.length ? sniff(bytes) : null;
      if (!KINDS[entry.kind].images) throw fault(400, `${entry.name} is a ${KINDS[entry.kind].noun}, which holds no images`);
      if (!kind) throw fault(415, "That is not a PNG, JPEG, GIF, WebP or AVIF image");
      const name = `${crypto.createHash("sha256").update(bytes).digest("hex").slice(0, 16)}.${kind}`, file = path.join(entry.side, "images", name);
      if (!await fs.stat(file).catch(() => null)) await writePrivateFile(file, bytes);
      return { name };
    },
    /** One of the paper's images, with what it is. */
    async image(id, name) {
      const entry = await entryOf(id), missing = () => fault(404, "This paper has no such image");
      if (!IMAGE_NAME.test(name)) throw missing();
      return { bytes: await fs.readFile(path.join(entry.side, "images", name)).catch(() => { throw missing(); }), type: IMAGE_TYPES[name.split(".")[1]] };
    },
    /** The paper's Markup store: its comments, each a thread. */
    markup: async (id) => (await held(id)).markup,
    async handleUpgrade(id, request, socket, head) {
      const kept = await current(id, "live").catch(() => null);
      if (!kept) return socket.destroy();
      sockets.handleUpgrade(request, socket, head, (peer) => {
        startWebSocketKeepalive(peer);
        peer.on("close", () => kept.peers.delete(peer));
        peer.on("message", (data, binary) => {
          // A frame that is not what document-format.js says ends the socket, never the hub.
          try {
            if (!binary) {
              const { client, name, format, holds } = JSON.parse(data);
              // A page loaded before the format grew would delete the blocks it cannot draw: it is kept out until it is reloaded.
              // So is one whose editor holds other things than this kind does (ArtifactKind `holds`).
              const kind = KINDS[kept.entry.kind];
              if (format !== kind.live.format || (kind.blocks && holding(holds) !== holding(kind.holds))) return peer.close(4426, `This page is older than the ${kind.noun}: reload it`);
              peer.author = [String(Number(client)), String(name).slice(0, 80)];
              if (!kept.peers.has(peer)) { kept.peers.add(peer); peer.send(frame(FRAME.have, Y.encodeStateVector(kept.doc))); if (kept.seats?.size) seated(kept, [peer]); }
            }
            else if (!kept.peers.has(peer)) peer.close(1003, "Name the client first");
            else if (data[0] === FRAME.have) peer.send(frame(FRAME.update, Y.encodeStateAsUpdate(kept.doc, data.subarray(1))));
            else if (data[0] === FRAME.update) {
              Y.applyUpdate(kept.doc, data.subarray(1), peer);
              if (peer.author && kept.authors.get(peer.author[0]) !== peer.author[1]) kept.authors.set(...peer.author);
            }
          } catch { peer.close(1003, "Not a document frame"); }
        });
      });
    },
    async close() {
      clearInterval(looking);
      for (const waiting of rescans.values()) clearTimeout(waiting);
      for (const peer of sockets.clients) peer.close(1012, "Conduit is restarting");
      for (const kept of await Promise.all([...rooms.values()].map((loading) => loading.catch(() => null)))) if (kept?.doc) { clearTimeout(kept.saving); await kept.work(() => save(kept)).catch((error) => console.error(`Could not save the paper ${kept.entry.name}`, error)); }
    },
  };
}

export function registerDocumentRoutes(app, documents) {
  app.get("/v0/projects/:project/artifacts", async (request, response) => response.json({ artifacts: await documents.list(request.params.project) }));
  app.post("/v0/projects/:project/artifacts", async (request, response) => {
    if (typeof request.body?.path === "string") return response.json(await documents.at(request.params.project, request.body.path, { adopt: request.body.adopt === true }));
    response.status(201).json(await documents.create(request.params.project, request.body));
  });
  app.get("/v0/document/:id", async (request, response) => {
    if (request.query.as === "about") return response.json(await documents.about(request.params.id));
    // As data, never as a page of the hub's: a site's scripts are run only in the frame its pane gives it.
    if (request.query.as === "site") return response.json(await documents.site(request.params.id, typeof request.query.have === "string" ? request.query.have : undefined));
    const range = typeof request.query.range === "string" ? request.query.range : undefined, read = await documents.read(request.params.id, request.query.as, range);
    if (typeof read === "string") response.type((await documents.about(request.params.id)).changes === "cells" ? "text/csv" : "text/markdown").send(read); else response.json(read);
  });
  app.post("/v0/document/:id/cells", async (request, response) => response.json(await documents.cells(request.params.id, request.body)));
  app.post("/v0/document/:id/thread", async (request, response) => response.json(await documents.thread(request.params.id)));
  app.get("/v0/document/:id/connections", async (request, response) => response.json(await documents.connections(request.params.id)));
  app.put("/v0/document/:id/lead", async (request, response) => {
    const name = request.body?.name;
    if (name !== null && typeof name !== "string") throw fault(400, "The lead is { name: a listener's name, or null for the artifact's own thread }");
    response.json(await documents.leader(request.params.id, name));
  });
  app.put("/v0/document/:id/connections/:chat", async (request, response) => response.json(await documents.connect(request.params.id, request.params.chat)));
  app.delete("/v0/document/:id/connections/:chat", async (request, response) => response.json(await documents.connect(request.params.id, request.params.chat, false)));
  app.get("/v0/chats/:chat/connections", (request, response) => response.json({ connections: documents.connectedTo(request.params.chat) }));
  app.patch("/v0/document/:id", async (request, response) => response.json(await documents.rename(request.params.id, request.body?.name)));
  app.delete("/v0/document/:id", async (request, response) => { await documents.remove(request.params.id); response.status(204).end(); });
  app.post("/v0/document/:id/blocks", async (request, response) => response.json(await documents.edit(request.params.id, request.body)));
  app.post("/v0/document/:id/stop", async (request, response) => response.json(await documents.stop(request.params.id, String(request.body?.item ?? ""))));
  app.post("/v0/document/:id/answer", async (request, response) => response.json(await documents.answer(request.params.id, request.body ?? {})));
  app.post("/v0/document/:id/images", express.raw({ type: "image/*", limit: IMAGE_MAX }), async (request, response) => response.status(201).json(await documents.keepImage(request.params.id, request.body)));
  // Drawn by an <img>, never run: no other type, no script, no page of the hub's.
  app.get("/v0/document/:id/images/:name", async (request, response) => {
    const { bytes, type } = await documents.image(request.params.id, request.params.name);
    response.set({ "content-type": type, "x-content-type-options": "nosniff", "content-security-policy": "default-src 'none'; sandbox", "cache-control": "private, max-age=31536000, immutable" }).send(bytes);
  });
  app.get("/v0/document/:id/suggestions", async (request, response) => response.json({ suggestions: await documents.suggestions(request.params.id) }));
  app.post("/v0/document/:id/changes", async (request, response) => {
    const { op, thread, key } = request.body ?? {};
    if ((op === "accept" || op === "reject") && typeof key === "string") return response.json(await documents[op](request.params.id, key));
    if (op !== "revert" || typeof thread !== "string") throw fault(400, "A change is taken back with { op: \"revert\", thread: \"<item>/<n>\" }, a suggestion settled with { op: \"accept\" | \"reject\", key: \"suggestion/<id>\" }");
    response.json(await documents.revert(request.params.id, thread));
  });
}
