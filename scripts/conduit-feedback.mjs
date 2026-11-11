#!/usr/bin/env node
// Reads the feedback folder and nothing else, so it needs no session and no running hub. The folder is
// CONDUIT_FEEDBACK_DIR, else <CONDUIT_DATA_ROOT>/feedback, else ./.feedback where `serve` made one, else Conduit's own.
//
// `serve [port]` is the receiver for a project with no hub (conduit-web/src/server/feedback-store.js on its own): the
// feedback tool's routes on this machine only, writing ./.feedback, so wait/take/done work there as they do here.
// `serve [port] one-way` takes feedback from people owed no answer: it serves no thread and takes nothing written back.
// An item is taken by one waiter (taken.json, written exclusively). `wait` takes only what was handed to its name;
// everything else stays in the folder until `take <id>`.
//
// An item is a thread: `reply <id> [n] <words>` answers the person (about comment n, or the item as a whole) in
// <id>/thread.jsonl, where the tool reads it; what they write back there ends the same name's next `wait`, and so
// does a comment added to a live item. `resolve <id> <n>` settles one comment; the last one settled handles the item.
//
// `wait <name> --stay` does not end: it prints one line for each thing that comes, so a session whose harness wakes it
// on a line of output (Claude Code's Monitor) stays listed the whole time. Plain `wait` ends at the first, for a
// harness that wakes only when a command ends.
import fs from "node:fs/promises";
import { existsSync, rmSync, watch } from "node:fs";
import os from "node:os";
import path from "node:path";

const local = path.resolve(".feedback");
const [command, argument, ...rest] = process.argv.slice(2);
const folder = process.env.CONDUIT_FEEDBACK_DIR ? path.resolve(process.env.CONDUIT_FEEDBACK_DIR)
  : process.env.CONDUIT_DATA_ROOT ? path.join(path.resolve(process.env.CONDUIT_DATA_ROOT), "feedback")
  : command === "serve" || existsSync(local) ? local
  : path.join(os.homedir(), ".conduit", "data", "feedback");
const waiting = path.join(folder, ".waiting");
const exists = (file) => fs.stat(file).then(() => true, () => false);
const alive = (pid) => { try { process.kill(Number(pid), 0); return true; } catch (error) { return error.code === "EPERM"; } };
const script = path.relative(process.cwd(), process.argv[1]) || process.argv[1];

