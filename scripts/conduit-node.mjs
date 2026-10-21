#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { startNodeAgent } from "../conduit-web/src/nodes/node-agent.js";
import { DEFAULT_DENY } from "../conduit-web/src/nodes/secrets.js";
import { CAPABILITIES, platformCapabilities } from "../conduit-web/src/nodes/capabilities.js";
import { buildManagedToolEnvironment } from "./pi-runtime.mjs";

// The node role's own settings, apart from any main server's data on this device.
const home = path.resolve(process.env.CONDUIT_NODE_HOME || path.join(os.homedir(), ".conduit-node"));
const file = path.join(home, "node.json");

function printHelp() {
  console.log(`Usage:
  conduit-node pair <main-url> <key> [name] [--node <id>] [--via <url>]...
                                              Pair this device with a main server; the key
                                              comes from pairing it in that server's Devices.
                                              Pairing with another server adds to the first.
                                              --node keeps the id that server gave the pairing.
                                              --via names another way to reach it (a public
                                              tunnel, say), tried when <main-url> is not.
  conduit-node unpair <main-url>              Forget a server, and what was shared with it.
  conduit-node share <path> [--server <main-url>] [--write] [--shell]
                     [--allow <pattern>]... [--deny <pattern>]...
                                              Share a folder with a server (read only unless
                                              --write / --shell are given). --shell lets it
                                              run commands that start in the folder but can
                                              reach anything this user can. With one server
                                              paired, --server may be left out.
                                              Secrets (.env*, keys, .ssh/, credential files)
                                              are kept back from file access; --allow lets one
                                              through, --deny keeps back more. Patterns match a
                                              name, * as a wildcard, a trailing / for a folder.
  conduit-node unshare <path> [--server <main-url>]
                                              Stop sharing a folder (with every server, unless
                                              one is named).
  conduit-node grant <capability> [--server <url>]
                                              Let a server use one of this device's
                                              capabilities: ${Object.keys(CAPABILITIES).join(", ")}.
  conduit-node revoke <capability> [--server <url>]
                                              Take one back.
  conduit-node status                         Which servers, what each is shared and granted,
                                              and what this device can do.
  conduit-node run                            Serve every paired server until stopped.

Each server is paired on its own: its own key, its own folders and grants.
Settings live in ${file} (CONDUIT_NODE_HOME moves them).`);
}

// Each shared folder has an id its server knows it by; the path stays on this device.
const rootId = () => `r_${crypto.randomBytes(9).toString("base64url")}`;
const withIds = (roots) => (roots || []).map((root) => (root.id ? root : { id: rootId(), ...root }));

/** Settings, as version 2: `{ name, pairings: [{ mainUrl, key, roots }] }`; version 1 had one server at the top. */
const read = () => {
  let settings;
  try { settings = JSON.parse(fs.readFileSync(file, "utf8")); } catch { return { version: 2, name: null, pairings: [] }; }
  if (!settings.pairings) {
    settings = { version: 2, name: settings.name || null,
      pairings: settings.mainUrl ? [{ mainUrl: settings.mainUrl, key: settings.key, roots: settings.roots || [] }] : [] };
  }
  settings.pairings = settings.pairings.map((pairing) => ({ ...pairing, roots: withIds(pairing.roots) }));
  return settings;
};
const write = (settings) => {
  fs.mkdirSync(home, { recursive: true, mode: 0o700 });
  fs.writeFileSync(file, `${JSON.stringify({ ...settings, version: 2 }, null, 2)}\n`, { mode: 0o600 });
};

const [command, ...args] = process.argv.slice(2);
const settings = read();

// `--flag value` options (repeatable ones collected), and the bare arguments.
function options(list, repeatable = [], valued = []) {
  const found = Object.fromEntries(repeatable.map((name) => [name, []]));
  const bare = [];
  for (let index = 0; index < list.length; index += 1) {
    const item = list[index];
    const name = item.replace(/^--/, "");
    if (!item.startsWith("--")) bare.push(item);
    else if (repeatable.includes(name)) found[name].push(list[++index] || "");
    else if (valued.includes(name)) found[name] = list[++index] || "";
    else found[name] = true;
  }
  return { ...found, bare };
}

const origin = (url) => { try { return new URL(url).origin; } catch { console.error(`Not a server URL: ${url}`); process.exit(2); } };

/** The pairing a command means: the named server, or the only one. */
function pairingFor(server) {
  if (!settings.pairings.length) { console.error("Not paired: run `conduit-node pair <main-url> <key>` first."); process.exit(2); }
  if (server) {
    const pairing = settings.pairings.find((item) => item.mainUrl === origin(server));
    if (!pairing) { console.error(`Not paired with ${origin(server)}.`); process.exit(2); }
    return pairing;
  }
  if (settings.pairings.length > 1) {
    console.error(`Paired with ${settings.pairings.length} servers; name one with --server: ${settings.pairings.map((item) => item.mainUrl).join(", ")}`);
    process.exit(2);
  }
  return settings.pairings[0];
}

