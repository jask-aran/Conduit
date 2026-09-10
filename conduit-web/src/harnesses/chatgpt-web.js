import { ChatGptWebAdapter, CHATGPT_WEB_CAPABILITIES } from "../chatgpt-web-adapter.js";
import { importProbe } from "./probe.js";

export const manifest = {
  id: "chatgpt-web",
  label: "ChatGPT Web",
  description: "Use models from a connected ChatGPT account",
  protocol: "native_api",
  installationId: "user-chatgpt-account",
  capabilities: CHATGPT_WEB_CAPABILITIES,
  // No thread history to enumerate: a ChatGPT account is not a machine store.
  discovery: "none",
  drive: false,
  profile: true,
  probe: (config) => importProbe(config.chatgptWebPython, "curl_cffi")(),
  build: (config) => new ChatGptWebAdapter({
    python: config.chatgptWebPython, script: config.chatgptWebScript, dataDir: config.chatgptWebDataDir,
  }),
};
