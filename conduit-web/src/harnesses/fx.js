import { FxAcpAdapter, FX_CAPABILITIES } from "../fx-acp-adapter.js";
import { commandProbe } from "./probe.js";

export const manifest = {
  id: "fx",
  label: "fx",
  profileLabel: "fx CLI",
  description: "Use the installed fx agent, configuration, credentials, and saved sessions",
  protocol: "acp",
  installationId: "host-fx",
  capabilities: FX_CAPABILITIES,
  discovery: "machine",
  warm: "process",
  nameGeneration: "backend",
  suppliesMessageIds: true,
  restartDrain: false,
  drive: true,
  profile: true,
  probe: (config) => commandProbe(config.fxCommand)(),
  build: (config) => new FxAcpAdapter({ command: config.fxCommand, logs: config.logs }),
};
