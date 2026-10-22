import { DurableAdapter, DURABLE_CAPABILITIES } from "../durable-adapter.js";
import { DurableRuntime } from "../server/durable-runtime.js";
import { READY } from "./probe.js";

// The Conduit durable agent: Conduit's own chats -- the Assistant, Coding and
// Runtime profiles (Conduit's templates) -- in a durable store this server
// owns, so a restart resumes them rather than losing the turn. Built in --
// nothing to install -- on the Pi agent directory's models and logins. It is
// not a profile of its own: a chat picks a template.
export const manifest = {
  id: "conduit-runtime",
  label: "Conduit",
  profileLabel: "Conduit",
  description: "Conduit's durable agent: chats survive a server restart mid-turn, on your Pi models and logins",
  protocol: "native_api",
  installationId: "conduit-runtime",
  capabilities: DURABLE_CAPABILITIES,
  discovery: "none",
  // In-process: a chat is usable the moment it is selected.
  warm: "none",
  nameGeneration: "conduit",
  drive: false,
  profile: false,
  builtIn: true,
  probe: () => READY(),
  build: (config) => new DurableAdapter({
    runtime: new DurableRuntime({ dataRoot: config.dataRoot, piAgentDir: config.piAgentDir, nodeHub: config.nodeHub,
      templates: config.piTemplates || [], promptStore: config.promptStore || null }),
    logs: config.logs,
  }),
};
