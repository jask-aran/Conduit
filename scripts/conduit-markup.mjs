#!/usr/bin/env node
// Reads the markup folder and nothing else, so it needs no session and no running hub. The folder is
// CONDUIT_MARKUP_DIR, else <CONDUIT_DATA_ROOT>/feedback, else ./.markup where `serve` made one, else Conduit's own.
// Beside Conduit's feedback folder, each paper's comments are items too, in its project's folder; the hub lists those
// folders in documents/roots.json.
//
// `serve [port]` is the receiver for a project with no hub (conduit-web/src/server/markup-store.js on its own): the
// markup tool's routes on this machine only, writing ./.markup, so wait/take/done work there as they do here.
// `serve [port] one-way` takes markup from people owed no answer: it serves no thread and takes nothing written back.
// An item is taken by one waiter (taken.json, written exclusively). `wait` takes only what was handed to its name;
// everything else stays in the folder until `take <id>`.
//
// An item is a thread: `reply <id> [n] <words>` answers the person (about comment n, or the item as a whole) in
// <id>/thread.jsonl, where the tool reads it; what they write back there ends the same name's next `wait`, and so
// does a comment added to a live item. `resolve <id> <n>` settles one comment; the last one settled handles the item.
// `answer <id> [n] --json '{"edits":[…],"reply":"…","resolve":true}'` does all of that for one comment at once; on an
// artifact it goes through the hub, which makes every edit or none.
//
// `document <list|new|read|replace|insert|delete|set> …` is the one part that needs the hub running: the hub holds a paper
// (a Conduit document, a .paper file in a project's folder) and is the only way to it, so these sign in as
// `conduit-auth api` does. `list <project>` prints a project's artifacts, each id first; `new <name> --project <id>`
// makes a paper and prints its id (`--kind markdown`: a Markdown file, a paper whose file is a plain .md; `--kind sheet`: a sheet; `--kind site`: a site,
// one HTML file an agent then edits as a file, which the block commands do not take). `read` prints the document as
// Markdown, each block under a comment that gives its id; the others change one block, taking Markdown from their last
// arguments or from stdin, and print the ids of the blocks written. `--as <name>` says who writes; `--for <item>/<n>`
// says which comment the edit answers; `--suggest` makes it a suggestion the person accepts or rejects (`--suggest <key>`
// adds to that one). `suggestions <id>` lists those standing; `accept|reject <id> <key>` settles one.
//
// A sheet (`--kind sheet`, a .csv whose cells can hold formulas) has its own commands: `document cells <id> [range] [--values]` prints it as CSV
// of what was typed (`--values`: of what formulas compute); `document set <id> <A1> <value>`, `document fill <id> <range> [value]` (or
// --json '{"values":[[…]]}'), and `document rows|cols <id> insert|delete <row number|column letter> [count]` change it, with --as and --for.
// A sheet with tabs: each takes `--tab <name>` (or an address that names one, `Data!B4`); `document tabs <id>` lists them, and
// `document tabs <id> add|rename|delete|move|hide|show …` changes them.
//
// `wait <name> --stay` does not end: it prints one line for each thing that comes, so a session whose harness wakes it
// on a line of output (Claude Code's Monitor) stays listed the whole time. Plain `wait` ends at the first, for a
// harness that wakes only when a command ends.
import fs from "node:fs/promises";
import { existsSync, rmSync, watch } from "node:fs";
import os from "node:os";
import path from "node:path";

const local = path.resolve(".markup");
const [command, argument, ...rest] = process.argv.slice(2);
const folder = process.env.CONDUIT_MARKUP_DIR ? path.resolve(process.env.CONDUIT_MARKUP_DIR)
  : process.env.CONDUIT_DATA_ROOT ? path.join(path.resolve(process.env.CONDUIT_DATA_ROOT), "feedback")
  : command === "serve" || existsSync(local) ? local
  : path.join(os.homedir(), ".conduit", "data", "feedback");
const waiting = path.join(folder, ".waiting");
const exists = (file) => fs.stat(file).then(() => true, () => false);
const alive = (pid) => { try { process.kill(Number(pid), 0); return true; } catch (error) { return error.code === "EPERM"; } };
const script = path.relative(process.cwd(), process.argv[1]) || process.argv[1];

