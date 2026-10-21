import { Type } from "@earendil-works/pi-ai";
import { defineExtension, defineTool } from "@earendil-works/pi-durable";
import { withAbortSignal } from "@earendil-works/chord/context";

/**
 * Typed device capabilities as tools (plan decision 7; src/nodes/capabilities.js).
 * Each runs on the conversation's own device unless the call names another,
 * and only where that device's owner granted it. A conversation is offered a
 * tool when some device it can reach has it granted. A device that is offline
 * is waited for, as file and shell calls are, and the person can go on without it.
 */
export function DeviceCapabilities(runtime) {
  const device = Type.Optional(Type.String({ description: "The device, by name (see `devices`, where offered). Omit for this conversation's own." }));
  const call = async (api, context, name, id, args) => {
    const target = await runtime.capabilityTarget(api.conversationId, name, id);
    const excuse = runtime.excuseFor(api.conversationId, target.nodeId);
    const unavailable = () => new Error(`${target.name} is unavailable: the user chose to continue without it. Do not try it again in this turn.`);
    if (excuse.excused()) throw unavailable();
    try {
      return await runtime.nodeHub.capability(target.nodeId, id, args, withAbortSignal(excuse.signal(), context),
        (waiting) => runtime.emitWaiting(api.conversationId, waiting));
    } catch (error) {
      if (excuse.excused()) throw unavailable();
      throw error;
    }
  };
  const text = (value) => ({ output: [{ type: "text", text: value }] });
  return defineExtension({ name: "device-capabilities", tools: [
    defineTool({
      name: "notify",
      description: "Show a notification on a device: for something the person should see when they are not watching this chat, such as long work finishing.",
      parameters: Type.Object({ title: Type.String(), body: Type.String(), device }),
      // Asking again after a restart could show it twice: the call is reported interrupted instead.
      replay: "unsafe",
      execute: async ({ title, body, device: name }, api, context) => {
        await call(api, context, name, "notify", { title, body });
        return text("Shown.");
      },
    }),
    defineTool({
      name: "clipboard_read",
      description: "Read the text on a device's clipboard, when the person says it holds something for you.",
      parameters: Type.Object({ device }),
      replay: "safe",
      execute: async ({ device: name }, api, context) => text(String(await call(api, context, name, "clipboard-read", {}) ?? "")),
    }),
    defineTool({
      name: "clipboard_write",
      description: "Put text on a device's clipboard, for the person to paste there. It replaces what was on it.",
      parameters: Type.Object({ text: Type.String(), device }),
      replay: "safe",
      execute: async ({ text: value, device: name }, api, context) => {
        await call(api, context, name, "clipboard-write", { text: value });
        return text("On the clipboard.");
      },
    }),
  ] });
}

/** Tool name -> the capability it needs. */
export const CAPABILITY_TOOLS = { notify: "notify", clipboard_read: "clipboard-read", clipboard_write: "clipboard-write" };
