import { execFile } from "node:child_process";
import { createJiti } from "jiti";
import { defineTool } from "@earendil-works/pi-durable";
import { ModelRegistry } from "@earendil-works/pi-coding-agent";

/**
 * Pi extension tools, run by the Conduit runtime.
 *
 * A Pi extension is a function handed Pi's extension API; most of what it
 * registers (commands, widgets, shortcuts, session hooks) is Pi's terminal UI
 * and means nothing here, but its tools are ordinary functions of their
 * arguments and a context. This hands the extension an API that keeps only
 * `registerTool` and `exec`, and runs each tool it registered as a pi-durable
 * tool with a headless context: no UI, the conversation's working directory
 * and model, and the Conduit Pi agent's model registry for anything the tool
 * asks a model itself.
 *
 * `replaySafe` names the tools that may simply run again after a restart
 * (reads and searches); any other is reported to the model as interrupted.
 */
const quiet = new Proxy({}, { get: () => () => undefined });

function piApi(tools) {
  const api = {
    registerTool: (tool) => tools.push(tool),
    exec: (command, args = [], options = {}) => new Promise((resolve) => {
      execFile(command, args, { cwd: options.cwd, timeout: options.timeout, signal: options.signal, maxBuffer: 32 * 1024 * 1024 },
        (error, stdout, stderr) => resolve({ stdout: String(stdout || ""), stderr: String(stderr || ""), code: error ? (typeof error.code === "number" ? error.code : 1) : 0, killed: Boolean(error?.killed) }));
    }),
    getFlag: () => undefined,
  };
  return new Proxy(api, { get: (target, key) => (key in target ? target[key] : () => undefined) });
}

export async function loadPiExtensionTools(entry, { models, replaySafe = [] }) {
  const jiti = createJiti(import.meta.url, { interopDefault: true, moduleCache: true });
  const factory = await jiti.import(entry, { default: true });
  const tools = [];
  await factory(piApi(tools));
  const registry = new ModelRegistry(models);
  const safe = new Set(replaySafe);
  return tools.map((tool) => defineTool({
    name: tool.name,
    description: [tool.description, tool.promptSnippet].filter(Boolean).join("\n\n"),
    parameters: tool.parameters,
    ...(safe.has(tool.name) ? { replay: "safe" } : {}),
    execute: async (args, api, context) => {
      const agent = await api.agent(context);
      const ctx = new Proxy({
        cwd: api.env?.cwd || agent.cwd || process.cwd(),
        hasUI: false,
        ui: quiet,
        model: agent.model ? models.getModel(agent.model.provider, agent.model.modelId) : undefined,
        modelRegistry: registry,
        isProjectTrusted: () => true,
      }, { get: (target, key) => (key in target ? target[key] : undefined) });
      const onUpdate = (partial) => {
        const text = (partial?.content || []).filter((part) => part.type === "text").map((part) => part.text).join("");
        if (text) api.output(`${text}\n`);
      };
      const result = await tool.execute(api.callId, args, context.abortSignal, onUpdate, ctx);
      return {
        output: (result?.content || []).filter((part) => part.type === "text" || part.type === "image"),
        ...(result?.details !== undefined ? { details: JSON.parse(JSON.stringify(result.details)) } : {}),
      };
    },
  }));
}
