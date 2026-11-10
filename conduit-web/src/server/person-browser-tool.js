import { Type } from "@earendil-works/pi-ai";
import { defineTool } from "@earendil-works/pi-durable";
import { callingChat } from "./conduit-mcp.js";

/*
 * `conduit_browser`: the person's own browser on any device of the network, for agents (a spike). The engine is
 * OpenCode Browse on that device (nodes/person-browser.js); this is its MCP server behind Conduit's, so a hub's
 * harness or thread drives a browser wherever it is: the hub's own environment directly, another device's through its
 * node (`personBrowser` target, device-api.js). Browse's tools are passed through as they are, named by `tool`.
 */
const text = (value, isError = false) => ({ output: [{ type: "text", text: value }], ...(isError ? { isError: true } : {}) });

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
        const devices = await browsers.environments();
        // The person's device: the one their client (this chat's origin, ui-control.js) says it is on.
        const tab = !named && runtime.uiControl ? await runtime.uiControl.targetFor(await callingChat(runtime, api, context)).catch(() => null) : null;
        const device = named ? devices.find((item) => item.name === named) : devices.find((item) => tab?.devices.includes(item.name)) || devices[0];
        if (!device) return text(named ? `${named} does not offer the person's browser. See devices.` : "No device on the network offers the person's browser.", true);
        const browser = browsers.reach(device);
        if (!tool) return text(`${device.name}'s browser, through OpenCode Browse. Tools:\n${JSON.stringify(await browser.tools(), null, 1)}`);
        const result = await browser.call(tool, args || {});
        return { output: result.output, ...(result.isError ? { isError: true } : {}) };
      } catch (error) { return text(`The browser did not answer: ${String(error?.message || error).slice(0, 400)}`, true); }
    },
  });
}