/** An id starts with when it was started; a folder still being written starts with a dot. */
async function items() {
  const names = (await fs.readdir(folder).catch(() => [])).filter((name) => !name.startsWith(".")).sort();
  const found = [];
  for (const name of names) {
    const dir = path.join(folder, name);
    if (!await exists(path.join(dir, "item.json"))) continue;
    found.push({ id: name, item: path.join(dir, "item.json"), state: await exists(path.join(dir, "handled.json")) ? "handled" : await exists(path.join(dir, "taken.json")) ? "taken" : "waiting" });
  }
  return found;
}
const claim = (entry, name) => fs.writeFile(path.join(folder, entry.id, "taken.json"), `${JSON.stringify({ at: new Date().toISOString(), pid: process.pid, ...(name ? { name } : {}) })}\n`, { flag: "wx" })
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
const thread = async (id) => (await fs.readFile(path.join(folder, id, "thread.jsonl"), "utf8").catch(() => "")).split("\n").filter(Boolean).map((line) => JSON.parse(line));
/** What the person has written back on an item this name took and has not finished, not yet handed to it. */
async function writtenBack(name) {
  for (const entry of await items()) {
    if (entry.state !== "taken") continue;
    const dir = path.join(folder, entry.id);
    if (JSON.parse(await fs.readFile(path.join(dir, "taken.json"), "utf8")).name !== name) continue;
    const said = (await thread(entry.id)).filter((message) => message.from === "person"), comments = JSON.parse(await fs.readFile(entry.item, "utf8")).comments;
    const read = await handedSoFar(dir), person = read.person ?? 0, seen = read.comments ?? comments.length;
    if (said.length <= person && comments.length <= seen) continue;
    await noteHanded(dir, { person: said.length, comments: comments.length });
    return { entry, said: said.slice(person), added: comments.slice(seen) };
  }
  return null;
}
const handing = (entry) => [entry.item, `Read it (its \`read\` says how), do what it asks, then: node ${script} done ${entry.id}`];
const hand = (entry) => { for (const line of handing(entry)) console.log(line); };
/** What every comment of an item is now, by what the thread last said of it. */
const allResolved = async (id) => {
  const settled = new Map((await thread(id)).filter((message) => typeof message.resolved === "boolean").map((message) => [message.n, message.resolved]));
  return JSON.parse(await fs.readFile(path.join(folder, id, "item.json"), "utf8")).comments.every((comment) => settled.get(comment.n) === true);
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
  const coming = () => new Promise((resolve) => {
    let looking = false;
    const look = async () => {
      if (looking) return;
      looking = true;
      const found = await next().catch(() => null);
      looking = false;
      if (found) { watcher.close(); clearInterval(poll); resolve(found); }
    };
    // The rename that publishes an item is the event; the poll covers a filesystem that reports none, and what is written back inside an item.
    const watcher = watch(folder, () => void look());
    const poll = setInterval(() => void look(), 2000);
  });
  // What is handed over is being worked on from now, which the person sees on each comment until this session's next line about it.
  const working = (id, ns) => fs.appendFile(path.join(folder, id, "thread.jsonl"), [...new Set(ns)].map((n) => `${JSON.stringify({ at: new Date().toISOString(), from: "agent", by: name, n, working: true })}\n`).join(""));
  do {
    const taken = await next() ?? await coming();
    let lines;
    if (taken.said) {
      await working(taken.entry.id, [...taken.added.map((comment) => comment.n), ...taken.said.filter((message) => message.text).map((message) => message.n ?? null)]);
      lines = [
        ...(taken.added.length ? [`The person added to ${taken.entry.item} (read each there, with its picture):`, ...taken.added.map((comment) => `  comment ${comment.n} (${comment.name}): ${comment.comment}`)] : []),
        ...(taken.said.length ? [`The person wrote back on ${taken.entry.item}:`, ...taken.said.map((message) => `  ${message.n ? `about comment ${message.n}` : "about the item"}: ${message.text ?? (message.resolved ? "resolved it" : "reopened it")}`)] : []),
        `Answer with: node ${script} reply ${taken.entry.id} [n] "<words>"`,
      ];
    } else {
      // From here on only what is new is handed over.
      const comments = JSON.parse(await fs.readFile(taken.item, "utf8")).comments;
      await noteHanded(path.join(folder, taken.id), { person: 0, comments: comments.length });
      await working(taken.id, comments.map((comment) => comment.n));
      lines = handing(taken);
    }
    // Staying, each thing that comes is one line, which is what wakes the session.
    if (stay) console.log(lines.map((line) => line.trim().replace(/\s*\n\s*/g, " ")).join("  "));
    else for (const line of [...lines, `To keep taking the person's feedback, run \`node ${script} wait ${JSON.stringify(name)}\` in the background again now.`]) console.log(line);
  } while (stay);
} else if (command === "serve") {
  const { createServer } = await import("node:http");
  const { createFeedbackStore, handleFeedback } = await import(new URL("../conduit-web/src/server/feedback-store.js", import.meta.url).href);
  await fs.mkdir(folder, { recursive: true, mode: 0o700 });
  const store = createFeedbackStore({ folder, answered: ![argument, ...rest].includes("one-way"), done: (id) => `node ${script} done ${id}`, log: (entry) => console.log(JSON.stringify(entry)) });
  // A page on this machine only: any site open in the browser can reach a local port, so another origin is refused.
  const here = (origin) => { try { return ["localhost", "127.0.0.1", "[::1]"].includes(new URL(origin).hostname); } catch { return false; } };
  const port = Number(argument) || 4390;
  createServer(async (request, response) => {
    const origin = request.headers.origin;
    if (origin && !here(origin)) { response.writeHead(403).end(); return; }
    if (origin) { response.setHeader("access-control-allow-origin", origin); response.setHeader("access-control-allow-methods", "GET, POST, PUT, DELETE"); response.setHeader("access-control-allow-headers", "content-type"); response.setHeader("vary", "origin"); }
    if (request.method === "OPTIONS") { response.writeHead(204).end(); return; }
    if (!await handleFeedback(store, request, response)) response.writeHead(404).end();
  }).listen(port, "127.0.0.1", () => console.log(`Feedback receiver on http://127.0.0.1:${port}/v0/feedback, writing ${folder}`));
} else if (command === "take" && argument) {
  const entry = (await items()).find((candidate) => candidate.id === path.basename(argument));
  if (!entry) { console.error(`No feedback item ${argument} in ${folder}`); process.exit(1); }
  if (entry.state === "waiting" && !await claim(entry)) { console.error(`${entry.id} was taken just now`); process.exit(1); }
  hand(entry);
} else if (command === "reply" && argument && rest.length) {
  const id = path.basename(argument), dir = path.join(folder, id);
  if (!await exists(path.join(dir, "item.json"))) { console.error(`No feedback item ${argument} in ${folder}`); process.exit(1); }
  const n = rest.length > 1 && /^\d+$/.test(rest[0]) ? Number(rest.shift()) : null;
  const by = await fs.readFile(path.join(dir, "taken.json"), "utf8").then((text) => JSON.parse(text).name ?? null, () => null);
  await fs.appendFile(path.join(dir, "thread.jsonl"), `${JSON.stringify({ at: new Date().toISOString(), from: "agent", ...(by ? { by } : {}), n, text: rest.join(" ") })}\n`);
  console.log(`Said on ${id}${n ? `, comment ${n}` : ""}`);
} else if (command === "resolve" && argument && /^\d+$/.test(rest[0] ?? "")) {
  const id = path.basename(argument), dir = path.join(folder, id), n = Number(rest[0]);
  if (!await exists(path.join(dir, "item.json"))) { console.error(`No feedback item ${argument} in ${folder}`); process.exit(1); }
  const by = await fs.readFile(path.join(dir, "taken.json"), "utf8").then((text) => JSON.parse(text).name ?? null, () => null);
  await fs.appendFile(path.join(dir, "thread.jsonl"), `${JSON.stringify({ at: new Date().toISOString(), from: "agent", ...(by ? { by } : {}), n, resolved: true })}\n`);
  const all = await allResolved(id);
  if (all) await fs.writeFile(path.join(dir, "handled.json"), `${JSON.stringify({ at: new Date().toISOString() })}\n`);
  console.log(`Resolved comment ${n} of ${id}${all ? ": every comment is resolved, so the item is handled" : ""}`);
} else if (command === "done" && argument) {
  const dir = path.join(folder, path.basename(argument));
  if (!await exists(path.join(dir, "item.json"))) { console.error(`No feedback item ${argument} in ${folder}`); process.exit(1); }
  await fs.writeFile(path.join(dir, "handled.json"), `${JSON.stringify({ at: new Date().toISOString() })}\n`);
  console.log(`Handled ${argument}`);
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
  console.log("Usage: conduit-feedback wait [name] [--stay] | take <id> | reply <id> [n] <words> | resolve <id> <n> | done <id> | list | serve [port] [one-way]");
  process.exit(command ? 1 : 0);
}
