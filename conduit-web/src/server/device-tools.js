import { Type } from "@earendil-works/pi-ai";
import { defineExtension, defineTool } from "@earendil-works/pi-durable";
import { NodeExecutionEnv } from "@earendil-works/pi-durable/env/node";
import { CodingTools } from "@earendil-works/pi-durable/tools";
import { RemoteExecutionEnv } from "../nodes/remote-env.js";

/**
 * Tools that pick their device per call (plan decision 21): for a
 * conversation with no home device, such as the persistent agent, which acts
 * wherever the work is. `devices` lists what it can reach; read, write, edit
 * and bash take an optional `device` and `folder`, and without them run where
 * the conversation does. A device's calls wait while it is offline, and the
 * person can go on without it, as in an owned thread.
 *
 * The same tool names as the coding tools, so a conversation selects one
 * extension or the other, never both.
 */
export function DeviceTools(runtime) {
  const devices = defineTool({
    name: "devices",
    description: "List the devices you can work on: each one's name, whether it is online, and the folders it shares "
      + "(with what each allows). Pass a device's name and a folder to read, write, edit or bash to work there.",
    parameters: Type.Object({}),
    replay: "safe",
    execute: async () => {
      const listed = (await runtime.reachable()).map((device) => ({ device: device.name, online: device.online, here: device.local,
        folders: device.roots.map((root) => ({ folder: root.path || root.label, ...(root.label && root.path ? { label: root.label } : {}),
          read: root.read !== false, write: Boolean(root.write), shell: Boolean(root.shell) })) }));
      return { output: [{ type: "text", text: JSON.stringify(listed, null, 2) }] };
    },
  });
  const placed = (tool) => defineTool({
    ...tool,
    description: `${tool.description} Pass \`device\` (a name from \`devices\`) and \`folder\` to run it on another device's shared folder; relative paths are inside that folder.`,
    parameters: Type.Object({
      ...tool.parameters.properties,
      device: Type.Optional(Type.String({ description: "The device to run on, by name (see `devices`). Omit for this conversation's own folder." })),
      folder: Type.Optional(Type.String({ description: "The shared folder on that device, as `devices` lists it. Omit for its first one." })),
    }),
    execute: async ({ device, folder, ...args }, api, context) => (device
      ? tool.execute(args, { ...api, env: await runtime.envOn(api.conversationId, device, folder) }, context)
      : tool.execute(args, api, context)),
  });
  return defineExtension({ name: "device-tools", tools: [devices, ...CodingTools.tools.map(placed)] });
}

/** A device's shared folder as an environment: this server's own disk, or the device's node. */
export async function deviceEnv(runtime, conversationId, name, folder) {
  const wanted = String(name || "").trim().toLowerCase();
  const device = (await runtime.reachable()).find((item) => item.name.toLowerCase() === wanted || item.nodeId === name);
  if (!device) throw new Error(`No device named ${JSON.stringify(name)}; list them with \`devices\``);
  const root = folder
    ? device.roots.find((item) => [item.path, item.label, item.id].includes(folder))
    : device.roots[0];
  if (!root) throw new Error(folder ? `${device.name} shares no folder ${JSON.stringify(folder)}` : `${device.name} shares no folders`);
  const cwd = root.path || root.label;
  if (device.local) return new NodeExecutionEnv({ cwd, shellEnv: runtime.shellEnv });
  return new RemoteExecutionEnv({ hub: runtime.nodeHub, nodeId: device.nodeId, place: { root: root.id, path: "" }, cwd,
    onWait: (waiting) => runtime.emitWaiting(conversationId, waiting), excuse: runtime.excuseFor(conversationId, device.nodeId) });
}
