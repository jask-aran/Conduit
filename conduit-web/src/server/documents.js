import { execFile } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { getSchema } from "@tiptap/core";
import { MarkdownManager } from "@tiptap/markdown";
import { WebSocketServer } from "ws";
import { updateYFragment, yXmlFragmentToProseMirrorRootNode } from "y-prosemirror";
import * as Y from "yjs";
import { excludeConduitFromGit } from "../attachment-store.js";
import { AUTHORS, BLOCK_TYPES, CHANGES, FRAGMENT, FRAME, PROPERTIES, blockId, documentExtensions, frame } from "../document-format.js";
import { remoteNode } from "../place.js";
import { writePrivateFile } from "../private-file.js";
import { createMarkupStore } from "./markup-store.js";
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
 * A site is the second kind of artifact: one HTML file, <name>.site.html, that an agent writes with its own tools and the
 * person sees drawn. The hub holds no live copy of it: it reads the file when a pane asks, and keeps only its comments
 * and its chats. Its id is in the file when the file says one (a meta tag, written when Conduit makes the file) and is
 * otherwise kept by the file's path, since the hub writes nothing into a file an agent is at work on.
 *
 * An artifact is tied to chats (links.json, beside its state). Its mated thread is its own chat, the paper's second view and
 * never in the project's list of chats, made when it is first asked for or first sent a comment: the listener named
 * `conduit`, the first one, so a comment goes to it unless the person says otherwise. A chat the person connected is a
 * listener by its title. The hub holds both itself: a comment sent to one is written into that chat as a notice, which
 * starts its agent on it; what the agent answers with is the CLI, as for any session. A session Conduit does not run
 * keeps `wait`.
 */
