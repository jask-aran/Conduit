#!/usr/bin/env node
// UI feedback items (conduit-web/src/server/feedback.js), for the agent that works on Conduit. The hub writes each
// item the person sends to <data>/feedback/<id>/item.json (with its pictures beside it); this reads that folder
// and nothing else, so it needs no session and no running hub.
//
//   conduit-feedback wait [name]   Block until an item for this waiter, take it, print the path of its item.json.
//                                  Run it in the background: its exit is the push. While it waits the feedback
//                                  tool lists it by name (default: this folder's) as a session to hand an item to.
//   conduit-feedback take <id>     Take one item whoever it is for (one sent with nobody to hand it to is held).
//   conduit-feedback done <id>     Mark an item handled.
//   conduit-feedback list          Every item and where it stands.
//
// An item is taken by one waiter (taken.json, written exclusively), so two sessions waiting get different items.
// A waiter is a file in <data>/feedback/.waiting named for its process, gone when the process is.
import fs from "node:fs/promises";
import { rmSync, watch } from "node:fs";
import os from "node:os";
import path from "node:path";

const folder = path.join(path.resolve(process.env.CONDUIT_DATA_ROOT || path.join(os.homedir(), ".conduit", "data")), "feedback");
const waiting = path.join(folder, ".waiting");
const [command, argument] = process.argv.slice(2);
const exists = (file) => fs.stat(file).then(() => true, () => false);
const me = String(process.pid);
const alive = (pid) => { try { process.kill(Number(pid), 0); return true; } catch (error) { return error.code === "EPERM"; } };
const script = path.relative(process.cwd(), process.argv[1]) || process.argv[1];

/** Sent items, oldest first (an id starts with when it was started; a folder still being written starts with a dot). */
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
const claim = (entry) => fs.writeFile(path.join(folder, entry.id, "taken.json"), `${JSON.stringify({ at: new Date().toISOString(), pid: process.pid })}\n`, { flag: "wx" })
  .then(() => true, (error) => { if (error.code === "EEXIST") return false; throw error; });

/** The oldest item this waiter may have: one handed to it, to nobody in particular, or to a waiter that has gone. A held one is nobody's until `take`. */
async function take() {
  for (const entry of await items()) {
    if (entry.state !== "waiting") continue;
    const handed = JSON.parse(await fs.readFile(entry.item, "utf8")).handed ?? {};
    if (handed.held || (handed.to && handed.to.id !== me && alive(handed.to.id))) continue;
    if (await claim(entry)) return entry;
  }
  return null;
}
const hand = (entry) => {
  console.log(entry.item);
  console.log(`Read it (its \`read\` says how), do what it asks, then: node ${script} done ${entry.id}`);
};

if (command === "wait") {
  await fs.mkdir(waiting, { recursive: true, mode: 0o700 });
  const mine = path.join(waiting, `${me}.json`);
  await fs.writeFile(mine, `${JSON.stringify({ id: me, name: argument || path.basename(process.cwd()), cwd: process.cwd(), since: new Date().toISOString() })}\n`);
  const leave = () => { try { rmSync(mine); } catch { /* already gone */ } };
  process.on("exit", leave);
  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) process.on(signal, () => process.exit(130));
  let taken = await take();
  if (!taken) {
    taken = await new Promise((resolve) => {
      let looking = false;
      const look = async () => {
        if (looking) return;
        looking = true;
        const found = await take().catch(() => null);
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
    console.log(`${(handed.held ? "held" : entry.state).padEnd(8)} ${entry.item}${handed.to ? `  for ${handed.to.name}` : ""}`);
  }
  for (const name of await fs.readdir(waiting).catch(() => [])) {
    const waiter = JSON.parse(await fs.readFile(path.join(waiting, name), "utf8").catch(() => "null"));
    if (waiter && alive(waiter.id)) console.log(`waiter   ${waiter.name}  (${waiter.cwd}, since ${waiter.since})`);
  }
} else {
  console.log("Usage: conduit-feedback wait [name] | take <id> | done <id> | list");
  process.exit(command ? 1 : 0);
}
