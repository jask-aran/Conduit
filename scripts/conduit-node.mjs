#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { startNodeAgent } from "../conduit-web/src/nodes/node-agent.js";
import { buildManagedToolEnvironment } from "./pi-runtime.mjs";

// The node role's own settings, apart from any main server's data on this device.
const home = path.resolve(process.env.CONDUIT_NODE_HOME || path.join(os.homedir(), ".conduit-node"));
const file = path.join(home, "node.json");

function printHelp() {
  console.log(`Usage:
  conduit-node pair <main-url> <key> [name]   Pair this device with a main server; the key
                                              comes from pairing it in the main server's Devices.
  conduit-node share <path> [--write] [--shell]
                                              Share a folder with main (read only unless
                                              --write / --shell are given). --shell lets main
                                              run commands that start in the folder but can
                                              reach anything this user can.
  conduit-node unshare <path>                 Stop sharing a folder.
  conduit-node status                         What this device shares, and with which server.
  conduit-node run                            Serve the shared folders to main until stopped.

Settings live in ${file} (CONDUIT_NODE_HOME moves them).`);
}

const read = () => { try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return { roots: [] }; } };
const write = (settings) => {
  fs.mkdirSync(home, { recursive: true, mode: 0o700 });
  fs.writeFileSync(file, `${JSON.stringify(settings, null, 2)}\n`, { mode: 0o600 });
};

const [command, ...args] = process.argv.slice(2);
const settings = read();

if (command === "pair") {
  const [mainUrl, key, ...name] = args;
  if (!mainUrl || !key) { printHelp(); process.exit(2); }
  write({ ...settings, mainUrl: new URL(mainUrl).origin, key, name: name.join(" ") || os.hostname() });
  console.log(`Paired with ${new URL(mainUrl).origin}. Share a folder, then run \`conduit-node run\`.`);
} else if (command === "share") {
  const target = args.find((item) => !item.startsWith("--"));
  if (!target || !fs.statSync(target, { throwIfNoEntry: false })?.isDirectory()) { console.error("Share an existing folder."); process.exit(2); }
  const root = { path: path.resolve(target), read: true, write: args.includes("--write"), shell: args.includes("--shell") };
  write({ ...settings, roots: [...(settings.roots || []).filter((item) => item.path !== root.path), root] });
  if (root.shell) console.warn(`--shell: commands start in ${root.path} but run as ${os.userInfo().username}, with everything that user can reach.`);
  console.log(`Sharing ${root.path}: ${["read", root.write && "write", root.shell && "shell"].filter(Boolean).join(", ")}. Restart \`conduit-node run\` to offer it.`);
} else if (command === "unshare") {
  const target = path.resolve(args[0] || "");
  write({ ...settings, roots: (settings.roots || []).filter((item) => item.path !== target) });
  console.log(`No longer sharing ${target}.`);
} else if (command === "status") {
  console.log(JSON.stringify({ mainUrl: settings.mainUrl || null, name: settings.name || null, paired: Boolean(settings.key), roots: settings.roots || [] }, null, 2));
} else if (command === "run") {
  if (!settings.mainUrl || !settings.key) { console.error("Not paired: run `conduit-node pair <main-url> <key>` first."); process.exit(2); }
  if (!settings.roots?.length) console.warn("Nothing is shared yet; main will see this device with no folders.");
  const agent = startNodeAgent({ mainUrl: settings.mainUrl, key: settings.key, name: settings.name || os.hostname(),
    roots: settings.roots || [], shellEnv: buildManagedToolEnvironment(process.env) });
  for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => { agent.stop(); process.exit(0); });
} else {
  printHelp();
  process.exit(command ? 2 : 0);
}
