/*
 * A device has one or more environments (Windows and a WSL distro are two of one machine); the code's word for one is
 * a node. A capability added here is told, kept, listed and typed everywhere; one added anywhere else is not seen.
 * Plain data and small functions, no imports: the client takes it as types only.
 */

/**
 * @typedef {{ id: string, label: string, read: boolean, write: boolean, shell: boolean, allow?: string[] }} SharedRoot
 */

/**
 * The key is the field's name in the hello and in the hub's view.
 * `type`: "roots" (SharedRoot[]), "names" (string[]) or "flag" (boolean).
 * `from`: "hello" (the environment says it) or a function of the others (the hub works it out).
 * `kept`: remembered while the environment is offline; otherwise true only while it is connected.
 * `screen`: the kind of screen it offers (a pane's view `<kind>:<node id>`).
 * `agent`: an agent may use it, and through which of Conduit's tools.
 */
export const DEVICE_CAPABILITIES = /** @type {const} */ ({
  roots: { type: "roots", from: "hello", kept: true, screen: null, agent: "devices",
    says: "The folders it shares, each with what it allows: read, write, commands" },
  harnesses: { type: "names", from: "hello", kept: true, screen: null, agent: null,
    says: "The harnesses installed there, for chats that run on it" },
  browse: { type: "flag", from: "hello", kept: true, screen: null, agent: null,
    says: "It lets the hub browse its disk and share the folders a person picks" },
  browser: { type: "flag", from: "hello", kept: false, screen: "browser", agent: "conduit_ui",
    says: "It offers its browser to the network's clients" },
  personBrowser: { type: "flag", from: "hello", kept: false, screen: null, agent: "conduit_browser",
    says: "The person's own browser there, which agents drive through OpenCode Browse" },
  terminal: { type: "flag", from: (/** @type {{ roots: SharedRoot[] }} */ held) => held.roots.some((root) => root.shell), kept: false, screen: null, agent: null,
    says: "A terminal in its home: some folder is shared with commands" },
});

/**
 * `for`: the capabilities a target serves. `methods`: every method served; "grants" is the environment's own, each by
 * the grant of the folder it touches. A target or method not listed is not served, and the hub does not ask for it.
 */
export const NODE_TARGETS = /** @type {const} */ ({
  env: { for: ["roots"], methods: "grants", says: "Files and commands in a shared folder" },
  proc: { for: ["terminal", "harnesses"], methods: ["spawn", "claim", "attach", "detach", "write", "closeInput", "resize", "kill", "list"],
    says: "Processes that outlive a call: a terminal, a harness" },
  harness: { for: ["harnesses"], methods: ["claudeSession", "codexRollout", "opencodeService"], says: "What a harness saved there, for the sessions the hub runs on it" },
  computer: { for: ["browse"], methods: ["list", "share"], says: "Its disk, to pick a folder to share" },
  browser: { for: ["browser"], methods: ["status", "describe", "configure", "act", "stream"], says: "Its browser: what it shows, input, and the port its picture streams from" },
  personBrowser: { for: ["personBrowser"], methods: ["status", "pair", "unpair", "launch", "tools", "call"], says: "The person's own browser: its pairing, starting it, and OpenCode Browse's tools, listed and called" },
  tunnel: { for: ["browser", "harnesses"], methods: ["open"], says: "A stream to a port on it, through the hub" },
  machine: { for: [], methods: ["read"], says: "Its readout: CPU, memory, disk, network, processes" },
});

const NONE = { roots: () => [], names: () => [], flag: () => false };
const READ = {
  // Roots go by id: one without is from a node older than root ids and is not addressable.
  roots: (value) => (Array.isArray(value) ? value.filter((root) => typeof root?.id === "string") : []),
  names: (value) => (Array.isArray(value) ? value.filter((name) => typeof name === "string") : []),
  flag: (value) => value === true,
};
const entries = Object.entries(DEVICE_CAPABILITIES);
const told = entries.filter(([, capability]) => capability.from === "hello");

export const helloCapabilities = (values) => Object.fromEntries(told.map(([key, capability]) => [key, READ[capability.type](values?.[key])]));

export const keptCapabilities = (held) => Object.fromEntries(told.filter(([, capability]) => capability.kept).map(([key]) => [key, held[key]]));

export function capabilitiesOf(live, record = {}) {
  const held = {};
  for (const [key, capability] of told) {
    held[key] = live ? READ[capability.type](live[key]) : capability.kept ? READ[capability.type](record[key]) : NONE[capability.type]();
  }
  for (const [key, capability] of entries) {
    if (typeof capability.from === "function") held[key] = live ? capability.from(held) : NONE[capability.type]();
  }
  return held;
}

export const SCREEN_CAPABILITIES = Object.fromEntries(entries.filter(([, capability]) => capability.screen).map(([key, capability]) => [capability.screen, key]));

export const environmentName = (device, node) => (device.nodes.length > 1 ? `${device.name} · ${node.name}` : device.name);
