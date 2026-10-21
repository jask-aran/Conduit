import { DurableAdapter, DURABLE_CAPABILITIES } from "../durable-adapter.js";
import { DurableRuntime } from "../server/durable-runtime.js";
import { READY } from "./probe.js";

// Conduit's own runtime: chats that live in a durable store this server owns,
// so a restart resumes them rather than losing the turn. Built in like Pi --
// nothing to install, and it uses the Conduit Pi agent's models and logins.
export const manifest = {
  id: "conduit-runtime",
  label: "Conduit runtime",
  profileLabel: "Conduit runtime",
  description: "Conduit's durable agent: chats survive a server restart mid-turn, on your Pi models and logins",
  protocol: "native_api",
  installationId: "conduit-runtime",
  capabilities: DURABLE_CAPABILITIES,
  discovery: "none",
  // In-process: a chat is usable the moment it is selected.
  warm: "none",
  nameGeneration: "conduit",
  suppliesMessageIds: true,
  drive: false,
  profile: true,
  builtIn: true,
  probe: () => READY(),
  build: (config) => new DurableAdapter({
    runtime: new DurableRuntime({ dataRoot: config.dataRoot, piAgentDir: config.piAgentDir, nodeHub: config.nodeHub }),
    logs: config.logs,
  }),
};