if (command === "pair") {
  const given = options(args, ["via"], ["node"]);
  const [mainUrl, key, ...name] = given.bare;
  if (!mainUrl || !key) { printHelp(); process.exit(2); }
  const at = origin(mainUrl);
  // Pairing a server again replaces its key and keeps what it was shared.
  const previous = settings.pairings.find((item) => item.mainUrl === at);
  // The server's id for this pairing, when known: how an app pointed at that server finds it here.
  const pairing = { mainUrl: at, key, ...(given.node ? { nodeId: given.node } : {}),
    ...(given.via.length ? { routes: given.via.map(origin) } : {}), roots: previous?.roots || [] };
  const pairings = [...settings.pairings.filter((item) => item.mainUrl !== at), pairing];
  write({ ...settings, name: name.join(" ") || settings.name || os.hostname(), pairings });
  console.log(`Paired with ${at}${pairings.length > 1 ? ` (${pairings.length} servers now)` : ""}. Share a folder with it, then run \`conduit-node run\`.`);
} else if (command === "unpair") {
  const at = origin(args[0] || "");
  write({ ...settings, pairings: settings.pairings.filter((item) => item.mainUrl !== at) });
  console.log(`No longer paired with ${at}.`);
} else if (command === "share") {
  const given = options(args, ["allow", "deny"], ["server"]);
  if ([...given.allow, ...given.deny].some((pattern) => !pattern)) { console.error("--allow and --deny each take a pattern."); process.exit(2); }
  const target = given.bare[0];
  if (!target || !fs.statSync(target, { throwIfNoEntry: false })?.isDirectory()) { console.error("Share an existing folder."); process.exit(2); }
  const pairing = pairingFor(given.server);
  const resolved = path.resolve(target);
  const previous = pairing.roots.find((item) => item.path === resolved);
  // Sharing a folder again changes its grants, not its id: workspaces on it keep working.
  const root = { id: previous?.id || rootId(), path: resolved,
    read: true, write: Boolean(given.write), shell: Boolean(given.shell),
    // Given patterns replace the folder's own; none given keeps them.
    allow: given.allow.length ? given.allow : previous?.allow || [],
    deny: given.deny.length ? given.deny : previous?.deny || [] };
  pairing.roots = [...pairing.roots.filter((item) => item.path !== root.path), root];
  write(settings);
  if (root.shell) console.warn(`--shell: commands start in ${root.path} but run as ${os.userInfo().username}, with everything that user can reach.`);
  console.log(`Sharing ${root.path} with ${pairing.mainUrl}: ${["read", root.write && "write", root.shell && "shell"].filter(Boolean).join(", ")}. Restart \`conduit-node run\` to offer it.`);
  console.log(`Kept back from file access: ${[...DEFAULT_DENY, ...root.deny].join(" ")}${root.allow.length ? `, except ${root.allow.join(" ")}` : ""}.`);
} else if (command === "unshare") {
  const given = options(args, [], ["server"]);
  const target = path.resolve(given.bare[0] || "");
  for (const pairing of given.server ? [pairingFor(given.server)] : settings.pairings) {
    pairing.roots = pairing.roots.filter((item) => item.path !== target);
  }
  write(settings);
  console.log(`No longer sharing ${target}${given.server ? ` with ${origin(given.server)}` : ""}.`);
} else if (command === "grant" || command === "revoke") {
  const given = options(args, [], ["server"]);
  const id = given.bare[0];
  if (!CAPABILITIES[id]) { console.error(`Unknown capability ${JSON.stringify(id || "")}: ${Object.keys(CAPABILITIES).join(", ")}.`); process.exit(2); }
  const pairing = pairingFor(given.server);
  const rest = (pairing.capabilities || []).filter((item) => item !== id);
  pairing.capabilities = command === "grant" ? [...rest, id] : rest;
  write(settings);
  const here = Boolean(platformCapabilities()[id]);
  console.log(`${command === "grant" ? "Granted" : "Revoked"} ${id} for ${pairing.mainUrl}.${command === "grant" && !here ? " This device cannot do it yet (no platform support found), so it stays unoffered." : ""} Restart \`conduit-node run\` to apply.`);
} else if (command === "status") {
  console.log(JSON.stringify({ name: settings.name || null, host: os.hostname(), canDo: Object.keys(platformCapabilities()),
    pairings: settings.pairings.map(({ mainUrl, nodeId, routes, roots, capabilities }) => ({ mainUrl, nodeId: nodeId || null, routes: routes || [], roots,
      granted: capabilities || [] })) }, null, 2));
} else if (command === "run") {
  write(settings);
  if (!settings.pairings.length) { console.error("Not paired: run `conduit-node pair <main-url> <key>` first."); process.exit(2); }
  const shellEnv = buildManagedToolEnvironment(process.env);
  // One connection per server, each with only what was shared with it.
  const agents = settings.pairings.map((pairing) => {
    if (!pairing.roots.length) console.warn(`Nothing is shared with ${pairing.mainUrl} yet; it will see this device with no folders.`);
    return startNodeAgent({ mainUrl: pairing.mainUrl, routes: pairing.routes, key: pairing.key, name: settings.name || os.hostname(), roots: pairing.roots,
      capabilities: pairing.capabilities || [], shellEnv });
  });
  for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => { for (const agent of agents) agent.stop(); process.exit(0); });
} else {
  printHelp();
  process.exit(command ? 2 : 0);
}
