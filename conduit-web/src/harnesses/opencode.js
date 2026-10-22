import { OpenCodeAdapter, OPENCODE_CAPABILITIES } from "../opencode-adapter.js";
import { commandProbe } from "./probe.js";

export const manifest = {
  id: "opencode",
  label: "OpenCode",
  profileLabel: "OpenCode 2",
  description: "Use the installed OpenCode 2 shared service and its saved sessions",
  protocol: "native_api",
  installationId: "host-opencode",
  capabilities: OPENCODE_CAPABILITIES,
  discovery: "machine",
  warm: "process",
  nameGeneration: "backend",
  restartDrain: false,
  drive: true,
  profile: true,
  // Runs on a paired device even when not installed here (registered regardless).
  devices: true,
  probe: (config) => commandProbe(config.opencodeCommand)(),
  build: (config) => new OpenCodeAdapter({ command: config.opencodeCommand, logs: config.logs, nodeHub: config.nodeHub }),
};