/** Read each time: a paper's folder is listed once the hub has seen the paper. */
const roots = async () => path.basename(folder) !== "feedback" ? [folder]
  : [folder, ...await fs.readFile(path.join(path.dirname(folder), "documents", "roots.json"), "utf8").then(JSON.parse, () => [])];
/** An id starts with when it was started, so id order is time order across roots; a folder still being written starts with a dot. */
async function items() {
  const found = [];
  for (const root of await roots()) {
    for (const name of (await fs.readdir(root).catch(() => [])).filter((name) => !name.startsWith("."))) {
      const dir = path.join(root, name);
      if (!await exists(path.join(dir, "item.json"))) continue;
      found.push({ id: name, dir, item: path.join(dir, "item.json"), state: await exists(path.join(dir, "handled.json")) ? "handled" : await exists(path.join(dir, "taken.json")) ? "taken" : "waiting" });
    }
  }
  return found.sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}
const find = async (id) => (await items()).find((entry) => entry.id === path.basename(id));
const claim = (entry, name) => fs.writeFile(path.join(entry.dir, "taken.json"), `${JSON.stringify({ at: new Date().toISOString(), pid: process.pid, ...(name ? { name } : {}) })}\n`, { flag: "wx" })
  .then(() => true, (error) => { if (error.code === "EEXIST") return false; throw error; });
/** How much of an item its session has been handed: what the person wrote back, and (a live item grows) its comments. */
const handedSoFar = (dir) => fs.readFile(path.join(dir, "agent-read.json"), "utf8").then(JSON.parse, () => ({}));
const noteHanded = (dir, read) => fs.writeFile(path.join(dir, "agent-read.json"), `${JSON.stringify(read)}\n`);

async function take(name) {
  for (const entry of await items()) {
    if (entry.state !== "waiting") continue;
    if (JSON.parse(await fs.readFile(entry.item, "utf8")).handed?.to?.name !== name) continue;
    if (await claim(entry, name)) return entry;
  }
  return null;
}
const thread = async (dir) => (await fs.readFile(path.join(dir, "thread.jsonl"), "utf8").catch(() => "")).split("\n").filter(Boolean).map((line) => JSON.parse(line));
/** What the person has written back on an item this name took and has not finished, not yet handed to it. */
async function writtenBack(name) {
  for (const entry of await items()) {
    if (entry.state !== "taken") continue;
    const dir = entry.dir;
    if (JSON.parse(await fs.readFile(path.join(dir, "taken.json"), "utf8")).name !== name) continue;
    const said = (await thread(dir)).filter((message) => message.from === "person"), comments = JSON.parse(await fs.readFile(entry.item, "utf8")).comments;
    const read = await handedSoFar(dir), person = read.person ?? 0, seen = read.comments ?? comments.length;
    if (said.length <= person && comments.length <= seen) continue;
    await noteHanded(dir, { person: said.length, comments: comments.length });
    return { entry, said: said.slice(person), added: comments.slice(seen) };
  }
  return null;
}
/** The artifact an item is on, where it is one: an artifact keeps its comments in <artifact>/markup/<item>. */
const artifactOf = (entry) => path.dirname(entry.dir) !== folder && path.basename(path.dirname(entry.dir)) === "markup" ? path.basename(path.dirname(path.dirname(entry.dir))) : undefined;
const quiet = (fields) => Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined && value !== null && value !== ""));
/** One comment as a session is handed it: what it asks, the text it quotes, and what it was on when it was sent (a paper's blocks and their text, a sheet's range by its A1 address, a site's elements). */
const brief = (comment) => quiet({ n: comment.n, words: comment.comment, quote: comment.quote, blocks: comment.under?.blocks, cells: comment.under?.cells ? comment.under.range ?? comment.under.cells : undefined, context: comment.under?.text ?? comment.under?.elements });
const answerWith = (entry, n, paper) => `node ${script} answer ${entry.id}${n ? ` ${n}` : ""} --json '{${paper ? `"edits":[{"op":"replace","at":"<block>","markdown":"…"}],` : ""}"reply":"…","resolve":true}'`;
/**
 * What a session is handed: one JSON line holding everything it needs to answer (the comments, what the person wrote back), then one line saying how
 * to answer, with the item's file last, for its pictures and the rest.
 */
