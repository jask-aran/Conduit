import { ChatGptWebAdapter, CHATGPT_WEB_CAPABILITIES } from "../chatgpt-web-adapter.js";
import { importProbe } from "./probe.js";

export const manifest = {
  id: "chatgpt-web",
  label: "ChatGPT Web",
  description: "Use models from a connected ChatGPT account",
  protocol: "native_api",
  installationId: "user-chatgpt-account",
  capabilities: CHATGPT_WEB_CAPABILITIES,
  nameGeneration: "backend",
  // This adapter keeps its own journal and names every message it records.
  suppliesMessageIds: true,
  // No thread history to enumerate: a ChatGPT account is not a machine store.
  discovery: "none",
  // A proxied web session has no process to start: a chat is usable as soon as
  // it is selected, and warming it would mean nothing.
  warm: "none",
  drive: false,
  profile: true,
  probe: (config) => importProbe(config.chatgptWebPython, "curl_cffi")(),
  build: (config) => new ChatGptWebAdapter({
    python: config.chatgptWebPython, script: config.chatgptWebScript, dataDir: config.chatgptWebDataDir,
  }),
};
