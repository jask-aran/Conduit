import { defineExtension } from "@earendil-works/pi-durable";
import { ConduitInboxTool } from "../agent/inbox.js";
import { UiTool } from "./ui-control.js";
import { PersonBrowserTool } from "./person-browser-tool.js";
import { browserWraps } from "../agent/policy.js";

/*
 * Served over HTTP to other harnesses and in-process to Conduit's own agents: a tool of this kind is added to this list
 * and nowhere else.
 */
export const conduitTools = (runtime) => [UiTool(runtime), ConduitInboxTool(runtime), PersonBrowserTool(runtime)];

export const ConduitMcp = (runtime) => {
  const tools = conduitTools(runtime);
  return defineExtension({ name: "conduit-mcp", tools, wraps: browserWraps(runtime, tools) });
};

export async function callingChat(runtime, api, context) {
  if (typeof api?.chatId === "string" && api.chatId) return api.chatId;
  if (!api?.conversationId || !runtime.chatOf) return null;
  return runtime.chatOf(api, context).catch(() => null);
}