const SAVE_AFTER_MS = 500, LOOK_EVERY_MS = 2_000, SCAN_AFTER_MS = 3_000, FAR_SCAN_MS = 15_000;
const MATED = "conduit", SCRIPT = path.resolve(import.meta.dirname, "../../../scripts/conduit-markup.mjs");
const KINDS = { paper: ".paper", site: ".site.html" }, ID = /^[a-z0-9-]{1,64}$/, WALK = { entries: 20_000, depth: 6 };
const kindOf = (at) => Object.keys(KINDS).find((kind) => at.endsWith(KINDS[kind])), nameOf = (at) => path.basename(at, KINDS[kindOf(at)]);
const SITE_ID = /<meta\s+name=["']conduit-artifact["']\s+content=["']([a-z0-9-]{1,64})["']/i;
const escaped = (text) => text.replace(/[&<>"]/g, (character) => `&#${character.charCodeAt(0)};`);
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
/** Every artifact's file under a folder, by a walk that `ls(dir)` feeds with a directory's `{ name, file, dir }` entries. */
async function walk(ls) {
  const found = [], queue = [["", 0]];
  for (let seen = 0; queue.length && seen < WALK.entries;) {
    const [dir, depth] = queue.shift();
    for (const entry of await ls(dir)) {
      seen += 1;
      const at = dir ? `${dir}/${entry.name}` : entry.name;
      if (entry.file && kindOf(entry.name)) found.push(at);
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
function localDisk(root) {
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
    files: async () => await run("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard", "--", ...Object.values(KINDS).map((ending) => `*${ending}`)], { cwd: root, maxBuffer: 8 * 1024 * 1024, timeout: 15_000 }).then(({ stdout }) => stdout.split("\0").filter(Boolean), () => null)
      ?? walk(async (dir) => (await fs.readdir(at(dir), { withFileTypes: true }).catch(() => [])).map((entry) => ({ name: entry.name, file: entry.isFile(), dir: entry.isDirectory() }))),
  };
}
/** The same over a device's folder (`host`: workspace-host.js's). It has no time a file was made, a link is not followed there at all, and a folder that cannot be listed fails the listing (a part of it would read as papers deleted). */
function deviceDisk(host) {
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
    files: async () => (await host.files({ exclude: ["node_modules", ".conduit"], limit: WALK.entries }))?.filter(kindOf)
      ?? walk(async (dir) => (await host.list(dir, { limit: WALK.entries }).catch((error) => dir && ["ENOENT", "permission_denied"].includes(error.code) ? [] : Promise.reject(error)) ?? []).map((entry) => ({ name: entry.name, file: entry.type === "file", dir: entry.type === "directory" }))),
  };
}
const spot = (entry) => entry.disk.at(entry.path);
const hash = (text) => crypto.createHash("sha256").update(text).digest("hex");
const shown = ({ id, kind, name, path: at, project }) => ({ id, kind, name, path: at, project });

/**
 * `chats`: () => the hub's chats, once it has them: `open({ workspace, title, mark })` makes one, `get(id)` is its summary, `notify(id, text)` writes a notice into it.
 * `devices`: (project) => the host of a folder on another device.
 */
export function createDocuments({ dataRoot, projects, changed = () => {}, chats = () => null, devices = null }) {
  const folder = path.join(dataRoot, "documents"), extensions = documentExtensions(), schema = getSchema(extensions), markdown = new MarkdownManager({ extensions });
  const sockets = new WebSocketServer({ noServer: true }), rooms = new Map(), known = new Map(), scans = new Map(), rescans = new Map(), scanned = new Map();
  const withIds = (node) => ({ ...node, ...(BLOCK_TYPES.includes(node.type) ? { attrs: { ...node.attrs, id: node.attrs?.id ?? blockId() } } : {}), ...(node.content ? { content: node.content.map(withIds) } : {}) });
  const parse = (text) => [...schema.nodeFromJSON(withIds(markdown.parse(text))).content.content];
  const blocksOf = (room) => [...yXmlFragmentToProseMirrorRootNode(room.blocks, schema).content.content];
  const empty = () => schema.nodes.paragraph.create({ id: blockId() });
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

  /** A paper's file: each block on a line of its own, so a diff of the file is a diff of blocks; its front matter (properties) before them, where it has any. */
  const written = (id, blocks, properties = {}) => `{"format":"conduit-document","version":1,"id":${JSON.stringify(id)},${Object.keys(properties).length ? `"properties":${JSON.stringify(properties)},` : ""}"blocks":[\n${blocks.map((block) => JSON.stringify(block.toJSON())).join(",\n")}\n]}\n`;
  /** What a file holds. A block with no id, or a second with the same one (a line copied by hand), is given its own. A file that is not a paper is said to be so, never guessed at. */
  const paper = (text, name) => {
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
    } catch (error) { throw fault(422, `${name}${KINDS.paper} is not a paper Conduit can read: ${error.message}`); }
  };

  const place = (project) => {
    const far = Boolean(remoteNode(project));
    if (far && !(devices && project.chatRoot)) throw fault(501, "This hub cannot reach papers in a project on another device");
    return { disk: far ? deviceDisk(devices(project)) : localDisk(path.resolve(project.workingRoot)), side: path.join(path.resolve(project.chatRoot || project.workingRoot), ".conduit", "artifacts") };
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
  /** The paper in this file is known. One that carries no id, or the id of a paper that is still in another file (a copy), is given its own, written into it. */
  async function adopt(project, at) {
    const { disk, side } = place(project), kind = kindOf(at), name = nameOf(at);
    await disk.inside(at);
    // A site's file is its agent's to write, and one written whole may no longer say its id: the id its path has is the site's, before what the file
    // says, which is read only for a path that has none (a new file, or one moved by hand). An id is one path's.
    let id = kind === "site" ? (await paths(side, () => {}))[at] : null;
    if (id && !await disk.stat(at)) throw Object.assign(new Error(`No file ${at}`), { code: "ENOENT" });
    if (!id) {
      const text = await disk.read(at), read = kind === "paper" ? paper(text, name) : { id: SITE_ID.exec(text)?.[1] ?? null };
      const other = read.id && known.get(read.id), copy = other && spot(other) !== disk.at(at) && await other.disk.stat(other.path).catch(() => true);
      id = read.id && !copy ? read.id : crypto.randomBytes(8).toString("hex");
      if (kind === "paper" && id !== read.id) await disk.write(at, written(id, read.blocks, read.properties));
      if (kind === "site") await paths(side, (kept) => { for (const was of Object.keys(kept)) if (kept[was] === id) delete kept[was]; kept[at] = id; });
    }
    const links = known.get(id)?.links ?? await fs.readFile(path.join(side, id, "links.json"), "utf8").then(JSON.parse).then((kept) => ({ thread: kept.thread ?? null, connections: [...kept.connections ?? []] }), () => ({ thread: null, connections: [] }));
    return known.set(id, { id, kind, name, path: at, project: project.id, disk, side: path.join(side, id), links }).get(id);
  }
  /**
   * A project's folder is read for its papers once, and again when one of them is found missing. The oldest file is read first, so of a paper and its copy the
   * paper keeps the id (a device does not say when a file was made: there the first by path keeps it).
   */
  const scan = (project) => scans.get(project.id) ?? scans.set(project.id, (async () => {
    const { disk } = place(project), all = disk.far ? [] : await here(), mine = (await disk.files()).filter((at) => disk.far || owner(path.join(disk.key, at), all)?.id === project.id).sort();
    // A device that drops while it is read fails the reading: files it did not answer for are not papers deleted.
    const found = await Promise.all(mine.map(async (at) => ({ at, born: (await disk.stat(at).catch((error) => disk.far ? Promise.reject(error) : null))?.born }))), kept = new Set();
    // A paper whose file cannot be read just now (a merge's conflict in it) is still that paper, at that path.
    const still = (at) => [...known.values()].find((entry) => entry.project === project.id && entry.path === at)?.id;
    for (const { at } of found.filter((file) => file.born !== undefined).sort((a, b) => a.born - b.born)) kept.add(await adopt(project, at).then((entry) => entry.id, (error) => disk.far && !error.status ? Promise.reject(error) : still(at)));
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
  /** Who the hub holds a paper's comments for: its mated thread first, then each connected chat by its title (the first to have a title keeps it). */
  const heldFor = (id) => {
    const entry = known.get(id), names = new Set([MATED]);
    if (!entry || !chats()) return [];
    return [{ name: MATED, chat: entry.links.thread }, ...entry.links.connections.flatMap((chat) => {
      const title = chats().get(chat)?.title, name = title && !names.has(title) ? title : `chat ${chat.slice(0, 8)}`;
      if (!chats().get(chat) || names.has(name)) return [];
      names.add(name);
      return [{ name, chat }];
    })];
  };
  /**
   * What the hub does for a listener it holds, as the CLI's `wait` does for a session: the item is taken in its name,
   * each comment is marked as being worked on, and the chat is told where the item is. `said`: what the person wrote
   * back on an item already handed over.
   */
  async function hand(room, item, to, said) {
    // The mated thread is made again where it has gone (an empty chat is not kept): what is sent to the paper always has a chat to reach.
    const dir = path.join(room.entry.side, "markup", item), chat = to.name === MATED ? (await mated(room.id)).id : to.chat, at = new Date().toISOString();
    // The name is the file's, which anyone who can write the folder chooses: it reaches the agent as a quoted name, never as lines of its own.
    const name = JSON.stringify(room.entry.name.replace(/\s+/g, " ").slice(0, 120)), taken = path.join(dir, "taken.json");
    if (said) return host().notify(chat, `On the ${room.entry.kind} ${name}, markup item ${item}: ${said}\nThe item is ${path.join(dir, "item.json")}; answer with \`node ${SCRIPT} reply ${item} [n] "<words>"\`.`);
    // Taken once: a session that took it first (a `wait` under the same name) keeps it, and the chat is told nothing.
    const mine = await fs.writeFile(taken, `${JSON.stringify({ name: to.name, held: true, chat, at })}\n`, { flag: "wx" }).then(() => true, async () => (await fs.readFile(taken, "utf8").then(JSON.parse).catch(() => null))?.held === true);
    if (!mine) return;
    // What the chat has not been told of yet: the comments with no line saying one is being worked on.
    const told = new Set((await fs.readFile(path.join(dir, "thread.jsonl"), "utf8").catch(() => "")).split("\n").filter(Boolean).map((line) => JSON.parse(line)).filter((line) => line.working).map((line) => line.n));
    const comments = JSON.parse(await fs.readFile(path.join(dir, "item.json"), "utf8")).comments ?? [], fresh = comments.filter((comment) => !told.has(comment.n));
    if (!fresh.length) return;
    // A chat that cannot be told has not taken it: the item goes back to waiting, which is what the person then reads.
    await host().notify(chat, `${fresh.length === comments.length ? "The person" : "The person added to what they"} sent you ${fresh.length === 1 ? "a comment" : `${fresh.length} comments`} on the ${room.entry.kind} ${name}${fresh.length === comments.length ? "" : ` (${fresh.map((comment) => comment.n).join(", ")})`}. Read ${path.join(dir, "item.json")} (its \`read\` says how) and do what it asks.`)
      .catch(async (error) => { if (!told.size) await fs.rm(taken, { force: true }); throw error; });
    await fs.appendFile(path.join(dir, "thread.jsonl"), fresh.map((comment) => `${JSON.stringify({ at, from: "agent", by: to.name, n: comment.n, working: true })}\n`).join(""));
  }

  /** The file is the paper: what it holds that the live copy does not is taken, as the smallest change that makes the live copy so. */
  async function take(room) {
    const { disk, path: at } = room.entry, text = await disk.read(at);
    if (text !== room.text) {
      const read = paper(text, room.entry.name);
      if (read.id && read.id !== room.id) throw Object.assign(new Error("Another paper's file is at this path"), { other: true });
      // What was written while the folder could not be reached is owed to a file that has not changed since: the kept state is then the paper, and the file takes it.
      if (!(room.owed && room.owed === hash(text) && room.blocks.length) && (!room.blocks.length || written(room.id, read.blocks, read.properties) !== written(room.id, blocksOf(room), room.properties.toJSON()))) set(room, read.blocks, undefined, () => { for (const name of room.properties.keys()) if (!(name in read.properties)) room.properties.delete(name); for (const [name, value] of Object.entries(read.properties)) if (room.properties.get(name) !== value) room.properties.set(name, value); });
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
    if (!now || spot(now) === spot(room.entry)) return shut(room, "This paper's file is gone");
    room.entry = now;
    await take(room).catch(unread);
  }
  async function save(room) {
    await look(room);
    if (room.gone) return;
    const text = written(room.id, blocksOf(room), room.properties.toJSON()), { disk, path: at } = room.entry;
    const owed = path.join(room.entry.side, "unwritten");
    if (!room.unread && !room.away && text !== room.text) {
      // A device that goes as it is written to is away: the state is kept, and the file is written when it answers.
      await disk.write(at, text).then(async () => { room.text = text; room.seen = (await disk.stat(at))?.mtimeMs; if (disk.far) await fs.rm(owed, { force: true }); }, (error) => { if (!disk.far) throw error; room.away = error.message; });
    }
    await writePrivateFile(path.join(room.entry.side, "state.yjs"), Y.encodeStateAsUpdate(room.doc));
    // Kept across a restart: which file the state is ahead of, so the file read then is not taken over what was written here.
    if (room.away && room.text !== undefined && text !== room.text) await writePrivateFile(owed, hash(room.text));
  }
  function shut(room, why) {
    clearTimeout(room.saving);
    room.gone = true;
    rooms.delete(room.id);
    for (const peer of room.peers) peer.close(4404, why);
  }
  /**
   * An artifact's comments: a Markup store of its own, and what the hub does for the listeners it holds. `where`: what an
   * item's summary says after the artifact's name; `about`: lines for the item's `read` (both read at each Send: a site
   * is renamed and moved while its store, which holds what is being marked, goes on); `seen`: told the open threads on each look at them.
   */
  function markupOf(room, where, about, seen = () => {}) {
    const { id, entry } = room, store = createMarkupStore({
      folder: path.join(entry.side, "markup"), listeners: path.join(dataRoot, "feedback"), on: () => `the ${entry.kind} ${room.entry.name} ${where()}`,
      held: async () => heldFor(id), done: (item) => `node ${SCRIPT} done ${item}`,
      about: () => [`Where a line here says \`node scripts/conduit-markup.mjs\`, run \`node ${SCRIPT}\`: it works from any folder.`, ...about()],
      log: (line) => console.log(JSON.stringify({ ...line, type: "conduit.document.markup", document: id })),
    });
    const open = async () => { const items = await store.open(); seen(items); return items; };
    // What is sent to a listener the hub holds, or written back on an item one of them took, is handed to its chat. The person's page is answered first: a chat that cannot be started is said in the log, and the item stays in the folder.
    // Who holds an item is the chat that took it, whatever it is called now: a chat's listener name is its title, which changes.
    const held = async (name, item) => {
      const all = heldFor(id), took = item && await fs.readFile(path.join(entry.side, "markup", item, "taken.json"), "utf8").then(JSON.parse).catch(() => null);
      return took?.held ? took.name === MATED ? all[0] : all.find((one) => one.chat === took.chat) && { name: took.name, chat: took.chat } : all.find((one) => one.name === name);
    };
    const failed = (error) => console.error(`Could not hand a comment on the ${entry.kind} ${room.entry.name} to its chat: ${error.message}`);
    return { ...store, open,
      send: async (item, body) => { const sent = await store.send(item, body), to = await held(sent.handed?.to?.name, sent.id); if (to) void hand(room, sent.id, to).catch(failed); return sent; },
      say: async (item, body) => {
        const said = await store.say(item, body), to = await held(said.by, item);
        await open();
        if (to && (body?.text || body?.resolved === false)) void hand(room, item, to, body.text ? `the person wrote back${Number.isInteger(body.n) ? ` on comment ${body.n}` : ""}: ${String(body.text).trim()}` : `the person reopened comment ${body.n}.`).catch(failed);
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
    const file = () => { const now = known.get(entry.id) ?? room.entry; return now.disk.far ? `${now.path} in the project's folder, on the device that holds it` : now.disk.at(now.path); };
    room.markup = markupOf(room, () => `(the file ${file()})`, () => [`This site is one HTML file, ${file()}, which the person sees drawn in a pane. To answer a comment, change that file with your own tools: the pane shows the new version a moment after it is saved. Leave its \`conduit-artifact\` meta tag as it is, and do not rename or move the file.`,
      "A comment's `under.elements` names what of the site its marks were drawn over, each as its parent and itself (`section#plans > h2`) with the text it shows; `rect` and `drawings` are in the pixels of the person's window, not of the site.",
      "If you have the tool `conduit_paper`, its comments, reply and resolve work on a site by its id."]);
    return room;
  }
  async function load(entry) {
    if (entry.kind === "site") return loadSite(entry);
    const { id } = entry, doc = new Y.Doc(), room = { id, entry, doc, blocks: doc.getXmlFragment(FRAGMENT), authors: doc.getMap(AUTHORS), changes: doc.getMap(CHANGES), properties: doc.getMap(PROPERTIES), peers: new Set(), agents: new Map(), queue: Promise.resolve() };
    /** One at a time: a save, a look at the file and a rename never cross. */
    room.work = (job) => (room.queue = room.queue.then(job, job));
    await fs.mkdir(entry.side, { recursive: true });
    if (!entry.disk.far) void excludeConduitFromGit(entry.disk.key).catch(() => {});
    const kept = await fs.readFile(path.join(entry.side, "state.yjs")).catch(() => null);
    if (kept) Y.applyUpdate(doc, kept);
    room.owed = await fs.readFile(path.join(entry.side, "unwritten"), "utf8").catch(() => null);
    await take(room);
    // A change is accepted when the person resolves its comment (a session's resolve accepts nothing); read on every look at the open threads, which hold every comment the person has not resolved.
    room.markup = markupOf(room, () => `(document ${id})`, () => ["If you have the tool `conduit_paper`, it does the same without a shell: read, replace, insert, delete (with `for`), reply and resolve.", "To answer a comment by changing the document, add `--for <this item's id>/<n>` to `document replace`, `insert` or `delete`: the person then sees which blocks changed for comment n and can take the change back. Resolving the comment yourself does not accept the change for the person: the comment stays in their margin, marked as resolved by you, with the change shown, until they resolve it too."], (items) => {
      const unsettled = new Set(items.flatMap((item) => item.comments.filter((comment) => !(comment.resolved && comment.resolvedBy === "person")).map((comment) => `${item.id}/${comment.n}`)));
      const settled = [...room.changes.entries()].filter(([, change]) => !unsettled.has(change.for));
      if (settled.length) doc.transact(() => { for (const [block] of settled) room.changes.delete(block); });
    });
    doc.on("update", (update, origin) => {
      for (const peer of room.peers) if (peer !== origin) peer.send(frame(FRAME.update, update));
      clearTimeout(room.saving);
      room.saving = setTimeout(() => void room.work(() => save(room)).catch((error) => console.error(`Could not save the paper ${room.entry.name}`, error)), SAVE_AFTER_MS);
    });
    // What the file brought that the kept state did not have is kept, and a file read without ids is written with them.
    await save(room);
    return room;
  }
  const held = async (id) => {
    const entry = await entryOf(id);
    if (!rooms.has(id)) { const loading = load(entry); rooms.set(id, loading); loading.catch(() => { if (rooms.get(id) === loading) rooms.delete(id); }); }
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
  const current = async (id) => {
    const entry = await entryOf(id);
    if (entry.kind !== "paper") throw fault(400, `${entry.name} is a ${entry.kind}, which has no blocks: it is the file ${entry.path} in its project's folder, changed as any file is`);
    const room = await held(id); await room.work(() => see(room));
    return room.gone ? (() => { throw fault(404, `No paper ${id}`); })() : room;
  };
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
      return mine().map(shown).sort((a, b) => a.name.localeCompare(b.name));
    },
    /** A new artifact (a paper, empty, or a site that says what it is), in a folder of the project (unsaid: its root). */
    async create(project, { kind = "paper", name, folder: into = "" } = {}) {
      if (typeof kind !== "string" || !Object.hasOwn(KINDS, kind)) throw fault(400, `There is no artifact of the kind ${kind}`);
      const of = await projectOf(project), { disk } = place(of), at = [within(into), `${named(name)}${KINDS[kind]}`].filter(Boolean).join("/"), id = crypto.randomBytes(8).toString("hex");
      await disk.inside(at);
      await disk.create(at, kind === "paper" ? written(id, [empty()]) : SITE(id, nameOf(at))).catch((error) => {
        throw error.code === "EEXIST" ? fault(409, `A ${kind} named ${nameOf(at)} is already there`) : error.code === "ENOENT" ? fault(404, `No folder ${into} in this project`) : error;
      });
      // A new site is not the one that was once at its path.
      if (kind === "site") await paths(place(of).side, (kept) => { delete kept[at]; });
      return told(await adopt(of, at));
    },
    /** The artifact a file of the project is. */
    async at(project, file) {
      const asked = await projectOf(project), far = Boolean(remoteNode(asked)), full = far ? null : path.join(path.resolve(asked.workingRoot), within(file)), of = far ? asked : owner(full, await here()) ?? asked;
      const at = far ? within(file) : path.relative(path.resolve(of.workingRoot), full).split(path.sep).join("/");
      if (!kindOf(at)) throw fault(400, `${file} is not an artifact`);
      const before = listing(of.id), entry = await adopt(of, at).catch((error) => { throw error.code === "ENOENT" ? fault(404, `No file ${file} in this project`) : error; });
      const room = await rooms.get(entry.id)?.catch(() => null);
      if (room) room.entry = entry;
      // Pressing a paper the hub already knows changes nothing, so nobody is told.
      return listing(of.id) === before ? shown(entry) : told(entry);
    },
    /** `trouble`: why what a paper's pane shows may not be what its file holds. */
    async about(id) {
      const entry = await entryOf(id), room = await rooms.get(id)?.catch(() => null);
      return { ...shown(entry), trouble: troubleOf(room) };
    },
    /** A site's HTML as its file holds it now, with a revision that changes when the file does; `have`: the revision the asker shows, which is not sent again. */
    async site(id, have) {
      let entry = await entryOf(id);
      if (entry.kind !== "site") throw fault(400, `${entry.name} is not a site`);
      let stat = await entry.disk.stat(entry.path);
      // A file that has gone may have been moved: the folder is read again, and a site that says its id is found where it is now.
      if (!stat) { await again(entry.project); entry = known.get(id); stat = entry?.kind === "site" ? await entry.disk.stat(entry.path) : null; }
      if (!stat) throw fault(404, "This site's file is gone");
      await entry.disk.inside(entry.path);
      const revision = String(stat.mtimeMs);
      return revision === have ? { revision } : { revision, html: await entry.disk.read(entry.path) };
    },
    /** The paper's mated thread, as a chat's summary. */
    thread: async (id) => ({ chat: await mated(id), project: (await entryOf(id)).project }),
    /** The chats tied to a paper: its mated thread (none until it is made) and those the person connected. */
    async connections(id) {
      const { links } = await entryOf(id);
      return { thread: links.thread && chats()?.get(links.thread) ? links.thread : null, connections: links.connections.flatMap((chat) => { const found = chats()?.get(chat); return found ? [{ chat, title: found.title || "Untitled chat" }] : []; }) };
    },
    /** A chat is connected to a paper, or (`on` false) no longer: the hub then hands it the comments sent to it. */
    async connect(id, chat, on = true) {
      const entry = await entryOf(id);
      if (!host().get(chat)) throw fault(404, `No chat ${chat}`);
      if (chat === entry.links.thread) throw fault(400, "That is the paper's own thread");
      entry.links.connections = [...entry.links.connections.filter((one) => one !== chat), ...(on ? [chat] : [])];
      await fs.mkdir(entry.side, { recursive: true });
      await link(entry);
      return this.connections(id);
    },
    /** What a chat has to do with papers: its project, and the papers it is the thread of or connected to, each with the name it listens under there. */
    of(chat) {
      const found = chat ? chats()?.get(chat) : null;
      return { project: found?.projectId ?? null, papers: found ? [...known.values()].flatMap((entry) => { const as = heldFor(entry.id).find((one) => one.chat === chat)?.name; return as ? [{ id: entry.id, as }] : []; }) : [] };
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
      const entry = await entryOf(id), room = await rooms.get(id)?.catch(() => null), to = [path.dirname(entry.path), `${named(name)}${KINDS[entry.kind]}`].filter((part) => part && part !== ".").join("/");
      const move = async () => {
        if (to !== entry.path && await entry.disk.stat(to)) throw fault(409, `A ${entry.kind} named ${nameOf(to)} is already there`);
        await entry.disk.rename(entry.path, to);
        // An id kept by the file's path goes with it.
        if (entry.kind === "site") await paths(path.dirname(entry.side), (kept) => { if (kept[entry.path] === id) { delete kept[entry.path]; kept[to] = id; } });
        const next = known.set(id, { ...entry, path: to, name: nameOf(to) }).get(id);
        if (room) room.entry = next;
        return next;
      };
      return told(await (room ? room.work(move) : move()));
    },
    /** Its file is deleted. Its comments and history stay in the project's .conduit folder, so a file brought back (from git, say) is the paper it was. */
    async remove(id) {
      const entry = await entryOf(id), room = await rooms.get(id)?.catch(() => null);
      if (room) await room.work(() => shut(room, "This paper was deleted"));
      await entry.disk.remove(entry.path);
      // Deleted here, its path is free: a site an agent later writes there is another one. (One deleted by hand and brought back is still itself.)
      if (entry.kind === "site") await paths(path.dirname(entry.side), (kept) => { if (kept[entry.path] === id) delete kept[entry.path]; });
      known.delete(id);
      await told(entry);
    },
    /** As Markdown, each block under a comment that gives its id; `markdown`: the Markdown alone, to export; `blocks`: the format itself. */
    async read(id, as) {
      const kept = await current(id), blocks = blocksOf(kept);
      const properties = kept.properties.toJSON(), front = Object.keys(properties).length ? `---\n${Object.entries(properties).map(([name, value]) => `${name}: ${JSON.stringify(value)}`).join("\n")}\n---\n\n` : "";
      if (as === "blocks") return { format: "conduit-document", version: 1, id, properties, blocks: blocks.map((block) => block.toJSON()), authors: kept.authors.toJSON(), changes: kept.changes.toJSON() };
      if (as === "markdown") return `${front}${markdown.serialize({ type: "doc", content: blocks.map((block) => block.toJSON()) }).trim()}\n`;
      return `${front}${blocks.map((block) => `<!-- block ${block.attrs.id} -->\n${markdown.serialize({ type: "doc", content: [block.toJSON()] }).trim()}`).join("\n\n")}\n`;
    },
    /**
     * One block changed: `replace` it with the Markdown's blocks (the first keeps its id), `insert` them after it (after `start`: first), or `delete` it.
     * `set` writes its front matter instead.
     * `for` ("<item>/<n>") is the comment it answers: what it changes is then kept in the document's changes until that comment is resolved.
     */
    async edit(id, { op, block, markdown: text = "", by, for: about } = {}) {
      const kept = await current(id), now = blocksOf(kept), at = now.findIndex((candidate) => candidate.attrs.id === block);
      // `set`: one property of its front matter (`block` its name, the Markdown its value as plain text; none removes it).
      if (op === "set") {
        const name = String(block ?? "").trim(), value = String(text).trim();
        if (!name || name.length > 60 || /[\n:]/.test(name)) throw fault(400, "A property's name is a few words, with no colon");
        kept.doc.transact(() => value ? kept.properties.set(name, value.slice(0, 2000)) : kept.properties.delete(name));
        return { properties: kept.properties.toJSON() };
      }
      if (!["replace", "insert", "delete", "set"].includes(op)) throw fault(400, "op is replace, insert, delete or set");
      if (at < 0 && !(op === "insert" && block === "start")) throw fault(404, `No block ${block} in ${id}`);
      const fresh = op === "delete" ? [] : parse(String(text));
      if (op === "replace" && fresh[0]) fresh[0] = fresh[0].type.create({ ...fresh[0].attrs, id: block }, fresh[0].content);
      const next = [...now.slice(0, op === "insert" ? at + 1 : at), ...fresh, ...now.slice(at + 1)], name = typeof by === "string" && by ? by.slice(0, 80) : "agent";
      if (about !== undefined) await kept.markup.thread(String(about).split("/")[0]);
      set(kept, next.length ? next : [empty()], name, about === undefined ? undefined : () => {
        const stamp = { for: String(about), by: name, at: new Date().toISOString() }, had = kept.changes.get(block), gone = op !== "insert" && !fresh.length;
        // The first `before` is the one kept: what is taken back is everything done for the comment, not its last step. A block made for a comment and then deleted leaves nothing to show.
        if (gone && had?.before === null) kept.changes.delete(block);
        else if (op !== "insert") kept.changes.set(block, { ...stamp, before: now[at].toJSON(), ...had, ...(gone ? { after: now[at - 1]?.attrs.id ?? null, at: stamp.at } : {}) });
        for (const made of fresh.slice(op === "replace" ? 1 : 0)) kept.changes.set(made.attrs.id, { ...stamp, before: null });
      });
      return { blocks: fresh.map((made) => made.attrs.id) };
    },
    /** Everything changed for one comment is put back as it was: a changed block is its `before` again, a new one goes, a deleted one returns after the block it followed. */
    async revert(id, thread) {
      const kept = await current(id), blocks = blocksOf(kept), mine = [...kept.changes.entries()].filter(([, change]) => change.for === thread);
      // Deleted blocks return latest first: two that followed the same block then stand in their old order.
      for (const [block, change] of mine.sort((a, b) => String(b[1].at).localeCompare(a[1].at))) {
        const at = blocks.findIndex((candidate) => candidate.attrs.id === block), before = change.before && schema.nodeFromJSON(change.before);
        if (at >= 0) blocks.splice(at, 1, ...(before ? [before] : []));
        else if (before) { const after = blocks.findIndex((candidate) => candidate.attrs.id === change.after); blocks.splice(change.after === null ? 0 : after < 0 ? blocks.length : after + 1, 0, before); }
      }
      set(kept, blocks.length ? blocks : [empty()], undefined, () => { for (const [block] of mine) kept.changes.delete(block); });
      return { blocks: mine.map(([block]) => block) };
    },
    /** The paper's Markup store: its comments, each a thread. */
    markup: async (id) => (await held(id)).markup,
    async handleUpgrade(id, request, socket, head) {
      const kept = await current(id).catch(() => null);
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
    if (typeof request.body?.path === "string") return response.json(await documents.at(request.params.project, request.body.path));
    response.status(201).json(await documents.create(request.params.project, request.body));
  });
  app.get("/v0/document/:id", async (request, response) => {
    if (request.query.as === "about") return response.json(await documents.about(request.params.id));
    // As data, never as a page of the hub's: a site's scripts are run only in the frame its pane gives it.
    if (request.query.as === "site") return response.json(await documents.site(request.params.id, typeof request.query.have === "string" ? request.query.have : undefined));
    const read = await documents.read(request.params.id, request.query.as);
    if (typeof read === "string") response.type("text/markdown").send(read); else response.json(read);
  });
  app.post("/v0/document/:id/thread", async (request, response) => response.json(await documents.thread(request.params.id)));
  app.get("/v0/document/:id/connections", async (request, response) => response.json(await documents.connections(request.params.id)));
  app.put("/v0/document/:id/connections/:chat", async (request, response) => response.json(await documents.connect(request.params.id, request.params.chat)));
  app.delete("/v0/document/:id/connections/:chat", async (request, response) => response.json(await documents.connect(request.params.id, request.params.chat, false)));
  app.get("/v0/chats/:chat/connections", (request, response) => response.json({ connections: documents.connectedTo(request.params.chat) }));
  app.patch("/v0/document/:id", async (request, response) => response.json(await documents.rename(request.params.id, request.body?.name)));
  app.delete("/v0/document/:id", async (request, response) => { await documents.remove(request.params.id); response.status(204).end(); });
  app.post("/v0/document/:id/blocks", async (request, response) => response.json(await documents.edit(request.params.id, request.body)));
  app.post("/v0/document/:id/changes", async (request, response) => {
    if (request.body?.op !== "revert" || typeof request.body.thread !== "string") throw fault(400, "A change is taken back with { op: \"revert\", thread: \"<item>/<n>\" }");
    response.json(await documents.revert(request.params.id, request.body.thread));
  });
}
