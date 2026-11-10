import { defineExtension } from "@earendil-works/pi-durable";
import { ConduitInboxTool } from "../agent/inbox.js";
import { UiTool } from "./ui-control.js";
import { PersonBrowserTool } from "./person-browser-tool.js";

/*
 * The conduit MCP server's tools (docs/plans/screens-and-device-control.md, decision 1): Conduit as an agent reaches
 * it -- its UI, the hub's inbox, screens as they come -- defined here once. Another harness calls them over HTTP
 * (mcp-endpoint.js); Conduit's own agents have the same tools in-process (ConduitMcp, an extension of the runtime).
 * A tool of this kind is added to this list and nowhere else.
 *
 * A call knows its chat: `api.chatId` over HTTP (the chat's own endpoint), `api.conversationId` in-process
 * (`runtime.chatOf` resolves it). A call with neither (a server someone added by hand) is no one's.
 */
export const conduitTools = (runtime) => [UiTool(runtime), ConduitInboxTool(runtime), PersonBrowserTool(runtime)];

export const ConduitMcp = (runtime) => defineExtension({ name: "conduit-mcp", tools: conduitTools(runtime) });

/** The chat a call was made from, or null. */
export async function callingChat(runtime, api, context) {
  if (typeof api?.chatId === "string" && api.chatId) return api.chatId;
  if (!api?.conversationId || !runtime.chatOf) return null;
  return runtime.chatOf(api, context).catch(() => null);
}
