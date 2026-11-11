#!/usr/bin/env node
// Reads the feedback folder and nothing else, so it needs no session and no running hub. The folder is
// CONDUIT_FEEDBACK_DIR, else <CONDUIT_DATA_ROOT>/feedback, else ./.feedback where `serve` made one, else Conduit's own.
//
// `serve [port]` is the receiver for a project with no hub (conduit-web/src/server/feedback-store.js on its own): the
// feedback tool's routes on this machine only, writing ./.feedback, so wait/take/done work there as they do here.
// An item is taken by one waiter (taken.json, written exclusively). `wait` takes only what was handed to its name;
// everything else stays in the folder until `take <id>`.
import fs from "node:fs/promises";
import { existsSync, rmSync, watch } from "node:fs";
import os from "node:os";
import path from "node:path";

const local = path.resolve(".feedback");
const [command, argument] = process.argv.slice(2);
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

async function take(name) {
  for (const entry of await items()) {
    if (entry.state !== "waiting") continue;
    if (JSON.parse(await fs.readFile(entry.item, "utf8")).handed?.to?.name !== name) continue;
    if (await claim(entry, name)) return entry;
  }
  return null;
}
const hand = (entry) => {
  console.log(entry.item);
  console.log(`Read it (its \`read\` says how), do what it asks, then: node ${script} done ${entry.id}`);
};

if (command === "wait") {
  await fs.mkdir(waiting, { recursive: true, mode: 0o700 });
  const name = argument || path.basename(process.cwd());
  const mine = path.join(waiting, `${process.pid}.json`);
  await fs.writeFile(mine, `${JSON.stringify({ id: String(process.pid), name, cwd: process.cwd(), since: new Date().toISOString() })}\n`);
  const leave = () => { try { rmSync(mine); } catch { /* already gone */ } };
  process.on("exit", leave);
  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) process.on(signal, () => process.exit(130));
  let taken = await take(name);
  if (!taken) {
    taken = await new Promise((resolve) => {
      let looking = false;
      const look = async () => {
        if (looking) return;
        looking = true;
        const found = await take(name).catch(() => null);
        looking = false;
        if (found) { watcher.close(); clearInterval(poll); resolve(found); }
      };
      // The rename that publishes an item is the event; the poll covers a filesystem that reports none.
      const watcher = watch(folder, () => void look());
      const poll = setInterval(() => void look(), 2000);
    });
  }
  hand(taken);
  console.log(`To keep taking the person's feedback, run \`node ${script} wait${argument ? ` ${JSON.stringify(argument)}` : ""}\` in the background again now.`);
} else if (command === "serve") {
  const { createServer } = await import("node:http");
  const { createFeedbackStore, handleFeedback } = await import(new URL("../conduit-web/src/server/feedback-store.js", import.meta.url).href);
  await fs.mkdir(folder, { recursive: true, mode: 0o700 });
  const store = createFeedbackStore({ folder, done: (id) => `node ${script} done ${id}`, log: (entry) => console.log(JSON.stringify(entry)) });
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
  console.log("Usage: conduit-feedback wait [name] | take <id> | done <id> | list | serve [port]");
  process.exit(command ? 1 : 0);
}
