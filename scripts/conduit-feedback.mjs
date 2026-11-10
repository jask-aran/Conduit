#!/usr/bin/env node
// UI feedback items (conduit-web/src/server/feedback.js), for the agent that works on Conduit. The hub writes each
// item the person sends to <data>/feedback/<id>/item.json (with screenshot.png beside it); this reads that folder
// and nothing else, so it needs no session and no running hub.
//
//   conduit-feedback wait        Block until an item nobody has taken, take it, print the path of its item.json.
//                                Run it in the background: its exit is the push.
//   conduit-feedback done <id>   Mark an item handled.
//   conduit-feedback list        Every item and where it stands.
//
// An item is taken by one waiter (taken.json, written exclusively), so two sessions waiting get different items.
import fs from "node:fs/promises";
import { watch } from "node:fs";
import os from "node:os";
import path from "node:path";

const folder = path.join(path.resolve(process.env.CONDUIT_DATA_ROOT || path.join(os.homedir(), ".conduit", "data")), "feedback");
const [command, id] = process.argv.slice(2);
const exists = (file) => fs.stat(file).then(() => true, () => false);

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

async function take() {
  for (const entry of await items()) {
    if (entry.state !== "waiting") continue;
    try {
      await fs.writeFile(path.join(folder, entry.id, "taken.json"), `${JSON.stringify({ at: new Date().toISOString(), pid: process.pid })}\n`, { flag: "wx" });
      return entry;
    } catch (error) { if (error.code !== "EEXIST") throw error; }
  }
  return null;
}

if (command === "wait") {
  await fs.mkdir(folder, { recursive: true, mode: 0o700 });
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
  console.log(taken.item);
} else if (command === "done" && id) {
  const dir = path.join(folder, path.basename(id));
  if (!await exists(path.join(dir, "item.json"))) { console.error(`No feedback item ${id} in ${folder}`); process.exit(1); }
  await fs.writeFile(path.join(dir, "handled.json"), `${JSON.stringify({ at: new Date().toISOString() })}\n`);
  console.log(`Handled ${id}`);
} else if (command === "list") {
  for (const entry of await items()) console.log(`${entry.state.padEnd(8)} ${entry.item}`);
} else {
  console.log("Usage: conduit-feedback wait | done <id> | list");
  process.exit(command ? 1 : 0);
}
