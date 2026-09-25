import { ClaudeCodeAdapter, CLAUDE_CODE_CAPABILITIES } from "../claude-code-adapter.js";
import { commandProbe } from "./probe.js";

export const manifest = {
  id: "claude-code",
  label: "Claude Code",
  profileLabel: "Claude Code",
  description: "Use the installed Claude Code, its configuration, credentials, and saved sessions",
  protocol: "native_api",
  installationId: "host-claude-code",
  capabilities: CLAUDE_CODE_CAPABILITIES,
  discovery: "machine",
  warm: "process",
  // Claude Code titles sessions for its own picker, not for a third party.
  nameGeneration: "conduit",
  // Prompts keep the uuid Conduit hands them; model messages carry the API's id.
  suppliesMessageIds: true,
  // Each chat's Claude Code is Conduit's child and ends with it, so a restart
  // waits for running turns, as Pi's does.
  drive: true,
  profile: true,
  probe: (config) => commandProbe(config.claudeCommand)(),
  build: (config) => new ClaudeCodeAdapter({ command: config.claudeCommand, logs: config.logs }),
};
