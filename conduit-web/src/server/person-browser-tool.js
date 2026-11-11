import { Type } from "@earendil-works/pi-ai";
import { defineTool } from "@earendil-works/pi-durable";
import { callingChat } from "./conduit-mcp.js";

const text = (value, isError = false) => ({ output: [{ type: "text", text: value }], ...(isError ? { isError: true } : {}) });

export async function browserFor(runtime, named, api, context) {
  const tab = !named && runtime.uiControl ? await runtime.uiControl.targetFor(await callingChat(runtime, api, context)).catch(() => null) : null;
  return runtime.personBrowsers.pick(named || null, tab);
}

export function PersonBrowserTool(runtime) {
  return defineTool({
    name: "conduit_browser",
    description: "The person's OWN browser on a device (their real, signed-in Chromium, through OpenCode Browse there). Not your default: browse in the hub's browser (codemode's browser namespace), "
      + "and use this only when the person asks for their own browser or the job needs their sign-in. It asks them first, each thread; a no stands. "
      + "Omit `tool` to list that device's Browse tools with their parameters; then call one by name with `arguments` "
      + "(`execute` runs Playwright code against the browser; a login, 2FA or CAPTCHA is handed to the person with its `handoff`). "
      + "`device` is a name from `devices`; default the device the person is talking to you from. "
      + "The device is the one whose browser the person paired, which may not be the one they are sitting at.",
    parameters: Type.Object({
      device: Type.Optional(Type.String({ description: "The device whose browser, by name (see `devices`). Default: the person's." })),
      tool: Type.Optional(Type.String({ description: "A Browse tool's name, such as execute. Omit to list them." })),
      arguments: Type.Optional(Type.Record(Type.String(), Type.Any(), { description: "That tool's arguments." })),
      again: Type.Optional(Type.Boolean({ description: "true only when the person, after saying no in this thread, has asked you themselves to use their own browser." })),
    }),
    replay: "unsafe",
    execute: async ({ device: named, tool, arguments: args }, api, context) => {
      try {
        const browsers = runtime.personBrowsers;
        if (!browsers) return text("The person's browsers cannot be reached from here.", true);
        const device = await browserFor(runtime, named, api, context);
        if (!device) return text(named ? `${named} does not offer the person's browser. See devices.` : "No device on the network offers the person's browser.", true);
        const browser = browsers.reach(device);
        if (!tool) return text(`${device.name}'s browser, through OpenCode Browse. Tools:\n${JSON.stringify(await browser.tools(), null, 1)}`);
        // A caller with no thread to ask from, another harness over MCP, cannot be allowed: the permission has no
        // standing answer.
        if (!api?.conversationId) return text(`Driving the person's browser on ${device.name} is theirs to allow, each thread, and you have no Conduit thread to ask from. Its tools can be listed; ask the person to do this from a Conduit chat.`, true);
        const result = await browser.call(tool, args || {});
        return { output: result.output, ...(result.isError ? { isError: true } : {}) };
      } catch (error) { return text(`The browser did not answer: ${String(error?.message || error).slice(0, 400)}`, true); }
    },
  });
}