async function handing(entry, comments, said = []) {
  const all = JSON.parse(await fs.readFile(entry.item, "utf8")).comments ?? [], artifact = artifactOf(entry), paper = all.some((comment) => comment.under?.blocks), sheet = artifact && all.some((comment) => comment.under?.cells);
  const n = all.length === 1 ? all[0].n : comments.length === 1 && !said.length ? comments[0].n : said.length === 1 && !comments.length ? said[0].n : null;
  return [JSON.stringify(quiet({ item: entry.id, artifact, comments: comments.length ? comments.map(brief) : undefined, said: said.length ? said.map((message) => quiet({ n: message.n, text: message.text, did: message.text ? undefined : message.resolved ? "resolved" : "reopened" })) : undefined, path: entry.item })),
    `The person ${said.length ? "wrote back on" : "sent"} ${entry.id}: what they ask, the text quoted and what it is on are in the line above, so nothing needs reading first${artifact ? "" : " (a comment's pictures are in its item)"}. ${sheet ? `A comment's \`cells\` is its range as it was when sent (rows may have moved since): read it with node ${script} document cells ${artifact} <range>, change it with node ${script} document set ${artifact} <A1> <value> --for ${entry.id}/<n> (or document fill). ` : ""}Answer${comments.length + said.length > 1 && !n ? " each comment, with its n" : ""}: ${answerWith(entry, n, paper)}${artifact ? "" : `, then: node ${script} done ${entry.id}`}. The item: ${entry.item}`];
}
const hand = async (entry) => { for (const line of await handing(entry, JSON.parse(await fs.readFile(entry.item, "utf8")).comments ?? [])) console.log(line); };
/** The name a session answers under: the one it took the item with, else the one its `wait` in this folder listens under, else the folder's. */
const waiterHere = async () => {
  const here = [];
  for (const name of await fs.readdir(waiting).catch(() => [])) {
    const waiter = JSON.parse(await fs.readFile(path.join(waiting, name), "utf8").catch(() => "null"));
    if (waiter?.name && waiter.cwd === process.cwd() && alive(waiter.id)) here.push(waiter);
  }
  return here.sort((a, b) => String(b.since).localeCompare(String(a.since)))[0]?.name;
};
const takenBy = (dir) => fs.readFile(path.join(dir, "taken.json"), "utf8").then((text) => JSON.parse(text).name ?? null, () => null);
const nameHere = async (dir) => (dir && await takenBy(dir)) ?? await waiterHere() ?? path.basename(process.cwd());
const fail = (message) => { console.error(message); process.exit(1); };
/** What a session writes on an item's thread straight into the folder: words on comment `n` (null: the item), or `n` resolved, which handles the item once every comment is. */
const sayOn = async (dir, n, text, by) => fs.appendFile(path.join(dir, "thread.jsonl"), `${JSON.stringify({ at: new Date().toISOString(), from: "agent", ...(by ? { by } : {}), n, text })}\n`);
const settle = async (dir, n, by) => {
  await fs.appendFile(path.join(dir, "thread.jsonl"), `${JSON.stringify({ at: new Date().toISOString(), from: "agent", ...(by ? { by } : {}), n, resolved: true })}\n`);
  const all = await allResolved(dir);
  if (all) await fs.writeFile(path.join(dir, "handled.json"), `${JSON.stringify({ at: new Date().toISOString() })}\n`);
  return all;
};
/** The hub, as `conduit-auth api` reaches it: its answer printed, or its error said and the run failed. */
const hub = async (method, route, body) => {
  const { execFileSync } = await import("node:child_process");
  try { process.stdout.write(execFileSync(process.execPath, [new URL("./conduit-auth.mjs", import.meta.url).pathname, "api", method, route, ...(body === undefined ? [] : [JSON.stringify(body)])], { encoding: "utf8" })); }
  catch (error) { process.stderr.write(error.stdout || `${error.message}\n`); process.exit(1); }
};
/** A `--json '{…}'` argument, taken out of the arguments. */
const jsonFlag = (args) => {
  const at = args.indexOf("--json");
  if (at < 0) return {};
  const [, text] = args.splice(at, 2);
  try { const read = JSON.parse(text ?? ""); if (read && typeof read === "object" && !Array.isArray(read)) return read; } catch { /* said below */ }
  return fail(`--json takes one JSON object, as in --json '{"markdown":"…"}'`);
};
/** `--for`'s comment as <item>/<n>: an item alone names its one comment. */
const answerFor = async (answering) => {
  if (answering !== undefined && /^[\w-]+$/.test(String(answering))) {
    const entry = await find(String(answering)), comments = entry ? JSON.parse(await fs.readFile(entry.item, "utf8")).comments ?? [] : [];
    if (comments.length !== 1) fail(`--for takes <item>/<n>${entry ? `: ${answering} has comments ${comments.map((comment) => comment.n).join(", ")}` : `, and there is no markup item ${answering}`}`);
    return `${answering}/${comments[0].n}`;
  }
  if (answering !== undefined && !/^[\w-]+\/\d+$/.test(String(answering))) fail(`--for takes <item>/<n> (an item id and a comment number), not ${answering}`);
  return answering;
};
/** The arguments that are not flags (each flag here but --values and --suggest takes a value). */
const positional = (args) => args.filter((arg, at) => !arg.startsWith("--") && !["--as", "--for", "--json", "--project", "--folder", "--kind", "--tab"].includes(args[at - 1]));
const A1 = /^\$?[A-Za-z]{1,3}\$?[1-9]\d*$/;
/** Whether an artifact's cells are what changes in it (a sheet), as the hub says. */
const hasCells = async (id) => {
  const { execFileSync } = await import("node:child_process");
  try { return JSON.parse(execFileSync(process.execPath, [new URL("./conduit-auth.mjs", import.meta.url).pathname, "api", "GET", `/v0/document/${encodeURIComponent(id)}?as=about`], { encoding: "utf8" })).changes === "cells"; } catch { return false; }
};
/** What every comment of an item is now, by what the thread last said of it. */
const allResolved = async (dir) => {
  const settled = new Map((await thread(dir)).filter((message) => typeof message.resolved === "boolean").map((message) => [message.n, message.resolved]));
  return JSON.parse(await fs.readFile(path.join(dir, "item.json"), "utf8")).comments.every((comment) => settled.get(comment.n) === true);
};

if (command === "wait") {
  await fs.mkdir(waiting, { recursive: true, mode: 0o700 });
  const stay = [argument, ...rest].includes("--stay");
  const name = argument && argument !== "--stay" ? argument : path.basename(process.cwd());
  const mine = path.join(waiting, `${process.pid}.json`);
  await fs.writeFile(mine, `${JSON.stringify({ id: String(process.pid), name, cwd: process.cwd(), since: new Date().toISOString() })}\n`);
  const leave = () => { try { rmSync(mine); } catch { /* already gone */ } };
  process.on("exit", leave);
  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) process.on(signal, () => process.exit(130));
  const next = async () => { const back = await writtenBack(name); return back ?? await take(name); };
  const coming = async () => { const dirs = (await roots()).filter((dir) => existsSync(dir)); return new Promise((resolve) => {
    let looking = false;
    const look = async () => {
      if (looking) return;
      looking = true;
      const found = await next().catch(() => null);
      looking = false;
      if (found) { for (const watcher of watchers) watcher.close(); clearInterval(poll); resolve(found); }
    };
    // The rename that publishes an item is the event; the poll covers a filesystem that reports none, a document folder made since, and what is written back inside an item.
    const watchers = dirs.map((dir) => watch(dir, () => void look()));
    const poll = setInterval(() => void look(), 2000);
  }); };
  // What is handed over is being worked on from now, which the person sees on each comment until this session's next line about it.
  const working = (dir, ns) => fs.appendFile(path.join(dir, "thread.jsonl"), [...new Set(ns)].map((n) => `${JSON.stringify({ at: new Date().toISOString(), from: "agent", by: name, n, working: true })}\n`).join(""));
  do {
    const taken = await next() ?? await coming();
    let lines;
    if (taken.said) {
      await working(taken.entry.dir, [...taken.added.map((comment) => comment.n), ...taken.said.filter((message) => message.text).map((message) => message.n ?? null)]);
      lines = await handing(taken.entry, taken.added, taken.said);
    } else {
      // From here on only what is new is handed over.
      const comments = JSON.parse(await fs.readFile(taken.item, "utf8")).comments;
      await noteHanded(taken.dir, { person: 0, comments: comments.length });
      await working(taken.dir, comments.map((comment) => comment.n));
      lines = await handing(taken, comments);
    }
    // Staying, each thing that comes is one line, which is what wakes the session.
    if (stay) console.log(lines.map((line) => line.trim().replace(/\s*\n\s*/g, " ")).join("  "));
    else for (const line of [...lines, `To keep taking the person's markup, run \`node ${script} wait ${JSON.stringify(name)}\` in the background again now.`]) console.log(line);
  } while (stay);
} else if (command === "serve") {
  const { createServer } = await import("node:http");
  const { createMarkupStore, handleMarkup } = await import(new URL("../conduit-web/src/server/markup-store.js", import.meta.url).href);
  await fs.mkdir(folder, { recursive: true, mode: 0o700 });
  const store = createMarkupStore({ folder, answered: ![argument, ...rest].includes("one-way"), done: (id) => `node ${script} done ${id}`, log: (entry) => console.log(JSON.stringify(entry)) });
  // A page on this machine only: any site open in the browser can reach a local port, so another origin is refused.
  const here = (origin) => { try { return ["localhost", "127.0.0.1", "[::1]"].includes(new URL(origin).hostname); } catch { return false; } };
  const port = Number(argument) || 4390;
  createServer(async (request, response) => {
    const origin = request.headers.origin;
    if (origin && !here(origin)) { response.writeHead(403).end(); return; }
    if (origin) { response.setHeader("access-control-allow-origin", origin); response.setHeader("access-control-allow-methods", "GET, POST, PUT, DELETE"); response.setHeader("access-control-allow-headers", "content-type"); response.setHeader("vary", "origin"); }
    if (request.method === "OPTIONS") { response.writeHead(204).end(); return; }
    if (!await handleMarkup(store, request, response)) response.writeHead(404).end();
  }).listen(port, "127.0.0.1", () => console.log(`Markup receiver on http://127.0.0.1:${port}/v0/markup, writing ${folder}`));
} else if (command === "take" && argument) {
  const entry = await find(argument);
  if (!entry) { console.error(`No markup item ${argument} in ${folder}`); process.exit(1); }
  if (entry.state === "waiting" && !await claim(entry)) { console.error(`${entry.id} was taken just now`); process.exit(1); }
  await hand(entry);
} else if (command === "reply" && argument && rest.length) {
  const entry = await find(argument);
  if (!entry) { console.error(`No markup item ${argument} in ${folder}`); process.exit(1); }
  const { id, dir } = entry;
  const n = rest.length > 1 && /^\d+$/.test(rest[0]) ? Number(rest.shift()) : null;
  await sayOn(dir, n, rest.join(" "), await takenBy(dir));
  console.log(`Said on ${id}${n ? `, comment ${n}` : ""}`);
} else if (command === "resolve" && argument && /^\d+$/.test(rest[0] ?? "")) {
  const entry = await find(argument), n = Number(rest[0]);
  if (!entry) { console.error(`No markup item ${argument} in ${folder}`); process.exit(1); }
  const all = await settle(entry.dir, n, await takenBy(entry.dir));
  console.log(`Resolved comment ${n} of ${entry.id}${all ? ": every comment is resolved, so the item is handled" : ""}`);
} else if (command === "answer" && argument) {
  // One comment answered at once. On an artifact the hub does it (every edit or none, then the reply and the resolve); on the interface, the folder is written here.
  const body = jsonFlag(rest), entry = await find(argument) ?? fail(`No markup item ${argument} in ${folder}`);
  if (!Object.keys(body).length && !process.stdin.isTTY) Object.assign(body, JSON.parse(await (await import("node:stream/consumers")).text(process.stdin) || "{}"));
  if (!Object.keys(body).length) fail(`Usage: node ${script} answer <item> [n] --json '{"edits":[{"op":"replace","at":"<block>","markdown":"…"}],"reply":"…","resolve":true}'`);
  const said = rest.indexOf("--as"), by = said >= 0 ? rest.splice(said, 2)[1] : body.by ?? body.as ?? await nameHere(entry.dir);
  const n = /^\d+$/.test(rest[0] ?? "") ? Number(rest[0]) : Number.isInteger(body.n) ? body.n : undefined, artifact = artifactOf(entry);
  if (artifact) await hub("POST", `/v0/document/${encodeURIComponent(artifact)}/answer`, { item: entry.id, n, edits: body.edits ?? [], reply: body.reply, resolve: body.resolve, by });
  else {
    const comments = JSON.parse(await fs.readFile(entry.item, "utf8")).comments ?? [], at = n ?? (comments.length === 1 ? comments[0].n : undefined);
    if (body.edits?.length) fail(`${entry.id} is on the interface, not an artifact: make its changes with your own tools, then answer with reply and resolve`);
    if (body.resolve && !comments.some((comment) => comment.n === at)) fail(at === undefined ? `Say which comment of ${entry.id} this answers (n: ${comments.map((comment) => comment.n).join(", ")})` : `No comment ${at} in ${entry.id}`);
    const words = typeof body.reply === "string" ? body.reply.trim() : "";
    if (!words && !body.resolve) fail("An answer has a reply or resolve");
    if (words) await sayOn(entry.dir, at ?? null, words, by);
    const all = body.resolve && await settle(entry.dir, at, by);
    console.log(`Answered ${entry.id}${at ? `, comment ${at}` : ""}${words ? ": replied" : ""}${body.resolve ? `${words ? "," : ":"} resolved${all ? ", so the item is handled" : ""}` : ""}`);
  }
} else if (command === "done" && argument) {
  const entry = await find(argument);
  if (!entry) { console.error(`No markup item ${argument} in ${folder}`); process.exit(1); }
  await fs.writeFile(path.join(entry.dir, "handled.json"), `${JSON.stringify({ at: new Date().toISOString() })}\n`);
  console.log(`Handled ${argument}`);
} else if (command === "document" && rest[0] && (argument === "list" || argument === "new")) {
  const { execFileSync } = await import("node:child_process");
  const flag = (name) => { const at = rest.indexOf(name); return at < 0 ? undefined : rest.splice(at, 2)[1]; };
  const project = argument === "list" ? rest[0] : flag("--project"), into = flag("--folder"), kind = flag("--kind") ?? "paper";
  if (!project) { console.error("document new takes --project <id or slug>"); process.exit(1); }
  try {
    const answer = JSON.parse(execFileSync(process.execPath, [new URL("./conduit-auth.mjs", import.meta.url).pathname, "api", argument === "list" ? "GET" : "POST", `/v0/projects/${encodeURIComponent(project)}/artifacts`, ...(argument === "list" ? [] : [JSON.stringify({ kind, name: rest.join(" "), folder: into })])], { encoding: "utf8" }));
    for (const made of answer.artifacts ?? [answer]) console.log(`${made.id}  ${made.path}`);
  } catch (error) { process.stderr.write(error.stdout || `${error.message}\n`); process.exit(1); }
} else if (command === "document" && (["cells", "fill", "rows", "cols", "tabs"].includes(argument) || (argument === "set" && A1.test((positional(rest)[1] ?? "").replace(/^.*!/, "")) && await hasCells(positional(rest)[0])))) {
  const usage = `Usage: node ${script} document ${{ cells: "cells <id> [range] [--values]", set: "set <id> <A1> <value>", fill: "fill <id> <range> [value], or --json '{\"values\":[[\"…\"]]}'", rows: "rows <id> insert|delete <row number> [count]", cols: "cols <id> insert|delete <column letter> [count]", tabs: "tabs <id> [add <name> [place] | rename <tab> <name> | delete <tab> | move <tab> <place> | hide <tab> | show <tab>]" }[argument]}${argument === "tabs" ? "" : " [--tab <name>]"}${argument === "cells" ? "" : " [--for <item>/<n>] [--as <name>]"}`;
  const body = jsonFlag(rest), flag = (name) => { const at = rest.indexOf(name); return at < 0 ? undefined : rest.splice(at, 2)[1]; };
  const by = flag("--as") ?? body.as ?? body.by ?? await nameHere(), answering = await answerFor(flag("--for") ?? body.for), computed = rest.includes("--values"), tab = flag("--tab") ?? body.tab;
  const [id, first, ...more] = rest.filter((arg) => arg !== "--values"), route = `/v0/document/${encodeURIComponent(id ?? "")}`;
  if (!id) fail(usage);
  if (argument === "cells") await hub("GET", `${route}?${new URLSearchParams({ ...(first ? { range: first } : {}), ...(computed ? { as: "values" } : {}), ...(tab ? { tab } : {}) })}`);
  else if (argument === "tabs") {
    // Places are counted from 1, as the listing numbers them.
    const place = (text) => /^\d+$/.test(text ?? "") && Number(text) > 0 ? Number(text) - 1 : fail(usage);
    // add's place, when given, is its last word.
    const op = { add: () => { const at = more.length > 1 && /^\d+$/.test(more.at(-1)) ? place(more.pop()) : undefined; return { name: more.join(" ") || fail(usage), at }; }, rename: () => ({ tab: more[0] ?? fail(usage), name: more.slice(1).join(" ") || fail(usage) }), delete: () => ({ tab: more[0] ?? fail(usage) }),
      move: () => ({ tab: more[0] ?? fail(usage), at: place(more[1]) }), hide: () => ({ tab: more[0] ?? fail(usage), hidden: true }), show: () => ({ tab: more[0] ?? fail(usage), hidden: false }) }[first ?? ""];
    if (first && !op) fail(usage);
    if (op) await hub("POST", `${route}/cells`, { op: `${first === "show" ? "hide" : first}-tab`, ...op(), by, for: answering });
    else await hub("GET", `${route}?as=tabs`);
  } else if (argument === "set" || argument === "fill") {
    const value = body.value ?? (more.length ? more.join(" ") : undefined);
    if (!(first ?? body.range ?? body.at) || (value === undefined && body.values === undefined)) fail(usage);
    await hub("POST", `${route}/cells`, { op: argument, tab, ...(argument === "set" ? { at: first ?? body.at } : { range: first ?? body.range, values: body.values }), value, by, for: answering });
  } else {
    const label = more[0] ?? "", at = argument === "rows" ? (/^\d+$/.test(label) ? Number(label) - 1 : NaN) : /^[A-Za-z]{1,3}$/.test(label) ? [...label.toUpperCase()].reduce((sum, letter) => sum * 26 + letter.charCodeAt(0) - 64, 0) - 1 : NaN;
    if (!["insert", "delete"].includes(first) || !(at >= 0)) fail(usage);
    await hub("POST", `${route}/cells`, { op: `${first}-${argument}`, tab, at, count: more[1] ? Number(more[1]) : 1, by, for: answering });
  }
} else if (command === "document" && ["read", "replace", "insert", "delete", "set"].includes(argument)) {
  const usage = `Usage: node ${script} document ${argument} <id>${argument === "read" ? "" : ` ${argument === "set" ? "<name> [value]" : `<block${argument === "insert" ? "|start" : ""}>${argument === "delete" ? "" : " [markdown]"}`} [--for <item>/<n>] [--as <name>], or --json '{"block":"…"${argument === "delete" ? "" : ',"markdown":"…"'}}'`}`;
  const body = jsonFlag(rest), named = rest.indexOf("--as"), by = named < 0 ? body.as ?? body.by ?? await nameHere() : rest.splice(named, 2)[1];
  const answers = rest.indexOf("--for"), answering = await answerFor(answers < 0 ? body.for : rest.splice(answers, 2)[1]);
  const suggests = rest.indexOf("--suggest"), suggest = suggests < 0 ? body.suggest : /^suggestion\//.test(rest[suggests + 1] ?? "") ? rest.splice(suggests, 2)[1] : (rest.splice(suggests, 1), true);
  const id = rest.shift() ?? body.id, block = body.block ?? rest.shift(), words = rest;
  if (!id || (argument !== "read" && !block)) fail(usage);
  // Markdown not given on the line is read from a pipe, never waited for from a terminal.
  const piped = async () => process.stdin.isTTY ? fail(usage) : (await import("node:stream/consumers")).text(process.stdin);
  const markdown = argument === "read" || argument === "delete" ? undefined : body.markdown ?? (argument === "set" || words.length ? words.join(" ") : await piped());
  await hub(argument === "read" ? "GET" : "POST", `/v0/document/${encodeURIComponent(id)}${argument === "read" ? "" : "/blocks"}`, argument === "read" ? undefined : { op: argument, block, markdown, by, for: answering, suggest });
} else if (command === "document" && rest[0] && (argument === "suggestions" || ((argument === "accept" || argument === "reject") && rest[1]))) {
  const { execFileSync } = await import("node:child_process");
  const [id, key] = rest, settle = argument !== "suggestions";
  try {
    process.stdout.write(execFileSync(process.execPath, [new URL("./conduit-auth.mjs", import.meta.url).pathname, "api", settle ? "POST" : "GET", `/v0/document/${encodeURIComponent(id)}/${settle ? "changes" : "suggestions"}`, ...(settle ? [JSON.stringify({ op: argument, key })] : [])], { encoding: "utf8" }));
  } catch (error) { process.stderr.write(error.stdout || `${error.message}\n`); process.exit(1); }
} else if (command === "list") {
  for (const entry of await items()) {
    const handed = entry.state === "waiting" ? JSON.parse(await fs.readFile(entry.item, "utf8")).handed ?? {} : {};
    console.log(`${entry.state.padEnd(8)} ${entry.item}${handed.to ? `  for ${handed.to.name}` : ""}`);
  }
  for (const name of await fs.readdir(waiting).catch(() => [])) {
    const waiter = JSON.parse(await fs.readFile(path.join(waiting, name), "utf8").catch(() => "null"));
    if (waiter && alive(waiter.id)) console.log(`waiter   ${waiter.name}  (${waiter.cwd}, since ${waiter.since})`);
  }
} else {
  console.log("Usage: conduit-markup wait [name] [--stay] | take <id> | answer <id> [n] --json '{\"edits\":[{\"op\":\"replace\",\"at\":\"<block>\",\"markdown\":\"…\"}],\"reply\":\"…\",\"resolve\":true}' | reply <id> [n] <words> | resolve <id> <n> | done <id> | list | serve [port] [one-way]\n       conduit-markup document list <project> | document new <name> --project <id> [--folder <path>] [--kind markdown|sheet|site] | document read <id> | document set <id> <name> [value] | document replace <id> <block> [markdown] | document insert <id> <block|start> [markdown] | document delete <id> <block> | document suggestions <id> | document accept|reject <id> <key> | document cells <id> [range] [--values] | document set <id> <A1> <value> | document fill <id> <range> [value] | document rows|cols <id> insert|delete <row|letter> [count] | document tabs <id> [add <name> [place] | rename <tab> <name> | delete <tab> | move <tab> <place> | hide|show <tab>]   (--tab <name> picks a sheet's tab for cells, set, fill, rows and cols, as an address such as Data!B4 does; --as <name>, by default the name this folder's wait listens under; --for <item>/<n> names the comment an edit answers, <item> alone its one comment; --suggest [key] makes it a suggestion; --json '{…}' gives any of block, markdown, as, for, suggest; Markdown piped in when not given)");
  // Asked for (`document` alone, as an item's `change` tells an agent to run it), usage is an answer, not a failure.
  process.exit(command && !(command === "document" && !argument) ? 1 : 0);
}
