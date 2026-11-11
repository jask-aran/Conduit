import { DurableAdapter, DURABLE_CAPABILITIES } from "../durable-adapter.js";
import { DurableRuntime } from "../server/durable-runtime.js";
import { READY } from "./probe.js";

// A durable store this server owns, so a restart resumes a chat rather than losing the turn. It is not a profile of
// its own: a chat picks a template.
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
      templates: config.piTemplates || [], contextStore: config.contextStore || null }),
    logs: config.logs,
  }),
};
