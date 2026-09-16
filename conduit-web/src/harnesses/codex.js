import { CodexAppServerAdapter, CODEX_CAPABILITIES } from "../codex-app-server-adapter.js";
import { commandProbe } from "./probe.js";

export const manifest = {
  id: "codex",
  label: "Codex",
  profileLabel: "Codex CLI",
  description: "Use the installed Codex app-server daemon and its native configuration",
  protocol: "native_api",
  installationId: "host-codex",
  capabilities: CODEX_CAPABILITIES,
  discovery: "machine",
  warm: "process",
  // App-server stores names but does not start the first-party client's hidden
  // naming turn for third-party threads.
  nameGeneration: "conduit",
  serviceLevels: [
    { id: "default", label: "Normal" },
    { id: "priority", label: "Priority" },
  ],
  // The daemon owns turns. Conduit can disconnect during restart and resume
  // its subscription without interrupting the work.
  restartDrain: false,
  drive: true,
  profile: true,
  probe: (config) => commandProbe(config.codexCommand)(),
  build: (config) => new CodexAppServerAdapter({ command: config.codexCommand }),
};
