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
  // Every item the app-server reports carries its own id.
  suppliesMessageIds: true,
  // Naming its own items is not the same as stating where they go. A steer, a
  // follow-up and an interrupt all reorder a turn, and the app-server reports
  // the pieces without saying what the transcript now reads as -- so Conduit
  // states it, using Codex's names rather than minting its own.
  statedTranscript: true,
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
  build: (config) => new CodexAppServerAdapter({ command: config.codexCommand, logs: config.logs }),
};
