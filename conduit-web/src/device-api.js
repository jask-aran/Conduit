/*
 * The device API, declared once (docs/plans/screens-and-device-control.md): what the hub knows of each environment on
 * the network -- a device has one or more (Windows and a WSL distro are two of one machine); the code's word for one
 * is a node -- and the calls it makes into it. Both ends and the client read this: a node's hello is built and read
 * by it (helloCapabilities), the hub's view of a node is computed from it (capabilitiesOf), a node serves only the
 * targets and methods listed (protocol.js servedCall), and the client's types are inferred from it
 * (client/platform/devices.ts: Environment, Device). A capability added here is told, kept, listed and typed everywhere; one added anywhere else is not seen.
 *
 * Plain data and small functions, no imports: the client takes it as types only.
 */

/**
 * @typedef {{ id: string, label: string, read: boolean, write: boolean, shell: boolean, allow?: string[] }} SharedRoot
 * A folder an environment shares, with what it allows there.
 */

/**
 * What an environment can do for the network. The key is the field's name in the hello and in the hub's view.
 *
 * `type`: its value -- "roots" (SharedRoot[]), "names" (string[]) or "flag" (boolean).
 * `from`: "hello" (the environment says it) or a function of the others (the hub works it out).
 * `kept`: remembered while the environment is offline; otherwise true only while it is connected.
 * `screen`: the kind of screen it offers (a pane's view `<kind>:<node id>`, server/screens.js).
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
 * What the hub calls on a node (`{ type: "call", target, method }`, nodes/protocol.js). `for`: the capabilities it
 * serves. `methods`: every method served; "grants" is the environment's own, each by the grant of the folder it
 * touches (protocol.js METHOD_GRANTS). A target or method not listed is not served, and the hub does not ask for it.
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

/** The capabilities a hello carries, each as its type says: what a node sends, and what the hub takes from it. */
export const helloCapabilities = (values) => Object.fromEntries(told.map(([key, capability]) => [key, READ[capability.type](values?.[key])]));

/** Of a node's capabilities, those the hub remembers while it is away. */
export const keptCapabilities = (held) => Object.fromEntries(told.filter(([, capability]) => capability.kept).map(([key]) => [key, held[key]]));

/**
 * An environment's capabilities now: from what it said if it is connected (`live`), else what is remembered of it
 * (`record`); one not kept is false while it is away.
 */
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

/** The kinds of screen devices offer, by the capability that says so. */
export const SCREEN_CAPABILITIES = Object.fromEntries(entries.filter(([, capability]) => capability.screen).map(([key, capability]) => [capability.screen, key]));

/** An environment as people and agents name it: its device's name, with its own when the device has several. */
export const environmentName = (device, node) => (device.nodes.length > 1 ? `${device.name} · ${node.name}` : device.name);
