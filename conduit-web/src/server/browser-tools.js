import { Type } from "@earendil-works/pi-ai";
import { callingChat } from "./conduit-mcp.js";

/*
 * The launch options every engine tool repeats are dropped: the hub launched the browser, so they are noise. A tool that
 * acts ends its result with where the browser now is, so an agent can tell an action that did nothing from one that worked.
 */
const SHARED = 0.8;
const READS = /_(snapshot|screenshot|get_[a-z_]+|wait_[a-z_]+|tab_list|find[a-z_]*|is_[a-z_]+|console|errors|cookies[a-z_]*)$/;

function plain(part) {
  if (part?.type !== "text" || !part.text.trimStart().startsWith("{")) return part;
  try {
    const body = JSON.parse(part.text);
    if (!body || typeof body !== "object" || !("data" in body)) return part;
    if (body.data && typeof body.data === "object") delete body.data.lifecycle;
    if (body.success && !body.error) { const data = body.data && Object.keys(body.data).length ? body.data : null; return { ...part, text: data ? JSON.stringify(data) : "Done." }; }
    return { ...part, text: JSON.stringify(body) };
  } catch { return part; }
}

export function hubBrowserTools(runtime, tools) {
  const counts = new Map();
  for (const tool of tools) for (const name of Object.keys(tool.parameters?.properties || {})) counts.set(name, (counts.get(name) || 0) + 1);
  const shared = new Set(tools.length > 4 ? [...counts].filter(([, count]) => count >= tools.length * SHARED).map(([name]) => name) : []);
  const by = new Map(tools.map((tool) => [tool.name, tool]));
  const said = async (suffix, api) => {
    const tool = [...by.values()].find((item) => item.name.endsWith(suffix));
    const result = tool ? await tool.execute({}, api).catch(() => null) : null;
    return result && !result.isError ? String(result.output?.find((part) => part.type === "text")?.text || "").trim().replace(/^"|"$/g, "") : "";
  };
  return tools.map((tool) => {
    const { properties = {}, required = [], ...schema } = tool.parameters || {};
    const kept = Object.fromEntries(Object.entries(properties).filter(([name]) => !shared.has(name) || required.includes(name)));
    const acts = tool.replay !== "safe" && !READS.test(tool.name);
    return { ...tool, parameters: Type.Unsafe({ ...schema, type: "object", properties: kept, required }),
      execute: async (args, api, context) => {
        const result = await tool.execute(args, api, context);
        const output = (result.output || []).map(plain);
        if (!acts || result.isError) return { ...result, output };
        const [title, url] = await Promise.all([said("_get_title", api), said("_get_url", api)]);
        const chat = await callingChat(runtime, api, context).catch(() => null);
        const tabs = runtime.uiControl ? await runtime.uiControl.look().catch(() => []) : [];
        const tab = runtime.uiControl && chat ? await runtime.uiControl.targetFor(chat, tabs).catch(() => null) : null;
        const unseen = tab && !tab.panes.some((pane) => pane.view === "browser:hub");
        const now = [url && `Now at ${title ? `${title} · ` : ""}${url}.`, unseen && "The person is not seeing this browser: conduit_ui open, view browser:hub, beside: true, shows it to them (once; it then follows the page)."].filter(Boolean).join(" ");
        return { ...result, output: now ? [...output, { type: "text", text: now }] : output };
      } };
  });
}
