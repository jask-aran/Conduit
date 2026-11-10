import { Type } from "@earendil-works/pi-ai";
import { defineTool } from "@earendil-works/pi-durable";
import { callingChat } from "./conduit-mcp.js";
import { browserAlwaysAllowed } from "../agent/policy.js";

/*
 * `conduit_browser`: the person's own browser on any device of the network, for agents (a spike). The engine is
 * OpenCode Browse on that device (nodes/person-browser.js); this is its MCP server behind Conduit's, so a hub's
 * harness or thread drives a browser wherever it is: the hub's own environment directly, another device's through its
 * node (`personBrowser` target, device-api.js). Browse's tools are passed through as they are, named by `tool`.
 */
const text = (value, isError = false) => ({ output: [{ type: "text", text: value }], ...(isError ? { isError: true } : {}) });

/** The environment a call means: the one named, else the person's (the device their client, this chat's origin, says it is on), else the first that offers one. */
export async function browserFor(runtime, named, api, context) {
  const tab = !named && runtime.uiControl ? await runtime.uiControl.targetFor(await callingChat(runtime, api, context)).catch(() => null) : null;
  return runtime.personBrowsers.pick(named || null, tab);
}

export function PersonBrowserTool(runtime) {
  return defineTool({
    name: "conduit_browser",
    description: "Drive the person's own browser on a device: their real, signed-in Chromium, through OpenCode Browse there. "
      + "Omit `tool` to list that device's Browse tools with their parameters; then call one by name with `arguments` "
      + "(`execute` runs Playwright code against the browser; a login, 2FA or CAPTCHA is handed to the person with its `handoff`). "
      + "`device` is a name from `devices`; default the device the person is talking to you from. "
      + "The hub's shared browser (pane browser:hub) is the agent_browser tools', not this.",
    parameters: Type.Object({
      device: Type.Optional(Type.String({ description: "The device whose browser, by name (see `devices`). Default: the person's." })),
      tool: Type.Optional(Type.String({ description: "A Browse tool's name, such as execute. Omit to list them." })),
      arguments: Type.Optional(Type.Record(Type.String(), Type.Any(), { description: "That tool's arguments." })),
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
        // A thread of Conduit's own asks the person first (agent/policy.js browserWraps). A caller with no thread to
        // ask from, another harness over MCP, drives it only where they have said Always.
        if (!api?.conversationId && !await browserAlwaysAllowed(runtime.agent, device.name)) {
          return text(`The person has not allowed this for ${device.name}. Driving their browser there is theirs to allow: a Conduit chat asks them, and their Always for that device covers you too.`, true);
        }
        const result = await browser.call(tool, args || {});
        return { output: result.output, ...(result.isError ? { isError: true } : {}) };
      } catch (error) { return text(`The browser did not answer: ${String(error?.message || error).slice(0, 400)}`, true); }
    },
  });
}
